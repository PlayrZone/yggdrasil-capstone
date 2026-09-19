import type { WorldAdapter } from '../contract/adapter.js';
import type { WorldEdges } from '../contract/edges.js';
import type { Intent, MindOutput, SimEvent } from '../contract/types.js';
import type { CognitionOutcome, CognitionRecordV2 } from '../record/types.js';
import { detectLexicalLeaks, stemWord, suppliedNames } from '../training/leakMatch.js';
import { deserializeThinkInput } from '../record/serialize.js';
import { commitTo, keyedStream, randomBlindSecret, sha256Hex } from './commit.js';
import { admitsIgnorance } from './disavowal.js';
import type { ArmId, BlindTrace, MomentOutcome, RawBeingTrace, TraceFeatures, TraceKey, TraceMoment } from './types.js';

/**
 * BLINDED BEHAVIOUR TRACES.
 *
 * A trace is what a being perceived, felt, thought, did, said, and what happened
 * next — rendered from the v3 cognition records, their outcomes and the event
 * log, through ONE template for every arm.
 *
 * ROUND 1's BLINDING WAS AN ANSWER KEY. Handles came from a counter over the
 * pooled list, which was `[...armA, ...armB]`, so arm A took every low ordinal;
 * the handle was printed as the FIRST LINE of the rendered text; and that text
 * went to the paid judge verbatim. `trace-001=A trace-002=A trace-003=B
 * trace-004=B` — 100% unblinding from format alone, no classifier required. The
 * load-bearing test could not see it because it stripped the handle before
 * comparing and then declared the rest identical.
 *
 * Four rules replace it, and none of them relies on a caller doing the right
 * thing:
 *
 *   1. A HANDLE CARRIES NOTHING. It is six opaque base-36 characters drawn from
 *      a KEYED stream, assigned over a permutation of the pooled traces drawn
 *      from the same stream. There is no ordering to read, and the order the
 *      traces are RETURNED in is that permutation too, so file order says
 *      nothing either.
 *
 *      ROUND 2 PUT THE KEY TO THAT PERMUTATION IN THE MANIFEST. The stream was
 *      `mulberry32(hashSeed('blind:' + seed))`, the seed defaulted to the run
 *      seeds joined, and `run_ab` returned the manifest beside the traces:
 *      re-running the public `blindTraces` on a dummy pool of the same size, in
 *      the documented pooled-arm order, recovered **8 of 8 arms by position**
 *      without touching the key. The stream is now keyed by a per-run SECRET
 *      that is in no result, no manifest, no spend log and no tool output; the
 *      artefact carries only `sha256(secret)`, so the run is still auditable
 *      once the key is unsealed and the secret disclosed (`commit.ts`).
 *   2. THE TEXT A JUDGE READS CONTAINS NO HANDLE AT ALL. Not the id, not a run
 *      id, not a being id, not a pair id. `BlindTrace.traceId` exists for the
 *      aggregator's bookkeeping and is never rendered.
 *   3. NO CADENCE COLUMN. Round 1 printed `[+<ticks since the trace began> · …]`
 *      on every moment. Think cadence is a function of prompt size through
 *      latency, and the two arms' prompts differ in size, so that column was a
 *      behavioural-but-structural tell. Moments are numbered instead; the day,
 *      the season and night/day stay, because they are the same world for every
 *      arm by construction (same seed, same founders).
 *   4. THE KEY IS SEALED. `blindTraces` hands back a `SealedTraceKey` whose
 *      entries are private. The judging code path never imports it, and
 *      `judgeTraces` unseals only after every judgement is already recorded.
 *
 * What remains in a trace that differs between arms is BEHAVIOUR — which is the
 * measurement. `test/eval-blinding.test.ts` holds rules 1–3 by training a
 * classifier on format features alone, with DIFFERENT minds on the two arms,
 * and requiring that it cannot beat chance; and by planting a tell and
 * requiring the same test to fail.
 */

