import { describe, expect, it } from 'vitest';
import { buildThinkPrompt } from '../src/consciousness/prompt.js';
import { foragerAdapter } from '../src/worlds/forager/adapter.js';
import {
  NEAR_DUPLICATE_COMPLETION_WEIGHT,
  NearDuplicateIndex,
  contentHash,
  shingleJaccard,
} from '../src/training/dedupe.js';
import type { ContextFeatures, Needs } from '../src/worlds/forager/types.js';
import type {
  KnowledgeRecord,
  KnownPerson,
  KnownStory,
  MemoryRecord,
  ThinkInput,
} from '../src/contract/types.js';

/**
 * The near-duplicate filter, measured on the prompts the engine actually
 * sends — not on toy strings.
 *
 * The defect this file exists to pin (T1 review §C3): the similarity document
 * used to be `user prompt + completion`, so the ~1.5 KB of shared instruction
 * boilerplate in every prompt dominated the shingles. Three UNRELATED acts
 * scored J = 0.768 / 0.793 / 0.791 against a 0.80 threshold; a populated
 * being's 3–4 KB prompt crosses it and merges acts that have nothing to do
 * with each other.
 */

// ─── Realistic fixtures ──────────────────────────────────────────────────────

const CTX: ContextFeatures = { nearWater: true, night: false, inShelter: false, elevationBand: 1 };

const NAMES = [
  'Tarem', 'Ishku', 'Navel', 'Orith', 'Sabek', 'Lumei', 'Kadran', 'Yevi', 'Threnn', 'Ovak',
  'Marek', 'Sunda', 'Belor', 'Ainu', 'Corvan', 'Delith', 'Ferrow', 'Galen', 'Huln', 'Imra',
  'Jorek', 'Kessa', 'Loam', 'Muri',
];

const STATEMENTS = [
  'Gathering succeeds (berry) happens mostly near water',
  'Eating eases hunger',
  'Sleeping in the open worsens safety',
  'Gathering fails (berry) happens mostly at night',
  'Eating (mushroomRed) is followed by becoming sick',
  'Drinking eases hunger',
  'Building eases safety',
  'Sleeping safely happens mostly in shelter',
  'Gathering succeeds (wood) happens mostly in the highlands',
  'A spear can be made by working wood and stone together',
  'Gathering succeeds (tuber) happens mostly near water',
  'Death happens mostly at night',
  'Gathering succeeds (clay) happens mostly near water',
  'Being attacked worsens safety',
  'A rope can be made by working 3 fiber together',
  'Finding resources rarely happens at night',
  'Suffering from exposure worsens safety',
  'Gathering succeeds (stone) happens mostly in the highlands',
  'Drinking rarely happens in the highlands',
  'A brick can be made by working 2 clay together',
  'Sleeping safely eases rest',
  'Eating (nightshade) is followed by becoming sick',
  'Gathering succeeds (fiber) happens mostly near water',
  'A handaxe can be made by working stone and wood together',
];

const MEMORY_LINES = [
  'I gathered berries by the wide river and my hunger eased',
  'I ate a red mushroom at the treeline and was sick for days',
  'I slept on the open plain and woke cold and watchful',
  'I saw one I did not know walking the lake shore at dusk',
  'I watched one I had known die in the deep wood',
  'I gave wood to another and they gave nothing back',
  'I built a roof at the foot of the hill before the rain',
  'I worked stone against wood and something came of it',
  'I found a stand of tubers in the high rocks',
  'I drank at the tributary where the water runs fast',
  'I reached for a bush that had already been picked clean',
  'I slept under a roof and woke strong',
  'A beast came at me out of the deep forest and I ran',
  'I fought the beast at the treeline and it left me',
  'A child was born to us in the warm season',
  'I spoke to one who listened and said nothing back',
  'I put what I carried in the ground where I could find it',
  'I put a seed in soft ground and did not see what came of it',
  'A plant stood where none had stood before',
  'I came back from the sickness after many days',
  'The cold got into me on the ridge and would not leave',
  'One I had trusted struck me near the water',
  'I killed the beast at the treeline and took what it had',
  'I took back what I had stored and it was still good',
];

