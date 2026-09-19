import type { MindOutput, ThinkInput } from '../contract/types.js';
import type { IMind } from './IMind.js';
import type { IMindBackend } from './IMindBackend.js';
import { ReflexMind } from './ReflexMind.js';
import { buildThinkPrompt, retryPrompt } from './prompt.js';
import type { ThinkPrompt } from './prompt.js';
import { MindOutputError, parseMindOutput } from './schema.js';

export interface CognitionRecord {
  agentId: number;
  tick: number;
  trigger: string;
  /** The FIRST attempt's messages; `attempts[i].prompt` is authoritative per attempt. */
  systemPrompt: string;
  userPrompt: string;
  /** The accepted completion, or the last one tried. `attempts` is the lossless record. */
  rawOutput: string;
  /** Every completion this call produced, in order — a retry is data, not noise. */
  attempts: CognitionAttempt[];
  /** The model that answered, so a row is never orphaned from its author. */
  modelId: string;
  valid: boolean;
  retried: boolean;
  fellBackToReflex: boolean;
  latencyMs: number;
  error?: string;
}

export interface CognitionAttempt {
  /**
   * The exact messages THIS attempt was sent. A retry carries the rejection
   * feedback, so pairing the accepted completion with the first attempt's
   * prompt would mis-pair every retried row.
   */
  prompt: { system: string; user: string };
  /** Raw model text, exactly as it came back (empty when the call itself threw). */
  raw: string;
  /** Why this attempt was rejected — a transport error or a parse failure. */
  error?: string;
}

export interface LlmMindOptions {
  /** Permanent fallback when the model errors or returns invalid JSON. */
  fallback?: IMind;
  /** Receives every call's full prompt + output — the training corpus. */
  onCognition?: (record: CognitionRecord) => void;
  /**
   * Called with the input the instant its prompt is built, BEFORE the backend
   * is awaited. A ThinkInput references live knowledge and relationship records
   * that the miners keep rewriting, so this is the only moment at which a
   * snapshot of it still describes what the model was actually shown — seconds
   * of inference later it does not. A recorder freezes it here.
   */
  onPromptBuilt?: (input: ThinkInput, prompt: ThinkPrompt) => void;
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
  private readonly onPromptBuilt: ((input: ThinkInput, prompt: ThinkPrompt) => void) | undefined;
  private readonly now: () => number;

  constructor(
    private readonly backend: IMindBackend,
    options: LlmMindOptions = {},
  ) {
    this.fallback = options.fallback ?? new ReflexMind();
    this.onCognition = options.onCognition;
    this.onPromptBuilt = options.onPromptBuilt;
    this.now = options.now ?? wallClock;
  }

  get modelId(): string {
    return this.backend.modelId;
  }

  async complete(input: ThinkInput): Promise<MindOutput> {
    const prompt = buildThinkPrompt(input);
    this.onPromptBuilt?.(input, prompt);
    const started = this.now();

    let raw = '';
    let lastError = '';
    // Transport failures and parse failures are caught separately so the text a
    // model actually produced survives even when it was rejected — a rejected
    // completion is the most informative row in a training corpus.
    const attempts: CognitionAttempt[] = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      const retried = attempt > 0;
      const feedback = retried ? lastError : undefined;
      // Composed once, here: these bytes are both what the backend is handed
      // and what the attempt stores — retry feedback included.
      const sent = retryPrompt(prompt, feedback);
      try {
        // The composed messages ARE what the backend sends: nothing downstream
        // may rebuild a prompt from a ThinkInput the miners have since rewritten.
        raw = await this.backend.complete(sent, input);
      } catch (err) {
        lastError = String(err);
        attempts.push({ prompt: sent, raw: '', error: lastError });
        continue;
      }
      try {
        const output = parseMindOutput(raw);
        attempts.push({ prompt: sent, raw });
        this.log(input, prompt, raw, started, attempts, { valid: true, retried, fellBack: false });
        return output;
      } catch (err) {
        lastError = err instanceof MindOutputError ? err.message : String(err);
        attempts.push({ prompt: sent, raw, error: lastError });
      }
    }

    // Both attempts failed — reflex carries the agent until next cycle.
    const output = this.fallback.think(input);
    this.log(input, prompt, raw, started, attempts, { valid: false, retried: true, fellBack: true, error: lastError });
    return output;
  }

  private log(
    input: ThinkInput,
    prompt: { system: string; user: string },
    raw: string,
    started: number,
    attempts: CognitionAttempt[],
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
      attempts: attempts.map((a) => ({ ...a, prompt: { ...a.prompt } })),
      modelId: this.backend.modelId,
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
