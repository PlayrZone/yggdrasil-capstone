import { describe, expect, it } from 'vitest';
import {
  COGNITION_SCHEMA_VERSION,
  ENGINE_VERSION,
  FORAGER_CONTINENT,
  LlmMind,
  MindOutputError,
  MockMindBackend,
  ReflexMind,
  attemptPrompt,
  buildThinkPrompt as buildThinkPromptIn,
  cognitionToExample,
  curateCorpus,
  evalJsonValidity,
  foragerAdapter,
  leakTrapBattery,
  parseMindOutput as parseMindOutputIn,
  parseMindOutputDetailed as parseMindOutputDetailedIn,
  retryPrompt,
  summarizeCorpus,
} from '../src/index.js';
import type {
  CognitionOutcome,
  CognitionRecord,
  CognitionRecordV2,
  IMindBackend,
  Intent,
  MindOutputRejection,
  ScaffoldState,
  ThinkInput,
  ThinkPrompt,
} from '../src/index.js';
import { CTX } from './helpers.js';

/**
 * W1-B3 WIRING, AND NOTHING ELSE. The parser and the prompt builder now take
 * the world whose vocabulary they are to use, so every call below is bound to
 * the forager continent — the world these cases were always written about.
 * Every assertion in this file is untouched: what is being pinned is that the
 * SAME inputs still produce the same decisions and the same reason codes when
 * the allowlists come out of the adapter instead of out of `schema.ts`.
 */
const parseMindOutput = (raw: string): ReturnType<typeof parseMindOutputIn> =>
  parseMindOutputIn(raw, foragerAdapter);
const parseMindOutputDetailed = (raw: string): ReturnType<typeof parseMindOutputDetailedIn> =>
  parseMindOutputDetailedIn(raw, foragerAdapter);
const buildThinkPrompt = (input: ThinkInput): ThinkPrompt => buildThinkPromptIn(input, foragerAdapter);

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
    attempts: [{ raw }],
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

// ─── Validity ────────────────────────────────────────────────────────────────

/**
 * `parseMindOutput('{}')` used to return `{goals:[],plan:[],utterances:[]}` and
 * count as VALID, so "100% schema validity" measured nothing at all and a mind
 * that returned nothing was treated as having decided (audit 03 §5).
 */
describe('validity: the output must decide something', () => {
  it('refuses an empty object, goals alone, and a thought alone', () => {
    for (const raw of ['{}', '{"goals":[{"description":"find food"}]}', '{"thought":"I am hungry."}', '{"plan":[],"utterances":[]}']) {
      expect(() => parseMindOutput(raw), raw).toThrow(MindOutputError);
      expect(reasonOf(raw)).toBe('no-decision');
    }
  });

  it('accepts an explicit, schema-legal do-nothing', () => {
    const out = parseMindOutput('{"plan":[{"kind":"Idle","durationTicks":40}]}');
    expect(out.plan).toEqual([{ kind: 'Idle', durationTicks: 40 }]);
  });

  it('accepts speech with no plan — saying something is deciding something', () => {
    const out = parseMindOutput('{"utterances":[{"speechAct":"request","text":"Where is water?"}]}');
    expect(out.utterances).toHaveLength(1);
    expect(out.plan).toEqual([]);
  });
});

/**
 * The salvage path, made explicit. The old `extractJson` scanned from the first
 * `{` to the last `}` and accepted whatever came out, so a model that ignored
 * "JSON only" was rewarded and a scan could splice across unrelated braces.
 */
