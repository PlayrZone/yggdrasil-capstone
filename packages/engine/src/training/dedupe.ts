/**
 * Exact and near-duplicate detection over text. No dependency, no model, no
 * embedding service: shingled MinHash with banded LSH, which is deterministic
 * and runs over a 10k-row corpus in a second.
 *
 * It exists because `curateCorpus`'s old "dedupe" was a key of
 * `trigger | ordered intent kinds` — a key space of ~278 values that capped the
 * output at 278 examples no matter how much data went in, and collapsed two
 * beings reasoning completely differently to the same `MoveTo>Sleep` into one
 * row (audit 03 §5: "a cap dressed as dedup").
 *
 * Similarity is measured over 5-token shingles. Jaccard is estimated from the
 * MinHash signatures; `shingleJaccard` computes it exactly, for verification of
 * a finished set (cheap at the sizes an output has, too slow for the scan).
 *
 * A training row is TWO parts, not one document — see
 * `NEAR_DUPLICATE_COMPLETION_WEIGHT`.
 */

const SHINGLE_TOKENS = 5;
const PERMUTATIONS = 64;
/** 16 bands × 4 rows: ~99.9% recall at J=0.8, and candidates stay bounded. */
const BAND_ROWS = 4;
const BANDS = PERMUTATIONS / BAND_ROWS;

/**
 * How much of the similarity score the COMPLETION carries; the context (the
 * prompt the completion answered) carries the rest.
 *
 * A row's prompt is ~90% the same instruction sheet, headings and phrasing on
 * every row, so scoring one concatenated document measures the boilerplate.
 * Measured on real `buildThinkPrompt` output (test/dedupe.test.ts): two beings
 * in the SAME situation giving completely unrelated answers scored J 0.64–0.92
 * at a 1.3 KB prompt and 0.84–0.97 at a 3.7 KB one — i.e. a populated being's
 * unrelated acts all collapsed into a single row at the 0.8 threshold.
 *
 * At 0.75 the arithmetic is a guarantee rather than a hope: a pair cannot reach
 * a 0.8 threshold unless the two ANSWERS agree at J ≥ (0.8 − 0.25) / 0.75 =
 * 0.733, however identical their prompts are.
 */
export const NEAR_DUPLICATE_COMPLETION_WEIGHT = 0.75;

/** Fixed multipliers/addends — the same text always signs the same way. */
const PERM_A = new Int32Array(PERMUTATIONS);
const PERM_B = new Int32Array(PERMUTATIONS);
for (let k = 0, h = 0x9e3779b9; k < PERMUTATIONS; k++) {
  h = mix32(h + 0x85ebca6b);
  PERM_A[k] = h | 1; // odd, so multiplication is a bijection mod 2^32
  h = mix32(h + 0xc2b2ae35);
  PERM_B[k] = h;
}

export interface NearDuplicateOptions {
  /** Estimated Jaccard at or above which two texts are the same act. Default 0.8. */
  threshold?: number;
}

/**
 * The two parts of a training row. They are scored separately because they are
 * not the same kind of evidence: the completion is what the mind produced, the
 * context is the situation it was handed and is largely fixed boilerplate.
 */
export interface DuplicateDocument {
  completion: string;
  /** Omitted ⇒ the completion is scored alone, as a single-string `admit` is. */
  context?: string;
}

interface Entry {
  completion: Uint32Array;
  /** null when the caller gave no context, or gave one nothing could be read from. */
  context: Uint32Array | null;
}

/**
 * Streaming near-duplicate filter. Deterministic and order-dependent by design:
 * the first text of a cluster is kept and the rest are refused, so the same
 * corpus in the same order always curates to the same set.
 */
export class NearDuplicateIndex {
  private readonly threshold: number;
  private readonly entries: Entry[] = [];
  private readonly buckets = new Map<string, number[]>();
  private admitted = 0;

  constructor(options: NearDuplicateOptions = {}) {
    this.threshold = options.threshold ?? 0.8;
  }

  get size(): number {
    return this.admitted;
  }

  /** Add `document` unless something within the threshold is already here. */
  admit(document: string | DuplicateDocument): boolean {
    const parts = typeof document === 'string' ? { completion: document } : document;
    const completionShingles = shingles(parts.completion);
    // Nothing shingleable is NO EVIDENCE of duplication, not proof of it. Such
    // a row is admitted and left out of the index: it can neither suppress nor
    // be suppressed. Exact repeats are `contentHash`'s job upstream.
    if (completionShingles.length === 0) {
      this.admitted++;
      return true;
    }
    const signature = signatureFrom(completionShingles);
    const contextShingles = parts.context !== undefined ? shingles(parts.context) : [];
    const contextSignature = contextShingles.length > 0 ? signatureFrom(contextShingles) : null;

    const w = NEAR_DUPLICATE_COMPLETION_WEIGHT;
    const keys = bandKeys(signature);
    const seen = new Set<number>();
    for (const key of keys) {
      for (const index of this.buckets.get(key) ?? []) {
        if (seen.has(index)) continue;
        seen.add(index);
        const other = this.entries[index]!;
        const completionAgreement = agreement(signature, other.completion);
        // With no context on one side there is one signal, and the score is it
        // — which is exactly what a single-string `admit` used to mean.
        const contextAgreement =
          contextSignature && other.context ? agreement(contextSignature, other.context) : completionAgreement;
        if (w * completionAgreement + (1 - w) * contextAgreement >= this.threshold) return false;
      }
    }
    const index = this.entries.push({ completion: signature, context: contextSignature }) - 1;
    this.admitted++;
    for (const key of keys) {
      const bucket = this.buckets.get(key);
      if (bucket) bucket.push(index);
      else this.buckets.set(key, [index]);
    }
    return true;
  }
}

