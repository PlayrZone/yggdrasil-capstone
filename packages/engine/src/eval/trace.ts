import type { WorldAdapter } from '../contract/adapter.js';
import type { Intent, MindOutput, SimEvent } from '../contract/types.js';
import type { CognitionOutcome, CognitionRecordV2 } from '../record/types.js';
import { detectLexicalLeaks, stemWord, suppliedNames } from '../training/leakMatch.js';
import { deserializeThinkInput } from '../record/serialize.js';
import { commitTo, keyedStream, randomBlindSecret } from './commit.js';
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
  records: readonly CognitionRecordV2[];
  outcomes: readonly CognitionOutcome[];
  /** Optional: the capped event tail, for what happened AROUND the being. */
  events?: readonly SimEvent[];
}

/** Build one raw trace per being that thought at least once. */
export function buildTraces(source: TraceSource, world: WorldAdapter): RawBeingTrace[] {
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
      return momentOf(record, outcomeById.get(record.id), world, start, happenedAround);
    });
    traces.push({ runId: source.runId, arm: source.arm, beingId, moments });
  }
  return traces;
}

function momentOf(
  record: CognitionRecordV2,
  outcome: CognitionOutcome | undefined,
  world: WorldAdapter,
  start: number,
  around: readonly string[],
): TraceMoment {
  const input = deserializeThinkInput(record.thinkInput);
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
export class SealedTraceKey {
  private readonly entries: readonly TraceKey[];
  private readonly secret: string;
  private unsealCount = 0;

  /** The public label of the run. It keys NOTHING. */
  readonly publicSeed: string;
  /** `sha256(secret)`. Safe to publish; useless until the secret is disclosed. */
  readonly commitment: string;

  constructor(entries: readonly TraceKey[], publicSeed: string, secret: string) {
    this.entries = entries.map((e) => ({ ...e }));
    this.publicSeed = publicSeed;
    this.secret = secret;
    this.commitment = commitTo(secret);
  }

  get size(): number {
    return this.entries.length;
  }

  /** Has anybody looked? The blinding tests assert this is still 0 mid-judging. */
  get unsealed(): boolean {
    return this.unsealCount > 0;
  }

  /** Every handle, in the order the traces were returned in. No arms. */
  handles(): readonly string[] {
    return this.entries.map((e) => e.traceId);
  }

  /** The handles of one arm — for PAIRING, which happens before any judging. */
  handlesOf(arm: ArmId): readonly string[] {
    return this.entries.filter((e) => e.arm === arm).map((e) => e.traceId);
  }

  /** Which arms are represented at all. */
  arms(): readonly ArmId[] {
    return [...new Set(this.entries.map((e) => e.arm))];
  }

  /**
   * Break the seal. Called by `judgeTraces` AFTER every judgement is recorded,
   * and by a caller that is reporting rather than judging.
   */
  unseal(): readonly TraceKey[] {
    this.unsealCount++;
    return this.entries.map((e) => ({ ...e }));
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
    if (this.unsealCount === 0) {
      throw new Error('the blinding secret is disclosed only after unseal(): a sealed key that answers questions is not sealed');
    }
    return { secret: this.secret, publicSeed: this.publicSeed, commitment: this.commitment };
  }

  /**
   * SERIALISING A SEALED KEY MUST NOT UNSEAL IT. `private` is a TypeScript
   * fact, not a JavaScript one: without this, `JSON.stringify(result)` — which
   * is what a reader or an agent does with a result object — printed every
   * entry and the secret beside them.
   */
  toJSON(): { sealed: true; size: number; publicSeed: string; commitment: string } {
    return { sealed: true, size: this.entries.length, publicSeed: this.publicSeed, commitment: this.commitment };
  }

  /** Swap which arm every handle belongs to — the label-swap control. */
  relabelled(swap: (arm: ArmId) => ArmId): SealedTraceKey {
    return new SealedTraceKey(
      this.entries.map((e) => ({ ...e, arm: swap(e.arm) })),
      this.publicSeed,
      this.secret,
    );
  }
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
    key.push({ traceId, arm: trace.arm, beingId: trace.beingId, runId: trace.runId });
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
