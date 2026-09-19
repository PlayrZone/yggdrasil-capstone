import type { Needs } from '../worlds/forager/types.js';
import { NEED_CRITICAL, NEED_PRESSING } from '../worlds/forager/types.js';
import { attemptPrompt } from '../record/serialize.js';
import type { CognitionAttempt, CognitionRecordV2 } from '../record/types.js';
import { NearDuplicateIndex, contentHash } from './dedupe.js';

/**
 * Fireworks chat fine-tuning example: a (system, user) → assistant turn.
 * The assistant content is the model's accepted JSON output. The Yggdrasil
 * model's ENTIRE training distribution is "being a Gahallian consciousness"
 * — these examples, harvested from real bootstrap-model runs.
 */
export interface TrainingExample {
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
}

/**
 * The pressure band a being was under when it thought. Four bands, because
 * "what did it decide?" means something different at hunger 8 and hunger 90 —
 * and 73% of the old corpus was captured with needs force-reset to near-zero,
 * with nothing in a row saying so (audit 03 §3).
 */
export type NeedRegime = 'satisfied' | 'rising' | 'pressing' | 'critical';

/** Below this, no need is doing anything; `NEED_PRESSING`/`CRITICAL` are the world's own. */
const NEED_RISING = 30;

export interface CurateOptions {
  /**
   * Largest share of the output any single plan shape may hold. Default 0.10
   * (audit 03 §8 item 5). When no cap can reach it — too few distinct
   * behaviours, or a share nothing could satisfy — the TIGHTEST cap is applied
   * instead and `planShapeCap.satisfied` is false. It is never abandoned.
   */
  maxPlanShapeShare?: number;
  /** Cap on one (run × being × need-regime × plan-shape) bucket. Default 16. */
  maxPerBucket?: number;
  /** Cap per trigger type, for corpora dominated by one trigger. Default none. */
  maxPerTrigger?: number;
  /** Estimated shingle Jaccard at which two acts are the same act. Default 0.8. */
  nearDuplicateThreshold?: number;
  /** Exact + near duplicate removal. Default true; false measures what it removes. */
  dedupe?: boolean;
}

/** Every reason a row did not make it. No silent truncation, ever. */
export interface CurationDrops {
  /** The model's answer was rejected by the parser. */
  invalid: number;
  /** The reflex fallback answered — never a training target. */
  reflexFallback: number;
  /** The act never came back before the run ended. */
  unanswered: number;
  /** Accepted attempt missing or empty. */
  noCompletion: number;
  exactDuplicate: number;
  nearDuplicate: number;
  overBucketCap: number;
  overTriggerCap: number;
  overPlanShapeCap: number;
}

/**
 * What the plan-shape cap actually did. `satisfied: false` means no cap could
 * hold the commonest shape to `requestedShare` — the tightest one was applied
 * and `achievedShare` is what came out. The cap used to disable itself in that
 * case and emit the corpus unbalanced with nothing saying so (T1 review §C2),
 * which made `topPlanShapeShare <= 0.1` a property of the test corpus rather
 * than of the curator.
 */
export interface PlanShapeCapReport {
  requestedShare: number;
  /** Rows per shape. null when nothing was capped (every candidate was emitted). */
  appliedCap: number | null;
  /** The share the commonest shape actually holds — equals `topPlanShapeShare`. */
  achievedShare: number;
  satisfied: boolean;
}

export interface CurationResult {
  jsonl: string;
  /** Rows in. */
  input: number;
  kept: number;
  drops: CurationDrops;
  /** Rows that were fit to train on and not a duplicate — the honest denominator. */
  uniqueEligible: number;
  /** kept / uniqueEligible. The audit's ">70% of unique acts" is this number. */
  retainedOfUnique: number;
  byTrigger: Record<string, number>;
  byNeedRegime: Record<NeedRegime, number>;
  planShapes: { shape: string; count: number; share: number }[];
  topPlanShapeShare: number;
  planShapeCap: PlanShapeCapReport;
  distinct: { runs: number; beings: number; planShapes: number };
}

/**
 * The attempt the engine accepted: the last one, which by definition parsed
 * when `parse.valid`. A rejected attempt is kept in the record (it is the most
 * informative row there is) but is never a training target.
 */
export function acceptedAttempt(rec: CognitionRecordV2): CognitionAttempt | null {
  const last = rec.attempts[rec.attempts.length - 1];
  if (!last || last.error !== undefined || !last.raw.trim()) return null;
  return last;
}

export function acceptedCompletion(rec: CognitionRecordV2): string | null {
  return acceptedAttempt(rec)?.raw.trim() ?? null;
}

/**
 * Turn one cognition record into a training example, or null if it isn't fit
 * to train on. We only keep calls the model got RIGHT first or second try —
 * never reflex-fallback outputs (that would teach the model to imitate the
 * dumb policy) and never empty/invalid text.
 *
 * The messages come from the ACCEPTED ATTEMPT, not from `rec.prompt`: a retry
 * is sent the rejection feedback too, so pairing a second-attempt completion
 * with the first attempt's prompt trains the model on a pair that never
 * existed.
 */
