import type { ThinkInput } from '../contract/types.js';
import type { IMind } from './IMind.js';
import type { IMindBackend } from './IMindBackend.js';
import type { ThinkPrompt } from './prompt.js';
import { ReflexMind } from './ReflexMind.js';

export interface MockMindBackendOptions {
  /**
   * Fail this many times (returning junk) before succeeding — exercises the
   * LlmMind retry + fallback paths deterministically. Default 0.
   */
  failTimes?: number;
  /** Reflex policy whose output the mock serializes as "the model's answer". */
  policy?: IMind;
}

/**
 * Offline/deterministic backend for tests and for running the full Y3
 * cognition path (scheduler, validation, logging, conversations) without a
 * network or an API key. It produces VALID MindOutput JSON by delegating to
 * a reflex policy — so a "mock-LLM" run behaves like reflex but travels the
 * entire async LlmMind → scheduler pipeline, proving the wiring.
 */
export class MockMindBackend implements IMindBackend {
  readonly modelId = 'mock/reflex-policy';
  private readonly policy: IMind;
  private failTimes: number;

  constructor(options: MockMindBackendOptions = {}) {
    this.policy = options.policy ?? new ReflexMind();
    this.failTimes = options.failTimes ?? 0;
  }

  complete(_prompt: ThinkPrompt, input: ThinkInput): Promise<string> {
    if (this.failTimes > 0) {
      this.failTimes--;
      return Promise.resolve('not json — the model glitched');
    }
    const out = this.policy.think(input);
    return Promise.resolve(JSON.stringify(out));
  }
}
