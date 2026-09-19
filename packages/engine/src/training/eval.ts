import type { ThinkInput } from '../contract/types.js';
import type { IMindBackend } from '../consciousness/IMindBackend.js';
import { buildThinkPrompt } from '../consciousness/prompt.js';
import { MindOutputError, parseMindOutputDetailed, utteranceHasContent } from '../consciousness/schema.js';
/**
 * Gate 1 of the eval suite a fine-tuned Yggdrasil model must clear before it
 * replaces the bootstrap model (config-only swap, so the gates are the only
 * safeguard). Pure + backend-agnostic: run it against any IMindBackend, and it
 * never touches a world, a file or a clock.
 *
 * Gate 2 — knowledge fidelity — is a battery, a matcher and a judge seam, and
 * lives in `fidelity.ts`.
 */

export interface ValidityResult {
  total: number;
  valid: number;
  rate: number;
  /**
   * Rejections by parser reason (`no-decision`, `json-in-prose`, …). A validity
   * rate with no breakdown beside it is the number that read 100% while `{}`
   * counted as a decision.
   */
  byReason: Record<string, number>;
  /** Accepted, but only because the object came inside a ``` fence. */
  salvagedFenced: number;
  /**
   * Valid outputs whose whole decision was to idle: a plan of nothing but
   * `Idle` (or no plan at all) and nothing said. A model that answers
   * `{"plan":[{"kind":"Idle"}]}` to everything scores 100% validity, so the
   * rate alone cannot tell it from a mind. These three are not a partition —
   * `acting` and `speaking` overlap — but `idleOnly` is disjoint from both,
   * and a gate read without it is a gate that rewards doing nothing well.
   */
  idleOnly: number;
  /** Valid outputs that chose at least one intent other than `Idle`. */
  acting: number;
  /** Valid outputs that said something with content in it (empty speech is not speech). */
  speaking: number;
}

/** Gate 1: JSON validity — the fine-tune must be ≥ the bootstrap's rate. */
export async function evalJsonValidity(backend: IMindBackend, inputs: ThinkInput[]): Promise<ValidityResult> {
  let valid = 0;
  let salvagedFenced = 0;
  let idleOnly = 0;
  let acting = 0;
  let speaking = 0;
  const byReason: Record<string, number> = {};
  for (const input of inputs) {
    try {
      const parsed = parseMindOutputDetailed(await backend.complete(buildThinkPrompt(input), input));
      valid++;
      if (parsed.salvage === 'fenced') salvagedFenced++;
      const acts = parsed.output.plan.some((intent) => intent.kind !== 'Idle');
      const says = parsed.output.utterances.some(utteranceHasContent);
      if (acts) acting++;
      if (says) speaking++;
      if (!acts && !says) idleOnly++;
    } catch (err) {
      if (!(err instanceof MindOutputError)) throw err; // transport errors surface
      byReason[err.reason] = (byReason[err.reason] ?? 0) + 1;
    }
  }
  return {
    total: inputs.length,
    valid,
    rate: inputs.length ? valid / inputs.length : 0,
    byReason,
    salvagedFenced,
    idleOnly,
    acting,
    speaking,
  };
}