describe('validity: every salvage case is an explicit accept or reject', () => {
  const ACCEPT: [string, string, 'bare' | 'fenced'][] = [
    ['bare object', '{"plan":[{"kind":"Idle"}]}', 'bare'],
    ['bare with surrounding whitespace', '\n  {"plan":[{"kind":"Idle"}]}\n\n', 'bare'],
    ['json fence', '```json\n{"plan":[{"kind":"Idle"}]}\n```', 'fenced'],
    ['bare fence with prose around it', 'Sure:\n```\n{"plan":[{"kind":"Idle"}]}\n```\nHope that helps.', 'fenced'],
    ['braces inside a string', '{"plan":[{"kind":"Idle"}],"thought":"a } inside"}', 'bare'],
    // A3: fence tags models actually emit. The tag is a delimiter, not a format
    // promise — the body still has to be JSON.
    ['an upper-case fence tag', '```JSON\n{"plan":[{"kind":"Idle"}]}\n```', 'fenced'],
    ['a js fence tag', '```js\n{"plan":[{"kind":"Idle"}]}\n```', 'fenced'],
    ['a spaced fence tag', '``` json\n{"plan":[{"kind":"Idle"}]}\n```', 'fenced'],
    ['a JSON5 fence around plain json', '```JSON5\n{"plan":[{"kind":"Idle"}]}\n```', 'fenced'],
    ['a fence never closed because the reply was cut off', '```json\n{"plan":[{"kind":"Idle"}]}', 'fenced'],
    ['a junk block before the real one', '```\nnot json at all\n```\n```json\n{"plan":[{"kind":"Idle"}]}\n```', 'fenced'],
    ['a json fence nested in a markdown fence', '```markdown\nHere:\n```json\n{"plan":[{"kind":"Idle"}]}\n```\n```', 'fenced'],
    ['a four-backtick fence', '````json\n{"plan":[{"kind":"Idle"}]}\n````', 'fenced'],
    ['a fence with CRLF line endings', '```json\r\n{"plan":[{"kind":"Idle"}]}\r\n```', 'fenced'],
    // A4: backticks inside a string are not a fence — the whole reply IS the object.
    ['a fence written inside a JSON string', '{"plan":[{"kind":"Idle"}],"thought":"I wrote ```json here```"}', 'bare'],
    ['backticks inside a thought inside a fence', '```json\n{"plan":[{"kind":"Idle"}],"thought":"I wrote ``` once"}\n```', 'fenced'],
    ['a plan exactly at the execution limit', JSON.stringify({ plan: Array.from({ length: 8 }, () => ({ kind: 'Idle' })) }), 'bare'],
  ];
  const REJECT: [string, string, MindOutputRejection][] = [
    ['json fished out of prose', 'here you go: {"plan":[{"kind":"Idle"}]}', 'json-in-prose'],
    ['json with a trailing explanation', '{"plan":[{"kind":"Idle"}]} — I hope that works', 'json-in-prose'],
    ['truncated mid-object', '{"plan":[{"kind":"Idle"', 'truncated-json'],
    ['truncated inside a fence', '```json\n{"plan":[{"kind":"Idle"', 'truncated-json'],
    ['trailing comma', '{"plan":[{"kind":"Idle"},]}', 'malformed-json'],
    ['single quotes', "{'plan':[{'kind':'Idle'}]}", 'malformed-json'],
    ['no json at all', 'the model rambled', 'not-json'],
    ['a bare string', '"I will rest"', 'not-json'],
    ['plan is not an array', '{"plan":"Idle"}', 'bad-plan'],
    ['unknown intent verb', '{"plan":[{"kind":"Teleport"}]}', 'bad-intent'],
    ['unknown speech act', '{"utterances":[{"speechAct":"hex"}]}', 'bad-speech-act'],
    // A3: an array reply is JSON — saying "not-json" told the model to fix the
    // wrong thing. A json5 BODY is still refused: the tag buys no leniency.
    ['an array reply', '["array"]', 'not-an-object'],
    ['an array of intents with no envelope', '[{"kind":"Idle"}]', 'not-an-object'],
    ['a json5 body under a json5 fence', '```json5\n{"plan":[{"kind":"Idle"},]}\n```', 'malformed-json'],
    ['two fences that each hold a legal reply', '```json\n{"plan":[{"kind":"Idle"}]}\n```\nor maybe\n```json\n{"plan":[{"kind":"Eat"}]}\n```', 'ambiguous-fences'],
    // A1/A2: legality is not a property of the first 8 elements.
    ['an illegal intent past the plan cap', JSON.stringify({ plan: [...Array.from({ length: 8 }, () => ({ kind: 'Idle' })), { kind: 'LaunchNuke' }] }), 'bad-intent'],
    ['an illegal speech act past the utterance cap', JSON.stringify({ utterances: [...Array.from({ length: 4 }, () => ({ speechAct: 'inform', text: 'hi' })), { speechAct: 'hex' }] }), 'bad-speech-act'],
    ['a plan longer than the engine runs', JSON.stringify({ plan: Array.from({ length: 500 }, () => ({ kind: 'Idle' })) }), 'plan-too-long'],
    ['more utterances than the engine speaks', JSON.stringify({ utterances: Array.from({ length: 5 }, () => ({ speechAct: 'inform', text: 'hi' })) }), 'utterances-too-long'],
    ['more goals than the engine holds', JSON.stringify({ plan: [{ kind: 'Idle' }], goals: Array.from({ length: 7 }, () => ({ description: 'eat' })) }), 'goals-too-long'],
    // A4: silent mutation.
    ['a coordinate that overflowed to Infinity', '{"plan":[{"kind":"MoveTo","x":1e999,"y":5}]}', 'bad-number'],
    ['an id past the safe integer range', '{"plan":[{"kind":"Gather","targetId":9007199254740993}]}', 'bad-number'],
    ['a repeated top-level key', '{"plan":[{"kind":"Idle"}],"plan":[{"kind":"Attack","targetId":2}]}', 'duplicate-key'],
    ['a repeated key spelled with an escape', '{"plan":[{"kind":"Idle"}],"pl\\u0061n":[{"kind":"Attack"}]}', 'duplicate-key'],
    ['a repeated key inside an intent', '{"plan":[{"kind":"Attack","kind":"Idle"}]}', 'duplicate-key'],
    ['an utterance with only whitespace to say', '{"utterances":[{"speechAct":"inform","text":"   "}]}', 'no-decision'],
    ['an utterance with only unicode whitespace to say', '{"utterances":[{"speechAct":"inform","text":"\\u00a0\\u2003\\u200b"}]}', 'no-decision'],
    ['an utterance with nothing in it at all', '{"utterances":[{"speechAct":"request","targetId":2}]}', 'no-decision'],
    ['an empty reply', '', 'not-json'],
    // B4: an arg outside the closed vocabulary is a refusal, not a silent drop.
    ['a structure the world cannot build', '{"plan":[{"kind":"Build","buildKind":"tower"}]}', 'bad-arg'],
    ['an object kind that is not a thing here', '{"plan":[{"kind":"Eat","objectKind":"plutonium"}]}', 'bad-arg'],
    ['a need no goal can serve', '{"plan":[{"kind":"Idle"}],"goals":[{"description":"rule","need":"power"}]}', 'bad-arg'],
    ['an intent that is an array', '{"plan":[[{"kind":"Idle"}]]}', 'bad-intent'],
    ['an intent that is null', '{"plan":[null]}', 'bad-intent'],
    // The block closed, and the object was left outside it.
    ['json left outside the fence', '```\njunk\n```\n{"plan":[{"kind":"Idle"}]}', 'json-in-prose'],
    ['two fences holding the same legal reply', '```json\n{"plan":[{"kind":"Idle"}]}\n```\n```json\n{"plan":[{"kind":"Idle"}]}\n```', 'ambiguous-fences'],
  ];

  for (const [name, raw, salvage] of ACCEPT) {
    it(`accepts ${name}`, () => {
      expect(parseMindOutputDetailed(raw).salvage).toBe(salvage);
    });
  }
  for (const [name, raw, reason] of REJECT) {
    it(`rejects ${name} as ${reason}`, () => {
      expect(reasonOf(raw)).toBe(reason);
    });
  }
});

