import type { WorldAdapter } from '../contract/adapter.js';
import type { MindOutput, ThinkInput } from '../contract/types.js';
import type { IMind } from './IMind.js';
import type { IMindBackend } from './IMindBackend.js';
import { policyFor } from './policy.js';
import { buildThinkPrompt, retryPrompt } from './prompt.js';
import type { ThinkPrompt } from './prompt.js';
import { MindOutputError, parseMindOutput } from './schema.js';

// ─── What a think actually did, counted at the source (W1-E S6) ─────────────

/**
 * WHY THIS LIVES HERE, AND WHY IT IS NOT A ROW.
 *
 * `CognitionRecord.fellBackToReflex` is true only when a think failed TWICE, so
 * a single bad completion that the retry rescues is invisible, and this class
 * swallowed every backend error into the reflex fallback besides. The W1-E
 * reviewer planted a backend that failed 5% and then 20% of the time and both
 * runs came back reporting `fallbackRate 0`: the instrument's only degradation
 * channel was a floor on DOUBLE failures rather than a measure of degradation.
 *
 * So `LlmMind` reports what every think did. It is deliberately NOT part of
 * `CognitionRecord`: the corpus rows, the prompts and `COGNITION_SCHEMA_VERSION`
 * are untouched, so every golden, the corpus byte count and record/replay are
 * byte-identical on a healthy run.
 *
 * It lives in THIS file rather than in `runner/RunCounters.ts` — where the
 * tally it feeds lives — because `RunCounters` spells this world's event ids,
 * and a mind file that imported it would drag the forager vocabulary into the
 * mind's import graph. `test/world-tables-out.test.ts` catches exactly that.
 * The reporter owns the report; the runner owns the tally and imports it here.
 */
export type ThinkOutcomeKind = 'ok' | 'retried-ok' | 'fell-back';

/**
 * The only two failures a mind is ALLOWED to survive (W1-B4 r4 ruling):
 * the transport did not answer, or the reply was not a legal reply. Anything
 * else — a `ForeignPlaceError`, a `TypeError`, any throw from engine code — is
 * a program error and propagates rather than becoming a quiet reflex act.
 */
export type ThinkFallbackReason = 'backend' | 'invalid-reply';

export interface ThinkOutcome {
  /**
   * The backend this think went through, by identity. It is the discriminator:
   * two arms of an A/B, or two Experiments in one process, share a model id and
   * an agent id space but never a backend object.
   */
  readonly backend: object;
  readonly modelId: string;
  readonly agentId: number;
  readonly tick: number;
  readonly kind: ThinkOutcomeKind;
  /** Present only on `fell-back`. */
  readonly reason?: ThinkFallbackReason;
  /** Completions this think consumed, rejected ones included. */
  readonly attempts: number;
}

export type ThinkOutcomeSink = (outcome: ThinkOutcome) => void;

const SINKS = new Set<ThinkOutcomeSink>();

/**
 * Listen to every think in this process until the returned function is called.
 * A listener filters by `outcome.backend` — see `ThinkOutcome.backend` for why
 * that and not the model id.
 */
export function observeThinkOutcomes(sink: ThinkOutcomeSink): () => void {
  SINKS.add(sink);
  return () => {
    SINKS.delete(sink);
  };
}

/** Called once per think, below. A no-op when nobody is listening. */
function reportThinkOutcome(outcome: ThinkOutcome): void {
  if (SINKS.size === 0) return;
  for (const sink of SINKS) sink(outcome);
}

/** The tally one run keeps of the outcomes above. */
export class ThinkOutcomeCounters {
  ok = 0;
  retriedOk = 0;
  fellBack = 0;
  readonly fellBackByReason: Record<ThinkFallbackReason, number> = { backend: 0, 'invalid-reply': 0 };

  get thinks(): number {
    return this.ok + this.retriedOk + this.fellBack;
  }

  /** Thinks the world carried instead of the mind. The number S6 is about. */
  get fallbackRate(): number {
    return rateOf(this.fellBack, this.thinks);
  }

  /**
   * Thinks that needed a second completion. A transport failing a share f of
   * CALLS retries at about f and falls back at about f², so THIS is the number
   * that sees a 5% plant.
   */
  get retryRate(): number {
    return rateOf(this.retriedOk + this.fellBack, this.thinks);
  }

  observeThink(outcome: ThinkOutcome): void {
    if (outcome.kind === 'ok') this.ok++;
    else if (outcome.kind === 'retried-ok') this.retriedOk++;
    else {
      this.fellBack++;
      this.fellBackByReason[outcome.reason ?? 'backend']++;
    }
  }
}

function rateOf(n: number, d: number): number {
  return d > 0 ? Math.round((n / d) * 10000) / 10000 : 0;
}

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

