import { describe, expect, it } from 'vitest';
import {
  COGNITION_SCHEMA_VERSION,
  ENGINE_VERSION,
  FORAGER_CONTINENT,
  curateCorpus,
  shingleJaccard,
} from '../src/index.js';
import type { CognitionRecordV2, Intent, IntentKind, ScaffoldState, TrainingExample } from '../src/index.js';
import { CTX } from './helpers.js';

/**
 * Audit 03 §8 item 5's acceptance criterion, run on a 10,000-act synthetic
 * corpus: retain > 70% of unique acts, exact-duplicate rate < 0.5%,
 * near-duplicate (J ≥ 0.8) rate < 2%, no single plan shape over 10%.
 *
 * The old curator could not have met it at any corpus size: its dedupe key was
 * `trigger | ordered intent kinds`, so the output was capped at the size of
 * that key space — ~278 rows for the whole 2,119-row corpus — and every
 * differently-reasoned act of the same shape collapsed into one.
 *
 * The near-duplicate verification below is deliberately INDEPENDENT of the
 * implementation under test: its own tokenizer and shingler, bottom-k blocking
 * for candidate pairs, and the decision made by exact Jaccard rather than by a
 * sketch. `shingleJaccard` is the engine's, but it is the exact measure, not
 * the MinHash estimate the curator actually uses.
 *
 * It scores the SAME property the curator claims: a row is two parts, and their
 * similarity is 0.75 × completion + 0.25 × context (see
 * `NEAR_DUPLICATE_COMPLETION_WEIGHT`, pinned by dedupe.test.ts). The weight is
 * written out here rather than imported, so the two implementations agree only
 * on the definition.
 */
const COMPLETION_WEIGHT = 0.75;

const SHAPES: [IntentKind[], number][] = [
  [['MoveTo'], 0.12],
  [['MoveTo', 'Sleep'], 0.09],
  [['MoveTo', 'Gather'], 0.08],
  [['Gather', 'Eat'], 0.07],
  [['Sleep'], 0.06],
];
const TAIL: IntentKind[][] = [
  ['Eat'], ['Idle'], ['MoveTo', 'Speak'], ['Speak'], ['Follow'], ['MoveTo', 'Idle'], ['Gather'],
  ['MoveTo', 'Gather', 'Eat'], ['Build'], ['Craft'], ['Dig'], ['Drink'], ['MoveTo', 'Drink'],
  ['Flee'], ['Attack'], ['Give'], ['Deposit'], ['Withdraw'], ['MoveTo', 'Build'], ['Craft', 'Idle'],
  ['Eat', 'Sleep'], ['Gather', 'Craft'], ['MoveTo', 'Follow'], ['Speak', 'Idle'], ['Idle', 'Sleep'],
  ['MoveTo', 'Eat'], ['Dig', 'Craft'], ['Drink', 'Sleep'], ['Flee', 'MoveTo'], ['Give', 'Speak'],
  ['Gather', 'Deposit'], ['MoveTo', 'Gather', 'Sleep'], ['Eat', 'Idle'], ['Sleep', 'Gather'],
  ['MoveTo', 'Craft'],
];

const BELIEFS = [
  'Gathering succeeds (berry) happens mostly near water', 'Eating eases hunger', 'Sleeping in the open worsens safety',
  'Gathering fails (berry) happens mostly at night', 'Eating (mushroomRed) is followed by becoming sick',
  'Drinking eases hunger', 'Building eases safety', 'Sleeping safely happens mostly in shelter',
  'Gathering succeeds (wood) happens mostly in the highlands', 'Agent #1841 is helpful',
  'Agent #1902 gives back when given to', 'Agent #1877 is dangerous', 'Finding resources happens mostly near water',
  'Suffering from exposure worsens safety', 'A spear can be made by working wood and stone together',
  'Gathering succeeds (tuber) happens mostly near water', 'Eating (nightshade) is followed by becoming sick',
  'Death happens mostly at night', 'Gathering succeeds (clay) happens mostly near water',
  'Gathering succeeds (stone) happens mostly in the highlands', 'Agent #1866 is generous',
  'Being attacked worsens safety', 'Sleeping safely eases rest', 'A rope can be made by working 3 fiber together',
  'Gathering fails (tuber) happens mostly in the highlands', 'Finding resources rarely happens at night',
  'Agent #1834 is helpful', 'Eating (berry) eases hunger', 'Drinking rarely happens in the highlands',
  'Gathering succeeds (fiber) happens mostly near water', 'Building rarely happens at night',
  'A handaxe can be made by working stone and wood together', 'Agent #1888 gives back when given to',
  'Eating (tuber) eases hunger', 'Suffering from exposure happens mostly at night', 'Agent #1911 is dangerous',
  'Gathering succeeds (meat) rarely happens near water', 'A brick can be made by working 2 clay together',
  'Death rarely happens in shelter', 'Gathering fails (wood) happens mostly at night',
];