export interface TraceSource {
  runId: string;
  arm: ArmId;
  /**
   * THE CLUSTER THIS TRACE BELONGS TO (S1). One seed × two arms is ONE
   * independent run, and until round 5 nothing downstream knew that: 64 pairs
   * out of one seed were analysed as 64 independent Bernoulli draws. The seed
   * travels with the trace so `pairTraces` can pair WITHIN a run and
   * `judgeTraces` can test ACROSS runs. It is not an arm and it is the same
   * string for both arms, so it is safe to carry past the blinding.
   */
  seed?: string;
  records: readonly CognitionRecordV2[];
  outcomes: readonly CognitionOutcome[];
  /** Optional: the capped event tail, for what happened AROUND the being. */
  events?: readonly SimEvent[];
}

/**
 * Build one raw trace per being that thought at least once.
 *
 * It takes the world's EDGES rather than its adapter (W1-B4 r4): reading a
 * recorded `ThinkInput` back means decoding places, and only the codec the
 * world handed its edges can do that. The instrument is an edge; a mind is not.
 */
export function buildTraces(source: TraceSource, edges: WorldEdges): RawBeingTrace[] {
  const world = edges.adapter;
  const outcomeById = new Map(source.outcomes.map((o) => [o.cognitionId, o]));
  const byBeing = new Map<number, CognitionRecordV2[]>();
  for (const record of source.records) {
    const rows = byBeing.get(record.beingId);
    if (rows) rows.push(record);
    else byBeing.set(record.beingId, [record]);
  }
  const traces: RawBeingTrace[] = [];
  for (const [beingId, rows] of [...byBeing].sort((a, b) => a[0] - b[0])) {
    rows.sort((a, b) => a.tick - b.tick);
    const start = rows[0]?.tick ?? 0;
    const around = (source.events ?? []).filter((e) => e.actorId === beingId || e.targetIds.includes(beingId));
    const moments = rows.map((record, index) => {
      const next = rows[index + 1]?.tick ?? Number.POSITIVE_INFINITY;
      const happenedAround = around.filter((e) => e.tick >= record.tick && e.tick < next).map((e) => e.type);
      return momentOf(record, outcomeById.get(record.id), edges, start, happenedAround);
    });
    traces.push({ runId: source.runId, arm: source.arm, seed: source.seed ?? source.runId, beingId, moments });
  }
  return traces;
}

function momentOf(
  record: CognitionRecordV2,
  outcome: CognitionOutcome | undefined,
  edges: WorldEdges,
  start: number,
  around: readonly string[],
): TraceMoment {
  const world = edges.adapter;
  const input = deserializeThinkInput(record.thinkInput, edges);
  const decided = record.resolvedOutput ?? record.parsedOutput;
  const perceived = new Map<string, number>();
  for (const r of input.worldView.resources) perceived.set(r.kind, (perceived.get(r.kind) ?? 0) + 1);
  for (const s of input.worldView.structures) perceived.set(s.kind, (perceived.get(s.kind) ?? 0) + 1);
  return {
    t: record.tick - start,
    day: record.simDay,
    night: input.worldView.night,
    season: input.worldView.season,
    felt: world.drives.map((d) => ({ drive: d.id, pressure: Math.round(input.snapshot.needs[d.id] ?? 0) })),
    perceived: [...perceived].map(([kind, count]) => ({ kind, count })),
    others: input.worldView.agents.length,
    carried: Object.entries(input.snapshot.inventory)
      .filter(([, n]) => (n ?? 0) > 0)
      .map(([kind, count]) => ({ kind, count: count ?? 0 })),
    thought: decided.thought ?? '',
    did: decided.plan.filter((i) => i.utterance === undefined).map((i) => renderIntent(i, world)),
    said: decided.utterances.map((u) => ({ act: u.speechAct, to: u.targetId ?? null, text: u.text ?? '' })),
    happened: outcome ? outcomeOf(outcome, world, around) : null,
  };
}

