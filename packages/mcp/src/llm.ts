import { FireworksMindBackend } from '@yggdrasil/engine';
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
