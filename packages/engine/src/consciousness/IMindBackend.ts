import type { ThinkInput } from '../contract/types.js';
import type { ThinkPrompt } from './prompt.js';

/**
 * Provider seam for LLM-backed minds. The backend is pure transport:
 * messages in, raw model text out. Parsing/validation/retry/fallback all live
 * in LlmMind, so swapping providers (Fireworks → fine-tuned Yggdrasil model
 * → Ollama) never touches cognition logic. Fireworks is the primary target.
 */
export interface IMindBackend {
  /** Model identity for the run record (e.g. a Fireworks model id). */
  readonly modelId: string;
  /**
   * @param prompt  the EXACT messages to send — already composed by LlmMind,
   *   retry feedback included. A backend sends these bytes and nothing else.
   *   It used to receive the ThinkInput and rebuild the prompt itself, which
   *   meant the record stored `retryPrompt(buildThinkPrompt(input@T0))` while
   *   the wire carried `retryPrompt(buildThinkPrompt(input@T1))` — the same
   *   object, rewritten by the miners in between. What is recorded is now what
   *   was sent, for every backend, by construction.
   * @param input   the situation those messages were built from, for backends
   *   that REASON rather than transport (mocks, replays, local policies).
   *   Never re-compose a prompt from it.
   * @returns raw model text (expected to contain the MindOutput JSON)
   */
  complete(prompt: ThinkPrompt, input: ThinkInput): Promise<string>;
}