function outcomeOf(outcome: CognitionOutcome, world: WorldAdapter, around: readonly string[]): MomentOutcome {
  const steps = outcome.intents.map((i) => ({
    act: i.kind,
    executed: i.executed,
    rejected: i.rejected,
    ...(i.rejectionReason ? { reason: i.rejectionReason } : {}),
  }));
  for (const type of around) steps.push({ act: `(${type})`, executed: true, rejected: false });
  const deltas = outcome.needDeltas as Record<string, number | undefined>;
  return {
    steps,
    reliefs: world.drives.map((d) => ({ drive: d.id, delta: Math.round(deltas[d.id] ?? 0) })),
    healthDelta: Math.round(outcome.healthDelta),
    alive: outcome.aliveAtEnd,
  };
}

function renderIntent(intent: Intent, world: WorldAdapter): string {
  const args: string[] = [];
  // A place is opaque to the instrument: the WORLD says how it is written down
  // (`SpaceOps.label`), so a trace reads the same way for any world and this
  // file holds no geometry of its own.
  if (intent.place !== undefined) args.push(`to ${world.space.label(intent.place)}`);
  if (intent.targetId !== undefined) args.push(`target ${REF_MARK}${intent.targetId}`);
  if (intent.objectKind !== undefined) args.push(intent.objectKind);
  if (intent.buildKind !== undefined) args.push(intent.buildKind);
  if (intent.durationTicks !== undefined) args.push(`for ${intent.durationTicks}`);
  return args.length > 0 ? `${intent.kind}(${args.join(', ')})` : `${intent.kind}()`;
}

/** The sentinel a world-wide id is written with before it is renumbered. */
const REF_MARK = ' ref:';

// ─── The sealed key ──────────────────────────────────────────────────────────

/**
 * WHICH HANDLE WAS WHICH ARM — held where the judging code path cannot reach it.
 *
 * The entries are private. `judge.ts` does not import this module at all, and
 * `TracePair` carries two traces and nothing else, so an arm label cannot reach
 * a judge however the judge is written. `handlesOf` exists for the pairing step,
 * which is the experimenter's, not the judge's; `unseal` exists for the
 * aggregator, and records that it happened so a test can prove judging came
 * first.
 */
/**
 * WHERE THE SECRET AND THE ARM MAP ACTUALLY LIVE.
 *
 * `private` is a TypeScript fact and nothing else. Round 3's key held
 * `entries`, `secret`, `unsealCount`, `publicSeed` and `commitment` as ordinary
 * enumerable own properties, so the 128-bit secret AND the complete
 * `traceId → arm` map came out of `Object.entries(key)`, `Object.assign({}, key)`,
 * `{...key}`, `structuredClone(key)`, `Object.getOwnPropertyNames(key)` and
 * `util.inspect(key)` — the last being exactly what `console.log(result)`
 * prints. Only `JSON.stringify` was guarded, by `toJSON`, and the README's
 * *"the secret is in **no** result, manifest, spend log or tool output"* was
 * false of the result object every agent holds.
 *
 * A module-level `WeakMap` is the fix rather than `#private` fields, because a
 * `#field` is still shown by `util.inspect` in current Node. Nothing outside
 * this module can reach this map, an instance carries no own data property at
 * all, and the two publishable values are prototype GETTERS — so a spread, a
 * clone and an inspect all produce something with nothing in it.
 */
interface SealedState {
  entries: readonly TraceKey[];
  secret: string;
  publicSeed: string;
  commitment: string;
  /**
   * ONE SEAL, SHARED BY EVERY DERIVATION (S4).
   *
   * Round 4's `relabelled` built a NEW key around the same entries and the same
   * secret with a FRESH `unsealCount`, so `key.relabelled(a => a).unseal()`
   * returned all twelve arms, `.disclose().secret` returned the run secret, and
   * the original still reported `unsealed === false`. The seal is now an object
   * every derivation holds a reference to: opening a child opens the parent,
   * because they are the same secret about the same traces.
   */
  seal: Seal;
  /** False on the original; true on anything `relabelArms` produced. */
  derived: boolean;
}

/** Shared, mutable, one per blinding. */
interface Seal {
  count: number;
  /** The first unseal, recorded once — a second one adds to the count, not to the log. */
  log: readonly string[];
}

const SEALED = new WeakMap<SealedTraceKey, SealedState>();

function stateOf(key: SealedTraceKey): SealedState {
  const held = SEALED.get(key);
  if (!held) throw new Error('this sealed key was not constructed by blindTraces — it holds nothing');
  return held;
}