const STORY_LINES = [
  'In the time before, one walked east until the ground rose and found water there that never failed',
  'One among us kept giving when there was nothing left and the people lived through the cold',
  'A child went into the deep wood after the beast and did not come out of it',
  'The old ones say the high rocks were split by something falling out of the sky',
  'One made a thing from stone and wood that no one had made before and showed it to the rest',
  'They tell of a season when nothing grew and the people went to the water and stayed there',
  'One spoke against the rest and walked away alone and was never spoken of again',
  'The first of us woke by the river with no name and chose one',
];

const FEELINGS = [
  'you trust them',
  'you have long kept their company',
  'you are wary of them',
  'you owe them and they know it',
  'they frighten you a little',
  'you have shared food with them many times',
  'you do not understand them',
  'you would follow them',
];

const THOUGHTS = [
  'The bushes by the water were full when I passed them and I will go back before the light goes.',
  'I am tired and the ground here is hard and I would rather be under a roof.',
  'My child went ahead of me and I do not see her now and that sits badly with me.',
  'I have carried this too long and it is heavy and no use to me where I stand.',
  'The cold gets into me at night and I sleep badly and wake no stronger.',
  'Someone here knows more than I do about the water and I mean to ask.',
  'The rocks above are hard to reach but I have seen others go up and come back.',
  'I gathered more than I need and I do not know what to do with it yet.',
  'The story says a great thing happened here and I want to stand where it happened.',
  'I have not spoken to anyone since the dark and it is beginning to tell on me.',
  'The wood here is wet and no use to me and I will look further along the ridge.',
  'Something moved in the trees and I did not stay to see what it was.',
];

const GOAL_LINES = [
  'find food and eat', 'get to shelter before dark', 'find water', 'ask the one who knows about the water',
  'go back to the place from the tale', 'work what I carry into a tool', 'keep close to my child',
  'see what lies beyond the ridge', 'rest until I am strong', 'put what I gathered somewhere safe',
];

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
  let guard = 0;
  while (taken.size < Math.min(n, pool.length) && guard++ < 200) taken.add(Math.floor(r() * pool.length) % pool.length);
  return [...taken].map((i) => pool[i]!);
}

function knowledgeOf(r: () => number, n: number): KnowledgeRecord[] {
  return sample(r, STATEMENTS, n).map((statement, i) => ({
    id: 100 + Math.floor(r() * 800),
    ruleKey: `rule-${i}`,
    rule: { kind: 'outcome-association', actionType: 'AteFood', feature: null, need: 'hunger', direction: 'relieves' },
    statement,
    confidence: 0.55 + r() * 0.44,
    evidenceCount: 1 + Math.floor(r() * 40),
    contradictionCount: 0,
    sourceMemoryIds: [],
    status: 'held',
    origin: r() < 0.3 ? 'testimony' : 'experience',
    firstFormed: 1000,
    lastReinforced: 2000,
  }));
}

function memoriesOf(r: () => number, n: number): MemoryRecord[] {
  return sample(r, MEMORY_LINES, n).map((summaryText, i) => ({
    id: 500 + i,
    tick: 2000 + Math.floor(r() * 500),
    type: 'GatherSucceeded',
    subjects: [],
    context: CTX,
    needDeltas: { hunger: -8 },
    outcome: 'success',
    summaryText,
    importance: r(),
    origin: 'experience',
  }));
}

/**
 * `sparse` renders at ~1.5 KB — the size the reviewer measured at J≈0.79.
 * `populated` is what a being with a life behind it actually sends: 8 memories,
 * 12 knowledge lines, stories, kin, the most-told tale, people it knows.
 */
