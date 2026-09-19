import { Experiment, MockMindBackend, at, codecFor, foragerAdapter } from '../../src/index.js';
import type {
  CognitionOutcome,
  CognitionRecordV2,
  ICognitionSink,
  Intent,
  MindOutput,
  PlaceRef,
  RunManifest,
  RunSummary,
  ThinkInput,
} from '../../src/index.js';

/**
 * A COHORT DRIVEN BY A MOCK THAT DECIDES WHERE TO GO.
 *
 * This is the dump the W1-B4 verifier had and the step did not. `MockMindBackend`
 * plays the MODEL, and a model writes the WORLD's wire — `{"kind":"MoveTo",
 * "x":900,"y":120}`. The mock wrote its policy's own `MindOutput` instead, which
 * since W1-B4 carries `place: PlaceRef`, so every act with a destination reached
 * `parseMindOutput` as `{"kind":"MoveTo"}` and the being was handed nowhere to
 * go. Nothing existing could see it: the goldens run no backend at all,
 * `thinkInputCohort` deliberately emits place-free acts (`Idle`/`Dig`), and
 * `strayArgCohort`'s scripted intents are already written in the wire's own
 * fields. This cohort is the one that does — every act it decides carries a
 * place, and what it pins is what diverged: the RAW bytes the mock wrote,
 * `parsedOutput`, `resolvedOutput`, and the ordered event log the world
 * produced from them.
 *
 * `test/mock-cohort.test.ts` compares it against `mockCohortTrace.c727af7.json`,
 * captured by running THIS FILE in a worktree at `c727af7` — the commit before
 * the mind stopped holding coordinates, and the last one on which a mock-driven
 * being still arrived where it decided to go.
 *
 * TO RE-CAPTURE at `c727af7`, two mechanical edits and nothing else: write each
 * plan step's place as the sibling fields it is written as (`place: at(900, 120)`
 * → `x: 900, y: 120`, in the same position, which is where the codec expands it)
 * and drop `world: foragerAdapter` from the backend, which had no such option.
 * Never edit the fixture to match.
 */

/** The site a seeded tale pulls a being toward — and the one it decides to walk to. */
const SACRED = { x: 900, y: 120 } as const;

/**
 * A place with only one of its two fields. Not a mistake to design out: a model
 * writes `{"kind":"MoveTo","x":5}`, that half of an act reached the body before
 * W1-B4, and the body's refusal is an event the being remembers. `at` cannot
 * make one, so the world's own reader does.
 */
const HALF: PlaceRef = codecFor(foragerAdapter.space).decode({ x: 5 })!;

/**
 * Six decisions, cycled — every shape of place a model produces, in the acts
 * this world declares them on:
 *
 *   0  the pilgrimage      a valid place on the act that declares one
 *   1  a site to build on  a place beside another argument
 *   2  out of the world    a place the body has to refuse
 *   3  half of a place     one field written, the other never sent
 *   4  a stray place       a place on an act that does not declare one
 *   5  a place that is not a number — `NaN`, which JSON cannot even hold
 */
function planFor(nth: number): Intent[] {
  switch (nth % 6) {
    case 0:
      return [{ kind: 'MoveTo', place: at(SACRED.x, SACRED.y) }, { kind: 'Idle', durationTicks: 3 }];
    case 1:
      return [{ kind: 'Build', buildKind: 'shelter', place: at(140, 160) }];
    case 2:
      return [{ kind: 'Flee', place: at(-4000, 9000) }];
    case 3:
      return [{ kind: 'MoveTo', place: HALF, targetId: 3 }];
    case 4:
      return [{ kind: 'Gather', place: at(120, 140), targetId: 2 }];
    default:
      return [{ kind: 'MoveTo', place: at(Number.NaN, 0) }];
  }
}

/** One decided row, reduced to the three fields the fail moved. */
export interface MockCohortRow {
  being: number;
  tick: number;
  appliedTick: number | null;
  status: string;
  /** What the "model" wrote — the bytes `parseMindOutput` was handed. */
  raw: string;
  /** …what came out of the parser, and what the world was finally given. */
  parsed: string;
  resolved: string | null;
}

