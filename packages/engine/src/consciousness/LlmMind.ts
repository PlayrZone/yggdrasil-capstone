import type { MindOutput, ThinkInput } from '../contract/types.js';
import type { IMind } from './IMind.js';
import type { IMindBackend } from './IMindBackend.js';
import { ReflexMind } from './ReflexMind.js';
import { buildThinkPrompt } from './prompt.js';
import { MindOutputError, parseMindOutput } from './schema.js';

export interface CognitionRecord {
  agentId: number;
  tick: number;
  trigger: string;
  systemPrompt: string;
  userPrompt: string;
  rawOutput: string;
  valid: boolean;
  retried: boolean;
  fellBackToReflex: boolean;
  latencyMs: number;
  error?: string;
}

export interface LlmMindOptions {
  /** Permanent fallback when the model errors or returns invalid JSON. */
  fallback?: IMind;
  /** Receives every call's full prompt + output — the training corpus. */
  onCognition?: (record: CognitionRecord) => void;
  /** Injected clock (tests pass a fake; the sim passes its tick-derived ms). */
  now?: () => number;
}

/**
 * Consciousness backed by an LLM. Builds the prompt, calls the backend,
 * validates the JSON, retries once with the error appended, and on a second
 * failure falls back to the ReflexMind so the world never blocks on a bad
 * thought. Every call is logged — `cognition_log` is also the Yggdrasil
 * model's future training corpus.
 *
 * `complete` is async (the LLM is slow); the CognitionScheduler keeps the
 * sim's fixed-timestep loop from ever awaiting it.
 */
export class LlmMind {
  private readonly fallback: IMind;
  private readonly onCognition: ((record: CognitionRecord) => void) | undefined;
  private readonly now: () => number;

  constructor(
    private readonly backend: IMindBackend,
    options: LlmMindOptions = {},
  ) {
    this.fallback = options.fallback ?? new ReflexMind();
    this.onCognition = options.onCognition;
    this.now = options.now ?? wallClock;
  }

  get modelId(): string {
    return this.backend.modelId;
  }

  async complete(input: ThinkInput): Promise<MindOutput> {
    const prompt = buildThinkPrompt(input);
    const started = this.now();

    let raw = '';
    let lastError = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      const retried = attempt > 0;
      try {
        raw = await this.backend.complete(input, retried ? lastError : undefined);
        const output = parseMindOutput(raw);
        this.log(input, prompt, raw, started, { valid: true, retried, fellBack: false });
        return output;
      } catch (err) {
        lastError = err instanceof MindOutputError ? err.message : String(err);
      }
    }

    // Both attempts failed — reflex carries the agent until next cycle.
    const output = this.fallback.think(input);
    this.log(input, prompt, raw, started, { valid: false, retried: true, fellBack: true, error: lastError });
    return output;
  }

  private log(
    input: ThinkInput,
    prompt: { system: string; user: string },
    raw: string,
    started: number,
    flags: { valid: boolean; retried: boolean; fellBack: boolean; error?: string },
  ): void {
    if (!this.onCognition) return;
    this.onCognition({
      agentId: input.snapshot.id,
      tick: input.worldView.tick,
      trigger: input.trigger,
      systemPrompt: prompt.system,
      userPrompt: prompt.user,
      rawOutput: raw,
      valid: flags.valid,
      retried: flags.retried,
      fellBackToReflex: flags.fellBack,
      latencyMs: Math.max(0, this.now() - started),
      ...(flags.error ? { error: flags.error } : {}),
    });
  }
}

function wallClock(): number {
  // Date.now is unavailable in some sandboxes; performance.now when present.
  return typeof performance !== 'undefined' ? performance.now() : 0;
}