function realisticInput(seed: number, scale: 'sparse' | 'populated'): ThinkInput {
  const r = rng(seed);
  const populated = scale === 'populated';
  const stories: KnownStory[] = populated
    ? sample(r, STORY_LINES, 4).map((text, i) => ({ id: `nar-${seed}-${i}`, text, firsthand: r() < 0.4 }))
    : [];
  const social: KnownPerson[] = populated
    ? sample(r, NAMES, 6).map((name) => ({ name, feeling: pick(r, FEELINGS) }))
    : [];
  return {
    snapshot: {
      id: 1000 + (seed % 900),
      name: pick(r, NAMES),
      ageTicks: 4000 + Math.floor(r() * 40000),
      traits: {
        curiosity: Math.round(r() * 100),
        aggression: Math.round(r() * 100),
        compassion: Math.round(r() * 100),
        ambition: Math.round(r() * 100),
        loyalty: Math.round(r() * 100),
        riskTolerance: Math.round(r() * 100),
      },
      needs: {
        hunger: Math.round(r() * 100),
        rest: Math.round(r() * 100),
        safety: Math.round(r() * 80),
        socialConnection: Math.round(r() * 90),
      },
      health: Math.round(50 + r() * 50),
      sick: r() < 0.15,
      x: Math.round(r() * 800),
      y: Math.round(r() * 800),
      inventory: populated
        ? { berry: 1 + Math.floor(r() * 5), wood: 1 + Math.floor(r() * 4), stone: 1 + Math.floor(r() * 3) }
        : { berry: 1 + Math.floor(r() * 3) },
      context: CTX,
    },
    recalledMemories: populated ? memoriesOf(r, 8) : [],
    knowledge: knowledgeOf(r, populated ? 12 : 3),
    relationships: new Map(),
    worldView: {
      tick: 3000 + Math.floor(r() * 5000),
      night: r() < 0.4,
      season: pick(r, ['spring', 'summer', 'autumn', 'winter'] as const),
      agents: populated
        ? Array.from({ length: 4 }, () => ({ id: 1000 + Math.floor(r() * 900), x: r() * 800, y: r() * 800 }))
        : [],
      resources: Array.from({ length: populated ? 6 : 2 }, () => ({
        id: Math.floor(r() * 9000),
        kind: pick(r, ['berryBush', 'tree', 'stoneDeposit', 'waterSource', 'tuberPlant'] as const),
        x: r() * 800,
        y: r() * 800,
        stock: 1 + Math.floor(r() * 9),
      })),
      structures: populated
        ? [{ id: 7, kind: 'shelter' as const, x: r() * 800, y: r() * 800 }]
        : [],
    },
    goals: sample(r, GOAL_LINES, populated ? 3 : 1).map((description, i) => ({
      id: i,
      description,
      createdTick: 2500,
    })),
    trigger: pick(r, ['periodic', 'planCompleted', 'needCritical', 'conversation'] as const),
    ...(populated
      ? {
          stories,
          mostTold: pick(r, STORY_LINES),
          kin: [
            { name: pick(r, NAMES), relation: 'parent' as const },
            { name: pick(r, NAMES), relation: 'child' as const },
          ],
          social,
          sacredPlace: { x: r() * 800, y: r() * 800 },
        }
      : {}),
  };
}

/** A completion shaped like the ones the parser actually accepts. */
function realisticCompletion(seed: number): string {
  const r = rng(seed ^ 0x5bf03635);
  const kinds = ['MoveTo', 'Gather', 'Eat', 'Sleep', 'Build', 'Speak', 'Craft', 'Follow'] as const;
  const kind = pick(r, [...kinds]);
  const intent =
    kind === 'MoveTo'
      ? { kind, x: Math.round(r() * 800), y: Math.round(r() * 800) }
      : kind === 'Eat'
        ? { kind, objectKind: pick(r, ['berry', 'tuber', 'meat']) }
        : kind === 'Sleep'
          ? { kind, durationTicks: 20 + Math.floor(r() * 200) }
          : { kind, targetId: 1000 + Math.floor(r() * 900) };
  return JSON.stringify({
    thought: pick(r, THOUGHTS),
    goals: sample(r, GOAL_LINES, 2).map((description) => ({ description, need: null })),
    plan: [intent],
    utterances: r() < 0.35 ? [{ targetId: null, speechAct: 'request', text: pick(r, THOUGHTS) }] : [],
  });
}

