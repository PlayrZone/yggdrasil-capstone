import type { WorldAdapter } from '../contract/adapter.js';
import { encodeOutput } from '../contract/wire.js';
import type { ThinkInput } from '../contract/types.js';
import type { IMind } from './IMind.js';
import type { IMindBackend } from './IMindBackend.js';
import type { ThinkPrompt } from './prompt.js';
import { policyFor } from './policy.js';

/**
 * WHOSE WORLD, AND WHERE THE ANSWERS COME FROM, both said out loud.
 *
 * `world` is REQUIRED, and it is required for two different reasons that used to
 * be one. It says whose reflex policy answers when no policy is handed over — it
 * used to fall back to `new ReflexMind()`, which silently made every mock cohort
 * in any world think with the forager continent's instincts (W1-B1 verifier,
 * backlog 2). And it says how an answer is WRITTEN DOWN, which is the fix for
 * the W1-B4 verifier's fail: a policy's `MindOutput` carries an opaque
 * `PlaceRef`, a model writes this world's WIRE fields, and the two are not the
 * same bytes. The `{policy}` branch used to forbid `world` outright, which is
 * exactly how a policy's answer came to be serialized as a mind's shape.
 */
export interface MockMindBackendOptions {
  /** The world this mock is answering in: whose policy, and whose wire. */
  readonly world: WorldAdapter;
  /** Policy whose output the mock writes as "the model's answer". Default: the world's reflex. */
  readonly policy?: IMind;
  /**
   * Fail this many times (returning junk) before succeeding — exercises the
   * LlmMind retry + fallback paths deterministically. Default 0.
   */
  readonly failTimes?: number;
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
  private readonly world: WorldAdapter;
  private readonly policy: IMind;
  private failTimes: number;

  constructor(options: MockMindBackendOptions) {
    this.world = options.world;
    this.policy = options.policy ?? policyFor(options.world);
    this.failTimes = options.failTimes ?? 0;
  }

  /**
   * A MOCK PLAYS THE MODEL, SO IT WRITES WHAT A MODEL WRITES (W1-B4 verifier,
   * the fail). It used to `JSON.stringify` the policy's own `MindOutput`, which
   * since W1-B4 carries `place: PlaceRef` — so the mock wrote
   * `{"kind":"MoveTo","place":{"x":900,"y":120}}` where a model writes
   * `{"kind":"MoveTo","x":900,"y":120}`, and `parseMindOutput` — which reads the
   * world's `SpaceOps.fields` at the TOP level — dropped it. Every mock-driven
   * being lost its destination, including the pilgrimage toward a story's site
   * that the whole sacred-place machinery exists to measure.
   *
   * `encodeOutput` is the codec that already existed for the body and the
   * recorder; this is the third seam it never reached. Nothing else here
   * changed, so a policy that emits no place writes the bytes it always did.
   */
  complete(_prompt: ThinkPrompt, input: ThinkInput): Promise<string> {
    if (this.failTimes > 0) {
      this.failTimes--;
      return Promise.resolve('not json — the model glitched');
    }
    const out = this.policy.think(input);
    return Promise.resolve(JSON.stringify(encodeOutput(this.world, out)));
  }
}