const MEMORIES = [
  'GatherSucceeded (berry) by the wide river', 'AteFood (tuber) at the edge of the wood',
  'SleptExposed on the open plain', 'BecameSick after the red mushroom', 'SawAgent near the lake shore',
  'WitnessedDeath of one I knew', 'GaveItem (wood) to another', 'ReceivedItem (berry) from another',
  'BuiltStructure at the hill foot', 'Crafted something from what I carried', 'FoundResource in the high rocks',
  'DrankWater at the tributary', 'GatherFailed at the empty bush', 'SleptSafely under a roof',
  'AttackedByPredator in the deep forest', 'FoughtPredator and lived', 'ChildBorn in the warm season',
  'UtteranceSpoken to one who listened', 'IntentRejected because nothing was in reach',
  'DepositedItem where I could find it again', 'SeedDeposited where the ground was soft',
  'PlantSprouted where none had been', 'RecoveredFromSickness after many days', 'SufferedExposure in the cold',
  'WasAttacked by one I had trusted', 'KilledPredator at the treeline', 'WithdrewItem from my store',
  'GatherSucceeded (stone) in the foothills', 'AteFood (meat) after the hunt', 'MoveTo the place from the story',
];

const GOALS = [
  'find food and eat', 'sleep', 'get to safety', 'seek company', 'explore', 'stay near kin and friends',
  'return to the place of the story', 'work the materials into a tool', 'find water', 'keep what I gather',
  'reach the high rocks', 'stay out of the cold', 'learn what the elder knows', 'follow the one I trust',
  'go where the bushes were full', 'mend before the dark', 'carry this to my child', 'find a roof',
  'see what lies east', 'ask about the lake', 'gather enough wood', 'rest until I am strong',
  'stay where it is warm', 'watch the one who makes things', 'go back to the water',
];

const THOUGHTS = [
  'The bushes by the water were full when I passed them.', 'I am tired and the ground here is hard.',
  'My child went ahead of me and I do not see her now.', 'The one I trust is not here today.',
  'I have carried this too long and it is heavy.', 'There is nothing to eat where I stand.',
  'The cold gets into me at night and I sleep badly.', 'I remember this place from what I was told.',
  'Someone here knows more than I do about the water.', 'I have not spoken to anyone since the dark.',
  'The rocks above are hard to reach but I have seen others go.', 'It is quiet and that makes me uneasy.',
  'I gathered more than I need and I do not know what to do with it.', 'My legs ache from walking.',
  'The others went the other way and I let them.', 'I am not sure this is the place from the tale.',
  'The water tastes different here.', 'I was sick and I am only now steady.',
  'The elder said something I did not understand.', 'I would rather be where there are others.',
  'The wood here is wet and no use to me.', 'I keep coming back to this same stretch of ground.',
  'Something moved in the trees and I did not stay to see.', 'I have eaten and I am steady again.',
  'The one who died was known to me.', 'I want to see what is beyond the ridge.',
  'There are too many of us here for what grows.', 'I have made nothing today.',
  'The story says a great thing happened here.', 'I do not like the open ground.',
  'My hands are cold and clumsy.', 'I found a place out of the wind.',
  'Nobody has come this way in a long time.', 'I gave what I had and I am glad of it.',
  'The night was long and I did not rest.', 'I saw the marks of something large.',
  'I will go where I went before.', 'The high ground is bare of food.',
  'One of them looked at me and said nothing.', 'I am strong today and I will use it.',
  'What I carry will spoil if I wait.', 'The ground is soft after the rain.',
  'I have learned little and I want to know more.', 'The shelter holds two and there are three of us.',
  'I do not want to be alone tonight.', 'I heard something told that I had not heard before.',
  'The water is far and I am thirsty.', 'There is more here than I first saw.',
  'I would go east if anyone came with me.', 'I am afraid of the deep wood.',
  'The bushes are picked over and nothing is left.', 'I slept badly and my head is thick.',
  'Someone left this behind and did not come back.', 'The way I came is no longer clear to me.',
  'I have kept my word and I expect nothing for it.', 'The season is turning and I feel it.',
  'I do not know this one but she looks kindly.', 'I have been here since before the dark.',
  'The stone I found is unlike the others.', 'I will wait here a while and watch.',
];

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

