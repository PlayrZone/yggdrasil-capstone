import type { MindOutput, ThinkInput } from '../contract/types.js';

/**
 * Consciousness: reasons, plans, communicates — using knowledge it did not
 * create and is not allowed to invent (V2). Sync for deterministic minds;
 * the Y3 LlmMind returns a promise via the async variant on IMindBackend.
 */
export interface IMind {
  think(input: ThinkInput): MindOutput;
}