/**
 * What every disclosure route is allowed to show. Reveals neither arm nor
 * secret — and, since S4, TELLS THE TRUTH ABOUT THE SEAL. Round 4's facade
 * printed `"sealed": true` after two `unseal()`s, so an unseal-then-rejudge was
 * indistinguishable from a blind pass in every artefact a reader holds.
 */
interface SealedFacade {
  sealed: boolean;
  unsealCount: number;
  /** True when this handle came out of a relabelling rather than out of `blindTraces`. */
  derived: boolean;
  size: number;
  publicSeed: string;
  commitment: string;
}

const INSPECT = Symbol.for('nodejs.util.inspect.custom');

export class SealedTraceKey {
  constructor(entries: readonly TraceKey[], publicSeed: string, secret: string, derivation?: { seal: Seal }) {
    SEALED.set(this, {
      entries: entries.map((e) => ({ ...e })),
      secret,
      publicSeed,
      commitment: commitTo(secret),
      seal: derivation?.seal ?? { count: 0, log: [] },
      derived: derivation !== undefined,
    });
  }

  /** The public label of the run. It keys NOTHING. */
  get publicSeed(): string {
    return stateOf(this).publicSeed;
  }

  /** `sha256(secret)`. Safe to publish; useless until the secret is disclosed. */
  get commitment(): string {
    return stateOf(this).commitment;
  }

  get size(): number {
    return stateOf(this).entries.length;
  }

  /** Has anybody looked — through THIS handle or any derivation of it? */
  get unsealed(): boolean {
    return stateOf(this).seal.count > 0;
  }

  /** How many times, so an artefact can carry the number rather than a boolean. */
  get unsealCount(): number {
    return stateOf(this).seal.count;
  }

  /** The first unseal, in words. Empty while the key is sealed. */
  get unsealLog(): readonly string[] {
    return stateOf(this).seal.log;
  }

  /** Every handle, in the order the traces were returned in. No arms. */
  handles(): readonly string[] {
    return stateOf(this).entries.map((e) => e.traceId);
  }

  /** The handles of one arm — for PAIRING, which happens before any judging. */
  handlesOf(arm: ArmId): readonly string[] {
    return stateOf(this)
      .entries.filter((e) => e.arm === arm)
      .map((e) => e.traceId);
  }

  /**
   * Which CLUSTER each handle came from — the seed, never the arm. Safe to hand
   * anywhere `handlesOf` is not: both arms of a seed carry the same string, so
   * it partitions the traces into independent runs and says nothing about which
   * mind produced one.
   */
  clusters(): readonly { traceId: string; seed: string }[] {
    return stateOf(this).entries.map((e) => ({ traceId: e.traceId, seed: e.seed }));
  }

  /** Which arms are represented at all. */
  arms(): readonly ArmId[] {
    return [...new Set(stateOf(this).entries.map((e) => e.arm))];
  }

  /**
   * Break the seal. Called by `judgeTraces` AFTER every judgement is recorded,
   * and by a caller that is reporting rather than judging. Still the only door,
   * and still one-way-logged.
   */
  unseal(): readonly TraceKey[] {
    const state = stateOf(this);
    state.seal.count++;
    // LOGGED ONCE. A second unseal is a bigger count, not a second line: the
    // question an auditor asks is "was this key ever opened before judging",
    // and one honest line answers it without growing with every report.
    if (state.seal.log.length === 0) {
      state.seal.log = [
        `unsealed for the first time (${state.derived ? 'through a DERIVED handle' : 'through the original handle'}, ` +
          `${state.entries.length} handles, seed ${state.publicSeed})`,
      ];
    }
    return state.entries.map((e) => ({ ...e }));
  }

  /**
   * BIND SOMETHING TO THIS RUN — a message authentication code over a caller's
   * digest, keyed by the blinding secret.
   *
   * It is what makes a run attestation unforgeable and unreplayable (S6): the
   * secret is drawn from the host's CSPRNG per run and published only after
   * `unseal()`, so a `{degraded: false}` claim minted for one run cannot be
   * moved onto another, and a claim edited after the fact no longer matches. It
   * reveals nothing about the arms: a MAC over the caller's own bytes.
   */
  bind(digest: string): string {
    const state = stateOf(this);
    return sha256Hex(`yggdrasil/run-attest/v1:${state.secret}:${state.commitment}:${digest}`);
  }