const SYSTEM = [
  'You are the mind of a being living in a simple world, among others.',
  'You reason ONLY from what you perceive and what you KNOW.',
  'Respond ONLY with JSON of this exact shape:',
  '{"thought":string,"goals":[...],"plan":[{"kind":INTENT,...args}],"utterances":[...]}',
].join('\n');

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(r: () => number, pool: T[]): T {
  return pool[Math.floor(r() * pool.length) % pool.length]!;
}

function sample<T>(r: () => number, pool: T[], n: number): T[] {
  const taken = new Set<number>();
  while (taken.size < Math.min(n, pool.length)) taken.add(Math.floor(r() * pool.length) % pool.length);
  return [...taken].map((i) => pool[i]!);
}

function shapeFor(r: () => number): IntentKind[] {
  const roll = r();
  let acc = 0;
  for (const [shape, weight] of SHAPES) {
    acc += weight;
    if (roll < acc) return shape;
  }
  return pick(r, TAIL);
}

interface SyntheticRow {
  record: CognitionRecordV2;
  /** Set for rows deliberately made a copy of an earlier one. */
  copyOf?: number;
  kind: 'good' | 'invalid' | 'reflex' | 'unanswered';
}

/**
 * 10,000 acts over 3 runs and 120 beings, with a realistic behavioural
 * distribution (top shape 12%, five shapes 42%, a 35-shape tail) and the three
 * kinds of row a corpus actually contains: 4% exact copies, 4% near copies (one
 * token changed), 8% rows that are not training targets at all.
 */
function syntheticCorpus(count: number): SyntheticRow[] {
  const rows: SyntheticRow[] = [];
  for (let i = 0; i < count; i++) {
    const r = rng(0x5eed0000 + i);
    const runId = `run-${i % 3}`;
    const beingId = 1800 + (i % 120);
    const tick = 1000 + i * 7;
    const shape = shapeFor(r);
    const plan: Intent[] = shape.map((kind) => intentOf(kind, r));
    const thought = `${pick(r, THOUGHTS)} ${pick(r, THOUGHTS)}`;
    const user = userPrompt(r, tick);
    const raw = JSON.stringify({
      thought,
      goals: sample(r, GOALS, 1 + Math.floor(r() * 2)).map((description) => ({ description, need: null })),
      plan,
      utterances: r() < 0.3 ? [{ speechAct: 'request', text: pick(r, THOUGHTS) }] : [],
    });

    const roll = r();
    const kind: SyntheticRow['kind'] = roll < 0.04 ? 'invalid' : roll < 0.06 ? 'reflex' : roll < 0.08 ? 'unanswered' : 'good';
    rows.push({ record: recordOf({ runId, beingId, tick, user, raw, plan, kind, needs: needsFor(r) }), kind });
  }

  // Copies, injected after the originals so the first of each pair is the keeper.
  const dup = rng(0xd00d);
  const copies: SyntheticRow[] = [];
  const good = rows.map((row, i) => ({ row, i })).filter(({ row }) => row.kind === 'good');
  for (let n = 0; n < Math.round(count * 0.04); n++) {
    const { row, i } = good[Math.floor(dup() * good.length) % good.length]!;
    copies.push({ kind: 'good', copyOf: i, record: { ...row.record, id: `dup-exact-${n}`, tick: row.record.tick + 1 } });
  }
  for (let n = 0; n < Math.round(count * 0.04); n++) {
    const { row, i } = good[Math.floor(dup() * good.length) % good.length]!;
    // One token changed: a near-duplicate by construction, verified below.
    const nudged = row.record.prompt.user.replace('hunger', 'hungerr');
    copies.push({
      kind: 'good',
      copyOf: i,
      record: {
        ...row.record,
        id: `dup-near-${n}`,
        tick: row.record.tick + 2,
        prompt: { ...row.record.prompt, user: nudged },
        attempts: [{ raw: row.record.attempts[0]!.raw }],
      },
    });
  }
  return [...rows, ...copies];
}

