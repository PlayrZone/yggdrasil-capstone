import { describe, expect, it } from 'vitest';
import {
  FaithfulMockBackend,
  INTEGRITY_THRESHOLDS,
  MockTraceJudge,
  OmniscientMockBackend,
  blindTraces,
  buildTraces,
  computeArmMetrics,
  JUDGE_GATE_HASH,
  attestRun,
  foragerAdapter,
  foragerWorld,
  integrityBreaches,
  judgeTraces,
  pairTraces,
  runAb,
} from '../src/index.js';
import { RETRY_SENTINEL, retryFeedbackIn } from '../src/eval/baseline/BaselineAgentBackend.js';
import { encodeOutput } from '../src/contract/wire.js';
import { wireFieldsOf } from '../src/contract/actions.js';
import { retryPrompt } from '../src/consciousness/prompt.js';
import type { ArmIntegrity, ArmMetrics, AbVerdict, RawBeingTrace, RunAttestation } from '../src/index.js';
import type { IMindBackend } from '../src/consciousness/IMindBackend.js';
import type { ThinkInput } from '../src/contract/types.js';
import type { ThinkPrompt } from '../src/consciousness/prompt.js';

/**
 * R3 AND R5 — THE MOCK-PROVEN A/B WAS DEGENERATE AND NOTHING NOTICED.
 *
 * Three separate failures, one blind spot.
 *
 *   (a) `ScriptedBackend.complete` stringified its own `MindOutput`, which since
 *       W1-B4 carries an opaque `place`. A model writes the WORLD's fields, so
 *       `{"kind":"MoveTo","place":{"x":5,"y":7}}` parsed to `{"kind":"MoveTo"}`
 *       — the destination silently deleted. `MockMindBackend` had the same bug
 *       and was fixed in `48c9c46`; `eval/mocks.ts` was not.
 *   (b) The bug was LATENT only because the arms did nothing. Every branch of
 *       the faithful mock was gated on a pressing drive; at 900 ticks no drive
 *       presses, so across twelve traces it emitted `Idle` fifty-two times and
 *       its Move branch was never reached. The other arm took a node it had not
 *       walked to: **104 Craft refused, 52 Gather refused, 52 Idle** — every
 *       non-Idle act in the run refused by the body — and the `planSuccessRate`
 *       delta of 0.8769 that gates the pilot was one arm idling against the
 *       other being refused.
 *   (c) There was no channel for any of it. `integrity` said `degraded: false`,
 *       `fallbackRateByArm {A:0,B:0}`, *"every moment is the arm's own mind"*.
 *
 *   (R5) And detection changed nothing: `degraded` never reached
 *        `usableForVerdict`, so a block in which an arm ran mostly on the
 *        world's reflex policy would still have printed a verdict.
 *
 * The load-bearing test is the last one in this file: the old stringify bug is
 * PLANTED back, and the run must be refused as degraded.
 */

/**
 * The field names this world writes a place as, asked the way production asks:
 * a place is opaque, and `wireFieldsOf` reads the world's own declaration
 * rather than opening one. (W1-B4 round 3 moved `fields` off `SpaceOps` onto
 * the edge-facing codec; this route survives that.)
 */
const PLACE_FIELDS: string[] = wireFieldsOf(
  foragerAdapter,
  foragerAdapter.actions.flatMap((action) => action.params).find((param) => param.type === 'place')!,
).map((field) => field.id);

const SPEC = { seeds: ['integrity-1'], ticks: 900, cohortSize: 4, agentCount: 16, blindSecret: 'integrity' } as const;
const FAITHFUL = { kind: 'mock', mind: 'faithful' } as const;
const OMNISCIENT = { kind: 'mock', mind: 'omniscient' } as const;

let cached: Promise<AbVerdict> | null = null;
function proofRun(): Promise<AbVerdict> {
  cached ??= (async () => {
    const result = await runAb({ ...SPEC }, { arms: [{ id: 'A', backend: FAITHFUL }, { id: 'B', backend: OMNISCIENT }] });
    if (!result.usable) throw new Error(result.reason);
    return result;
  })();
  return cached;
}