interface Row {
  user: string;
  completion: string;
}

function realisticRows(scale: 'sparse' | 'populated', n: number): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    user: buildThinkPrompt(realisticInput(0x1234 + i * 977, scale), foragerAdapter).user,
    completion: realisticCompletion(0x1234 + i * 977),
  }));
}

/**
 * The adversarial case the reviewer measured: ONE situation, unrelated answers.
 * Two beings in the same state early in a run, or one being thinking twice at
 * the same place, send near-identical prompts — so a similarity that counts
 * prompt tokens is measuring the boilerplate, not the act.
 */
function sameSituationRows(scale: 'sparse' | 'populated', n: number): Row[] {
  const user = buildThinkPrompt(realisticInput(0x9001, scale), foragerAdapter).user;
  return Array.from({ length: n }, (_, i) => ({ user, completion: realisticCompletion(0x4400 + i * 131) }));
}

/** The same being a few ticks later: a handful of numbers move, nothing else. */
function nearSituationRows(scale: 'sparse' | 'populated', n: number): Row[] {
  const base = realisticInput(0x9001, scale);
  // A snapshot carries one pressure per DRIVE the world declares; this fixture
  // is the forager world's, whose four are always there.
  const needs = base.snapshot.needs as Needs;
  return Array.from({ length: n }, (_, i) => {
    const input: ThinkInput = {
      ...base,
      snapshot: {
        ...base.snapshot,
        needs: { ...needs, hunger: needs.hunger + i, rest: needs.rest + i },
      },
      worldView: { ...base.worldView, tick: base.worldView.tick + i * 7 },
    };
    return { user: buildThinkPrompt(input, foragerAdapter).user, completion: realisticCompletion(0x4400 + i * 131) };
  });
}

/** The OLD similarity definition: one document of prompt + completion. */
function concatenatedJaccard(a: Row, b: Row): number {
  return shingleJaccard(`${a.user}\n${a.completion}`, `${b.user}\n${b.completion}`);
}

/** The definition the index now uses, computed here from the exact Jaccards. */
function weightedJaccard(a: Row, b: Row): number {
  const w = NEAR_DUPLICATE_COMPLETION_WEIGHT;
  return w * shingleJaccard(a.completion, b.completion) + (1 - w) * shingleJaccard(a.user, b.user);
}

function distribution(rows: Row[], score: (a: Row, b: Row) => number): { min: number; median: number; max: number } {
  const all: number[] = [];
  for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) all.push(score(rows[i]!, rows[j]!));
  all.sort((x, y) => x - y);
  return { min: all[0]!, median: all[all.length >> 1]!, max: all[all.length - 1]! };
}

// ─── C3: shared boilerplate must not merge unrelated acts ────────────────────