function needsFor(r: () => number): { hunger: number; rest: number; safety: number; socialConnection: number } {
  return {
    hunger: Math.round(r() * 100),
    rest: Math.round(r() * 100),
    safety: Math.round(r() * 80),
    socialConnection: Math.round(r() * 90),
  };
}

function userPrompt(r: () => number, tick: number): string {
  return [
    'Why you are thinking now: periodic.',
    `NEEDS (0 satisfied, 100 desperate): hunger ${Math.round(r() * 100)}, rest ${Math.round(r() * 100)}, safety ${Math.round(r() * 80)}, social ${Math.round(r() * 90)}`,
    `HEALTH ${Math.round(60 + r() * 40)}. It is ${pick(r, ['spring', 'summer', 'autumn', 'winter'])}, ${r() < 0.4 ? 'night' : 'day'}.`,
    `INVENTORY: ${sample(r, ['berry', 'wood', 'stone', 'fiber', 'clay', 'tuber', 'seed', 'meat'], 1 + Math.floor(r() * 3)).map((k) => `${k}×${1 + Math.floor(r() * 6)}`).join(', ')}`,
    'WHAT YOU KNOW:',
    ...sample(r, BELIEFS, 3 + Math.floor(r() * 4)).map((b, i) => `  - [${i + 1}] You believe (${60 + Math.floor(r() * 39)}%, seen ${1 + Math.floor(r() * 40)}×): ${b}`),
    'WHAT YOU SEE (within range):',
    `  resources: ${1 + Math.floor(r() * 5)} ${pick(r, ['berryBush', 'tree', 'stoneDeposit', 'waterSource', 'tuberPlant', 'fiberPlant'])}`,
    `  ${Math.floor(r() * 6)} other being(s) nearby`,
    'RECENT MEMORIES:',
    ...sample(r, MEMORIES, 2 + Math.floor(r() * 4)).map((m) => `  - ${m}`),
    `CURRENT GOALS: ${sample(r, GOALS, 1 + Math.floor(r() * 2)).join('; ')}`,
    `It is tick ${tick}. Decide what to do. Respond with JSON only.`,
  ].join('\n');
}

function intentOf(kind: IntentKind, r: () => number): Intent {
  switch (kind) {
    case 'MoveTo':
      return { kind, x: Math.round(r() * 800), y: Math.round(r() * 800) };
    case 'Eat':
    case 'Give':
    case 'Deposit':
    case 'Withdraw':
      return { kind, objectKind: pick(r, ['berry', 'tuber', 'meat', 'wood', 'stone']) };
    case 'Build':
      return { kind, buildKind: pick(r, ['shelter', 'wall', 'container']) };
    case 'Sleep':
    case 'Idle':
      return { kind, durationTicks: 20 + Math.floor(r() * 200) };
    default:
      return { kind, targetId: 1 + Math.floor(r() * 400) };
  }
}