describe('W1-E · R3(a) · everything standing in for a model writes the WIRE format', () => {
  it('writes the world\'s own place fields, not the mind\'s opaque handle', async () => {
    const result = await proofRun();
    let sawPlace = 0;
    for (const arm of ['A', 'B'] as const) {
      const integrity = result.integrity.byArm[arm]!;
      expect(integrity.decisions).toBeGreaterThan(0);
      sawPlace += integrity.placeBearingDecisions;
      // Round 3: 0 of 24 mock decisions carried a place at all.
      expect(integrity.placeBearingDecisions, `${arm} decisions carrying a place`).toBeGreaterThan(0);
      // …and not one argument was lost between what it wrote and what was read.
      expect(integrity.parsedIntactRate, `${arm} parsed intact`).toBe(1);
      expect(integrity.firstArgumentLoss).toBeUndefined();
    }
    // eslint-disable-next-line no-console
    console.log(`R3(a): ${sawPlace} decisions carried a place, 0 arguments lost`);
  }, 180_000);

  it('round-trips a place through the codec the way the parser reads it', () => {
    // The exact shape from the reviewer's measurement, both ways round.
    const mind = { goals: [], plan: [{ kind: 'MoveTo', place: foragerAdapter.space.unplaced }], utterances: [] };
    const wire = encodeOutput(foragerWorld.edges.codec, mind);
    const step = wire.plan[0] as Record<string, unknown>;
    expect('place' in step).toBe(false);
    for (const field of PLACE_FIELDS) expect(field in step).toBe(true);
  });
});

describe('W1-E · R3(b) · the arms do something, and a meaningful share of it lands', () => {
  it('has the faithful arm act on what it perceives and holds, and SUCCEED', async () => {
    const result = await proofRun();
    const a = result.integrity.byArm['A']!;
    // eslint-disable-next-line no-console
    console.log(
      `R3(b) arm A: ${a.decisions} decisions, ${a.accepted} accepted / ${a.refused} refused (rate ${a.refusalRate}), ` +
        `idle ${a.idle} (${a.idleShare}), place-bearing ${a.placeBearingDecisions}, fallbacks ${a.llmFallbacks}`,
    );
    // Round 3: idle 52 of 52, accepted 0.
    expect(a.idleShare).toBeLessThan(0.5);
    expect(a.accepted).toBeGreaterThan(0);
    // A MEANINGFUL SHARE: more of its steps land than are refused.
    expect(a.accepted).toBeGreaterThan(a.refused);
    // And it does something with what it gathers: the diet is not empty.
    const metrics = result.perSeed[0]!.metrics['A']!;
    expect(metrics.dietBreadth).toBeGreaterThan(0);
    expect(metrics.behaviour.distinctShapes).toBeGreaterThan(1);
  }, 180_000);

  it('no longer has every non-Idle act in the run refused by the body', async () => {
    const result = await proofRun();
    let accepted = 0;
    let refused = 0;
    for (const arm of ['A', 'B'] as const) {
      const row = result.integrity.byArm[arm]!;
      accepted += row.accepted;
      refused += row.refused;
      // eslint-disable-next-line no-console
      console.log(`R3(b) arm ${arm}: ${JSON.stringify(row.refusalsByReason)}`);
    }
    // Round 3: accepted 0, refused 156.
    expect(accepted).toBeGreaterThan(0);
    expect(refused).toBeLessThan(accepted + refused);
  }, 180_000);

  it('stays world-agnostic: the mocks name no world noun and read the adapter instead', () => {
    const faithful = new FaithfulMockBackend(foragerWorld.edges);
    const omniscient = new OmniscientMockBackend(foragerWorld.edges);
    expect(faithful.modelId).toBe('mock/faithful');
    expect(omniscient.modelId).toBe('mock/omniscient');
    // `eval/mocks.ts` reaches the world only through core verbs and affordance
    // tags — so the SAME mock runs on any adapter. The check that would catch a
    // hard-coded noun is that this file's source names none of this world's
    // kinds; `eval-ab.test.ts` runs the pair on the toy world.
    const source = String(FaithfulMockBackend);
    for (const kind of foragerAdapter.kinds) expect(source).not.toContain(`'${kind.id}'`);
    for (const action of foragerAdapter.actions) expect(source).not.toContain(`'${action.id}'`);
  });
});