export function cognitionToExample(rec: CognitionRecordV2): TrainingExample | null {
  if (!rec.parse.valid || rec.parse.fellBackToReflex || rec.status !== 'answered') return null;
  const accepted = acceptedAttempt(rec);
  if (!accepted) return null;
  const prompt = attemptPrompt(rec, accepted);
  return {
    messages: [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user },
      { role: 'assistant', content: accepted.raw.trim() },
    ],
  };
}

/**
 * Curate a cognition corpus into a balanced JSONL set. Deterministic: same
 * records in the same order, same JSONL out. Reports exactly what it dropped
 * and why — the corpus shapes the model, so the researcher must see the cuts.
 *
 * Three stages, in this order:
 *   1. ELIGIBILITY — invalid, reflex-fallback, unanswered and empty rows go.
 *   2. DUPLICATES — exact by content hash over the whole row, then near by
 *      shingled MinHash over the COMPLETION and the user turn scored
 *      separately (`NEAR_DUPLICATE_COMPLETION_WEIGHT`). The system turn is the
 *      same instruction sheet on every row, and so is most of the user turn:
 *      scoring one concatenated document made two unrelated acts from the same
 *      situation look 0.84–0.97 alike at a populated 3.7 KB prompt.
 *   3. BALANCE — a cap per (run × being × need-regime × plan shape) bucket, an
 *      optional cap per trigger, and finally a plan-shape cap chosen so that no
 *      shape exceeds `maxPlanShapeShare` of what is actually emitted.
 */
export function curateCorpus(records: CognitionRecordV2[], opts: CurateOptions = {}): CurationResult {
  const maxPerBucket = opts.maxPerBucket ?? 16;
  const maxPerTrigger = opts.maxPerTrigger ?? Infinity;
  const maxPlanShapeShare = opts.maxPlanShapeShare ?? 0.1;
  const dedupe = opts.dedupe ?? true;

  const drops: CurationDrops = {
    invalid: 0,
    reflexFallback: 0,
    unanswered: 0,
    noCompletion: 0,
    exactDuplicate: 0,
    nearDuplicate: 0,
    overBucketCap: 0,
    overTriggerCap: 0,
    overPlanShapeCap: 0,
  };

  // ── 1 + 2: eligibility and duplicates ──────────────────────────────────────
  const seenExact = new Set<string>();
  const near = new NearDuplicateIndex(
    opts.nearDuplicateThreshold !== undefined ? { threshold: opts.nearDuplicateThreshold } : {},
  );
  const candidates: { rec: CognitionRecordV2; example: TrainingExample; shape: string; bucket: string }[] = [];

  for (const rec of records) {
    if (rec.status !== 'answered') {
      drops.unanswered++;
      continue;
    }
    if (rec.parse.fellBackToReflex) {
      drops.reflexFallback++;
      continue;
    }
    if (!rec.parse.valid) {
      drops.invalid++;
      continue;
    }
    const example = cognitionToExample(rec);
    if (!example) {
      drops.noCompletion++;
      continue;
    }
    if (dedupe) {
      const context = example.messages[1]!.content;
      const completion = example.messages[2]!.content;
      const hash = contentHash(`${context}\n${completion}`);
      if (seenExact.has(hash)) {
        drops.exactDuplicate++;
        continue;
      }
      seenExact.add(hash);
      if (!near.admit({ completion, context })) {
        drops.nearDuplicate++;
        continue;
      }
    }
    const shape = planShape(rec);
    candidates.push({
      rec,
      example,
      shape,
      bucket: `${rec.runId}|${rec.beingId}|${needRegime(rec)}|${shape}`,
    });
  }
  const uniqueEligible = candidates.length;

  // ── 3a: per-bucket and per-trigger caps ────────────────────────────────────
  const perBucket = new Map<string, number>();
  const perTrigger = new Map<string, number>();
  const balanced: typeof candidates = [];
  for (const c of candidates) {
    const inBucket = perBucket.get(c.bucket) ?? 0;
    if (inBucket >= maxPerBucket) {
      drops.overBucketCap++;
      continue;
    }
    const inTrigger = perTrigger.get(c.rec.trigger) ?? 0;
    if (inTrigger >= maxPerTrigger) {
      drops.overTriggerCap++;
      continue;
    }
    perBucket.set(c.bucket, inBucket + 1);
    perTrigger.set(c.rec.trigger, inTrigger + 1);
    balanced.push(c);
  }

  // ── 3b: the plan-shape cap, over what survived the other caps ──────────────
  const shapeCounts = new Map<string, number>();
  for (const c of balanced) shapeCounts.set(c.shape, (shapeCounts.get(c.shape) ?? 0) + 1);
  const chosen = planShapeCap([...shapeCounts.values()], maxPlanShapeShare);
  const shapeCap = chosen.cap;

  const emittedByShape = new Map<string, number>();
  const byTrigger: Record<string, number> = {};
  const byNeedRegime: Record<NeedRegime, number> = { satisfied: 0, rising: 0, pressing: 0, critical: 0 };
  const runs = new Set<string>();
  const beings = new Set<string>();
  const lines: string[] = [];
  for (const c of balanced) {
    const emitted = emittedByShape.get(c.shape) ?? 0;
    if (emitted >= shapeCap) {
      drops.overPlanShapeCap++;
      continue;
    }
    emittedByShape.set(c.shape, emitted + 1);
    byTrigger[c.rec.trigger] = (byTrigger[c.rec.trigger] ?? 0) + 1;
    byNeedRegime[needRegime(c.rec)]++;
    runs.add(c.rec.runId);
    beings.add(`${c.rec.runId}:${c.rec.beingId}`);
    lines.push(JSON.stringify(c.example));
  }

  const kept = lines.length;
  const planShapes = [...emittedByShape.entries()]
    .map(([shape, count]) => ({ shape, count, share: ratio(count, kept) }))
    .sort((a, b) => b.count - a.count || (a.shape < b.shape ? -1 : 1));

  return {
    jsonl: lines.join('\n'),
    input: records.length,
    kept,
    drops,
    uniqueEligible,
    retainedOfUnique: ratio(kept, uniqueEligible),
    byTrigger,
    byNeedRegime,
    planShapes,
    topPlanShapeShare: planShapes[0]?.share ?? 0,
    planShapeCap: {
      requestedShare: maxPlanShapeShare,
      appliedCap: Number.isFinite(shapeCap) ? shapeCap : null,
      achievedShare: ratio(chosen.achieved.peak, chosen.achieved.total),
      satisfied: chosen.satisfied,
    },
    distinct: { runs: runs.size, beings: beings.size, planShapes: planShapes.length },
  };
}