/** Exact-duplicate key: a 128-bit content hash, cheaper to hold than the text. */
export function contentHash(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  let c = 0x9e3779b9;
  let d = 0x85ebca6b;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    a = Math.imul(a ^ ch, 0x01000193);
    b = Math.imul(b + ch, 0x85ebca6b) ^ (b >>> 7);
    c = mix32(c ^ Math.imul(ch + i, 0xc2b2ae35));
    d = Math.imul(d ^ (ch + (i << 3)), 0x27d4eb2f);
  }
  return [a, b, c, d].map((v) => (v >>> 0).toString(16).padStart(8, '0')).join('');
}

/**
 * The exact shingle Jaccard of two texts — the ground truth the sketch
 * estimates. Zero when either side has no shingles at all: a text nothing can
 * be read from carries NO EVIDENCE of similarity, and calling two of them
 * identical is how every non-ASCII row after the first used to be dropped.
 */
export function shingleJaccard(a: string, b: string): number {
  const sa = new Set(shingles(a));
  const sb = new Set(shingles(b));
  if (sa.size === 0 || sb.size === 0) return 0;
  let shared = 0;
  for (const s of sa) if (sb.has(s)) shared++;
  return shared / (sa.size + sb.size - shared);
}

function signatureFrom(hashes: number[]): Uint32Array {
  const signature = new Uint32Array(PERMUTATIONS).fill(0xffffffff);
  for (const h of hashes) {
    for (let k = 0; k < PERMUTATIONS; k++) {
      const v = (Math.imul(h, PERM_A[k]!) + PERM_B[k]!) >>> 0;
      if (v < signature[k]!) signature[k] = v;
    }
  }
  return signature;
}

function agreement(a: Uint32Array, b: Uint32Array): number {
  let same = 0;
  for (let k = 0; k < PERMUTATIONS; k++) if (a[k] === b[k]) same++;
  return same / PERMUTATIONS;
}

function bandKeys(signature: Uint32Array): string[] {
  const keys: string[] = [];
  for (let band = 0; band < BANDS; band++) {
    let key = `${band}`;
    for (let row = 0; row < BAND_ROWS; row++) key += `:${signature[band * BAND_ROWS + row]}`;
    keys.push(key);
  }
  return keys;
}

/** Distinct hashes of the 5-token windows of `text`. */
function shingles(text: string): number[] {
  const tokens = tokenize(text);
  if (tokens.length === 0) return [];
  const tokenHashes = tokens.map(fnv1a);
  if (tokens.length < SHINGLE_TOKENS) return [...new Set(tokenHashes)];
  const out = new Set<number>();
  for (let i = 0; i + SHINGLE_TOKENS <= tokenHashes.length; i++) {
    let h = 0x811c9dc5;
    for (let j = 0; j < SHINGLE_TOKENS; j++) h = mix32(h ^ tokenHashes[i + j]!);
    out.add(h >>> 0);
  }
  return [...out];
}

const NON_ASCII = /[^ -]/;
const ASCII_SPLIT = /[^a-z0-9]+/;
const TOKEN_RUN = /[\p{L}\p{N}\p{M}]+|\p{Extended_Pictographic}/gu;
/**
 * Scripts written without spaces. One `\p{L}` run of these is a whole sentence,
 * which would give a document one token and therefore no shingles, so each of
 * their characters is tokenised on its own — character shingles inside the
 * word-shingle scheme. Coarser than a real segmenter and deliberately so: no
 * dependency, and near-duplicate detection only needs the two texts to disagree
 * in the same places a reader would.
 */
const UNSEGMENTED = /[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}\p{sc=Thai}\p{sc=Khmer}\p{sc=Lao}\p{sc=Myanmar}\p{sc=Tibetan}]/u;

/**
 * Tokens for shingling, Unicode-aware. The old `/[^a-z0-9]+/` split left every
 * CJK, emoji or punctuation-only document with an EMPTY token set, which made
 * all of them identical to one another (T1 review §C1).
 *
 * Marks stay attached to their letter and the text is NFC'd first, so the
 * composed and decomposed spellings of "café" tokenise alike; pictographs are
 * tokens in their own right. ASCII — every prompt this engine actually sends —
 * takes the old fast path, which is provably the same tokenisation there (no
 * ASCII code point is a letter, digit, mark or pictograph under one definition
 * and not the other) and keeps the 10k scan cheap.
 */
function tokenize(text: string): string[] {
  const lowered = text.toLowerCase();
  if (!NON_ASCII.test(lowered)) return lowered.split(ASCII_SPLIT).filter(Boolean);
  const out: string[] = [];
  for (const match of lowered.normalize('NFC').matchAll(TOKEN_RUN)) {
    const run = match[0]!;
    if (!UNSEGMENTED.test(run)) {
      out.push(run);
      continue;
    }
    let word = '';
    for (const ch of run) {
      if (!UNSEGMENTED.test(ch)) {
        word += ch;
        continue;
      }
      if (word) {
        out.push(word);
        word = '';
      }
      out.push(ch);
    }
    if (word) out.push(word);
  }
  return out;
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

function mix32(h: number): number {
  let v = h | 0;
  v ^= v >>> 16;
  v = Math.imul(v, 0x7feb352d);
  v ^= v >>> 15;
  v = Math.imul(v, 0x846ca68b);
  v ^= v >>> 16;
  return v | 0;
}
