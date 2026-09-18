import { describe, expect, it } from 'vitest';
import {
  COGNITION_SCHEMA_VERSION,
  ENGINE_VERSION,
  FORAGER_CONTINENT,
  MockMindBackend,
  curateCorpus,
  cognitionToExample,
  evalJsonValidity,
  evalKnowledgeFidelity,
  retryPrompt,
  summarizeCorpus,
} from '../src/index.js';
import type {
  CognitionOutcome,
  CognitionRecordV2,
  IMindBackend,
  Intent,
  ScaffoldState,
  ThinkInput,
} from '../src/index.js';
import { CTX } from './helpers.js';

const SCAFFOLD: ScaffoldState = {
  needsProvisionedWithinTicks: null,
  itemsGrantedWithinTicks: null,
  relocatedWithinTicks: null,
  seededMyths: [],
  authoredEvents: [],
  seededRecipes: [],
  ideasGiven: 0,
  madeConsciousAtTick: 0,
  mythBehavior: true,
  leadership: true,
  offerMaking: true,
  craftLearning: false,
};

let nextRow = 0;

function rec(overrides: Partial<CognitionRecordV2> = {}, plan: Intent[] = [{ kind: 'Eat', objectKind: 'berry' }]): CognitionRecordV2 {
  const raw = JSON.stringify({ goals: [], plan, utterances: [] });
  return {
    id: `run-a:${nextRow++}:1`,
    schemaVersion: COGNITION_SCHEMA_VERSION,
    engineVersion: ENGINE_VERSION,
    runId: 'run-a',
    scenarioId: 'exp-1',
    worldId: FORAGER_CONTINENT,
    seed: 'seed-a',
    options: { agentCount: 10, mythBehavior: true, leadership: true, offerMaking: true, craftLearning: false, outcomeWindowTicks: 400 },
    tick: 1,
    simDay: 1,
    beingId: 1,
    beingName: 'Kara',
    generation: 1,
    ageTicks: 100,
    trigger: 'periodic',
    thinkInput: {
      snapshot: {
        id: 1,
        name: 'Kara',
        ageTicks: 100,
        traits: { curiosity: 50, aggression: 0, compassion: 50, ambition: 50, loyalty: 50, riskTolerance: 50 },
        needs: { hunger: 50, rest: 10, safety: 10, socialConnection: 10 },
        health: 100,
        sick: false,
        x: 0,
        y: 0,
        inventory: {},
        context: CTX,
      },
      recalledMemories: [],
      knowledge: [],
      relationships: [],
      worldView: { tick: 1, night: false, season: 'spring', agents: [], resources: [], structures: [] },
      goals: [],
      trigger: 'periodic',
    },
    prompt: { system: 'sys', user: 'usr' },
    status: 'answered',
    attempts: [{ prompt: { system: 'sys', user: 'usr' }, raw }],
    modelId: 'mock/reflex-policy',
    backendLabel: 'mock/reflex-policy',
    parse: { valid: true, retried: false, fellBackToReflex: false },
    parsedOutput: { goals: [], plan, utterances: [] },
    resolvedOutput: { goals: [], plan, utterances: [] },
    appliedTick: 2,
    latencyMs: 5,
    scaffold: { ...SCAFFOLD },
    ...overrides,
  };
}

