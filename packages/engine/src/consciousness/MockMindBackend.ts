import type { WorldAdapter } from '../contract/adapter.js';
import type { ThinkInput } from '../contract/types.js';
import type { IMind } from './IMind.js';
import type { IMindBackend } from './IMindBackend.js';
import type { ThinkPrompt } from './prompt.js';
import { policyFor } from './policy.js';

interface MockMindBackendBase {
  /**
   * Fail this many times (returning junk) before succeeding — exercises the
   * LlmMind retry + fallback paths deterministically. Default 0.
   */
  readonly failTimes?: number;
}

/**
 * WHERE THE MOCK'S ANSWERS COME FROM, said out loud. It used to fall back to
 * `new ReflexMind()`, which silently made every mock cohort — in any world —
 * think with the forager continent's survival policy (W1-B1 verifier,
 * backlog 2). Now a caller either hands the policy or names the world whose
 * reflex policy to use, and there is no third option.
 */
export type MockMindBackendOptions =
  | (MockMindBackendBase & {
      /** Policy whose output the mock serializes as "the model's answer". */
      readonly policy: IMind;
      readonly world?: never;
    })
  | (MockMindBackendBase & {
      /** The world whose reflex policy answers. */
      readonly world: WorldAdapter;
      readonly policy?: never;
    });

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

  constructor(options: MockMindBackendOptions) {
    this.policy = options.policy ?? policyFor(options.world);
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
