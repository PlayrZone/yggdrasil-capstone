import { Experiment, MockMindBackend } from '../../src/index.js';
import type {
  CognitionOutcome,
  CognitionRecordV2,
  ICognitionSink,
  Intent,
  MindOutput,
  RunManifest,
  RunSummary,
  SimEvent,
  ThinkInput,
} from '../../src/index.js';

/**
 * A COHORT THAT WRITES DOWN WHAT THE OLD ENGINE DID WITH A STRAY ARGUMENT.
 *
 * W1-B3 moved every plan step through `WorldGate.admitIntent`, which refused an
 * intent carrying an argument its action does not declare. Before it, such a
 * step reached the BODY, which either executed it (ignoring the field) or
 * refused it as physics — and a physical refusal is an `IntentRejected` event
 * the being REMEMBERS. The W1-B3 verifier found the difference: `Eat{targetId}`
 * lost five remembered rejections, a `MoveTo` carrying every argument stopped
 * moving anyone, and `resolvedOutput` — corpus data — diverged at row 0.
 *
 * Nothing in the goldens could see it: a reflex being emits only the arguments
 * its own acts declare, so the whole class passes 3,000 golden ticks untouched.
 * This is the cohort that does see it — a scripted "model" that asks for every
 * one of this world's sixteen acts three ways:
 *
 *   `/valid`  exactly the arguments the act declares,
 *   `/stray`  only arguments it does NOT declare (the commonest LLM slip, and
 *             the one the parser deliberately tolerates: every VALUE is legal),
 *   `/all`    every argument the wire can carry, at once.
 *
 * The trace it returns is the whole observable decision surface: what each
 * being was asked to decide and when (`script`), what the corpus recorded
 * (`records`, with `resolvedOutput` kept as its own bytes), and every refusal
 * the body uttered (`rejections`). `test/world-stray-args.test.ts` compares it
 * against `strayArgTrace.01a23d2.json`, captured by running THIS FILE in a
 * worktree at `01a23d2`, the commit before the seam moved.
 *
 * It imports nothing that W1-B3 added, so the same source runs in both trees.
 */

/** Every value is legal for its argument, so the parser passes all of them. */
export const COHORT_ARGS: Readonly<Record<string, number | string>> = {
  x: 120,
  y: 140,
  targetId: 4,
  objectKind: 'berry',
  buildKind: 'shelter',
  durationTicks: 5,
};

/** The order `parsePlan` writes an intent's fields in, hence the wire's order. */
export const COHORT_ARG_ORDER: readonly string[] = [
  'x',
  'y',
  'targetId',
  'objectKind',
  'buildKind',
  'durationTicks',
];

/**
 * The forager world's acts and the arguments each one takes, WRITTEN OUT rather
 * than read off the adapter: a cohort that derived the shapes from the tables it
 * is testing could not tell a transcription error from a behaviour change, and
 * the old tree has no such tables to read. `world-stray-args.test.ts` pins this
 * against `foragerAdapter` so the two cannot drift apart.
 *
 * Speech is left out of `Speak`: it is composed by the engine from `utterances`
 * and never parsed out of a plan, so a model cannot write one.
 */
export const COHORT_ACTIONS: readonly (readonly [string, readonly string[]])[] = [
  ['MoveTo', ['x', 'y', 'targetId']],
  ['Gather', ['targetId']],
  ['Dig', []],
  ['Eat', ['objectKind']],
  ['Drink', []],
  ['Sleep', ['durationTicks']],
  ['Build', ['buildKind', 'x', 'y']],
  ['Deposit', ['objectKind', 'targetId']],
  ['Withdraw', ['objectKind', 'targetId']],
  ['Give', ['targetId', 'objectKind']],
  ['Attack', ['targetId']],
  ['Craft', []],
  ['Speak', []],
  ['Follow', ['targetId']],
  ['Flee', ['x', 'y']],
  ['Idle', ['durationTicks']],
];

export interface StrayCase {
  /** `Eat/stray` — the act and which of the three ways it is being asked for. */
  readonly id: string;
  readonly intent: Intent;
}

/** The forty-eight decisions, in a fixed order the script cycles through. */
export function strayArgCases(): StrayCase[] {
  const cases: StrayCase[] = [];
  for (const [action, declared] of COHORT_ACTIONS) {
    cases.push({ id: `${action}/valid`, intent: intentWith(action, declared) });
    cases.push({
      id: `${action}/stray`,
      intent: intentWith(action, COHORT_ARG_ORDER.filter((arg) => !declared.includes(arg))),
    });
    cases.push({ id: `${action}/all`, intent: intentWith(action, COHORT_ARG_ORDER) });
  }
  return cases;
}

