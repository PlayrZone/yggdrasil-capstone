/**
 * COMMITMENT AND A KEYED STREAM — so that "the key is sealed" is true against a
 * reader of the result, not only against the judge.
 *
 * ROUND 2's BLINDING WAS INVERTIBLE BY ANYONE HOLDING THE RESULT. The
 * permutation was drawn from `mulberry32(hashSeed('blind:' + seed))`, the seed
 * defaulted to the run seeds joined, and the manifest printed it beside the
 * traces. Re-running the public `blindTraces` on a dummy pool of the same size,
 * in the documented pooled-arm order, recovered **8 of 8 arms by position**
 * without ever touching the key. The judge never saw a seed, so this was not
 * round 1's format tell — but every human and every agent that read the result
 * object or the MCP JSON was fully unblinded.
 *
 * Two things fix it, and both are needed:
 *
 *   A SECRET, NOT A SEED. The permutation and the handle stream are keyed by a
 *   per-run secret that appears in no result, no manifest, no spend log and no
 *   tool output. It lives inside the sealed key object and comes out only when
 *   the key is unsealed. Nothing here writes it to disk: a secret that is
 *   persisted is a secret that is findable, and the run that needs it is the
 *   run that is still in memory.
 *
 *   A COMMITMENT, SO THE RUN STAYS AUDITABLE. The published artefact carries
 *   `sha256("yggdrasil/blind-commit/v1:" + secret)`. Before unsealing it says
 *   nothing; after unsealing, an auditor recomputes it from the disclosed
 *   secret, re-runs `blindTraces` with that secret, and gets the same handles in
 *   the same order. "The handles were shuffled by something you did not have"
 *   is then a checkable claim rather than a promise.
 *
 * ENTROPY, AND WHY NOT `mulberry32`. Its state is 32 bits, so every permutation
 * it can draw is one of 2³², and an attacker holding the published handles can
 * enumerate that space offline and match them. The stream here is SHA-256 in
 * counter mode over the secret, so the permutation carries the secret's entropy
 * and not the PRNG's.
 */

const COMMIT_DOMAIN = 'yggdrasil/blind-commit/v1:';
const STREAM_DOMAIN = 'yggdrasil/blind-stream/v1:';

/** 32 hex characters — 128 bits from the host's CSPRNG. */
export function randomBlindSecret(): string {
  const source = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (!source?.getRandomValues) {
    // Refusing beats degrading: a blinding whose secret came from `Math.random`
    // is a blinding an attacker can search, and it would still SAY it was sealed.
    throw new Error(
      'no cryptographic random source: this host cannot draw a blinding secret. ' +
        'Pass `secret` explicitly (tests do) rather than blinding with something guessable.',
    );
  }
  const bytes = source.getRandomValues(new Uint8Array(16));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The value a published artefact may carry. Reveals nothing until the secret is disclosed. */
export function commitTo(secret: string): string {
  return sha256Hex(`${COMMIT_DOMAIN}${secret}`);
}

/** Does this disclosed secret match the commitment the run published? */
export function verifyCommitment(secret: string, commitment: string): boolean {
  return commitTo(secret) === commitment;
}

/**
 * A float stream keyed by the secret: SHA-256 in counter mode, eight 32-bit
 * words per digest. Deterministic given the secret, and unreachable without it.
 */
export function keyedStream(secret: string): () => number {
  let counter = 0;
  let words: number[] = [];
  let at = 0;
  return function next(): number {
    if (at >= words.length) {
      words = sha256Words(`${STREAM_DOMAIN}${secret}:${counter++}`);
      at = 0;
    }
    return (words[at++]! >>> 0) / 4294967296;
  };
}

// ─── SHA-256 ─────────────────────────────────────────────────────────────────

const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

/** The digest as eight 32-bit words. */
export function sha256Words(text: string): number[] {
  const bytes = utf8(text);
  const length = bytes.length;
  const padded = new Uint8Array((((length + 8) >> 6) + 1) * 64);
  padded.set(bytes);
  padded[length] = 0x80;
  const bits = length * 8;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 4, bits >>> 0, false);
  view.setUint32(padded.length - 8, Math.floor(bits / 4294967296), false);

  const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const w = new Array<number>(64);
  for (let block = 0; block < padded.length; block += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(block + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15]!, 7) ^ rotr(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3);
      const s1 = rotr(w[i - 2]!, 17) ^ rotr(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) | 0;
    }
    let [a, b, c, d, e, f, g, hh] = h as [number, number, number, number, number, number, number, number];
    for (let i = 0; i < 64; i++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + s1 + ch + K[i]! + w[i]!) | 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + maj) | 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    const next = [a, b, c, d, e, f, g, hh];
    for (let i = 0; i < 8; i++) h[i] = (h[i]! + next[i]!) | 0;
  }
  return h;
}

export function sha256Hex(text: string): string {
  return sha256Words(text)
    .map((word) => (word >>> 0).toString(16).padStart(8, '0'))
    .join('');
}

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

/** UTF-8 without `TextEncoder`, so the engine needs no host API here either. */
function utf8(text: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const low = text.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
        i++;
      }
    }
    if (code < 0x80) out.push(code);
    else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code < 0x10000) out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    else out.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
  }
  return Uint8Array.from(out);
}
