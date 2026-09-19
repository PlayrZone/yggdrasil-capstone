import { describe, expect, it } from 'vitest';
import { actionVocabulary, buildThinkPrompt, foragerAdapter, foragerWorld, retryPrompt } from '../src/index.js';
import type { IMindBackend, KnowledgeRecord, MemoryRecord, ThinkInput, ThinkPrompt } from '../src/index.js';
import {
  ArmRouterBackend,
  BaselineAgentBackend,
  acceptsModelSummary,
  retryFeedbackIn,
} from '../src/eval/baseline/BaselineAgentBackend.js';
import {
  BOILERPLATE_IMPORTANCE,
  BaselineMemory,
  DEFAULT_LOG_SIZE,
  DEFAULT_RETRIEVE_K,
  FIELDS_ARM_B_NEVER_READS,
  RECENCY_HALF_LIFE_THINKS,
  situationQuery,
} from '../src/eval/baseline/memory.js';
import { buildBaselineInterviewPrompt, buildBaselinePrompt } from '../src/eval/baseline/prompt.js';
import {
  EPISTEMIC_INSTRUCTION_LINES,
  EPISTEMIC_INSTRUCTION_TEXT,
  carriesEpistemicInstruction,
} from '../src/eval/epistemic.js';
import { INTERVIEW_INSTRUCTION, QUESTION_PREFIX, isInterview, questionIn } from '../src/eval/interview.js';
import { FaithfulMockBackend } from '../src/eval/mocks.js';
import { at } from '../src/worlds/forager/space.js';

/**
 * ARM B IS A CONTROL, AND A CONTROL IS ONLY WORTH WHAT IT DOES NOT HAVE — but
 * round 1's reviewer was right that it had also lost things nobody meant to take
 * from it. So these tests hold two claims at once:
 *
 *   ABSENCE   the plain agent still carries none of Yggdrasil's epistemics, and
 *             `FIELDS_ARM_B_NEVER_READS` is walked rather than trusted.
 *   FAIRNESS  it retrieves and reflects the way the paper it is named after
 *             does, it is told who it is and where a need turns pressing, it
 *             hears the same rejection feedback arm A hears, and the epistemic
 *             instruction is a factor it can be given (B+) rather than a thing
 *             one arm happens to own.
 */

const BELIEF_TEXT = 'Berries are found near water';
const BELIEF_KEY = 'ctx:GatherSucceeded:berry:nearWater:positive';
const STORY_TEXT = 'Long ago the first ones came down from the high ridge';
const FEELING_TEXT = 'you trust them deeply';
const KIN_NAME = 'Xanthe';
const FRIEND_NAME = 'Quilla';
const SACRED = { x: 9177, y: 7331 };
const TRAGEDY = { x: 4242, y: 5353 };

/** A free, scripted transport — what `arms.ts` would have opened from a mock spec. */
const mockTransport = (): IMindBackend => new FaithfulMockBackend(foragerWorld.edges);

const TRAITS = { curiosity: 60, aggression: 10, compassion: 50, ambition: 40, loyalty: 55, riskTolerance: 30 };

/** A fully cultured being — everything arm A is given, so absence can be measured. */
function situation(): ThinkInput {
  const belief: KnowledgeRecord = {
    id: 7,
    ruleKey: BELIEF_KEY,
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
      traits: TRAITS,
      needs: { hunger: 61, rest: 20, safety: 5, socialConnection: 30 },
      health: 88,
      sick: false,
      place: at(100, 200),
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
      agents: [{ id: 9, place: at(105, 205) }],
      resources: [{ id: 11, kind: 'berryBush', place: at(110, 210), stock: 4 }],
      structures: [],
    },
    goals: [],
    trigger: 'periodic',
    stories: [{ id: 'home:1', text: STORY_TEXT, firsthand: false }],
    mostTold: STORY_TEXT,
    kin: [{ name: KIN_NAME, relation: 'parent' }],
    social: [{ name: FRIEND_NAME, feeling: FEELING_TEXT }],
    sacredPlace: at(SACRED.x, SACRED.y),
    tragedyPlaces: [at(TRAGEDY.x, TRAGEDY.y)],
  };
}