  /**
   * The secret the permutation was drawn from, for an auditor — ONLY after the
   * key has been unsealed. Handing it out earlier would publish the thing the
   * blinding rests on, which is exactly round 2's defect with an extra step.
   *
   * With it: `verifyCommitment(secret, commitment)` proves the published
   * commitment belonged to this run, and re-running `blindTraces` with it
   * reproduces the same handles in the same order.
   */
  disclose(): { secret: string; publicSeed: string; commitment: string } {
    const state = stateOf(this);
    // A DERIVED KEY IS A CONTROL, NOT AN AUDITOR. `swapArmLabels(key).disclose()`
    // handed over the run secret in one line and left the original reading
    // `unsealed === false`; a label-swap control needs the arms it was built to
    // permute and has no business with the secret they were drawn from.
    if (state.derived) {
      throw new Error('a derived key never discloses: disclose() belongs to the key blindTraces returned, not to a relabelling of it');
    }
    if (state.seal.count === 0) {
      throw new Error('the blinding secret is disclosed only after unseal(): a sealed key that answers questions is not sealed');
    }
    return { secret: state.secret, publicSeed: state.publicSeed, commitment: state.commitment };
  }

  /** `JSON.stringify(result)` — what a reader or an agent reaches for first. */
  toJSON(): SealedFacade {
    return this.facade();
  }

  /** `util.inspect(key)` — what `console.log(result)` prints. */
  [INSPECT](): SealedFacade {
    return this.facade();
  }

  /** `String(key)` and template interpolation. */
  toString(): string {
    const { sealed, unsealCount, size, publicSeed, commitment } = this.facade();
    return (
      `SealedTraceKey(${sealed ? 'sealed' : `UNSEALED ×${unsealCount}`}, ${size} handles, ` +
      `seed ${publicSeed}, commitment ${commitment.slice(0, 12)})`
    );
  }

  private facade(): SealedFacade {
    const state = stateOf(this);
    return {
      sealed: state.seal.count === 0,
      unsealCount: state.seal.count,
      derived: state.derived,
      size: state.entries.length,
      publicSeed: state.publicSeed,
      commitment: state.commitment,
    };
  }
}

/**
 * THE LABEL-SWAP CONTROL, and why it is not a method any more.
 *
 * `key.relabelled(a => a)` was a public method that minted a fresh seal around
 * the same secret, so one line reopened the blinding and the original went on
 * saying it was sealed. The relabelling itself is a legitimate control — run
 * the whole aggregate with the arms swapped and the sign must flip — so it
 * survives as a module function that is NOT exported from the package index and
 * whose product shares the parent's seal: unsealing the swapped key marks the
 * original unsealed, and the swapped key can never disclose.
 */
export function relabelArms(key: SealedTraceKey, swap: (arm: ArmId) => ArmId): SealedTraceKey {
  const state = stateOf(key);
  return new SealedTraceKey(
    state.entries.map((e) => ({ ...e, arm: swap(e.arm) })),
    state.publicSeed,
    state.secret,
    { seal: state.seal },
  );
}

// ─── Blinding ────────────────────────────────────────────────────────────────

export interface BlindOptions {
  /**
   * The PUBLIC label of this blinding, recorded in the manifest. It keys
   * nothing — round 2's did, and that was the defect.
   */
  seed: string;
  /**
   * The secret the permutation and the handles are drawn from. Omitted in a
   * real run, where it is drawn from the host's CSPRNG and never leaves the
   * sealed key; supplied by TESTS, which need determinism and are entitled to
   * know the answer.
   */
  secret?: string;
  /** Traces with fewer moments than this are dropped. Default 1. */
  minMoments?: number;
  /** Prefix for the opaque handles. Default `trace`. */
  prefix?: string;
  /**
   * TEST ONLY — plant a tell, to prove the blinding test can fail. `ordered`
   * restores round 1's behaviour exactly: handles numbered in arm order, printed
   * as the first line of the text.
   */
  plantTell?: 'ordered';
}

