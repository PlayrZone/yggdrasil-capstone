import type { CognitionAttempt, CognitionRecordV2 } from '../record/types.js';

/**
 * Fireworks chat fine-tuning example: a (system, user) → assistant turn.
 * The assistant content is the model's accepted JSON output. The Yggdrasil
 * model's ENTIRE training distribution is "being a Gahallian consciousness"
 * — these examples, harvested from real bootstrap-model runs.
 */
export interface TrainingExample {
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
}

export interface CurateOptions {
  /** Cap examples per trigger type so common triggers don't swamp rare ones. */
  maxPerTrigger?: number;
  /** Drop near-duplicate (trigger + plan-shape) examples beyond this many. */
  dedupe?: boolean;
}

export interface CurationResult {
  jsonl: string;
  kept: number;
  droppedInvalid: number;
  droppedDuplicate: number;
  droppedOverCap: number;
  byTrigger: Record<string, number>;
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
  if (!rec.parse.valid || rec.parse.fellBackToReflex) return null;
  const accepted = acceptedAttempt(rec);
  if (!accepted) return null;
  return {
    messages: [
      { role: 'system', content: accepted.prompt.system },
      { role: 'user', content: accepted.prompt.user },
      { role: 'assistant', content: accepted.raw.trim() },
    ],
  };
}

/**
 * Curate a cognition corpus into a balanced JSONL set. Deterministic: same
 * records in, same JSONL out. Reports exactly what it dropped and why — no
 * silent truncation (the corpus shapes the model; the researcher must see
 * the cuts).
 *
 * NOTE (audit 03 §5): the dedupe key is trigger + plan shape, which caps the
 * output at the size of that key space no matter how much data goes in and
 * deletes all linguistic variety. Replacing it is a separate rework item;
 * `summarizeCorpus` reports the key-space share so the cap is at least visible.
 */
export function curateCorpus(records: CognitionRecordV2[], opts: CurateOptions = {}): CurationResult {
  const maxPerTrigger = opts.maxPerTrigger ?? Infinity;
  const dedupe = opts.dedupe ?? true;

  let droppedInvalid = 0;
  let droppedDuplicate = 0;
  let droppedOverCap = 0;
  const byTrigger: Record<string, number> = {};
  const seenShapes = new Set<string>();
  const lines: string[] = [];

  for (const rec of records) {
    const example = cognitionToExample(rec);
    if (!example) {
      droppedInvalid++;
      continue;
    }
    if (dedupe) {
      const shape = `${rec.trigger}|${planShape(rec)}`;
      if (seenShapes.has(shape)) {
        droppedDuplicate++;
        continue;
      }
      seenShapes.add(shape);
    }
    const count = byTrigger[rec.trigger] ?? 0;
    if (count >= maxPerTrigger) {
      droppedOverCap++;
      continue;
    }
    byTrigger[rec.trigger] = count + 1;
    lines.push(JSON.stringify(example));
  }

  return {
    jsonl: lines.join('\n'),
    kept: lines.length,
    droppedInvalid,
    droppedDuplicate,
    droppedOverCap,
    byTrigger,
  };
}

/** Coarse signature of a plan — the ordered intent kinds the mind chose. */
export function planShape(rec: CognitionRecordV2): string {
  const plan = rec.parsedOutput.plan;
  return plan.length > 0 ? plan.map((i) => i.kind).join('>') : 'noplan';
}