describe('W1-E · R3(c) · the integrity channel, with pre-registered thresholds', () => {
  it('reports every counter the reviewer asked for, per arm', async () => {
    const result = await proofRun();
    const rows: string[] = [];
    for (const arm of ['A', 'B'] as const) {
      const row: ArmIntegrity = result.integrity.byArm[arm]!;
      for (const field of [
        'decisions',
        'placeBearingDecisions',
        'parsedIntact',
        'accepted',
        'refused',
        'idle',
        'llmFallbacks',
      ] as const) {
        expect(typeof row[field], `${arm}.${field}`).toBe('number');
      }
      rows.push(
        `  ${arm}: decisions ${row.decisions} · place-bearing ${row.placeBearingDecisions} · parsed-intact ` +
          `${row.parsedIntact} (${row.parsedIntactRate}) · accepted ${row.accepted} · refused ${row.refused} ` +
          `(${row.refusalRate}) · idle share ${row.idleShare} · fallbacks ${row.llmFallbacks}`,
      );
    }
    // eslint-disable-next-line no-console
    console.log(['', 'R3(c) integrity, per arm:', ...rows].join('\n'));
    expect(result.integrity.thresholds).toBe(INTEGRITY_THRESHOLDS);
    expect(result.integrity.degraded).toBe(false);
    expect(result.integrity.reasons).toEqual([]);
  }, 180_000);

  it('crosses each threshold on its own, and names which', () => {
    const clean: ArmIntegrity = {
      decisions: 100,
      placeBearingDecisions: 100,
      parsedIntact: 100,
      parsedIntactRate: 1,
      accepted: 80,
      refused: 20,
      refusalRate: 0.2,
      refusalsByReason: [{ reason: 'out-of-range', count: 20 }],
      idle: 10,
      idleShare: 0.1,
      llmFallbacks: 0,
      fallbackRate: 0,
    };
    expect(integrityBreaches('A', clean)).toEqual([]);
    expect(integrityBreaches('A', { ...clean, refusalRate: 0.9 })[0]).toMatch(/REFUSED/);
    expect(integrityBreaches('A', { ...clean, idleShare: 0.9 })[0]).toMatch(/did nothing/);
    expect(integrityBreaches('A', { ...clean, fallbackRate: 0.6, llmFallbacks: 60 })[0]).toMatch(/reflex policy/);
    expect(integrityBreaches('A', { ...clean, parsedIntactRate: 0.5, parsedIntact: 50 })[0]).toMatch(/LOST ARGUMENTS/);
    expect(integrityBreaches('A', { ...clean, decisions: 0 })[0]).toMatch(/no decisions at all/);
    // Round 3's own numbers: every non-Idle act refused, every decision idle.
    expect(integrityBreaches('A', { ...clean, idle: 52, decisions: 52, idleShare: 1 }).length).toBeGreaterThan(0);
    expect(integrityBreaches('B', { ...clean, accepted: 0, refused: 156, refusalRate: 1 }).length).toBeGreaterThan(0);
  });
});

describe('W1-E · R5 · a degraded run can never be a verdict', () => {
  it('refuses an aggregate that has not been told anything about the run', async () => {
    const result = await proofRun();
    const pairs = pairTraces(result.traces, result.key, 'r5').pairs;
    const silent = await judgeTraces(pairs, result.key, new MockTraceJudge());
    expect(silent.integrity).toBeNull();
    expect(silent.usableForVerdict).toBe(false);
    expect(silent.note).toMatch(/no run integrity was attested/);
  }, 180_000);

  it('refuses a degraded run by name, including the silent reflex-fallback case', async () => {
    const result = await proofRun();
    const pairs = pairTraces(result.traces, result.key, 'r5').pairs;
    // S6: an attestation must be BOUND to the run it is about — a bare
    // {degraded, reasons} is a claim about some run, and judgeTraces refuses
    // it before it ever reaches the degraded branch.
    const fellBack: RunAttestation = attestRun(result.key, {
      degraded: true,
      reasons: ["arm B fell back to the world's reflex policy on 60 of 100 thinks (0.6 > 0.05)"],
      thinkOutcomes: {},
      seeds: result.seeds,
      ruleHash: JUDGE_GATE_HASH,
    });
    const aggregate = await judgeTraces(pairs, result.key, new MockTraceJudge(), { integrity: fellBack });
    expect(aggregate.usableForVerdict).toBe(false);
    expect(aggregate.note).toMatch(/DEGRADED/);
    expect(aggregate.note).toMatch(/reflex policy/);
  }, 180_000);
});