function intentWith(kind: string, args: readonly string[]): Intent {
  const intent: Record<string, unknown> = { kind };
  // Written in the wire's order, whatever order the act declares them in, so a
  // recorded plan can be compared byte for byte.
  for (const arg of COHORT_ARG_ORDER) if (args.includes(arg)) intent[arg] = COHORT_ARGS[arg];
  return intent as unknown as Intent;
}

export interface RecordedThink {
  being: number;
  tick: number;
  appliedTick: number | null;
  valid: boolean;
  /** `resolvedOutput` as the corpus holds it — its own bytes, key order included. */
  resolved: string | null;
}

export interface RejectedIntent {
  tick: number;
  actor: number;
  intentKind: string;
  reason: string;
}

export interface StrayArgTrace {
  /** Every case the script handed out, in call order: who decided what, when. */
  script: string[];
  records: RecordedThink[];
  rejections: RejectedIntent[];
  rejectionsByReason: Record<string, number>;
  /** Plan steps the body was actually handed, by act. */
  executedByKind: Record<string, number>;
}

/** Keeps what a corpus keeps, through JSON — exactly what the file sink writes. */
class TraceSink implements ICognitionSink {
  readonly records: CognitionRecordV2[] = [];
  openRun(_manifest: RunManifest): void {}
  cognition(record: CognitionRecordV2): void {
    this.records.push(JSON.parse(JSON.stringify(record)) as CognitionRecordV2);
  }
  outcome(_outcome: CognitionOutcome): void {}
  closeRun(_summary: RunSummary): void {}
}

const TICK_CHUNKS = 200;
const TICKS_PER_CHUNK = 10;
/** Six beings, each starting eight cases along, so all forty-eight are asked. */
const COHORT_SIZE = 6;
const CASE_STRIDE = 8;

export async function runStrayArgCohort(): Promise<StrayArgTrace> {
  const cases = strayArgCases();
  const sink = new TraceSink();
  const offsets = new Map<number, number>();
  const calls = new Map<number, number>();
  const script: string[] = [];
  const rejections: RejectedIntent[] = [];

  // A being's Nth think is always the same case, whatever order the beings are
  // served in — so the script is a fact about the cohort, not about scheduling.
  const policy = {
    think: (input: ThinkInput): MindOutput => {
      const being = input.snapshot.id;
      const nth = calls.get(being) ?? 0;
      calls.set(being, nth + 1);
      const chosen = cases[((offsets.get(being) ?? 0) + nth) % cases.length]!;
      script.push(`${being}:${chosen.id}`);
      return {
        goals: [],
        plan: [chosen.intent, { kind: 'Idle', durationTicks: 3 }],
        // Speech every eighth case, so the act this world binds to `Say` — which
        // the engine composes rather than the model — crosses the edge too.
        utterances:
          script.length % 8 === 1 ? [{ speechAct: 'inform' as const, text: 'the berries by the water' }] : [],
      };
    },
  };

  const exp = new Experiment({
    seed: 'w1-b3-stray-args',
    agentCount: 12,
    mindBackend: new MockMindBackend({ policy }),
    now: () => 0,
    recording: { sink, runId: 'stray-args', nowMs: () => 0 },
  });
  exp.bus.on((event: SimEvent) => {
    if (event.type !== 'IntentRejected') return;
    rejections.push({
      tick: event.tick,
      actor: event.actorId,
      intentKind: String(event.payload['intentKind']),
      reason: String(event.payload['reason']),
    });
  });

  const cohort = exp.agentIds.slice(0, COHORT_SIZE);
  cohort.forEach((id, i) => offsets.set(id, i * CASE_STRIDE));
  for (const id of cohort) exp.makeConscious(id);

  for (let chunk = 0; chunk < TICK_CHUNKS; chunk++) {
    // Kept alive on a fixed cadence: a being living on junk plans starves, and a
    // cohort that dies early asks fewer of its questions.
    if (chunk % 30 === 0) {
      exp.provisionNeeds(cohort, {
        hunger: 20,
        rest: 20,
        safety: 10,
        socialConnection: 20,
        health: 100,
        clearSickness: true,
      });
    }
    exp.advance(TICKS_PER_CHUNK);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  await exp.settleCognition();
  exp.endRecording();

  const rejectionsByReason: Record<string, number> = {};
  for (const rejection of rejections) {
    rejectionsByReason[rejection.reason] = (rejectionsByReason[rejection.reason] ?? 0) + 1;
  }
  const executedByKind: Record<string, number> = {};
  const records: RecordedThink[] = sink.records.map((record) => {
    for (const intent of record.resolvedOutput?.plan ?? []) {
      executedByKind[intent.kind] = (executedByKind[intent.kind] ?? 0) + 1;
    }
    return {
      being: record.beingId,
      tick: record.tick,
      appliedTick: record.appliedTick,
      valid: record.parse.valid,
      resolved: record.resolvedOutput === null ? null : JSON.stringify(record.resolvedOutput),
    };
  });

  return { script, records, rejections, rejectionsByReason, executedByKind };
}