export interface BlindingManifest {
  /** The run's public label. It keys nothing; the permutation is keyed by the secret. */
  publicSeed: string;
  /**
   * `sha256("yggdrasil/blind-commit/v1:" + secret)`. Everything a published
   * artefact is allowed to carry about the permutation: it reveals nothing
   * before unsealing and verifies afterwards.
   */
  commitment: string;
  /** How handles were assigned, for a reader who was not here. */
  scheme: 'sealed-secret-permutation/opaque-handle';
  traces: number;
  dropped: number;
  minMoments: number;
  /** Present only when a test deliberately broke the blinding. */
  plantedTell?: string;
}

export interface BlindResult {
  traces: BlindTrace[];
  key: SealedTraceKey;
  manifest: BlindingManifest;
}

/**
 * Turn raw traces into blind ones.
 *
 * The permutation is over the POOLED list, drawn here rather than left to a
 * caller: round 1 documented "a caller that wants them shuffled shuffles the
 * INPUT", and the one caller in the repo did not. It is drawn from a stream
 * keyed by a SECRET, not by anything the result publishes — round 2 published
 * its key in the manifest and the whole run was invertible by re-running this
 * function.
 */
export function blindTraces(raw: readonly RawBeingTrace[], world: WorldAdapter, options: BlindOptions): BlindResult {
  const minMoments = options.minMoments ?? 1;
  const prefix = options.prefix ?? 'trace';
  const kept = raw.filter((t) => t.moments.length >= minMoments);
  const dropped = raw.length - kept.length;

  const secret = options.secret ?? randomBlindSecret();
  const rng = keyedStream(secret);
  const order = permutation(kept.length, rng);

  const traces: BlindTrace[] = [];
  const key: TraceKey[] = [];
  const used = new Set<string>();
  for (let at = 0; at < order.length; at++) {
    const trace = kept[order[at]!]!;
    const traceId =
      options.plantTell === 'ordered'
        ? // The planted tell IS round 1: a counter over the arm-ordered pooled
          // list. Kept in the source because a blinding test that cannot be made
          // to fail is not evidence of anything.
          `${prefix}-${(order[at]! + 1).toString(36).padStart(3, '0')}`
        : opaqueHandle(prefix, rng, used);
    const local = localiseRefs(trace.moments);
    traces.push({
      traceId,
      text: renderTrace(local, options.plantTell === 'ordered' ? traceId : undefined),
      features: traceFeatures(local, world),
      moments: local.length,
    });
    key.push({ traceId, arm: trace.arm, seed: trace.seed ?? trace.runId, beingId: trace.beingId, runId: trace.runId });
  }
  return {
    traces,
    key: new SealedTraceKey(key, options.seed, secret),
    manifest: {
      publicSeed: options.seed,
      commitment: commitTo(secret),
      scheme: 'sealed-secret-permutation/opaque-handle',
      traces: traces.length,
      dropped,
      minMoments,
      ...(options.plantTell ? { plantedTell: options.plantTell } : {}),
    },
  };
}

/** A Fisher–Yates permutation of 0..n-1, from a seeded stream. */
function permutation(n: number, rng: () => number): number[] {
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = order[i]!;
    order[i] = order[j]!;
    order[j] = a;
  }
  return order;
}

/**
 * Six base-36 characters from the seeded stream. Opaque rather than ordinal, so
 * that even a reader who is handed the whole list of handles has no ordering to
 * correlate with anything.
 */
function opaqueHandle(prefix: string, rng: () => number, used: Set<string>): string {
  for (let attempt = 0; attempt < 64; attempt++) {
    const token = Math.floor(rng() * 36 ** 6)
      .toString(36)
      .padStart(6, '0');
    const handle = `${prefix}-${token}`;
    if (!used.has(handle)) {
      used.add(handle);
      return handle;
    }
  }
  throw new Error('could not draw a distinct trace handle in 64 attempts — the seeded stream is degenerate');
}

