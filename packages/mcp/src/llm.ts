import { FireworksMindBackend, MockMindBackend, foragerAdapter } from '@yggdrasil/engine';
import type { IMindBackend } from '@yggdrasil/engine';

/**
 * The LLM consciousness is the point of the lab — it is what we run the world
 * to TRAIN. Experiments use a Fireworks-backed mind by default. The model
 * defaults to the validated teacher (gpt-oss-120b); point FIREWORKS_MODEL at
 * the fine-tuned Yggdrasil model once it is served to close the loop.
 *
 * The key is read from the environment only — never logged, never persisted,
 * never sent anywhere but Fireworks.
 */
export const DEFAULT_MODEL = 'accounts/fireworks/models/gpt-oss-120b';

export function hasLlmKey(): boolean {
  return !!process.env['FIREWORKS_API_KEY'];
}

export function llmModelId(): string {
  return process.env['FIREWORKS_MODEL'] ?? DEFAULT_MODEL;
}

/** Build the LLM backend from env, or null if no key is configured. */
export function makeLlmBackend(): IMindBackend | null {
  const apiKey = process.env['FIREWORKS_API_KEY'];
  if (!apiKey) return null;
  return new FireworksMindBackend({ apiKey, model: llmModelId() });
}

/**
 * Which backend an EVAL may use, and whether it is allowed to cost anything.
 *
 * The eval gates are read-only in effect — they touch no world, no file and no
 * DB row — but against a configured Fireworks model one run is dozens of
 * completions of a paid endpoint. So a keyed lab refuses unless the caller has
 * said `allowPaid`, and an unkeyed one scores the offline mock, which costs
 * nothing and still proves the gate is wired.
 */
export interface EvalBackendChoice {
  backend: IMindBackend | null;
  paid: boolean;
  /** Set when nothing may run; the text explains the cost that was declined. */
  refusal?: string;
}

export function evalBackend(calls: number, allowPaid: boolean | undefined): EvalBackendChoice {
  const paid = makeLlmBackend();
  // The mock answers with a reflex policy, and W1-B2 makes it say whose: this
  // lab runs the forager continent.
  if (!paid) return { backend: new MockMindBackend({ world: foragerAdapter }), paid: false };
  if (!allowPaid) {
    return {
      backend: null,
      paid: true,
      refusal: [
        `refused: this lab is configured with a paid model (${llmModelId()}).`,
        `Running this would send ${calls} completions to it.`,
        'Re-run with allowPaid: true to accept the cost, or unset FIREWORKS_API_KEY to score the offline mock instead.',
      ].join('\n'),
    };
  }
  return { backend: paid, paid: true };
}