describe('corpus curation', () => {
  it('keeps valid calls, drops invalid/fallback/empty', () => {
    const records = [
      rec(),
      rec({ parse: { valid: false, retried: true, fellBackToReflex: true, error: 'not valid JSON' } }),
      rec({ attempts: [{ prompt: { system: 'sys', user: 'usr' }, raw: '' }] }),
    ];
    const result = curateCorpus(records, { dedupe: false });
    expect(result.kept).toBe(1);
    expect(result.droppedInvalid).toBe(2);
    const example = cognitionToExample(records[0]!)!;
    expect(example.messages).toHaveLength(3);
    // The example is paired with the exact text that produced it — the thing the
    // old corpus could not do at all, because it stored neither side.
    expect(example.messages[0]).toEqual({ role: 'system', content: 'sys' });
    expect(example.messages[2]!.content).toBe(records[0]!.attempts[0]!.raw);
    expect(cognitionToExample(records[1]!)).toBeNull();
  });

  it('pairs a retried completion with the prompt THAT attempt was sent', () => {
    const first = { system: 'sys', user: 'usr' };
    const second = retryPrompt(first, 'not valid JSON');
    const retried = rec({
      prompt: first,
      attempts: [
        { prompt: first, raw: 'the model rambled', error: 'not valid JSON' },
        { prompt: second, raw: '{"plan":[{"kind":"Sleep"}]}' },
      ],
      parse: { valid: true, retried: true, fellBackToReflex: false },
    });
    const messages = cognitionToExample(retried)!.messages;
    expect(messages[2]!.content).toBe('{"plan":[{"kind":"Sleep"}]}');
    // The retry prompt, not the first attempt's — the pair must be one that existed.
    expect(messages[1]!.content).toBe(second.user);
    expect(messages[1]!.content).not.toBe(first.user);
  });

  it('dedupes by trigger + plan shape and caps per trigger', () => {
    const same = [rec(), rec(), rec()]; // identical plan shape
    expect(curateCorpus(same, { dedupe: true }).kept).toBe(1);
    expect(curateCorpus(same, { dedupe: true }).droppedDuplicate).toBe(2);

    const varied = [
      rec({}, [{ kind: 'Eat', objectKind: 'berry' }]),
      rec({}, [{ kind: 'Sleep' }]),
      rec({}, [{ kind: 'MoveTo', x: 1, y: 2 }]),
    ];
    const capped = curateCorpus(varied, { dedupe: true, maxPerTrigger: 2 });
    expect(capped.kept).toBe(2);
    expect(capped.droppedOverCap).toBe(1);
  });

  it('emits valid JSONL (one example per line)', () => {
    const result = curateCorpus([rec(), rec({}, [{ kind: 'Sleep' }])], { dedupe: true });
    const lines = result.jsonl.split('\n');
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
  });
});

function outcomeFor(rowId: string, ok: boolean): CognitionOutcome {
  return {
    cognitionId: rowId,
    schemaVersion: COGNITION_SCHEMA_VERSION,
    runId: 'run-a',
    beingId: 1,
    openedTick: 1,
    closedTick: 4,
    closedReason: 'planCompleted',
    interventionsDuringThink: [],
    interrupted: false,
    intents: [{ index: 0, kind: 'Eat', objectKind: 'berry', reached: true, executed: ok, rejected: !ok, yielded: [] }],
    utterances: [],
    needDeltas: { hunger: ok ? -55 : 0 },
    healthDelta: 0,
    knowledgeFormed: [],
    knowledgeChanged: [],
    aliveAtEnd: true,
    goalsEmitted: 0,
    goalsHeldAtNextThink: null,
  };
}