/** Every world-wide handle becomes a per-trace ordinal, first-seen first. */
function localiseRefs(moments: readonly TraceMoment[]): TraceMoment[] {
  const ordinals = new Map<number, number>();
  const ordinal = (id: number): number => {
    let at = ordinals.get(id);
    if (at === undefined) ordinals.set(id, (at = ordinals.size + 1));
    return at;
  };
  return moments.map((moment) => ({
    ...moment,
    did: moment.did.map((step) =>
      step.replace(new RegExp(`${REF_MARK}(-?\\d+)`, 'g'), (_all, digits: string) => `#${ordinal(Number(digits))}`),
    ),
    said: moment.said.map((u) => ({ ...u, to: u.to === null ? null : ordinal(u.to) })),
  }));
}

/**
 * One template, every arm. Every line is printed every moment.
 *
 * `handle` is undefined in every real call: nothing that identifies a trace is
 * rendered into the text a judge reads. The parameter exists so the planted-tell
 * fixture can put it back and prove the blinding test fails when it does.
 */
export function renderTrace(moments: readonly TraceMoment[], handle?: string): string {
  const lines: string[] = [`TRACE${handle ? ` ${handle}` : ''} — ${moments.length} moments`];
  for (let i = 0; i < moments.length; i++) {
    const m = moments[i]!;
    lines.push('');
    // No tick offset: cadence is a function of prompt size through latency, and
    // the arms' prompts differ in size. The day is the same world in both arms.
    lines.push(`[moment ${i + 1} · day ${m.day} · ${m.season} · ${m.night ? 'night' : 'day'}]`);
    lines.push(`  feels: ${m.felt.map((f) => `${f.drive} ${f.pressure}`).join(', ') || 'nothing'}`);
    lines.push(`  sees: ${m.perceived.map((p) => `${p.count} ${p.kind}`).join(', ') || 'nothing'}; ${m.others} others`);
    lines.push(`  carries: ${m.carried.map((c) => `${c.kind}×${c.count}`).join(', ') || 'nothing'}`);
    lines.push(`  thinks: ${m.thought.length > 0 ? `"${m.thought}"` : '(nothing)'}`);
    lines.push(`  does: ${m.did.join('; ') || '(nothing)'}`);
    lines.push(
      `  says: ${m.said.map((s) => `(${s.act}${s.to === null ? '' : ` to #${s.to}`}) "${s.text}"`).join('; ') || '(nothing)'}`,
    );
    lines.push(`  then: ${renderOutcome(m.happened)}`);
  }
  return lines.join('\n');
}

function renderOutcome(outcome: MomentOutcome | null): string {
  if (!outcome) return '(still open)';
  const steps = outcome.steps
    .map((s) => `${s.act} ${s.executed ? 'done' : s.rejected ? `refused (${s.reason ?? 'no reason given'})` : 'not reached'}`)
    .join('; ');
  const moved = outcome.reliefs.map((r) => `${r.drive} ${r.delta >= 0 ? '+' : ''}${r.delta}`).join(', ');
  return `${steps || 'nothing happened'}; ${moved}; health ${outcome.healthDelta >= 0 ? '+' : ''}${outcome.healthDelta}; ${outcome.alive ? 'alive' : 'dead'}`;
}

// ─── Features ────────────────────────────────────────────────────────────────