/**
 * Round-1 review, defects A1–A4: what the old parser accepted, mutated or
 * masked. Each case below was VALID (or wrongly named) before the fix.
 */
describe('validity: the gate bites past the execution caps', () => {
  const idles = (n: number): string => JSON.stringify({ plan: Array.from({ length: n }, () => ({ kind: 'Idle' })) });

  it('validates every intent, not just the ones the engine would run', () => {
    // A1: `slice(0,8)` ran BEFORE the kind check, so this parsed as 8× Idle.
    expect(reasonOf(idles(8).replace(/]}$/, ',{"kind":"LaunchNuke"}]}'))).toBe('bad-intent');
    expect(() => parseMindOutput(idles(8))).not.toThrow();
  });

  it('refuses an over-long plan instead of truncating it, and says by how much', () => {
    // A2: 500 intents parsed, were cut to 8, and the raw kept all 500.
    const err = errorOf(idles(500));
    expect(err.reason).toBe('plan-too-long');
    expect(err.message).toContain('500');
    expect(err.message).toContain('8');
  });

  it('names the field whose number the engine could not use', () => {
    // A4: `{"kind":"MoveTo","x":1e999,"y":5}` silently became MoveTo{y:5}.
    for (const field of ['x', 'y', 'targetId', 'durationTicks']) {
      for (const literal of ['1e999', '-1e999', '9007199254740993']) {
        const raw = `{"plan":[{"kind":"MoveTo","${field}":${literal}}]}`;
        const err = errorOf(raw);
        expect(err.reason, raw).toBe('bad-number');
        expect(err.message, raw).toContain(field);
      }
    }
    expect(reasonOf('{"utterances":[{"speechAct":"inform","text":"hi","ruleRef":1e999}]}')).toBe('bad-number');
    expect(reasonOf('{"utterances":[{"speechAct":"inform","text":"hi","targetId":1e999}]}')).toBe('bad-number');
    expect(reasonOf('{"plan":[{"kind":"Idle"}],"goals":[{"description":1e999}]}')).toBe('bad-number');
  });

  it('keeps a number that is merely odd — absent, null and wrong-typed stay ignored', () => {
    expect(parseMindOutput('{"plan":[{"kind":"MoveTo","x":null,"y":5}]}').plan[0]).toEqual({ kind: 'MoveTo', y: 5 });
    expect(parseMindOutput('{"plan":[{"kind":"MoveTo","x":"far","y":5}]}').plan[0]).toEqual({ kind: 'MoveTo', y: 5 });
    // -0 is finite and exact: it is kept as the model wrote it, not rounded away.
    const negZero = parseMindOutput('{"plan":[{"kind":"MoveTo","x":-0,"y":0}]}').plan[0]!;
    expect(Object.is(negZero.x, -0)).toBe(true);
    expect(parseMindOutput('{"plan":[{"kind":"Gather","targetId":9007199254740991}]}').plan[0]!.targetId).toBe(9007199254740991);
  });

  it('reads the revised block instead of letting the first fence win', () => {
    // A3: the first fence won, so a junk block rejected the real answer.
    const raw = 'Wait, that was wrong.\n```\n{"plan":[{"kind":"Teleport"}]}\n```\nHere is the real one:\n```json\n{"plan":[{"kind":"Eat","objectKind":"berry"}]}\n```';
    const parsed = parseMindOutputDetailed(raw);
    expect(parsed.salvage).toBe('fenced');
    expect(parsed.output.plan).toEqual([{ kind: 'Eat', objectKind: 'berry' }]);
  });

  it('refuses to choose between two legal fences, and counts them', () => {
    const err = errorOf('```json\n{"plan":[{"kind":"Idle"}]}\n```\nor\n```json\n{"plan":[{"kind":"Flee"}]}\n```');
    expect(err.reason).toBe('ambiguous-fences');
    expect(err.message).toContain('2');
  });

  it('keeps an empty utterance but never calls it a decision', () => {
    // `name`/`thought` trimmed; `text` did not, so "   " counted as speech.
    const out = parseMindOutput('{"plan":[{"kind":"Eat"}],"utterances":[{"speechAct":"inform","text":"  \\u00a0 "}]}');
    expect(out.utterances).toHaveLength(1); // the model's act survives…
    expect(out.utterances[0]!.text).toBeUndefined(); // …with nothing in its mouth
    expect(reasonOf('{"utterances":[{"speechAct":"inform","text":"  "}]}')).toBe('no-decision');
    // Speech that carries something is still a decision on its own.
    expect(parseMindOutput('{"utterances":[{"speechAct":"share-knowledge","ruleRef":3}]}').utterances).toHaveLength(1);
    expect(parseMindOutput('{"utterances":[{"speechAct":"share-episode","narrativeRef":"a:1:2"}]}').utterances).toHaveLength(1);
  });

  /**
   * ROUND-2 REVIEW B4: `kind` was closed and its ARGS were not.
   * `{"kind":"Build","buildKind":"tower"}` parsed as a legal Build with the
   * field dropped and the Body built a shelter; `objectKind:"plutonium"` was
   * carried through by an unchecked cast. Every enumerated arg is now checked
   * against the vocabulary the prompt advertises, on every verb: a value in the
   * vocabulary is kept whatever the verb (the Body decides what it means there),
   * and one outside it is `bad-arg` naming the field and what was written.
   */
  it('checks every enumerated arg against the closed vocabulary, on every intent kind', () => {
    const KINDS = [
      'MoveTo', 'Gather', 'Dig', 'Eat', 'Drink', 'Sleep', 'Build', 'Deposit',
      'Withdraw', 'Give', 'Attack', 'Craft', 'Speak', 'Follow', 'Flee', 'Idle',
    ];
    const ARGS: { field: string; good: string; bad: string[] }[] = [
      { field: 'objectKind', good: 'berry', bad: ['plutonium', 'tower', 'BERRY', 'berries', ''] },
      { field: 'buildKind', good: 'shelter', bad: ['tower', 'castle', 'Shelter', 'berry', ''] },
    ];
    for (const kind of KINDS) {
      for (const { field, good, bad } of ARGS) {
        const ok = parseMindOutput(`{"plan":[{"kind":"${kind}","${field}":"${good}"}]}`).plan[0]!;
        expect(ok, `${kind}.${field}`).toEqual({ kind, [field]: good });
        for (const value of bad) {
          const raw = `{"plan":[{"kind":"${kind}","${field}":${JSON.stringify(value)}}]}`;
          const err = errorOf(raw);
          expect(err.reason, raw).toBe('bad-arg');
          expect(err.message, raw).toContain(field);
          expect(err.message, raw).toContain(value);
        }
        // Not even the right SHAPE is guessed at: a number or an object where a
        // word belongs is a refusal, not a silent drop.
        for (const literal of ['7', 'true', '{"kind":"shelter"}', '["shelter"]']) {
          expect(reasonOf(`{"plan":[{"kind":"${kind}","${field}":${literal}}]}`), `${kind}.${field}=${literal}`).toBe('bad-arg');
        }
        // …and absent or null still means the model offered nothing.
        expect(parseMindOutput(`{"plan":[{"kind":"${kind}","${field}":null}]}`).plan[0], `${kind}.${field}=null`).toEqual({ kind });
      }
    }
  });

  it('refuses a build the world has no such thing as, instead of building another', () => {
    // The exact case the reviewer printed: parsed OK, field dropped, shelter built.
    const err = errorOf('{"plan":[{"kind":"Build","buildKind":"tower","x":3,"y":4}]}');
    expect(err.reason).toBe('bad-arg');
    expect(err.message).toContain('tower');
    expect(err.message).toContain('shelter, wall, container');
    expect(reasonOf('{"plan":[{"kind":"Eat","objectKind":"plutonium"}]}')).toBe('bad-arg');
    // Every kind the world IS made of still parses, on the verbs that take one.
    for (const objectKind of ['water', 'wood', 'seed', 'copperOre', 'gemstone', 'corpse']) {
      expect(reasonOf(`{"plan":[{"kind":"Deposit","objectKind":"${objectKind}"}]}`), objectKind).toBe('accepted');
    }
  });

  it('checks a goal’s need against the four the prompt renders', () => {
    expect(parseMindOutput('{"plan":[{"kind":"Idle"}],"goals":[{"description":"eat","need":"hunger"}]}').goals[0]!.need).toBe('hunger');
    const err = errorOf('{"plan":[{"kind":"Idle"}],"goals":[{"description":"rule them","need":"power"}]}');
    expect(err.reason).toBe('bad-arg');
    expect(err.message).toContain('power');
    expect(parseMindOutput('{"plan":[{"kind":"Idle"}],"goals":[{"description":"eat","need":null}]}').goals[0]!.need).toBeUndefined();
  });

  it('cannot be made to pollute a prototype through a key', () => {
    const out = parseMindOutput('{"__proto__":{"polluted":true},"plan":[{"kind":"Idle"}]}');
    expect(out.plan).toEqual([{ kind: 'Idle' }]);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('refuses a reply whose keys contradict each other', () => {
    // JSON.parse keeps the LAST "plan"; the first was executed unseen.
    const err = errorOf('{"plan":[{"kind":"Idle"}],"plan":[{"kind":"Attack","targetId":2}]}');
    expect(err.reason).toBe('duplicate-key');
    expect(err.message).toContain('plan');
    // One key, many times, is the only duplicate that matters — nesting included.
    expect(reasonOf('{"plan":[{"kind":"Idle"}],"thought":"a","thought":"b"}')).toBe('duplicate-key');
    expect(reasonOf('{"plan":[{"kind":"Idle","durationTicks":1}],"thought":"plan: plan"}')).toBe('accepted');
  });
});