export interface MockCohortTrace {
  rows: MockCohortRow[];
  /** The whole ordered event log, one row of JSON each. */
  events: string[];
  counts: {
    events: number;
    births: number;
    builds: number;
    alive: number;
    conflicts: number;
    /** Rows whose raw reply carries a coordinate at the TOP level, as a model writes one. */
    rawWithCoordinates: number;
    /** …and rows whose resolved plan reached the world with one. */
    resolvedWithCoordinates: number;
  };
}

class RowSink implements ICognitionSink {
  readonly records: CognitionRecordV2[] = [];
  openRun(_manifest: RunManifest): void {}
  cognition(record: CognitionRecordV2): void {
    this.records.push(JSON.parse(JSON.stringify(record)) as CognitionRecordV2);
  }
  outcome(_outcome: CognitionOutcome): void {}
  closeRun(_summary: RunSummary): void {}
}

const TICK_CHUNKS = 120;
const TICKS_PER_CHUNK = 10;
const COHORT_SIZE = 4;

export async function runMockCohort(): Promise<MockCohortTrace> {
  const sink = new RowSink();
  const calls = new Map<number, number>();

  // A being's Nth decision is always the same one, whatever order the beings
  // are served in — so the script is a fact about the cohort, not about
  // scheduling.
  const policy = {
    think: (input: ThinkInput): MindOutput => {
      const being = input.snapshot.id;
      const nth = calls.get(being) ?? 0;
      calls.set(being, nth + 1);
      return {
        goals: [{ id: nth, description: 'reach the place the story tells of', need: 'safety', createdTick: 0 }],
        plan: planFor(nth + being),
        utterances: nth % 4 === 1 ? [{ speechAct: 'inform' as const, text: 'the home by the great river' }] : [],
        thought: 'I will go where the tale says they raised it.',
      };
    },
  };

  const exp = new Experiment({
    seed: 'w1-b4-mock-cohort',
    agentCount: 12,
    mindBackend: new MockMindBackend({ world: foragerAdapter, policy }),
    now: () => 0,
    recording: { sink, runId: 'mock-cohort', nowMs: () => 0 },
  });
  // A tale they were TOLD, at a site none of them witnessed — so `sacredPlace`
  // is in every think input and the act at `nth % 6 === 0` is a pilgrimage to it.
  exp.seedMyth('The first makers raised a home by the great river', {
    id: 'home:0',
    x: SACRED.x,
    y: SACRED.y,
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

  let rawWithCoordinates = 0;
  let resolvedWithCoordinates = 0;
  const rows: MockCohortRow[] = sink.records.map((record) => {
    const raw = record.attempts[0]?.raw ?? '';
    const resolved = record.resolvedOutput === null ? null : JSON.stringify(record.resolvedOutput);
    // A coordinate at the TOP level of a decided act is the whole question: it
    // is what a model writes, what the parser reads, and what the mock stopped
    // producing. Counted off the bytes rather than asserted about them.
    if (/"plan":\[\{"kind":"[A-Za-z]+","x":/.test(raw)) rawWithCoordinates++;
    if (resolved !== null && /"kind":"[A-Za-z]+","x":/.test(resolved)) resolvedWithCoordinates++;
    return {
      being: record.beingId,
      tick: record.tick,
      appliedTick: record.appliedTick,
      status: record.status,
      raw,
      parsed: JSON.stringify(record.parsedOutput),
      resolved,
    };
  });

  return {
    rows,
    events: exp.eventLog.map((event) => JSON.stringify(event)),
    counts: {
      events: exp.eventCount,
      births: exp.birthCount,
      builds: exp.buildCount,
      alive: exp.aliveCount(),
      conflicts: exp.conflictCount,
      rawWithCoordinates,
      resolvedWithCoordinates,
    },
  };
}