/** What a trace shows, as numbers a rule-based judge can score. */
export function traceFeatures(moments: readonly TraceMoment[], world: WorldAdapter): TraceFeatures {
  const n = moments.length;
  const shapes = moments.map((m) => m.did.map((d) => d.slice(0, d.indexOf('(') >= 0 ? d.indexOf('(') : undefined)).join('>'));
  const counts = new Map<string, number>();
  for (const shape of shapes) counts.set(shape, (counts.get(shape) ?? 0) + 1);

  let runs = 0;
  for (let i = 0; i < shapes.length; i++) if (i === 0 || shapes[i] !== shapes[i - 1]) runs++;

  const supplied = suppliedFromTrace(moments, world);
  let pastReference = 0;
  let reactivity = 0;
  let socialCoherence = 0;
  let addressed = 0;
  let unsupportedClaims = 0;
  let ignorance = 0;
  const saidBefore = new Set<string>();

  for (let i = 0; i < n; i++) {
    const m = moments[i]!;
    const words = tokensOf(`${m.thought} ${m.said.map((s) => s.text).join(' ')}`);
    if (i > 0 && words.some((w) => saidBefore.has(w) && !STOP.has(w))) pastReference++;
    for (const w of words) saidBefore.add(w);

    const previous = moments[i - 1];
    if (previous) {
      const refused = previous.happened?.steps.some((s) => s.rejected) ?? false;
      const newSight = JSON.stringify(previous.perceived) !== JSON.stringify(m.perceived);
      if ((refused || newSight) && shapes[i] !== shapes[i - 1]) reactivity++;
    }
    for (const u of m.said) {
      addressed++;
      if (m.others > 0) socialCoherence++;
    }
    const output = asOutput(m);
    unsupportedClaims += detectLexicalLeaks(output, { supplied, names: suppliedNames(EMPTY_FOR_NAMES) }).filter(
      (e) => e.kind === 'claim',
    ).length;
    if (admitsIgnorance(`${m.thought} ${m.said.map((s) => s.text).join(' ')}`)) ignorance++;
  }

  const executed = moments.reduce((sum, m) => sum + (m.happened?.steps.filter((s) => s.executed).length ?? 0), 0);
  const attempted = moments.reduce((sum, m) => sum + (m.happened?.steps.length ?? 0), 0);

  return {
    moments: n,
    goalPersistence: runs > 0 ? round(n / runs) : 0,
    pastReference: rate(pastReference, Math.max(0, n - 1)),
    reactivity: rate(reactivity, Math.max(0, n - 1)),
    socialCoherence: rate(socialCoherence, addressed),
    distinctActs: counts.size,
    actEntropy: entropy([...counts.values()], n),
    planSuccessRate: rate(executed, attempted),
    unsupportedClaims,
    ignoranceAdmissions: ignorance,
  };
}

/** A moment's words, shaped so the existing leak matcher can read them. */
function asOutput(moment: TraceMoment): MindOutput {
  return {
    goals: [],
    plan: [],
    utterances: [
      ...(moment.thought.length > 0 ? [{ speechAct: 'inform' as const, text: moment.thought }] : []),
      ...moment.said.filter((s) => s.text.length > 0).map((s) => ({ speechAct: 'inform' as const, text: s.text })),
    ],
  };
}

/** The vocabulary this trace SHOWS the being was given — nothing else. */
function suppliedFromTrace(moments: readonly TraceMoment[], world: WorldAdapter): Set<string> {
  const supplied = new Set<string>();
  const add = (text: string): void => {
    for (const token of text.split(/[^\p{L}\p{N}]+/u)) {
      const stem = stemWord(token);
      if (stem) supplied.add(stem);
    }
  };
  for (const drive of world.drives) add(drive.id);
  for (const m of moments) {
    for (const p of m.perceived) add(p.kind);
    for (const c of m.carried) add(c.kind);
    for (const d of m.did) add(d);
    add(m.season);
  }
  return supplied;
}

/** The names channel is not available from a trace; an empty situation says so. */
const EMPTY_FOR_NAMES = {
  snapshot: { name: '' },
  kin: [],
  social: [],
} as unknown as Parameters<typeof suppliedNames>[0];

const STOP = new Set([
  'the', 'a', 'an', 'i', 'to', 'and', 'of', 'is', 'it', 'my', 'me', 'will', 'am', 'this', 'that', 'for', 'in', 'on',
  'with', 'so', 'but', 'if', 'do', 'not', 'have', 'has', 'be', 'was', 'are', 'there', 'here', 'go', 'more', 'some',
]);

function tokensOf(text: string): string[] {
  return text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 2);
}

function entropy(counts: readonly number[], total: number): number {
  if (total <= 0) return 0;
  let h = 0;
  for (const c of counts) {
    const p = c / total;
    if (p > 0) h -= p * Math.log2(p);
  }
  return round(h);
}

function rate(n: number, d: number): number {
  return d > 0 ? round(n / d) : 0;
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}
