import { describe, expect, it } from 'vitest';
import { AgentMind, LlmMind, MockMindBackend, ReflexMind, at, buildThinkPrompt, foragerAdapter, narrativeRefOf } from '../src/index.js';
import type { IMind, KnowledgeRule, MindOutput, ThinkInput, Utterance } from '../src/index.js';
import { CTX, mem, resetIds } from './helpers.js';

/**
 * The speech path of a conscious being: what a mind SAYS is its own choice,
 * but what is actually transmitted comes from the speaker's stores. These
 * tests fail if the payload is dropped on the way out (the schema stops
 * carrying the references, or AgentMind stops resolving them) and equally if
 * something a model invented ever reaches a listener.
 */

const SPEAKER = 1;
const LISTENER = 2;

const BERRY_NEAR_WATER: KnowledgeRule = {
  kind: 'context-association',
  event: 'GatherSucceeded',
  objectKind: 'berry',
  feature: 'nearWater',
  direction: 'positive',
};
const FABRICATED: KnowledgeRule = {
  kind: 'succession',
  causeType: 'DrankWater',
  effectType: 'KilledPredator',
};
const STORY_ID = 'slew:9:1';
const STORY_TEXT = 'Nine slew a bear in the forest';
/** What the mind is shown and may name — never the id itself. */
const STORY_REF = narrativeRefOf(STORY_ID);
const SEEDED_ID = 'seed:myth';
const SEEDED_TEXT = 'The makers were here before us';

/** A mind that says exactly what the test wants said — the seam MockMindBackend
 *  exposes for a "model" whose words are fixed. */
class ScriptedMind implements IMind {
  constructor(private readonly utterances: Utterance[]) {}
  think(): MindOutput {
    return { goals: [], plan: [], utterances: this.utterances };
  }
}

/** A speaker who genuinely holds one belief and carries one story. */
function speakerMind(mind?: IMind): AgentMind {
  const agent = new AgentMind(SPEAKER, foragerAdapter, mind ? { mind } : {});
  agent.knowledge.applyEvidence(
    { rule: BERRY_NEAR_WATER, confidence: 0.8, evidenceCount: 6, contradictionCount: 0, sourceMemoryIds: [] },
    10,
  );
  agent.narratives.remember(STORY_ID, STORY_TEXT, at(12, 34), 5, true);
  agent.narratives.seed(SEEDED_ID, SEEDED_TEXT, at(0, 0), 1, 6);
  return agent;
}

function thinkInput(agent: AgentMind): ThinkInput {
  return {
    snapshot: {
      id: SPEAKER,
      name: 'Kara',
      ageTicks: 900,
      traits: { curiosity: 50, aggression: 10, compassion: 80, ambition: 40, loyalty: 60, riskTolerance: 30 },
      needs: { hunger: 10, rest: 10, safety: 5, socialConnection: 80 },
      health: 90,
      sick: false,
      place: at(0, 0),
      inventory: {},
      context: CTX,
    },
    recalledMemories: [],
    knowledge: agent.knowledge.held(),
    relationships: new Map(),
    worldView: { tick: 500, night: false, season: 'spring', agents: [{ id: LISTENER, place: at(2, 0) }], resources: [], structures: [] },
    goals: [],
    trigger: 'periodic',
    stories: agent.narratives.all().map((n) => ({ id: n.id, text: n.text, firsthand: n.firsthand })),
  };
}

/** Hearing an utterance, exactly as the body delivers it to a witness. */
function hear(listener: AgentMind, utterance: Utterance): void {
  listener.observe(mem(60, 'UtteranceSpoken', { subjects: [SPEAKER], toldBy: SPEAKER, utterance }));
}

async function speakThroughLlm(agent: AgentMind, utterances: Utterance[]): Promise<Utterance[]> {
  const llm = new LlmMind(new MockMindBackend({ world: foragerAdapter, policy: new ScriptedMind(utterances) }), { world: foragerAdapter });
  const output = await llm.complete(thinkInput(agent));
  return agent.applyOutput(output).utterances;
}