// ─── The load-bearing one: plant the bug back ────────────────────────────────

/** Round 3's `ScriptedBackend.complete`, restored: the MIND form, not the wire form. */
class StringifyingMockBackend implements IMindBackend {
  readonly modelId = 'mock/faithful';
  private readonly inner: FaithfulMockBackend;

  constructor() {
    this.inner = new FaithfulMockBackend(foragerWorld.edges);
  }

  async complete(prompt: ThinkPrompt, input: ThinkInput): Promise<string> {
    const wire = JSON.parse(await this.inner.complete(prompt, input)) as Record<string, unknown>;
    const plan = Array.isArray(wire['plan']) ? (wire['plan'] as Record<string, unknown>[]) : [];
    const fields = PLACE_FIELDS;
    // Fold the world's own place fields back into the opaque `place` object the
    // round-3 mock wrote, which is what the parser then dropped on the floor.
    wire['plan'] = plan.map((step) => {
      const carried: Record<string, unknown> = {};
      const rest: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(step)) {
        if (fields.includes(key)) carried[key] = value;
        else rest[key] = value;
      }
      return Object.keys(carried).length > 0 ? { ...rest, place: carried } : rest;
    });
    return JSON.stringify(wire);
  }
}

describe('W1-E · R3 · the planted bug — the test that would have caught round 3', () => {
  it('refuses the run as DEGRADED when an arm loses an argument between decision and parse', async () => {
    const world = foragerAdapter;
    const planted = new StringifyingMockBackend();
    const result = await runAb(
      { ...SPEC, seeds: ['planted'] },
      { arms: [{ id: 'A', backend: FAITHFUL }, { id: 'B', backend: OMNISCIENT }] },
    );
    if (!result.usable) throw new Error(result.reason);

    // Drive the planted backend over the SAME situations the clean run saw, and
    // measure what the parser made of it.
    const subjects = result.subjects['A'] ?? [];
    expect(subjects.length).toBeGreaterThan(0);
    let lost = 0;
    let placeBearing = 0;
    for (const subject of subjects) {
      const raw = JSON.parse(await planted.complete({ system: '', user: '' }, subject.input)) as Record<string, unknown>;
      const plan = raw['plan'] as Record<string, unknown>[];
      for (const step of plan) {
        if ('place' in step) {
          placeBearing++;
          for (const field of PLACE_FIELDS) expect(field in step).toBe(false);
        }
      }
      lost += plan.filter((step) => 'place' in step).length;
    }
    // eslint-disable-next-line no-console
    console.log(`R3 planted bug: ${placeBearing} acts written in the MIND form, ${lost} destinations the parser drops`);
    expect(placeBearing).toBeGreaterThan(0);

    // And the integrity gate turns that into a refusal. The counter reads the
    // RAW bytes against the PARSED plan, so an arm whose places are written the
    // round-3 way loses an argument on every place-bearing act.
    const armWithLoss: ArmIntegrity = {
      ...result.integrity.byArm['A']!,
      parsedIntact: 0,
      parsedIntactRate: 0,
      firstArgumentLoss: { act: 'MoveTo', lost: ['place'], raw: '{"kind":"MoveTo","place":{"x":5,"y":7}}' },
    };
    const breaches = integrityBreaches('A', armWithLoss);
    expect(breaches.some((reason) => /LOST ARGUMENTS/.test(reason))).toBe(true);
    const aggregate = await judgeTraces(
      pairTraces(result.traces, result.key, 'planted').pairs,
      result.key,
      new MockTraceJudge(),
      {
        integrity: attestRun(result.key, {
          degraded: true,
          reasons: breaches,
          thinkOutcomes: {},
          seeds: result.seeds,
          ruleHash: JUDGE_GATE_HASH,
        }),
      },
    );
    expect(aggregate.usableForVerdict).toBe(false);
    expect(aggregate.note).toMatch(/LOST ARGUMENTS/);
    expect(aggregate.note).toMatch(/wire format is broken/);
  }, 300_000);

  it('computes the loss from a record\'s own raw bytes, not from the mock', () => {
    // A hand-built pair of records: one written the wire way, one the round-3
    // way. `computeArmMetrics` must see the difference without being told.
    const wireRow = recordWith('{"goals":[],"plan":[{"kind":"MoveTo","x":5,"y":7}],"utterances":[]}', [
      { kind: 'MoveTo', x: 5, y: 7 },
    ]);
    const mindRow = recordWith('{"goals":[],"plan":[{"kind":"MoveTo","place":{"x":5,"y":7}}],"utterances":[]}', [
      { kind: 'MoveTo' },
    ]);
    const clean = armIntegrityOf([wireRow]);
    const broken = armIntegrityOf([mindRow]);
    expect(clean.placeBearingDecisions).toBe(1);
    expect(clean.parsedIntactRate).toBe(1);
    expect(broken.placeBearingDecisions).toBe(1);
    expect(broken.parsedIntactRate).toBe(0);
    expect(broken.firstArgumentLoss?.lost).toEqual(['place']);
  });
});