/** The reason has to reach the record, or a corpus cannot be scored on it. */
describe('validity: the reason rides onto the attempt', () => {
  it('retries and falls back on an output that decided nothing, recording why', async () => {
    const log: CognitionRecord[] = [];
    const empty: IMindBackend = { modelId: 'mock/empty', complete: () => Promise.resolve('{}') };
    const mind = new LlmMind(empty, { world: foragerAdapter, fallback: new ReflexMind(foragerAdapter), onCognition: (r) => log.push(r) });
    const out = await mind.complete(leakTrapBattery()[0]!.input);

    expect(out.plan.length).toBeGreaterThan(0); // reflex carried the being
    expect(log[0]!.valid).toBe(false);
    expect(log[0]!.fellBackToReflex).toBe(true);
    expect(log[0]!.attempts).toHaveLength(2);
    for (const attempt of log[0]!.attempts) expect(attempt.error).toContain('no-decision');
    // …and the retry told the model exactly that.
    expect(log[0]!.attempts[1]!.prompt.user).toContain('no-decision');
  });

  it('carries a NEW reason code back to the model too', async () => {
    const log: CognitionRecord[] = [];
    const flood = JSON.stringify({ plan: Array.from({ length: 500 }, () => ({ kind: 'Idle' })) });
    const verbose: IMindBackend = { modelId: 'mock/verbose', complete: () => Promise.resolve(flood) };
    const mind = new LlmMind(verbose, { world: foragerAdapter, fallback: new ReflexMind(foragerAdapter), onCognition: (r) => log.push(r) });
    await mind.complete(leakTrapBattery()[0]!.input);
    expect(log[0]!.attempts[1]!.prompt.user).toContain('plan-too-long');
  });
});