describe('LLM speech resolution', () => {
  it('teaches and retells through the whole mock-LLM path', async () => {
    resetIds();
    const speaker = speakerMind();
    const listener = new AgentMind(LISTENER, foragerAdapter);
    const spoken = await speakThroughLlm(speaker, [
      { targetId: LISTENER, speechAct: 'share-knowledge', ruleRef: 1, text: 'Berries grow by the water.' },
      { targetId: LISTENER, speechAct: 'share-episode', narrativeRef: STORY_REF, text: 'Let me tell you of Nine.' },
    ]);
    for (const u of spoken) hear(listener, u);

    const taught = listener.knowledge.all();
    expect(taught).toHaveLength(1); // ≥1 testimony intake from an LLM utterance
    expect(taught[0]!.rule).toEqual(BERRY_NEAR_WATER);
    // Taught, not shared: two beings must never hold one rule object.
    expect(taught[0]!.rule).not.toBe(speaker.knowledge.held()[0]!.rule);
    expect(spoken[0]!.rule).not.toBe(speaker.knowledge.held()[0]!.rule);
    expect(taught[0]!.origin).toBe('testimony');
    expect(listener.narratives.has(STORY_ID)).toBe(true); // ≥1 narrative intake
    expect(listener.narratives.get(STORY_ID)!.text).toBe(STORY_TEXT);
    // A tale heard today may be generations old: it keeps the teller's age.
    expect(listener.narratives.get(STORY_ID)!.firstTick).toBe(speaker.narratives.get(STORY_ID)!.firstTick);
    // The model's own words survive as speech; they are never the payload.
    expect(spoken[0]!.text).toBe('Berries grow by the water.');
  });

  it('gives every listener of one utterance its own copy of the rule', async () => {
    resetIds();
    const speaker = speakerMind();
    speaker.knowledge.applyEvidence(
      {
        rule: { kind: 'craft-recipe', output: 'spear', inputs: { wood: 1, stone: 1 } },
        confidence: 0.9,
        evidenceCount: 6,
        contradictionCount: 0,
        sourceMemoryIds: [],
      },
      10,
    );
    const recipe = speaker.knowledge.held().find((k) => k.rule.kind === 'craft-recipe')!;
    const [first, second] = [new AgentMind(LISTENER, foragerAdapter), new AgentMind(3, foragerAdapter)];
    const spoken = await speakThroughLlm(speaker, [
      { speechAct: 'share-knowledge', ruleRef: recipe.id, text: 'A point on a shaft.' },
    ]);
    // One utterance, overheard by two — the body delivers the same object to both.
    hear(first, spoken[0]!);
    hear(second, spoken[0]!);

    const a = first.knowledge.all()[0]!.rule;
    const b = second.knowledge.all()[0]!.rule;
    expect(a).toEqual(b);
    expect(a).not.toBe(b); // no two stores ever share a rule object
    expect(a).not.toBe(recipe.rule);
    expect(b).not.toBe(recipe.rule);
    // …nested payloads included, or one being could edit another's belief.
    if (a.kind === 'craft-recipe' && recipe.rule.kind === 'craft-recipe') {
      expect(a.inputs).not.toBe(recipe.rule.inputs);
      a.inputs.wood = 99;
    }
    expect(recipe.rule).toEqual({ kind: 'craft-recipe', output: 'spear', inputs: { wood: 1, stone: 1 } });
    expect(b).toEqual({ kind: 'craft-recipe', output: 'spear', inputs: { wood: 1, stone: 1 } });
  });

  it("transmits the speaker's real confidence, never a claimed one", async () => {
    resetIds();
    const speaker = speakerMind();
    const spoken = await speakThroughLlm(speaker, [
      { targetId: LISTENER, speechAct: 'share-knowledge', ruleRef: 1, ruleConfidence: 0.99 },
    ]);
    expect(spoken[0]!.ruleConfidence).toBe(speaker.knowledge.held()[0]!.confidence);
    expect(spoken[0]!.ruleConfidence).not.toBe(0.99);
  });

  it('never transmits a rule or a story the model invented', async () => {
    resetIds();
    const speaker = speakerMind();
    const listener = new AgentMind(LISTENER, foragerAdapter);
    const spoken = await speakThroughLlm(speaker, [
      { targetId: LISTENER, speechAct: 'share-knowledge', rule: FABRICATED, ruleConfidence: 1, text: 'Water kills bears.' },
      { targetId: LISTENER, speechAct: 'share-episode', narrativeId: 'invented:tale', narrativeText: 'I once flew.' },
    ]);
    for (const u of spoken) hear(listener, u);

    expect(spoken[0]!.rule).toBeUndefined();
    expect(spoken[0]!.text).toBe('Water kills bears.'); // still plain speech
    expect(spoken[1]!.narrativeId).toBeUndefined();
    expect(listener.knowledge.all()).toHaveLength(0);
    expect(listener.narratives.size).toBe(0);
  });

  it('leaves plain speech when a reference points at nothing held', async () => {
    resetIds();
    const speaker = speakerMind();
    const spoken = await speakThroughLlm(speaker, [
      { targetId: LISTENER, speechAct: 'share-knowledge', ruleRef: 999, text: 'I know a thing.' },
      { targetId: LISTENER, speechAct: 'share-episode', narrativeRef: 'fell:4:2', text: 'A tale.' },
    ]);
    expect(spoken).toHaveLength(2);
    expect(spoken[0]!.rule).toBeUndefined();
    expect(spoken[0]!.text).toBe('I know a thing.');
    expect(spoken[1]!.narrativeText).toBeUndefined();
  });

  it('shows the references it asks for in the prompt', () => {
    const speaker = speakerMind();
    const prompt = buildThinkPrompt(thinkInput(speaker), foragerAdapter);
    expect(prompt.user).toContain('[1]'); // the knowledge id a ruleRef names
    expect(prompt.user).toContain(`(ref ${STORY_REF})`);
    expect(prompt.system).toContain('"ruleRef"');
    expect(prompt.system).toContain('"narrativeRef"');
  });

  it('never shows a mind a narrative id — no analysis label, no "seeded" tell', () => {
    const speaker = speakerMind();
    const prompt = buildThinkPrompt(thinkInput(speaker), foragerAdapter);
    const whole = `${prompt.system}\n${prompt.user}`;
    expect(whole).not.toContain('seed:'); // a seeded myth must not read as seeded
    for (const n of speaker.narratives.all()) {
      expect(whole).not.toContain(n.id); // ids are engine bookkeeping
      expect(whole).toContain(`(ref ${narrativeRefOf(n.id)})`);
    }
    expect(whole).toContain(SEEDED_TEXT); // the tale itself is still carried
  });

  it('refuses a raw narrative id as a reference — only the opaque handle resolves', async () => {
    resetIds();
    const speaker = speakerMind();
    const listener = new AgentMind(LISTENER, foragerAdapter);
    // A model that guessed (or was somehow told) the engine's own id gets nothing.
    const spoken = await speakThroughLlm(speaker, [
      { targetId: LISTENER, speechAct: 'share-episode', narrativeRef: STORY_ID, text: 'A tale of Nine.' },
    ]);
    expect(spoken[0]!.narrativeId).toBeUndefined();
    expect(spoken[0]!.narrativeText).toBeUndefined();
    hear(listener, spoken[0]!);
    expect(listener.narratives.size).toBe(0);
  });
});

