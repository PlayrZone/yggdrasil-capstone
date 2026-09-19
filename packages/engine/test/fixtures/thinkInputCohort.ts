import { FORAGER_MOCK } from './foragerMock.js';
import { Experiment, MockMindBackend, foragerAdapter } from '../../src/index.js';
import type {
  CognitionOutcome,
  CognitionRecordV2,
  ICognitionSink,
  MindOutput,
  RunManifest,
  RunSummary,
  ThinkInput,
} from '../../src/index.js';

/**
 * A COHORT THAT WRITES DOWN WHAT A COGNITION ROW LOOKS LIKE.
 *
 * `strayArgCohort.ts` pins what was DECIDED (`resolvedOutput`). This pins what
 * the being was SHOWN: `thinkInput` as the corpus stores it, and the prompt
 * built from it — the two halves W1-B4 could have moved without any golden
 * noticing, because every coordinate in a row lives in a field the simulation
 * itself never reads back.
 *
 * `test/corpus-bytes.test.ts` compares it against `thinkInputRows.c727af7.json`,
 * captured by running THIS FILE in a worktree at `c727af7` — the commit before
 * the mind stopped holding coordinates. If the two agree, a v3 row recorded
 * before the step and after it are the same bytes, which is why
 * `COGNITION_SCHEMA_VERSION` did not have to move.
 *
 * It imports nothing W1-B4 added, so the same source runs in both trees — with
 * one deletion: `MockMindBackend` now REQUIRES the world whose wire it writes
 * (W1-B4 verifier, the fail), and at `c727af7` the `{policy}` branch forbade
 * one. Drop `world: foragerAdapter` from the line below to re-capture, and
 * nothing else. The policy here emits `Idle`/`Dig`, which carry no place, so the
 * bytes are the same either way; `mockCohort.ts` is the fixture that would not
 * be.
 *
 * The run is chosen to put a coordinate in every place a row can hold one: the
 * being's own position (`snapshot`), everything it can see (`worldView`), where
 * its memories happened (`recalledMemories`), and — through a seeded myth it
 * was told rather than witnessed — the site a story pulls it toward
 * (`sacredPlace`, and the sentence the prompt renders from it).
 */

class RowSink implements ICognitionSink {
  readonly records: CognitionRecordV2[] = [];
  openRun(_manifest: RunManifest): void {}
  cognition(record: CognitionRecordV2): void {
    this.records.push(JSON.parse(JSON.stringify(record)) as CognitionRecordV2);
  }
  outcome(_outcome: CognitionOutcome): void {}
  closeRun(_summary: RunSummary): void {}
}

export interface ThinkInputRow {
  being: number;
  tick: number;
  /** `thinkInput` as the corpus holds it — its own bytes, key order included. */
  input: string;
  /** …and the prompt those bytes were built into, which is what was paid for. */
  system: string;
  user: string;
}

export interface ThinkInputTrace {
  rows: ThinkInputRow[];
  /** How many rows carry a story's site at all — the field most at risk. */
  withSacredPlace: number;
}

const TICK_CHUNKS = 120;
const TICKS_PER_CHUNK = 10;
const COHORT_SIZE = 3;

/** A decision with only the arguments its act declares, so nothing depends on
 *  how a stray one is treated — that is `strayArgCohort`'s question, not this one. */
const PLAN = (nth: number): MindOutput => ({
  goals: [{ id: nth, description: 'find water', need: 'hunger', createdTick: 0 }],
  plan: nth % 2 === 0 ? [{ kind: 'Idle', durationTicks: 4 }] : [{ kind: 'Dig' }],
  utterances: [],
  thought: 'I will wait and see.',
});

export async function runThinkInputCohort(): Promise<ThinkInputTrace> {
  const sink = new RowSink();
  const calls = new Map<number, number>();
  const policy = {
    think: (input: ThinkInput): MindOutput => {
      const being = input.snapshot.id;
      const nth = calls.get(being) ?? 0;
      calls.set(being, nth + 1);
      return PLAN(nth);
    },
  };

  const exp = new Experiment({
    seed: 'w1-b4-think-input',
    agentCount: 12,
    mindBackend: new MockMindBackend({ ...FORAGER_MOCK, policy }),
    now: () => 0,
    recording: { sink, runId: 'think-input', nowMs: () => 0 },
  });
  // A tale they were TOLD, at a site none of them witnessed — the one thing
  // that puts a story's place into a think input at all.
  // Filed as a RAISING, because that is the only kind of tale a being makes
  // pilgrimage to — a seeded `seed:myth` is carried but never becomes a site.
  exp.seedMyth('The first makers raised a home by the great river', {
    id: 'home:0',
    x: 900,
    y: 120,
    timesHeard: 5,
  });
  const cohort = exp.agentIds.slice(0, COHORT_SIZE);
  for (const id of cohort) exp.makeConscious(id);

  for (let chunk = 0; chunk < TICK_CHUNKS; chunk++) {
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

  let withSacredPlace = 0;
  const rows: ThinkInputRow[] = sink.records.map((record) => {
    if ((record.thinkInput as { sacredPlace?: unknown }).sacredPlace !== undefined) withSacredPlace++;
    return {
      being: record.beingId,
      tick: record.tick,
      input: JSON.stringify(record.thinkInput),
      system: record.prompt.system,
      user: record.prompt.user,
    };
  });
  return { rows, withSacredPlace };
}