describe('eval gate 1: JSON validity', () => {
  const inputs = (): ThinkInput[] => leakTrapBattery().slice(0, 4).map((t) => t.input);

  it('scores the mock backend valid and reports the salvage count', async () => {
    const r = await evalJsonValidity(new MockMindBackend({ world: foragerAdapter }), inputs());
    expect(r.rate).toBe(1);
    expect(r.byReason).toEqual({});
    expect(r.salvagedFenced).toBe(0);
  });

  it('breaks rejections down by reason, so a rate is never read alone', async () => {
    const answers = ['{}', 'the model rambled', 'here you go: {"plan":[{"kind":"Idle"}]}', '```json\n{"plan":[{"kind":"Idle"}]}\n```'];
    let call = 0;
    const scripted: IMindBackend = {
      modelId: 'mock/mixed',
      complete: () => Promise.resolve(answers[call++ % answers.length]!),
    };
    const r = await evalJsonValidity(scripted, inputs());
    expect(r.valid).toBe(1);
    expect(r.salvagedFenced).toBe(1);
    expect(r.byReason).toEqual({ 'no-decision': 1, 'not-json': 1, 'json-in-prose': 1 });
  });

  /**
   * A model that always answers `{"plan":[{"kind":"Idle"}]}` scores 100%
   * validity. The rate alone cannot tell it from a mind that decides anything,
   * so the idle answer is counted where a reader cannot miss it.
   */
  it('separates a mind that only idles from one that acts, at the same 100%', async () => {
    const lazy: IMindBackend = { modelId: 'mock/lazy', complete: () => Promise.resolve('{"plan":[{"kind":"Idle"}]}') };
    const lazyScore = await evalJsonValidity(lazy, inputs());
    expect(lazyScore.rate).toBe(1);
    expect(lazyScore.idleOnly).toBe(4);
    expect(lazyScore.acting).toBe(0);
    expect(lazyScore.speaking).toBe(0);

    const real = await evalJsonValidity(new MockMindBackend({ world: foragerAdapter }), inputs());
    expect(real.rate).toBe(1); // identical headline…
    expect(real.acting).toBeGreaterThan(0); // …different mind
    expect(real.idleOnly).toBeLessThan(lazyScore.idleOnly);
  });

  it('does not let empty speech count as having spoken', async () => {
    const mute: IMindBackend = {
      modelId: 'mock/mute',
      complete: () => Promise.resolve('{"plan":[{"kind":"Idle"}],"utterances":[{"speechAct":"inform","text":"   "}]}'),
    };
    const r = await evalJsonValidity(mute, inputs());
    expect(r.rate).toBe(1);
    expect(r.speaking).toBe(0);
    expect(r.idleOnly).toBe(4);
  });

  it('passes the composed prompt to the backend — what is recorded is what was sent', async () => {
    const sent: ThinkPrompt[] = [];
    const spy: IMindBackend = {
      modelId: 'mock/spy',
      complete: (prompt) => {
        sent.push(prompt);
        return Promise.resolve('{"plan":[{"kind":"Idle"}]}');
      },
    };
    const input = leakTrapBattery()[0]!.input;
    await evalJsonValidity(spy, [input]);
    expect(sent[0]).toEqual(buildThinkPrompt(input));
  });
});

