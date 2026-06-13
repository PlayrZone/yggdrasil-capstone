import type { IMindBackend, ThinkInput } from '@yggdrasil/engine';

/**
 * The renderer-side mind backend. It is pure transport: it forwards the
 * agent's situation to the main process (where the Fireworks key lives) and
 * returns the model's raw text. All parsing/validation/fallback stays in the
 * engine's LlmMind — this just carries bytes across the IPC seam.
 */
export class BridgeBackend implements IMindBackend {
  constructor(readonly modelId: string) {}

  complete(input: ThinkInput, retryError?: string): Promise<string> {
    const lab = window.lab;
    if (!lab) return Promise.reject(new Error('NO_BRIDGE'));
    return lab.llmComplete(input, retryError);
  }
}