function recordOf(o: {
  runId: string;
  beingId: number;
  tick: number;
  user: string;
  raw: string;
  plan: Intent[];
  kind: SyntheticRow['kind'];
  needs: { hunger: number; rest: number; safety: number; socialConnection: number };
}): CognitionRecordV2 {
  const parsed = JSON.parse(o.raw) as { goals: []; plan: Intent[]; utterances: [] };
  return {
    id: `${o.runId}:${o.tick}:${o.beingId}`,
    schemaVersion: COGNITION_SCHEMA_VERSION,
    engineVersion: ENGINE_VERSION,
    runId: o.runId,
    scenarioId: 'synthetic',
    worldId: FORAGER_CONTINENT,
    seed: o.runId,
    options: { agentCount: 120, mythBehavior: true, leadership: true, offerMaking: true, craftLearning: false, outcomeWindowTicks: 400 },
    tick: o.tick,
    simDay: Math.floor(o.tick / 2400) + 1,
    beingId: o.beingId,
    beingName: `Gahallian #${o.beingId}`,
    generation: 1,
    ageTicks: 4000,
    trigger: 'periodic',
    thinkInput: {
      snapshot: {
        id: o.beingId,
        name: `Gahallian #${o.beingId}`,
        ageTicks: 4000,
        traits: { curiosity: 50, aggression: 10, compassion: 50, ambition: 50, loyalty: 50, riskTolerance: 40 },
        needs: o.needs,
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
      worldView: { tick: o.tick, night: false, season: 'spring', agents: [], resources: [], structures: [] },
      goals: [],
      trigger: 'periodic',
    },
    prompt: { system: SYSTEM, user: o.user },
    status: o.kind === 'unanswered' ? 'unanswered-at-run-end' : 'answered',
    attempts: o.kind === 'unanswered' ? [] : [{ raw: o.raw }],
    modelId: 'bootstrap/teacher',
    backendLabel: 'bootstrap/teacher',
    parse: {
      valid: o.kind === 'good',
      retried: o.kind !== 'good',
      fellBackToReflex: o.kind === 'reflex',
      ...(o.kind === 'good' ? {} : { error: 'not-json: no JSON object anywhere in the reply' }),
    },
    parsedOutput: { goals: parsed.goals, plan: o.plan, utterances: parsed.utterances },
    resolvedOutput: { goals: parsed.goals, plan: o.plan, utterances: parsed.utterances },
    appliedTick: o.tick + 1,
    latencyMs: 900,
    scaffold: { ...SCAFFOLD },
  };
}

// ─── Independent near-duplicate verification ─────────────────────────────────

/** Its own tokenizer and shingler, so a bug in the curator's cannot hide here. */
function shinglesOf(text: string): number[] {
  const tokens = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const out = new Set<number>();
  for (let i = 0; i + 5 <= tokens.length; i++) {
    let h = 5381;
    for (let j = i; j < i + 5; j++) {
      const t = tokens[j]!;
      for (let k = 0; k < t.length; k++) h = (Math.imul(h, 33) ^ t.charCodeAt(k)) | 0;
      h = (Math.imul(h, 33) ^ 32) | 0;
    }
    out.add(h >>> 0);
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * Rows with a near twin, found exactly. Candidates come from bottom-k blocking
 * over the COMPLETION (a pair cannot reach 0.8 overall unless its completions
 * agree at 0.733, and two sets that alike miss all 8 of their smallest hashes
 * with vanishing probability), and every candidate is then decided by the exact
 * weighted score.
 */
function nearDuplicateRows(rows: Row[], threshold: number): number {
  const completions = rows.map((r) => shinglesOf(r.completion));
  const contexts = rows.map((r) => shinglesOf(r.user));
  const blocks = new Map<number, number[]>();
  for (let i = 0; i < completions.length; i++) {
    for (const h of completions[i]!.slice(0, 8)) {
      const bucket = blocks.get(h);
      if (bucket) bucket.push(i);
      else blocks.set(h, [i]);
    }
  }
  const flagged = new Set<number>();
  const checked = new Set<string>();
  for (const bucket of blocks.values()) {
    if (bucket.length < 2 || bucket.length > 400) continue;
    for (let a = 0; a < bucket.length; a++) {
      for (let b = a + 1; b < bucket.length; b++) {
        const key = `${bucket[a]}:${bucket[b]}`;
        if (checked.has(key)) continue;
        checked.add(key);
        if (weighted(bucket[a]!, bucket[b]!) >= threshold) {
          flagged.add(bucket[a]!);
          flagged.add(bucket[b]!);
        }
      }
    }
  }
  return flagged.size;

  function weighted(a: number, b: number): number {
    return (
      COMPLETION_WEIGHT * jaccard(completions[a]!, completions[b]!) +
      (1 - COMPLETION_WEIGHT) * jaccard(contexts[a]!, contexts[b]!)
    );
  }
}

function jaccard(a: number[], b: number[]): number {
  let i = 0;
  let j = 0;
  let shared = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      shared++;
      i++;
      j++;
    } else if (a[i]! < b[j]!) i++;
    else j++;
  }
  return shared / (a.length + b.length - shared);
}

/** An emitted row, split back into the two parts the curator compares. */
interface Row {
  user: string;
  completion: string;
}

function rowsOf(jsonl: string): Row[] {
  return jsonl
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const example = JSON.parse(line) as TrainingExample;
      return { user: example.messages[1]!.content, completion: example.messages[2]!.content };
    });
}

