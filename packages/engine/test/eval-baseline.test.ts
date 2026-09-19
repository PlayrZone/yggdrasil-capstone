import { describe, expect, it } from 'vitest';
import {
  ArmRouterBackend,
  BaselineAgentBackend,
  BaselineMemory,
  FaithfulMockBackend,
  INTERVIEW_INSTRUCTION,
  QUESTION_PREFIX,
  actionVocabulary,
  buildBaselineInterviewPrompt,
  buildBaselinePrompt,
  buildThinkPrompt,
  foragerAdapter,
  isInterview,
  questionIn,
} from '../src/index.js';
import type { IMindBackend, KnowledgeRecord, ThinkInput, ThinkPrompt } from '../src/index.js';

/**
 * ARM B IS A CONTROL, and a control is only worth what it does NOT have. These
 * tests are about absence: the plain agent must live in the same body, speak the
 * same verbs and be asked the same questions, while holding none of the
 * epistemics that are the independent variable.
 */

const BELIEF_TEXT = 'Berries are found near water';
const STORY_TEXT = 'Long ago the first ones came down from the high ridge';
const FEELING_TEXT = 'you trust them deeply';

function situation(): ThinkInput {
  const belief: KnowledgeRecord = {
    id: 7,
    ruleKey: 'ctx:GatherSucceeded:berry:nearWater:positive',
    rule: { kind: 'context-association', event: 'GatherSucceeded', objectKind: 'berry', feature: 'nearWater', direction: 'positive' },
    statement: BELIEF_TEXT,
    confidence: 0.9,
    evidenceCount: 12,
    contradictionCount: 0,
    sourceMemoryIds: [],
    status: 'held',
    origin: 'experience',
    firstFormed: 0,
    lastReinforced: 100,
  };
  return {
    snapshot: {
      id: 3,
      name: 'Ilka',
      ageTicks: 5000,
      traits: { curiosity: 60, aggression: 10, compassion: 50, ambition: 40, loyalty: 55, riskTolerance: 30 },
      needs: { hunger: 61, rest: 20, safety: 5, socialConnection: 30 },
      health: 88,
      sick: false,
      x: 100,
      y: 200,
      inventory: { berry: 2 },
      context: { nearWater: true, night: false, inShelter: false, elevationBand: 0 },
    },
    recalledMemories: [],
    knowledge: [belief],
    relationships: new Map(),
    worldView: {
      tick: 900,
      night: false,
      season: 'spring',
      agents: [{ id: 9, x: 105, y: 205 }],
      resources: [{ id: 11, kind: 'berryBush', x: 110, y: 210, stock: 4 }],
      structures: [],
    },
    goals: [],
    trigger: 'periodic',
    stories: [{ id: 'home:1', text: STORY_TEXT, firsthand: false }],
    mostTold: STORY_TEXT,
    kin: [{ name: 'Berrun', relation: 'parent' }],
    social: [{ name: 'Sallo', feeling: FEELING_TEXT }],
    sacredPlace: { x: 900, y: 900 },
  };
}

describe('W1-E · the baseline agent has the body but not the epistemics', () => {
  const input = situation();
  const memory = new BaselineMemory();
  memory.observe(input, foragerAdapter);
  const mine = buildBaselinePrompt(input, foragerAdapter, memory);
  const theirs = buildThinkPrompt(input, foragerAdapter);

  it('carries none of the mined knowledge, stories or relationship feelings the Yggdrasil prompt carries', () => {
    const whole = `${mine.system}\n${mine.user}`;
    for (const carried of [BELIEF_TEXT, STORY_TEXT, FEELING_TEXT, 'WHAT YOU KNOW', 'STORIES YOU CARRY', 'THOSE YOU KNOW']) {
      expect(whole).not.toContain(carried);
    }
    // …and the control is only meaningful because arm A's prompt does carry them.
    const yggdrasil = `${theirs.system}\n${theirs.user}`;
    for (const carried of [BELIEF_TEXT, STORY_TEXT, FEELING_TEXT]) expect(yggdrasil).toContain(carried);
  });

  it('does not inherit the epistemic instruction — that instruction is what it is a control for', () => {
    expect(theirs.system).toContain('You have no knowledge of the world beyond this');
    expect(mine.system).not.toContain('You have no knowledge of the world beyond this');
  });

  it('is held to exactly the same verbs and the same body', () => {
    expect(mine.system).toContain(actionVocabulary(foragerAdapter));
    expect(theirs.system).toContain(actionVocabulary(foragerAdapter));
    for (const drive of foragerAdapter.drives) expect(mine.user).toContain(drive.id);
    expect(mine.user).toContain('berry×2');
    expect(mine.user).toContain('berryBush');
  });

  it('shows raw observations, and a summary only once it has reflected', () => {
    expect(mine.user).toContain('I see 1 berryBush');
    expect(mine.user).toContain('(nothing yet)');
    const rolling = new BaselineMemory({ summaryEvery: 1 });
    rolling.observe(input, foragerAdapter);
    rolling.summarizeLocally();
    expect(buildBaselinePrompt(input, foragerAdapter, rolling).user).toContain('I see 1 berryBush, 1 other people. (1×)');
  });
});