describe('near-duplicate similarity on real prompts', () => {
  const sparse = realisticRows('sparse', 24);
  const populated = realisticRows('populated', 24);

  const sameSparse = sameSituationRows('sparse', 24);
  const samePopulated = sameSituationRows('populated', 24);
  const nearPopulated = nearSituationRows('populated', 24);
  const sets: [string, Row[]][] = [
    ['independent/sparse', sparse],
    ['independent/populated', populated],
    ['same-situation/sparse', sameSparse],
    ['same-situation/populated', samePopulated],
    ['near-situation/sparse', nearSituationRows('sparse', 24)],
    ['near-situation/populated', nearPopulated],
  ];

  it('renders prompts the size a real being sends', () => {
    expect(sparse[0]!.user.length).toBeGreaterThan(1100);
    expect(sparse[0]!.user.length).toBeLessThan(1600);
    expect(populated[0]!.user.length).toBeGreaterThan(3000);
    expect(populated[0]!.user.length).toBeLessThan(4200);
    expect(samePopulated[0]!.completion.length).toBeGreaterThan(150);
  });

  /**
   * The defect, measured over all 276 unrelated pairs per set (min/median/max
   * of the exact Jaccard of the concatenated `user + completion` document —
   * the definition the curator shipped with):
   *
   *   independent/sparse       0.302 / 0.356 / 0.501
   *   independent/populated    0.167 / 0.216 / 0.280
   *   same-situation/sparse    0.637 / 0.712 / 0.923   (1293-byte prompt)
   *   same-situation/populated 0.837 / 0.876 / 0.970   (3721-byte prompt)
   *   near-situation/populated 0.821 / 0.859 / 0.950
   *
   * At the populated size EVERY unrelated pair clears the 0.80 threshold, so
   * one being's whole day of thinking would have curated down to a single row.
   */
  it('shows the concatenated document merging unrelated acts at real prompt sizes', () => {
    const sparseSame = distribution(sameSparse, concatenatedJaccard);
    expect(sparseSame.max).toBeGreaterThan(0.8); // the reviewer's 0.79, reproduced
    const populatedSame = distribution(samePopulated, concatenatedJaccard);
    expect(populatedSame.min).toBeGreaterThan(0.8); // …and at 3.7 KB, all of them
    const populatedNear = distribution(nearPopulated, concatenatedJaccard);
    expect(populatedNear.min).toBeGreaterThan(0.8);
  });

  /**
   * The same pairs under the definition the index now uses:
   *
   *   independent/sparse       0.099 / 0.135 / 0.508
   *   independent/populated    0.045 / 0.083 / 0.444
   *   same-situation/sparse    0.250 / 0.277 / 0.691
   *   same-situation/populated 0.250 / 0.277 / 0.691
   *   near-situation/populated 0.245 / 0.271 / 0.686
   *
   * The 0.250 floor is the arithmetic: identical prompts, unrelated answers ⇒
   * 0.75 × 0 + 0.25 × 1. The 0.691 tail is a pair whose ANSWERS really do
   * overlap (same opening thought, same goals) — which is the thing the filter
   * is supposed to notice.
   */
  it('leaves real headroom under the threshold for every unrelated pair', () => {
    for (const [label, rows] of sets) {
      const d = distribution(rows, weightedJaccard);
      expect(d.max, label).toBeLessThan(0.72);
      expect(d.median, label).toBeLessThan(0.35);
    }
  });

  it('admits every unrelated act even when the prompts are identical', () => {
    for (const [label, rows] of sets) {
      const index = new NearDuplicateIndex();
      for (const row of rows) expect(index.admit(row), label).toBe(true);
      expect(index.size, label).toBe(rows.length);
    }
  });

  it('still catches a true near duplicate: same answer, one token moved in the prompt', () => {
    const index = new NearDuplicateIndex();
    for (const row of samePopulated.slice(0, 8)) expect(index.admit(row)).toBe(true);
    const original = samePopulated[3]!;
    const twin: Row = { user: original.user.replace('hunger', 'hungerr'), completion: original.completion };
    // Not an exact duplicate, so the content hash upstream would not catch it.
    expect(contentHash(`${twin.user}\n${twin.completion}`)).not.toBe(
      contentHash(`${original.user}\n${original.completion}`),
    );
    expect(weightedJaccard(original, twin)).toBeGreaterThan(0.95);
    expect(index.admit(twin)).toBe(false);
  });

  it('keeps the first of a cluster and is order-deterministic', () => {
    const row = samePopulated[0]!;
    const twin: Row = { ...row, user: row.user.replace('hunger', 'hungerr') };
    const forward = new NearDuplicateIndex();
    expect(forward.admit(row)).toBe(true);
    expect(forward.admit(twin)).toBe(false);
    const backward = new NearDuplicateIndex();
    expect(backward.admit(twin)).toBe(true);
    expect(backward.admit(row)).toBe(false);
  });

  it('pins the weight the independent verification in curation.test.ts assumes', () => {
    expect(NEAR_DUPLICATE_COMPLETION_WEIGHT).toBe(0.75);
    // A pair cannot reach a 0.8 threshold unless the ANSWERS agree this well,
    // however identical the prompts are.
    expect((0.8 - (1 - NEAR_DUPLICATE_COMPLETION_WEIGHT)) / NEAR_DUPLICATE_COMPLETION_WEIGHT).toBeCloseTo(0.7333, 4);
  });

  it('still works as a single-string filter', () => {
    const index = new NearDuplicateIndex();
    const a = 'the bushes by the water were full when i passed them and i will go back before the light goes';
    expect(index.admit(a)).toBe(true);
    expect(index.admit(`${a} today`)).toBe(false); // near twin of a
    expect(index.admit('i am tired and the ground here is hard and i would rather be under a roof')).toBe(true);
    expect(index.size).toBe(2);
  });
});