describe('curation on a 10k synthetic corpus', () => {
  const corpus = syntheticCorpus(10_000);
  const records = corpus.map((row) => row.record);
  const result = curateCorpus(records);
  const rows = rowsOf(result.jsonl);

  it('builds the corpus the acceptance criterion describes', () => {
    expect(records.length).toBe(10_800); // 10,000 acts + 4% exact + 4% near copies
    // The injected near copies really are near duplicates, by the exact
    // weighted score: an identical completion beside a one-token-nudged prompt.
    const near = corpus.filter((row) => row.record.id.startsWith('dup-near'));
    expect(near.length).toBeGreaterThan(300);
    for (const row of near.slice(0, 20)) {
      const original = corpus[row.copyOf!]!.record;
      const context = shingleJaccard(row.record.prompt.user, original.prompt.user);
      expect(context).toBeGreaterThanOrEqual(0.8);
      expect(context).toBeLessThan(1);
      const completion = shingleJaccard(row.record.attempts[0]!.raw, original.attempts[0]!.raw);
      expect(completion).toBe(1);
      expect(COMPLETION_WEIGHT * completion + (1 - COMPLETION_WEIGHT) * context).toBeGreaterThanOrEqual(0.8);
    }
  });

  it('retains more than 70% of unique acts', () => {
    expect(result.uniqueEligible).toBeGreaterThan(7000);
    expect(result.retainedOfUnique).toBeGreaterThan(0.7);
    expect(result.kept).toBe(rows.length);
  });

  it('holds the exact-duplicate rate under 0.5% and the near-duplicate rate under 2%', () => {
    const hashes = new Set(rows.map((r) => `${r.user}\n${r.completion}`));
    const exactRate = (rows.length - hashes.size) / rows.length;
    expect(exactRate).toBeLessThan(0.005);
    const nearRate = nearDuplicateRows(rows, 0.8) / rows.length;
    expect(nearRate).toBeLessThan(0.02);
  });

  it('holds no single plan shape above 10% of the output', () => {
    expect(result.topPlanShapeShare).toBeLessThanOrEqual(0.1);
    // …and did so by capping the commonest shape, not by emptying the set.
    expect(result.drops.overPlanShapeCap).toBeGreaterThan(0);
    expect(result.distinct.planShapes).toBeGreaterThan(30);
    // The cap reports what it did, and the request was actually met.
    expect(result.planShapeCap.satisfied).toBe(true);
    expect(result.planShapeCap.requestedShare).toBe(0.1);
    expect(result.planShapeCap.appliedCap).toBeGreaterThan(0);
    expect(result.planShapeCap.achievedShare).toBe(result.topPlanShapeShare);
  });

  it('never emits an invalid, reflex-fallback or unanswered row, and accounts for every input', () => {
    const drops = Object.values(result.drops).reduce((a, b) => a + b, 0);
    expect(result.kept + drops).toBe(result.input);
    expect(result.drops.reflexFallback).toBeGreaterThan(0);
    expect(result.drops.unanswered).toBeGreaterThan(0);
    expect(result.drops.invalid).toBeGreaterThan(0);
    // Every emitted line is a real (system, user, assistant) triple.
    for (const line of result.jsonl.split('\n').slice(0, 50)) {
      const example = JSON.parse(line) as TrainingExample;
      expect(example.messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant']);
      expect(() => JSON.parse(example.messages[2]!.content)).not.toThrow();
    }
  });

  it('spreads the output across runs, beings and need regimes', () => {
    expect(result.distinct.runs).toBe(3);
    expect(result.distinct.beings).toBeGreaterThan(100);
    const regimes = Object.values(result.byNeedRegime).filter((n) => n > 0);
    expect(regimes).toHaveLength(4);
  });

  it('is deterministic', () => {
    expect(curateCorpus(records).jsonl).toBe(result.jsonl);
  });
}, 180_000);

// ─── The plan-shape cap, including the shares it cannot reach ────────────────

/** A corpus with exactly the shape distribution asked for, and nothing else varying. */
function shapedCorpus(distribution: [IntentKind[], number][]): CognitionRecordV2[] {
  const out: CognitionRecordV2[] = [];
  let i = 0;
  for (const [shape, n] of distribution) {
    for (let k = 0; k < n; k++, i++) {
      const r = rng(0xbeef0000 + i * 7919);
      const plan: Intent[] = shape.map((kind) => intentOf(kind, r));
      const tick = 1000 + i * 13;
      const raw = JSON.stringify({ thought: `${pick(r, THOUGHTS)} (${i})`, goals: [], plan, utterances: [] });
      out.push(
        recordOf({
          runId: 'run-cap',
          beingId: 1800 + (i % 40),
          tick,
          user: userPrompt(r, tick),
          raw,
          plan,
          kind: 'good',
          needs: needsFor(r),
        }),
      );
    }
  }
  return out;
}

/** Balancing only: the other caps and dedupe are out of the way. */
const CAP_ONLY = { maxPerBucket: Number.MAX_SAFE_INTEGER, dedupe: false };

describe('the plan-shape cap', () => {
  const skewed: [IntentKind[], number][] = [[['MoveTo'], 60], [['Sleep'], 30], [['Eat'], 10]];

  it('applies the tightest cap when the requested share is unreachable', () => {
    // Three shapes: the best any cap can do is a third of the output, so 10% is
    // unsatisfiable. It must still balance — it used to give up and emit 60%.
    const result = curateCorpus(shapedCorpus(skewed), { ...CAP_ONLY, maxPlanShapeShare: 0.1 });
    expect(result.planShapeCap.satisfied).toBe(false);
    expect(result.planShapeCap.requestedShare).toBe(0.1);
    expect(result.planShapeCap.appliedCap).toBe(10);
    expect(result.kept).toBe(30);
    expect(result.drops.overPlanShapeCap).toBe(70);
    expect(result.topPlanShapeShare).toBeCloseTo(1 / 3, 4);
    expect(result.planShapeCap.achievedShare).toBe(result.topPlanShapeShare);
  });

  for (const share of [0, 0.01]) {
    it(`does not disable itself when asked for a stricter share (${share})`, () => {
      const result = curateCorpus(shapedCorpus(skewed), { ...CAP_ONLY, maxPlanShapeShare: share });
      expect(result.planShapeCap.satisfied).toBe(false);
      expect(result.planShapeCap.requestedShare).toBe(share);
      expect(result.planShapeCap.appliedCap).toBe(10);
      expect(result.topPlanShapeShare).toBeCloseTo(1 / 3, 4);
      expect(result.kept).toBe(30); // stricter, not emptied
    });
  }

  it('honours a satisfiable share and says so', () => {
    const shapes: [IntentKind[], number][] = [
      [['MoveTo'], 200],
      ...TAIL.slice(0, 11).map((shape) => [shape, 10] as [IntentKind[], number]),
    ];
    const result = curateCorpus(shapedCorpus(shapes), { ...CAP_ONLY, maxPlanShapeShare: 0.1 });
    expect(result.planShapeCap.satisfied).toBe(true);
    expect(result.planShapeCap.appliedCap).toBe(12);
    expect(result.kept).toBe(122); // 12 of the commonest + 11 × 10
    expect(result.topPlanShapeShare).toBeLessThanOrEqual(0.1);
    expect(result.planShapeCap.achievedShare).toBe(result.topPlanShapeShare);
  });

  it('reports honestly when a corpus has only one behaviour to balance', () => {
    const result = curateCorpus(shapedCorpus([[['Idle'], 40]]), { ...CAP_ONLY, maxPlanShapeShare: 0.1 });
    expect(result.planShapeCap.satisfied).toBe(false);
    expect(result.planShapeCap.appliedCap).toBeNull();
    expect(result.planShapeCap.achievedShare).toBe(1);
    expect(result.kept).toBe(40);
    expect(result.drops.overPlanShapeCap).toBe(0);
  });

  it('accounts for every input row whatever the cap did', () => {
    for (const share of [0, 0.01, 0.1, 0.5, 1]) {
      const result = curateCorpus(shapedCorpus(skewed), { ...CAP_ONLY, maxPlanShapeShare: share });
      const drops = Object.values(result.drops).reduce((a, b) => a + b, 0);
      expect(result.kept + drops).toBe(result.input);
    }
  });
});