describe('dataset card', () => {
  it('measures scaffolding, shape concentration, duplicates and outcome coverage', () => {
    const eat = rec({ id: 'run-a:1:1' });
    const eatAgain = rec({ id: 'run-a:2:1' }); // byte-identical training pair
    const sleep = rec({ id: 'run-a:3:2', beingId: 2, prompt: { system: 'sys', user: 'other' } }, [{ kind: 'Sleep', durationTicks: 200 }]);
    const provisioned = rec(
      {
        id: 'run-b:4:9',
        runId: 'run-b',
        seed: 'seed-b',
        scenarioId: 'exp-2',
        beingId: 9,
        trigger: 'planFailed',
        prompt: { system: 'sys', user: 'third' },
        scaffold: { ...SCAFFOLD, needsProvisionedWithinTicks: 3, seededMyths: ['seed:myth'] },
      },
      [{ kind: 'MoveTo', x: 1, y: 2 }, { kind: 'Gather', targetId: 4 }],
    );
    const fellBack = rec({
      id: 'run-a:5:1',
      prompt: { system: 'sys', user: 'fourth' },
      parse: { valid: false, retried: true, fellBackToReflex: true, error: 'not valid JSON' },
    });

    const card = summarizeCorpus(
      [eat, eatAgain, sleep, provisioned, fellBack],
      [outcomeFor('run-a:1:1', true), outcomeFor('run-a:3:2', false), outcomeFor('missing-row', true)],
    );

    expect(card.total).toBe(5);
    expect(card.schemaVersions).toEqual([COGNITION_SCHEMA_VERSION]);
    expect(card.byTrigger).toEqual([
      { key: 'periodic', count: 4, share: 0.8 },
      { key: 'planFailed', count: 1, share: 0.2 },
    ]);
    expect(card.scaffold.needsProvisioned).toBe(1);
    expect(card.scaffold.seededMyth).toBe(1);
    expect(card.scaffold.unscaffolded).toBe(4);
    expect(card.validity).toEqual({ valid: 4, invalid: 1, retried: 1, fellBackToReflex: 1, unanswered: 0 });
    expect(card.distinct).toMatchObject({ beings: 3, runs: 2, seeds: 2, worlds: 1, scenarios: 2, models: 1 });
    expect(card.planShapes[0]).toEqual({ key: 'Eat', count: 3, share: 0.6 });
    expect(card.topFivePlanShapeShare).toBe(1);
    expect(card.intentKinds.find((s) => s.key === 'Gather')!.count).toBe(1);
    // Two rows share a (system, user, completion) triple: one of them is a copy.
    expect(card.exactDuplicateRate).toBe(0.2);
    // Two of five rows have an outcome; the third outcome points at no row.
    expect(card.outcomeLinkedRate).toBe(0.4);
    expect(card.planShapeSuccess).toEqual([
      { shape: 'Eat', n: 1, successRate: 1 },
      { shape: 'Sleep', n: 1, successRate: 0 },
    ]);
  });

  it('is empty-safe and deterministic', () => {
    const empty = summarizeCorpus([], []);
    expect(empty.total).toBe(0);
    expect(empty.exactDuplicateRate).toBe(0);
    expect(empty.outcomeLinkedRate).toBe(0);
    const rows = [rec({ id: 'x:1:1' }), rec({ id: 'x:2:1' }, [{ kind: 'Sleep' }])];
    expect(summarizeCorpus(rows, [])).toEqual(summarizeCorpus(rows, []));
  });
});

// A backend that ALWAYS plants a seed — simulates a model leaking pretrained
// "agriculture exists" knowledge the agent never learned.
class LeakyBackend implements IMindBackend {
  readonly modelId = 'mock/leaky';
  complete(): Promise<string> {
    return Promise.resolve('{"plan":[{"kind":"Deposit","objectKind":"seed"}],"goals":[],"utterances":[]}');
  }
}

function probeInput(): ThinkInput {
  return {
    snapshot: {
      id: 1,
      name: 'K',
      ageTicks: 1,
      traits: { curiosity: 50, aggression: 0, compassion: 50, ambition: 50, loyalty: 50, riskTolerance: 50 },
      needs: { hunger: 80, rest: 10, safety: 10, socialConnection: 10 },
      health: 90,
      sick: false,
      x: 0,
      y: 0,
      inventory: { seed: 1 },
      context: CTX,
    },
    recalledMemories: [],
    knowledge: [], // crucially: NO seed→plant knowledge
    relationships: new Map(),
    worldView: { tick: 1, night: false, season: 'spring', agents: [], resources: [], structures: [] },
    goals: [],
    trigger: 'periodic',
  };
}

describe('eval gates', () => {
  it('JSON validity: mock backend is 100% valid', async () => {
    const r = await evalJsonValidity(new MockMindBackend(), [probeInput(), probeInput()]);
    expect(r.rate).toBe(1);
  });

  it('knowledge fidelity: faithful reflex policy never plants without knowledge', async () => {
    const r = await evalKnowledgeFidelity(new MockMindBackend(), [{ name: 'hungry-with-seed', input: probeInput() }]);
    expect(r.passed).toBe(true);
    expect(r.violations).toHaveLength(0);
  });

  it('knowledge fidelity: catches a model that leaks pretrained agriculture', async () => {
    const r = await evalKnowledgeFidelity(new LeakyBackend(), [{ name: 'hungry-with-seed', input: probeInput() }]);
    expect(r.passed).toBe(false);
    expect(r.violations[0]!.reason).toContain('pretrained-knowledge leak');
  });
});
