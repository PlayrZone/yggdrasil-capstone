import type { CognitionRecord } from '../consciousness/LlmMind.js';

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
 * Turn one cognition record into a training example, or null if it isn't fit
 * to train on. We only keep calls the model got RIGHT first or second try —
 * never reflex-fallback outputs (that would teach the model to imitate the
 * dumb policy) and never empty/invalid text.
 */
export function cognitionToExample(rec: CognitionRecord): TrainingExample | null {
  if (!rec.valid || rec.fellBackToReflex) return null;
  if (!rec.rawOutput.trim()) return null;
  return {
    messages: [
      { role: 'system', content: rec.systemPrompt },
      { role: 'user', content: rec.userPrompt },
      { role: 'assistant', content: rec.rawOutput },
    ],
  };
}

/**
 * Curate a cognition_log into a balanced JSONL corpus. Deterministic: same
 * records in, same JSONL out. Reports exactly what it dropped and why — no
 * silent truncation (the corpus shapes the model; the researcher must see
 * the cuts).
 */
export function curateCorpus(records: CognitionRecord[], opts: CurateOptions = {}): CurationResult {
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
      const shape = `${rec.trigger}|${planShape(rec.rawOutput)}`;
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

/** Coarse signature of a plan for dedupe — the ordered intent kinds. */
function planShape(raw: string): string {
  try {
    const data = JSON.parse(raw) as { plan?: { kind?: unknown }[] };
    if (!Array.isArray(data.plan)) return 'noplan';
    return data.plan.map((i) => String(i.kind)).join('>');
  } catch {
    return 'unparsed';
  }
}