describe('speech from minds that attach their own rules', () => {
  it('still teaches on the reflex path — its rules come from the same store', () => {
    resetIds();
    const speaker = speakerMind(new ReflexMind(foragerAdapter));
    const listener = new AgentMind(LISTENER, foragerAdapter);
    const input = thinkInput(speaker);
    const out = speaker.think(input.snapshot, input.worldView, 'periodic');
    const shared = out.utterances.find((u) => u.speechAct === 'share-knowledge');
    expect(shared?.rule).toEqual(BERRY_NEAR_WATER);
    expect(shared!.ruleConfidence).toBe(speaker.knowledge.held()[0]!.confidence);
    hear(listener, shared!);
    expect(listener.knowledge.all()).toHaveLength(1);
  });

  it('strips a rule the speaker does not actually hold', () => {
    resetIds();
    const speaker = speakerMind(
      new ScriptedMind([{ targetId: LISTENER, speechAct: 'share-knowledge', rule: FABRICATED, ruleConfidence: 0.9 }]),
    );
    const input = thinkInput(speaker);
    const out = speaker.think(input.snapshot, input.worldView, 'periodic');
    expect(out.utterances[0]!.rule).toBeUndefined();
    expect(out.utterances[0]!.ruleConfidence).toBeUndefined();
  });
});