interface MomentSpec {
  tick: number;
  memories?: MemoryRecord[];
  resources?: { kind: string; id?: number }[];
  inventory?: Record<string, number>;
  hunger?: number;
  agents?: number;
}

/** A bare situation with no culture in it — for testing memory, not absence. */
function moment(spec: MomentSpec): ThinkInput {
  return {
    snapshot: {
      id: 3,
      name: 'Ilka',
      ageTicks: 5000,
      traits: TRAITS,
      needs: { hunger: spec.hunger ?? 10, rest: 10, safety: 5, socialConnection: 10 },
      health: 100,
      sick: false,
      place: at(0, 0),
      inventory: spec.inventory ?? {},
      context: {},
    },
    recalledMemories: spec.memories ?? [],
    knowledge: [],
    relationships: new Map(),
    worldView: {
      tick: spec.tick,
      night: false,
      season: 'spring',
      agents: Array.from({ length: spec.agents ?? 0 }, (_unused, i) => ({ id: 50 + i, place: at(0, 0) })),
      resources: (spec.resources ?? []).map((r, i) => ({ id: r.id ?? 200 + i, kind: r.kind, place: at(0, 0), stock: 4 })),
      structures: [],
    },
    goals: [],
    trigger: 'periodic',
  };
}

function episode(id: number, tick: number, summaryText: string, importance: number): MemoryRecord {
  return {
    id,
    tick,
    type: 'GatherSucceeded',
    subjects: [],
    context: {},
    needDeltas: {},
    outcome: 'success',
    summaryText,
    importance,
    origin: 'experience',
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

  it('is held to exactly the same verbs and the same body', () => {
    expect(mine.system).toContain(actionVocabulary(foragerAdapter));
    expect(theirs.system).toContain(actionVocabulary(foragerAdapter));
    for (const drive of foragerAdapter.drives) expect(mine.user).toContain(drive.id);
    expect(mine.user).toContain('berry×2');
    expect(mine.user).toContain('berryBush');
  });

  it('is told who it is and where a need turns pressing — what withholding only handicapped it with', () => {
    for (const personality of [`curiosity ${TRAITS.curiosity}`, `loyalty ${TRAITS.loyalty}`, `risk ${TRAITS.riskTolerance}`]) {
      expect(mine.system).toContain(personality);
      expect(theirs.system).toContain(personality);
    }
    const thresholds = `${foragerAdapter.drives[0]?.pressingAt}+ pressing, ${foragerAdapter.drives[0]?.criticalAt}+ critical`;
    expect(mine.user).toContain(thresholds);
    expect(theirs.user).toContain(thresholds);
  });

  it('shows what this moment brings back, and a summary only once it has reflected', () => {
    expect(mine.user).toContain('I see 1 berryBush');
    expect(mine.user).toContain('(nothing yet)');
    const reflected = new BaselineMemory({ summaryEvery: 1 });
    reflected.observe(input, foragerAdapter);
    reflected.summarizeLocally(input, foragerAdapter);
    const withSummary = buildBaselinePrompt(input, foragerAdapter, reflected).user;
    expect(withSummary).toContain('I see 1 berryBush, 1 other people.');
    expect(withSummary).not.toContain('(nothing yet)');
  });
});