describe('W1-E · both arms are interviewed in the same words', () => {
  const input = situation();

  it('shares the instruction and the question frame', () => {
    const memory = new BaselineMemory();
    memory.observe(input, foragerAdapter);
    const b = buildBaselineInterviewPrompt(input, foragerAdapter, memory, 'What is a furnace?');
    expect(isInterview(b)).toBe(true);
    expect(b.user).toContain(`${QUESTION_PREFIX}"What is a furnace?"`);
    expect(questionIn(b)).toBe('What is a furnace?');
    expect(b.system).toContain(INTERVIEW_INSTRUCTION);
    // A think prompt is never mistaken for an interview.
    expect(isInterview(buildBaselinePrompt(input, foragerAdapter, memory))).toBe(false);
    expect(isInterview(buildThinkPrompt(input, foragerAdapter))).toBe(false);
  });

  it('drops the decision instruction so the being answers instead of planning', () => {
    const memory = new BaselineMemory();
    memory.observe(input, foragerAdapter);
    const b = buildBaselineInterviewPrompt(input, foragerAdapter, memory, 'Where is the sea?');
    expect(b.user).not.toContain('Respond with JSON only');
  });
});

describe('W1-E · per-being state and arm routing', () => {
  it('keeps one memory per being, so two beings never share a window', async () => {
    const seen: ThinkPrompt[] = [];
    const transport: IMindBackend & { free: true } = {
      free: true,
      modelId: 'mock/echo',
      complete: (prompt: ThinkPrompt) => {
        seen.push(prompt);
        return Promise.resolve('{"goals":[],"plan":[],"utterances":[]}');
      },
    };
    const baseline = new BaselineAgentBackend({ world: foragerAdapter, transport: { backend: transport } });
    const one = situation();
    const two = situation();
    two.snapshot = { ...two.snapshot, id: 4, name: 'Karr', inventory: { tuber: 5 } };
    await baseline.complete({ system: '', user: '' }, one);
    await baseline.complete({ system: '', user: '' }, two);
    expect(seen[0]?.user).toContain('berry×2');
    expect(seen[0]?.user).not.toContain('tuber×5');
    expect(seen[1]?.user).toContain('tuber×5');
    expect(seen[1]?.user).not.toContain('berry×2');
    expect(baseline.sentPrompts().map((s) => s.beingId)).toEqual([3, 4]);
  });

  it('routes a mixed cohort on the being asking, with no runner change', async () => {
    const calls: string[] = [];
    const armA: IMindBackend & { free: true } = {
      free: true,
      modelId: 'mock/a',
      complete: (_p, i) => {
        calls.push(`A:${i.snapshot.id}`);
        return Promise.resolve('{"goals":[],"plan":[],"utterances":[]}');
      },
    };
    const armB: IMindBackend & { free: true } = {
      free: true,
      modelId: 'mock/b',
      complete: (_p, i) => {
        calls.push(`B:${i.snapshot.id}`);
        return Promise.resolve('{"goals":[],"plan":[],"utterances":[]}');
      },
    };
    const router = new ArmRouterBackend((id) => (id % 2 === 0 ? 'A' : 'B'), armA, armB);
    const even = situation();
    even.snapshot = { ...even.snapshot, id: 4 };
    await router.complete({ system: '', user: '' }, even);
    await router.complete({ system: '', user: '' }, situation());
    expect(calls).toEqual(['A:4', 'B:3']);
    expect(router.modelId).toBe('mixed(A=mock/a|B=mock/b)');
  });

  it('a mock mind answers a think with JSON and an interview with words', async () => {
    const mock = new FaithfulMockBackend(foragerAdapter);
    const input = situation();
    const think = await mock.complete(buildThinkPrompt(input, foragerAdapter), input);
    expect(() => JSON.parse(think)).not.toThrow();
    const memory = new BaselineMemory();
    memory.observe(input, foragerAdapter);
    const asked = await mock.complete(buildBaselineInterviewPrompt(input, foragerAdapter, memory, 'What are you carrying?'), input);
    expect(asked).toContain('berry');
    expect(() => JSON.parse(asked)).toThrow();
  });
});