interface LlmMindOptionsBase {
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
 * THE WORLD IS NOT OPTIONAL (W1-B3). It was, while the world only decided what
 * carried a being when the model failed; now it also decides what the prompt
 * OFFERS (the adapter's action vocabulary) and what the parser will ACCEPT, so
 * a mind cannot be built without naming the place it lives in. `fallback`
 * remains an override for a caller that wants a particular policy; absent, the
 * world's own is used — never, as it once was, the forager continent's
 * whatever world the run was in (W1-B1 verifier, backlog 2).
 */
export type LlmMindOptions = LlmMindOptionsBase & {
  readonly world: WorldAdapter;
  /** Permanent fallback when the model errors or returns invalid JSON. */
  readonly fallback?: IMind;
};

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
  private readonly world: WorldAdapter;
  private readonly fallback: IMind;
  private readonly onCognition: ((record: CognitionRecord) => void) | undefined;
  private readonly onPromptBuilt: ((input: ThinkInput, prompt: ThinkPrompt) => void) | undefined;
  private readonly now: () => number;

  constructor(
    private readonly backend: IMindBackend,
    options: LlmMindOptions,
  ) {
    this.world = options.world;
    this.fallback = options.fallback ?? policyFor(options.world);
    this.onCognition = options.onCognition;
    this.onPromptBuilt = options.onPromptBuilt;
    this.now = options.now ?? wallClock;
  }

  get modelId(): string {
    return this.backend.modelId;
  }

  async complete(input: ThinkInput): Promise<MindOutput> {
    const prompt = buildThinkPrompt(input, this.world);
    this.onPromptBuilt?.(input, prompt);
    const started = this.now();

    let raw = '';
    let lastError = '';
    let lastFailure: ThinkFallbackReason = 'backend';
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
        // A TRANSPORT failure. Anything the language itself threw is a bug in
        // this process, not a provider having a bad minute — see `isProgramError`.
        if (isProgramError(err)) throw err;
        lastError = String(err);
        lastFailure = 'backend';
        attempts.push({ prompt: sent, raw: '', error: lastError });
        continue;
      }
      try {
        const output = parseMindOutput(raw, this.world);
        attempts.push({ prompt: sent, raw });
        this.report(input, attempts.length, retried ? 'retried-ok' : 'ok');
        this.log(input, prompt, raw, started, attempts, { valid: true, retried, fellBack: false });
        return output;
      } catch (err) {
        // ONLY A REPLY-VALIDITY FAILURE MAY BE SURVIVED (W1-B4 r4).
        //
        // This catch used to take everything, so a `ForeignPlaceError` or a
        // `TypeError` thrown by the wire codec while DECODING a legal-looking
        // reply became a reflex act and the run carried on with eleven rows
        // recorded as answered. `MindOutputError` is the declared "this reply is
        // not a legal reply" channel — `schema.ts#attempt` already rethrows
        // everything else — so anything else here is a program error and
        // propagates, loudly, to the caller that can still do something about it.
        if (!(err instanceof MindOutputError)) throw err;
        lastError = err.message;
        lastFailure = 'invalid-reply';
        attempts.push({ prompt: sent, raw, error: lastError });
      }
    }

    // Both attempts failed — reflex carries the agent until next cycle.
    const output = this.fallback.think(input);
    this.report(input, attempts.length, 'fell-back', lastFailure);
    this.log(input, prompt, raw, started, attempts, { valid: false, retried: true, fellBack: true, error: lastError });
    return output;
  }

  /**
   * What this think DID, at the source — the counter `CognitionRecord` cannot
   * carry, because a row that changed would change the corpus. See
   * `runner/RunCounters.ts` for why the retry and the two fallback reasons are
   * separate outcomes rather than one boolean.
   */
  private report(input: ThinkInput, attempts: number, kind: ThinkOutcomeKind, reason?: ThinkFallbackReason): void {
    reportThinkOutcome({
      backend: this.backend,
      modelId: this.backend.modelId,
      agentId: input.snapshot.id,
      tick: input.worldView.tick,
      kind,
      ...(reason ? { reason } : {}),
      attempts,
    });
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

/**
 * A throw that means "this code is wrong", as opposed to "the provider did not
 * answer". The four the language itself raises, plus anything a caller marks
 * `fatal` — a budget refusal is NOT one of them: it is a transport that has
 * been told to stop, the run latches on it, and W1-E's `RunHalt` reads that latch.
 */
function isProgramError(err: unknown): boolean {
  if (err instanceof TypeError || err instanceof RangeError || err instanceof ReferenceError || err instanceof SyntaxError) {
    return true;
  }
  return typeof err === 'object' && err !== null && (err as { fatal?: unknown }).fatal === true;
}

function wallClock(): number {
  // Date.now is unavailable in some sandboxes; performance.now when present.
  return typeof performance !== 'undefined' ? performance.now() : 0;
}