// ─── Curation ────────────────────────────────────────────────────────────────

describe('corpus curation', () => {
  it('keeps valid calls and reports every drop by reason', () => {
    const records = [
      rec(),
      rec({ parse: { valid: false, retried: true, fellBackToReflex: true, error: 'not-json: no JSON object anywhere in the reply' } }),
      rec({ attempts: [{ raw: '' }] }),
      rec({ status: 'unanswered-at-run-end', attempts: [], parse: { valid: false, retried: false, fellBackToReflex: false } }),
    ];
    const result = curateCorpus(records, { dedupe: false });
    expect(result.kept).toBe(1);
    expect(result.input).toBe(4);
    expect(result.drops).toMatchObject({ reflexFallback: 1, unanswered: 1, noCompletion: 1, invalid: 0 });

    const example = cognitionToExample(records[0]!)!;
    expect(example.messages).toHaveLength(3);
    expect(example.messages[0]).toEqual({ role: 'system', content: 'sys' });
    expect(example.messages[2]!.content).toBe(records[0]!.attempts[0]!.raw);
    expect(cognitionToExample(records[1]!)).toBeNull();
  });

  it('pairs a retried completion with the prompt THAT attempt was sent', () => {
    const first = { system: 'sys', user: 'usr' };
    const second = retryPrompt(first, 'not-json: no JSON object anywhere in the reply');
    const retried = rec({
      prompt: first,
      attempts: [
        { raw: 'the model rambled', error: 'not-json: no JSON object anywhere in the reply' },
        { promptDelta: { userSuffix: second.user.slice(first.user.length) }, raw: '{"plan":[{"kind":"Sleep"}]}' },
      ],
      parse: { valid: true, retried: true, fellBackToReflex: false },
    });
    expect(attemptPrompt(retried, retried.attempts[1]!)).toEqual(second);
    const messages = cognitionToExample(retried)!.messages;
    expect(messages[2]!.content).toBe('{"plan":[{"kind":"Sleep"}]}');
    // The retry prompt, not the first attempt's — the pair must be one that existed.
    expect(messages[1]!.content).toBe(second.user);
    expect(messages[1]!.content).not.toBe(first.user);
  });

  /**
   * The old key was `trigger | ordered intent kinds`, which capped the output at
   * the key space (~278 rows) no matter how much went in and threw away every
   * differently-reasoned act of the same shape. Three beings who each think
   * their own way to `Eat` are three examples.
   */
  it('keeps distinct reasoning of the same plan shape, and drops true copies', () => {
    const body = (thought: string): CognitionRecordV2 =>
      rec({
        prompt: { system: 'sys', user: `usr ${thought}` },
        attempts: [{ raw: JSON.stringify({ goals: [], plan: [{ kind: 'Eat', objectKind: 'berry' }], utterances: [], thought }) }],
      });
    const varied = [
      body('The bush by the water was full when I passed it at dawn.'),
      body('My child is hungry and I would rather she ate before me.'),
      body('I have carried these berries three days and they will spoil.'),
    ];
    expect(curateCorpus(varied).kept).toBe(3);

    const copies = [body('The same words exactly.'), body('The same words exactly.')];
    const deduped = curateCorpus(copies);
    expect(deduped.kept).toBe(1);
    expect(deduped.drops.exactDuplicate).toBe(1);
  });

  it('emits valid JSONL (one example per line)', () => {
    const result = curateCorpus([rec(), rec({ prompt: { system: 'sys', user: 'other' } }, [{ kind: 'Sleep' }])]);
    const lines = result.jsonl.split('\n');
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
  });
});