describe('W1-E · retrieval is retrieval, not a window', () => {
  const world = foragerAdapter;

  it('returns the top-scored observations, and keeps a relevant old one over an irrelevant recent one', () => {
    const memory = new BaselineMemory();
    // Eight lived episodes about berries and water, early in the life.
    for (let i = 0; i < 8; i++) {
      const tick = 100 + i * 100;
      memory.observe(
        moment({ tick, memories: [episode(i + 1, tick, `I gathered berry ${i} from a berryBush by the water`, 0.8)] }),
        world,
      );
    }
    // Then four recent, trivial things about nothing that is happening now.
    for (let i = 0; i < 4; i++) {
      const tick = 1000 + i * 100;
      memory.observe(moment({ tick, memories: [episode(100 + i, tick, `A cloud passed overhead ${i}`, 0.05)] }), world);
    }
    const now = moment({ tick: 2000, resources: [{ kind: 'berryBush', id: 11 }], inventory: { berry: 2 }, hunger: 61 });

    const top = memory.retrieve(now, world);
    expect(top).toHaveLength(DEFAULT_RETRIEVE_K);
    // Every one of the eight is a berry memory: the four most RECENT observations
    // are all outside the retrieved set, which a rolling window cannot do.
    for (const observation of top) expect(observation.text).toContain('berry');
    expect(top.some((o) => o.text.includes('berry 0'))).toBe(true);
    expect(top.some((o) => o.text.includes('cloud'))).toBe(false);
    // Ranked, not merely selected, and pure: scoring never writes.
    const scores = top.map((o) => o.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    expect(memory.retrieve(now, world).map((o) => o.text)).toEqual(top.map((o) => o.text));
    expect(memory.observations()).toHaveLength(13);
  });

  it('weighs importance and recency together, so a grave memory outlives fifteen dull ones', () => {
    const memory = new BaselineMemory();
    memory.observe(
      moment({ tick: 10, memories: [episode(1, 10, 'I gathered berry from a berryBush by the water', 0.9)] }),
      world,
    );
    for (let i = 1; i <= 15; i++) {
      const tick = 10 + i * 50;
      memory.observe(moment({ tick, memories: [episode(100 + i, tick, `I walked across the stone ridge ${i}`, 0.3)] }), world);
    }
    const now = moment({ tick: 2000, resources: [{ kind: 'berryBush', id: 11 }], inventory: { berry: 1 }, hunger: 61 });
    const top = memory.retrieve(now, world);
    expect(top[0]?.text).toContain('berryBush');
    expect(top[0]?.importance).toBe(0.9);
    // It is genuinely old: fifteen thinks have passed since it was filed.
    expect(top[0]?.recency).toBeLessThan(0.7);
    expect(top[0]?.score).toBeGreaterThan(top[1]?.score ?? 0);
  });

  it('matches a plural to its singular and a compound kind to its parts', () => {
    const memory = new BaselineMemory();
    memory.observe(
      moment({
        tick: 10,
        memories: [
          episode(1, 10, 'I carried two stones back', 0.5),
          episode(2, 10, 'I pushed through the bushes', 0.5),
          episode(3, 10, 'I slept on the ridge', 0.5),
        ],
      }),
      world,
    );
    const relevanceFor = (query: ThinkInput): Map<string, number> =>
      new Map(memory.retrieve(query, world).map((o) => [o.text, o.relevance]));

    const carryingStone = relevanceFor(moment({ tick: 20, inventory: { stone: 1 } }));
    expect(carryingStone.get('I carried two stones back') ?? 0).toBeGreaterThan(0);
    expect(carryingStone.get('I slept on the ridge') ?? 1).toBe(0);

    const facingBush = relevanceFor(moment({ tick: 20, resources: [{ kind: 'berryBush', id: 1 }] }));
    expect(facingBush.get('I pushed through the bushes') ?? 0).toBeGreaterThan(0);
  });

  it('reflects over what mattered, not over the line it has written most often', () => {
    const memory = new BaselineMemory({ summaryEvery: 1000 });
    // Twelve thinks in front of the same bush, hungry the whole time: the two
    // templated lines are by far the most FREQUENT thing in this life.
    for (let i = 0; i < 12; i++) {
      memory.observe(moment({ tick: 100 + i * 50, resources: [{ kind: 'berryBush', id: 11 }], hunger: 70 }), world);
    }
    const lived = [
      episode(1, 700, 'My hunger eased when I ate the berry I took from the berryBush', 0.9),
      episode(2, 710, 'I was sick for two days after I ate the pale mushroom', 0.85),
      episode(3, 720, 'A wolf took Karr at the water and I could do nothing', 0.95),
      episode(4, 730, 'I gave a tuber to the one who had none', 0.8),
    ];
    const now = moment({ tick: 800, resources: [{ kind: 'berryBush', id: 11 }], hunger: 70, memories: lived });
    memory.observe(now, world);
    memory.summarizeLocally(now, world);

    const summary = memory.summary();
    for (const record of lived) expect(summary).toContain(record.summaryText);
    // The two lines it has written twelve times each are not in the summary at all.
    expect(summary).not.toContain('I see 1 berryBush');
    expect(summary).not.toContain('I feel hunger');
    // …and the frequent line is still IN the log; it simply did not win.
    expect(memory.observations().some((o) => o.text === 'I see 1 berryBush.')).toBe(true);
  });

  it('decays on the declared half-life and floors a templated line at the declared importance', () => {
    const memory = new BaselineMemory();
    memory.observe(moment({ tick: 10, memories: [episode(1, 10, 'A wolf took Karr at the water', 0.9)] }), world);
    for (let i = 1; i <= RECENCY_HALF_LIFE_THINKS; i++) memory.observe(moment({ tick: 10 + i * 10 }), world);
    const ranked = memory.retrieve(moment({ tick: 9999 }), world);
    expect(ranked.find((o) => o.text.includes('wolf'))?.recency).toBeCloseTo(0.5, 9);
    expect(ranked.find((o) => o.text === 'I see nothing of note.')?.importance).toBe(BOILERPLATE_IMPORTANCE);
  });

  it('bounds the log at the declared size, dropping the least recently observed first', () => {
    const memory = new BaselineMemory();
    const total = DEFAULT_LOG_SIZE + 20;
    for (let i = 0; i < total; i++) {
      memory.observe(moment({ tick: i * 10, memories: [episode(i + 1, i * 10, `event number ${i}`, 0.5)] }), world);
    }
    expect(memory.observations()).toHaveLength(DEFAULT_LOG_SIZE);
    const texts = memory.observations().map((o) => o.text);
    // The templated line is true again every think, so it is never the oldest.
    expect(texts).toContain('I see nothing of note.');
    expect(texts).toContain(`event number ${total - 1}`);
    expect(texts).not.toContain('event number 0');
  });

  it('files a templated line once and lets an episode age from when it surfaced', () => {
    const memory = new BaselineMemory();
    for (let i = 0; i < 5; i++) {
      memory.observe(moment({ tick: 10 + i * 10, resources: [{ kind: 'berryBush', id: 11 }] }), world);
    }
    // Five thinks, one perception line — not five copies of it.
    expect(memory.observations()).toHaveLength(1);
    expect(memory.observations()[0]?.at).toBe(5);
    expect(memory.thinkCount).toBe(5);
  });
});

describe('W1-E · the epistemic instruction is a factor, not a property of an arm', () => {
  const input = situation();
  const memory = new BaselineMemory();
  memory.observe(input, foragerAdapter);

  it('plain arm B does not carry it and arm A still does', () => {
    const plain = buildBaselinePrompt(input, foragerAdapter, memory);
    expect(plain.system).not.toContain(EPISTEMIC_INSTRUCTION_TEXT);
    for (const line of EPISTEMIC_INSTRUCTION_LINES) expect(plain.system).not.toContain(line);
    expect(carriesEpistemicInstruction(buildThinkPrompt(input, foragerAdapter))).toBe(true);
  });

  it('arm B+ carries it, in its think and in its interview', () => {
    const plus = buildBaselinePrompt(input, foragerAdapter, memory, { epistemicInstruction: true });
    expect(plus.system).toContain(EPISTEMIC_INSTRUCTION_TEXT);
    const asked = buildBaselineInterviewPrompt(input, foragerAdapter, memory, 'What is a furnace?', {
      epistemicInstruction: true,
    });
    expect(asked.system).toContain(EPISTEMIC_INSTRUCTION_TEXT);
    // Adding the sentence adds nothing else: the two prompts differ by it alone.
    const plain = buildBaselinePrompt(input, foragerAdapter, memory);
    expect(plus.system.replace(`${EPISTEMIC_INSTRUCTION_TEXT}\n`, '')).toBe(plain.system);
    expect(plus.user).toBe(plain.user);
  });

  it('names itself B+ so a run manifest cannot confuse the two arms', async () => {
    const plain = new BaselineAgentBackend({ world: foragerAdapter, transport: mockTransport() });
    const plus = new BaselineAgentBackend({ world: foragerAdapter, transport: mockTransport(), epistemicInstruction: true });
    expect(plain.modelId).not.toContain('epistemic');
    expect(plus.modelId).toContain('baseline+epistemic');
    const input = situation();
    await plain.complete(buildThinkPrompt(input, foragerAdapter), input);
    await plus.complete(buildThinkPrompt(input, foragerAdapter), input);
    expect(plain.sentPrompts()[0]?.prompt.system).not.toContain(EPISTEMIC_INSTRUCTION_TEXT);
    expect(plus.sentPrompts()[0]?.prompt.system).toContain(EPISTEMIC_INSTRUCTION_TEXT);
  });
});

describe('W1-E · a retry is the same moment, and it carries the same feedback', () => {
  it('reads the rejection reason out of the Yggdrasil prompt in that prompt’s own wording', () => {
    const input = situation();
    const base = buildThinkPrompt(input, foragerAdapter);
    expect(retryFeedbackIn(base)).toBeUndefined();
    expect(retryFeedbackIn(retryPrompt(base, 'plan[0].kind is not an action'))).toBe('plan[0].kind is not an action');
  });

  it('resends with the sentence arm A would have resent, byte for byte', async () => {
    const baseline = new BaselineAgentBackend({ world: foragerAdapter, transport: mockTransport() });
    const input = situation();
    const first = buildThinkPrompt(input, foragerAdapter);
    const reason = 'MindOutputError: utterances[0].speechAct is not a speech act';
    const second = retryPrompt(first, reason);
    await baseline.complete(first, input);
    await baseline.complete(second, input);

    const sent = baseline.sentPrompts();
    expect(sent).toHaveLength(2);
    expect(sent[0]?.prompt.user).not.toContain('previous reply was rejected');
    // Exactly the bytes arm A's user message gained, appended to arm B's own.
    const feedback = second.user.slice(first.user.length);
    expect(sent[1]?.prompt.user.endsWith(feedback)).toBe(true);
    expect(sent[1]?.prompt.user).toContain(reason);
    expect(sent[1]?.prompt.user.slice(0, -feedback.length)).toBe(sent[0]?.prompt.user);
  });

  it('does not fold the same moment into memory twice', async () => {
    const baseline = new BaselineAgentBackend({ world: foragerAdapter, transport: mockTransport() });
    const input = situation();
    const first = buildThinkPrompt(input, foragerAdapter);
    await baseline.complete(first, input);
    const after = baseline.memoryOf(input.snapshot.id)?.observations().length ?? 0;
    expect(after).toBeGreaterThan(0);

    await baseline.complete(retryPrompt(first, 'not JSON'), input);
    expect(baseline.memoryOf(input.snapshot.id)?.observations()).toHaveLength(after);
    // The retrieval clock did not advance either — a rejection is not a life event.
    expect(baseline.memoryOf(input.snapshot.id)?.thinkCount).toBe(1);
    expect(baseline.sentPrompts()).toHaveLength(2);
  });

  it('never lets a junk summary become what the agent believes it has been through', () => {
    expect(acceptsModelSummary('I have been gathering berries and keeping away from the water.')).toBe(true);
    expect(acceptsModelSummary('   ')).toBe(false);
    expect(acceptsModelSummary('x'.repeat(600))).toBe(false);
  });
});

describe('W1-E · the control is still a control', () => {
  it('lets nothing from a field it must never read reach any prompt it composes', () => {
    const input = situation();
    const memory = new BaselineMemory();
    memory.observe(input, foragerAdapter);
    const composed: ThinkPrompt[] = [
      buildBaselinePrompt(input, foragerAdapter, memory),
      buildBaselinePrompt(input, foragerAdapter, memory, { epistemicInstruction: true }),
      buildBaselineInterviewPrompt(input, foragerAdapter, memory, 'What do the old stories say?'),
    ];
    // One witness per forbidden field, and the list itself is the checklist: add
    // a field to `FIELDS_ARM_B_NEVER_READS` and this test demands a witness for it.
    const witnesses: Record<string, string[]> = {
      knowledge: [BELIEF_TEXT, BELIEF_KEY],
      stories: [STORY_TEXT],
      mostTold: [STORY_TEXT],
      social: [FRIEND_NAME, FEELING_TEXT],
      kin: [KIN_NAME],
      sacredPlace: [String(SACRED.x), String(SACRED.y)],
      tragedyPlaces: [String(TRAGEDY.x), String(TRAGEDY.y)],
    };
    expect(Object.keys(witnesses).sort()).toEqual([...FIELDS_ARM_B_NEVER_READS].sort());
    // The retrieval query is built from the same four fields, so it is checked too.
    const surfaces = [...composed.map((p) => `${p.system}\n${p.user}`), situationQuery(input, foragerAdapter)];
    for (const surface of surfaces) {
      for (const [field, needles] of Object.entries(witnesses)) {
        for (const needle of needles) expect(surface, `${field} leaked "${needle}"`).not.toContain(needle);
      }
    }
    // Arm A's prompt carries every one of them, which is what makes it a control.
    const yggdrasil = buildThinkPrompt(input, foragerAdapter);
    const armA = `${yggdrasil.system}\n${yggdrasil.user}`;
    for (const needle of [BELIEF_TEXT, STORY_TEXT, FEELING_TEXT, KIN_NAME, FRIEND_NAME]) {
      expect(armA).toContain(needle);
    }
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
  it('keeps one memory per being, so two beings never share a log', async () => {
    const baseline = new BaselineAgentBackend({ world: foragerAdapter, transport: mockTransport() });
    const one = situation();
    const two = situation();
    two.snapshot = { ...two.snapshot, id: 4, name: 'Karr', inventory: { tuber: 5 } };
    await baseline.complete(buildThinkPrompt(one, foragerAdapter), one);
    await baseline.complete(buildThinkPrompt(two, foragerAdapter), two);

    const sent = baseline.sentPrompts();
    expect(sent.map((s) => s.beingId)).toEqual([3, 4]);
    expect(sent[0]?.prompt.user).toContain('berry×2');
    expect(sent[0]?.prompt.user).not.toContain('tuber×5');
    expect(sent[1]?.prompt.user).toContain('tuber×5');
    expect(sent[1]?.prompt.user).not.toContain('berry×2');
    expect(baseline.memoryOf(3)).not.toBe(baseline.memoryOf(4));
  });

  it('routes a mixed cohort on the being asking, with no runner change', async () => {
    const calls: string[] = [];
    const armA: IMindBackend = {
      modelId: 'mock/a',
      complete: (_p, i) => {
        calls.push(`A:${i.snapshot.id}`);
        return Promise.resolve('{"goals":[],"plan":[],"utterances":[]}');
      },
    };
    const armB: IMindBackend = {
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
    const mock = new FaithfulMockBackend(foragerWorld.edges);
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