// ─── C1: text the old tokenizer could not read at all ────────────────────────

/**
 * An independent 5-token shingler, to check that the ASCII path is unchanged.
 * Set-of-windows is hash-independent, so the Jaccard it computes must equal
 * `shingleJaccard`'s exactly on ASCII.
 */
function referenceJaccard(a: string, b: string): number {
  const windows = (text: string): Set<string> => {
    const tokens = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    const out = new Set<string>();
    if (tokens.length === 0) return out;
    if (tokens.length < 5) {
      for (const t of tokens) out.add(t);
      return out;
    }
    for (let i = 0; i + 5 <= tokens.length; i++) out.add(tokens.slice(i, i + 5).join(' '));
    return out;
  };
  const sa = windows(a);
  const sb = windows(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let shared = 0;
  for (const s of sa) if (sb.has(s)) shared++;
  return shared / (sa.size + sb.size - shared);
}

const JP_A = '私は川のそばで実を集めた。空腹は和らいだが、夜が近づいているので家に帰ることにした。';
/** A document the length of a real corpus row, not a toy sentence. */
const JP_LONG =
  '私は川のそばで実を集めた。空腹は和らいだが、夜が近づいているので家に帰ることにした。' +
  '途中で誰にも会わなかった。高い岩の上に登れば遠くまで見えるという話を聞いたことがあるが、まだ行ったことはない。';
const JP_B = '山の高いところで石を見つけた。重かったので、ひとつだけ持って戻った。誰にも会わなかった。';
const ZH_A = '我在河边采到了浆果，饥饿缓解了，但天色已晚，我决定回去。';
const ZH_B = '我在高山上找到了石头，它很重，所以我只带了一块回来。';
const TH_A = 'ฉันเก็บผลไม้ริมแม่น้ำและความหิวก็บรรเทาลงแต่ค่ำแล้วจึงตัดสินใจกลับ';
const EMOJI_A = '🙂🌊🍓🌲🔥🏠🌙⛰️🐟🪵';
const EMOJI_B = '😠🌋🥩🦴🪨🕳️☄️🐺🦌🩸';
const PUNCT_A = '!!! ... ??? --- ,,,';
const PUNCT_B = '*** ;;; ::: ~~~ ###';

describe('unicode tokenisation', () => {
  it('keeps distinct non-ASCII documents distinct', () => {
    // Every one of these scored 1.0 before: an empty shingle set on both sides.
    const pairs: [string, string][] = [
      [JP_A, JP_B],
      [ZH_A, ZH_B],
      [JP_A, ZH_A],
      [JP_A, PUNCT_A],
      [EMOJI_A, EMOJI_B],
      [PUNCT_A, PUNCT_B],
      [JP_A, EMOJI_A],
    ];
    for (const [a, b] of pairs) {
      expect(shingleJaccard(a, b), `${a} vs ${b}`).toBeLessThan(0.8);
    }
  });

  it('admits every non-ASCII document the index cannot read, rather than eating it', () => {
    const index = new NearDuplicateIndex();
    const documents = [JP_A, JP_B, ZH_A, ZH_B, TH_A, EMOJI_A, EMOJI_B, PUNCT_A, PUNCT_B, '—', '。', ''];
    for (const d of documents) expect(index.admit(d), d).toBe(true);
    expect(index.size).toBe(documents.length);
  });

  it('treats an unreadable text as no evidence, not as identity', () => {
    expect(shingleJaccard(PUNCT_A, PUNCT_B)).toBe(0);
    expect(shingleJaccard('', '')).toBe(0);
    expect(shingleJaccard(PUNCT_A, PUNCT_A)).toBe(0); // identical is contentHash's job
    expect(contentHash(PUNCT_A)).toBe(contentHash(PUNCT_A));
  });

  it('still catches a true near duplicate in a space-free script', () => {
    // At a document length a corpus row actually has (91 tokens), one changed
    // character costs the 5 shingles it sits in: J = 82/92 = 0.891.
    const twin = `${JP_LONG.slice(0, 20)}山${JP_LONG.slice(21)}`;
    expect(twin).not.toBe(JP_LONG);
    expect(shingleJaccard(JP_LONG, twin)).toBeGreaterThan(0.8);
    const index = new NearDuplicateIndex();
    expect(index.admit(JP_LONG)).toBe(true);
    expect(index.admit(twin)).toBe(false);
    // Character shingles mean a SHORT document is not a near duplicate on one
    // changed character, exactly as a short English one is not: 35 shingles,
    // 5 of them moved ⇒ 0.75. The scale is the same in both scripts.
    expect(shingleJaccard(JP_A, `${JP_A.slice(0, 20)}山${JP_A.slice(21)}`)).toBeCloseTo(0.75, 2);
    expect(shingleJaccard(ZH_A, ZH_A.replace('浆果', '石头'))).toBeGreaterThan(0.5);
    expect(shingleJaccard(ZH_A, ZH_B)).toBeLessThan(0.2);
  });

  it('reads mixed-script and accented text as one token stream', () => {
    const mixedA = 'I went to 川 and gathered 実, then walked home before dark and slept well';
    const mixedB = 'I went to 山 and gathered 石, then walked home before dark and slept well';
    expect(shingleJaccard(mixedA, mixedA)).toBe(1);
    expect(shingleJaccard(mixedA, mixedB)).toBeGreaterThan(0.15); // two of 15 tokens moved
    expect(shingleJaccard(mixedA, mixedB)).toBeLessThan(0.5);
    // Composed and decomposed spellings of the same words are the same text.
    const nfc = 'la forêt où le café était très chaud et la crème épaisse';
    expect(shingleJaccard(nfc, nfc.normalize('NFD'))).toBe(1);
    // …but a diacritic is not silently folded away.
    expect(shingleJaccard(nfc, nfc.replace(/[êûéè]/g, 'e'))).toBeLessThan(1);
  });

  it('leaves the ASCII tokenisation exactly as it was', () => {
    const rows = realisticRows('populated', 6);
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        expect(shingleJaccard(rows[i]!.user, rows[j]!.user)).toBeCloseTo(
          referenceJaccard(rows[i]!.user, rows[j]!.user),
          12,
        );
      }
    }
    const r = rng(0x515c11);
    for (let n = 0; n < 200; n++) {
      const a = Array.from({ length: 60 }, () => String.fromCharCode(32 + Math.floor(r() * 95))).join('');
      const b = Array.from({ length: 60 }, () => String.fromCharCode(32 + Math.floor(r() * 95))).join('');
      expect(shingleJaccard(a, b)).toBeCloseTo(referenceJaccard(a, b), 12);
    }
  });
});