// ─── Dataset card ────────────────────────────────────────────────────────────

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
    speechTrackingStopped: false,
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
      parse: { valid: false, retried: true, fellBackToReflex: true, error: 'not-json: no JSON object anywhere in the reply' },
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
    // Renamed from `unscaffolded`: it means no intervention was LOGGED, which
    // is not the same as the being having been left alone.
    expect(card.scaffold.noRecordedIntervention).toBe(4);
    expect(card.validity).toEqual({ valid: 4, invalid: 1, retried: 1, fellBackToReflex: 1, unanswered: 0 });
    expect(card.distinct).toMatchObject({ beings: 3, runs: 2, seeds: 2, worlds: 1, scenarios: 2, models: 1 });
    expect(card.planShapes[0]).toEqual({ key: 'Eat', count: 3, share: 0.6 });
    expect(card.topFivePlanShapeShare).toBe(1);
    expect(card.intentKinds.find((s) => s.key === 'Gather')!.count).toBe(1);
    expect(card.byNeedRegime).toEqual([{ key: 'rising', count: 5, share: 1 }]);
    // Two rows share a (system, user, completion) triple: one of them is a copy.
    expect(card.exactDuplicateRate).toBe(0.2);
    // Two of five rows have an outcome; the third outcome points at no row.
    expect(card.outcomeLinkedRate).toBe(0.4);
    expect(card.orphanOutcomes).toBe(1);
    expect(card.duplicateOutcomes).toBe(0);
    expect(card.planShapeSuccess).toEqual([
      { shape: 'Eat', n: 1, successRate: 1 },
      { shape: 'Sleep', n: 1, successRate: 0 },
    ]);
  });

  /** The reviewer's carried nit: repeated ids pushed the rate past 1. */
  it('cannot report an outcome-linked rate above 1', () => {
    const only = rec({ id: 'run-a:9:1' });
    const card = summarizeCorpus([only], [outcomeFor('run-a:9:1', true), outcomeFor('run-a:9:1', false), outcomeFor('run-a:9:1', true)]);
    expect(card.outcomeLinkedRate).toBe(1);
    expect(card.duplicateOutcomes).toBe(2);
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

function reasonOf(raw: string): MindOutputRejection | 'accepted' {
  try {
    parseMindOutput(raw);
    return 'accepted';
  } catch (err) {
    return err instanceof MindOutputError ? err.reason : 'accepted';
  }
}

function errorOf(raw: string): MindOutputError {
  try {
    parseMindOutput(raw);
  } catch (err) {
    if (err instanceof MindOutputError) return err;
  }
  throw new Error(`expected a MindOutputError for ${raw.slice(0, 60)}`);
}
