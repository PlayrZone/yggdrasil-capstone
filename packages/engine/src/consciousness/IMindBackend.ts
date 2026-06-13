import type { ThinkInput } from '../contract/types.js';

/**
 * Provider seam for LLM-backed minds. The backend is pure transport:
 * prompt in, raw model text out. Parsing/validation/retry/fallback all live
 * in LlmMind, so swapping providers (Fireworks → fine-tuned Yggdrasil model
 * → Ollama) never touches cognition logic. Fireworks is the primary target.
 */
export interface IMindBackend {
  /** Model identity for the run record (e.g. a Fireworks model id). */
  readonly modelId: string;
  /**
   * @param input        the agent's situation to reason about
   * @param retryError   when set, the previous output was rejected for this
   *                     reason; the backend should append it so the model
   *                     can correct itself.
   * @returns raw model text (expected to contain the MindOutput JSON)
   */
  complete(input: ThinkInput, retryError?: string): Promise<string>;
}