interface ChosenCap {
  /** Infinity ⇒ nothing is dropped; every candidate is emitted. */
  cap: number;
  /** The concentration that cap produces, as an exact fraction. */
  achieved: { peak: number; total: number };
  satisfied: boolean;
}

/**
 * The per-shape cap to apply. Both the biggest shape and the total grow with
 * the cap, so this walks the candidate caps rather than assuming the constraint
 * is monotone.
 *
 * Preference order: the LARGEST cap that respects `share` (it satisfies the
 * request while keeping the most rows). When no cap can — fewer distinct
 * behaviours than `1 / share`, or a share of 0 nothing could reach — the cap
 * that MINIMISES the achieved share is applied instead, ties going to the
 * larger cap. It previously gave up and returned Infinity there, so asking for
 * stricter balance silently turned balancing off.
 */
function planShapeCap(counts: number[], share: number): ChosenCap {
  if (counts.length === 0) return { cap: Infinity, achieved: { peak: 0, total: 0 }, satisfied: true };
  const largest = Math.max(...counts);
  let satisfiedCap = 0;
  let satisfiedAt = { peak: 0, total: 0 };
  let tightestCap = largest;
  let tightestAt = { peak: 1, total: 1 };
  for (let cap = 1; cap <= largest; cap++) {
    let total = 0;
    let peak = 0;
    for (const c of counts) {
      const take = Math.min(c, cap);
      total += take;
      if (take > peak) peak = take;
    }
    // `<=` so a tie takes the larger cap: same concentration, more rows kept.
    if (peak * tightestAt.total <= tightestAt.peak * total) {
      tightestCap = cap;
      tightestAt = { peak, total };
    }
    if (peak <= share * total) {
      satisfiedCap = cap;
      satisfiedAt = { peak, total };
    }
  }
  const [cap, achieved, satisfied] =
    satisfiedCap > 0
      ? ([satisfiedCap, satisfiedAt, true] as const)
      : ([tightestCap, tightestAt, false] as const);
  return { cap: cap >= largest ? Infinity : cap, achieved, satisfied };
}

/** Coarse signature of a plan — the ordered intent kinds the mind chose. */
export function planShape(rec: CognitionRecordV2): string {
  const plan = rec.parsedOutput.plan;
  return plan.length > 0 ? plan.map((i) => i.kind).join('>') : 'noplan';
}

/** The pressure band the being was under when the prompt was built. */
export function needRegime(rec: CognitionRecordV2): NeedRegime {
  // This world's four drives; B5 reads them from the adapter, as the prompt will.
  const n = rec.thinkInput.snapshot.needs as Needs;
  const peak = Math.max(n.hunger, n.rest, n.safety, n.socialConnection);
  if (peak >= NEED_CRITICAL) return 'critical';
  if (peak >= NEED_PRESSING) return 'pressing';
  return peak >= NEED_RISING ? 'rising' : 'satisfied';
}

function ratio(n: number, d: number): number {
  return d > 0 ? Math.round((n / d) * 10000) / 10000 : 0;
}