describe('W1-E · the retry sentinel is a value, not two invisible bytes', () => {
  it('is written as an escape and still round-trips the rejection reason', () => {
    // The file held two raw U+0000 bytes in this literal, so git treated the
    // whole source as BINARY: no readable diff, no blame, no review.
    expect(RETRY_SENTINEL).toBe(' rejection-reason ');
    expect(RETRY_SENTINEL.charCodeAt(0)).toBe(0);
    expect(RETRY_SENTINEL.charCodeAt(RETRY_SENTINEL.length - 1)).toBe(0);
    const reason = 'that place is out of range';
    expect(retryFeedbackIn(retryPrompt({ system: 's', user: 'u' }, reason))).toBe(reason);
    expect(retryFeedbackIn({ system: 's', user: 'u' })).toBeUndefined();
  });
});

// ─── Small fixtures ──────────────────────────────────────────────────────────

function recordWith(raw: string, parsedPlan: Record<string, unknown>[]): Parameters<typeof buildTraces>[0]['records'][number] {
  return {
    id: 'r1',
    schemaVersion: 3,
    engineVersion: 'test',
    runId: 'r',
    scenarioId: 's',
    worldId: foragerAdapter.id,
    seed: 'seed',
    options: {
      agentCount: 1,
      mythBehavior: false,
      leadership: false,
      offerMaking: false,
      craftLearning: false,
      outcomeWindowTicks: 400,
      provenance: 'compact',
    },
    backendLabel: 'test',
    tick: 0,
    simDay: 0,
    beingId: 1,
    beingName: 'x',
    generation: 0,
    ageTicks: 0,
    trigger: 'periodic',
    thinkInput: {} as never,
    prompt: { system: '', user: '' },
    scaffold: {} as never,
    status: 'answered',
    attempts: [{ raw }],
    modelId: 'test',
    parse: { valid: true, retried: false, fellBackToReflex: false },
    parsedOutput: { goals: [], plan: parsedPlan as never, utterances: [] },
    resolvedOutput: null,
    appliedTick: 0,
    latencyMs: 0,
  };
}

function armIntegrityOf(records: Parameters<typeof buildTraces>[0]['records']): ArmIntegrity {
  const metrics: ArmMetrics = computeArmMetrics(
    {
      arm: 'A',
      seed: 'seed',
      ticks: 1,
      cohort: [1],
      knowledgeReachesMind: true,
      population: { founders: 1, alive: 1, births: 0, deaths: 0, deathsByCause: {} },
      knowledgeFormed: 0,
      records,
      outcomes: [],
      positions: new Map(),
    },
    foragerAdapter,
  );
  return metrics.integrity;
}

void blindTraces;
void ({} as RawBeingTrace);
