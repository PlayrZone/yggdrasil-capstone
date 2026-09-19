import { describe, expect, it } from 'vitest';
import { CRAFT_RECIPES } from '../src/body/index.js';
import {
  NODE_YIELD,
  NUTRITIOUS_FOODS,
  SICKENING_FOODS,
  actionForCore,
  actionVocabulary,
  checkIntent,
  foragerAdapter,
  kindsFor,
  kindsWithTag,
  planArguments,
} from '../src/index.js';
import type { CoreVerb, Intent, KindParam } from '../src/index.js';
import { toyWorld } from './fixtures/toyAdapter.js';
import {
  WAS_ARG_ORDER,
  WAS_BUILD_KIND_LIST,
  WAS_GOAL_NEEDS,
  WAS_INTENT_KINDS,
  WAS_INTENT_VOCAB,
  WAS_OBJECT_KIND_LIST,
  wasBuildKindHint,
} from './fixtures/foragerVerbsBefore.js';

/**
 * W1-B3 MOVED THE VERBS AND THE STUFF; IT DID NOT REWRITE THEM.
 *
 * `fixtures/foragerVerbsBefore.ts` holds the four closed lists and the prompt's
 * verb line as they stood in `consciousness/{schema,prompt}.ts` the moment
 * before. This file checks the adapter reproduces every one — ids, order,
 * argument names, refusal clauses — and that the tags are the sets this engine
 * already keeps rather than a taxonomy someone invented here.
 *
 * It exists because the goldens cannot see most of it. A reflex being never
 * digs, never withdraws and never consults the slow mind, so `Withdraw`'s
 * arguments and the `bad-arg` clauses pass through 3,000 golden ticks
 * untouched: a transcription error in any of them would be invisible.
 */

describe('the forager verbs, as they stood before the move', () => {
  it('declares every action the world had, in the same order, and no others', () => {
    expect(foragerAdapter.actions.map((a) => a.id)).toEqual(WAS_INTENT_KINDS);
    expect(foragerAdapter.actionById.size).toBe(WAS_INTENT_KINDS.length);
  });

  it('renders the prompt’s verb line byte for byte', () => {
    expect(actionVocabulary(foragerAdapter)).toBe(WAS_INTENT_VOCAB);
  });

  it('binds each verb to a core verb, and uses every one of the twelve', () => {
    expect(foragerAdapter.actions.map((a) => [a.id, a.core])).toEqual([
      ['MoveTo', 'Move'],
      ['Gather', 'Take'],
      ['Dig', 'Take'],
      ['Eat', 'Use'],
      ['Drink', 'Use'],
      ['Sleep', 'Rest'],
      ['Build', 'Build'],
      ['Deposit', 'Give'],
      ['Withdraw', 'Take'],
      ['Give', 'Give'],
      ['Attack', 'Contest'],
      ['Craft', 'Combine'],
      ['Speak', 'Say'],
      ['Follow', 'Attend'],
      ['Flee', 'Flee'],
      ['Idle', 'Wait'],
    ]);
    const CORE: readonly CoreVerb[] = [
      'Move', 'Take', 'Use', 'Combine', 'Give', 'Say', 'Attend', 'Rest', 'Build', 'Contest', 'Flee', 'Wait',
    ];
    for (const core of CORE) expect(actionForCore(foragerAdapter, core), core).toBeDefined();
  });

  /** Exactly what `YggdrasilSystem`'s switch reads for each act. */
  it('gives each verb the arguments the body reads for it', () => {
    const shapes = Object.fromEntries(
      foragerAdapter.actions.map((a) => [a.id, a.params.map((p) => `${p.id}:${p.type}`)]),
    );
    expect(shapes).toEqual({
      MoveTo: ['x:number', 'y:number', 'targetId:ref'],
      Gather: ['targetId:ref'],
      Dig: [],
      Eat: ['objectKind:kind'],
      Drink: [],
      Sleep: ['durationTicks:duration'],
      Build: ['buildKind:kind', 'x:number', 'y:number'],
      Deposit: ['objectKind:kind', 'targetId:ref'],
      Withdraw: ['objectKind:kind', 'targetId:ref'],
      Give: ['targetId:ref', 'objectKind:kind'],
      Attack: ['targetId:ref'],
      Craft: [],
      Speak: ['utterance:speech'],
      Follow: ['targetId:ref'],
      Flee: ['x:number', 'y:number'],
      Idle: ['durationTicks:duration'],
    });
  });

  /**
   * This world's body answers for an act it cannot perform, and that refusal is
   * an event beings remember — so nothing is required at the edge and nothing
   * is bounded there. Both are declared truthfully, not left off the type.
   */
  it('marks nothing required and bounds nothing, because the body answers', () => {
    for (const action of foragerAdapter.actions) {
      for (const param of action.params) {
        expect(param.required, `${action.id}.${param.id}`).toBeUndefined();
        if (param.type === 'number' || param.type === 'duration') {
          expect([param.min, param.max], `${action.id}.${param.id}`).toEqual([undefined, undefined]);
        }
      }
    }
  });

  it('reads an intent’s arguments in the order the parser read them', () => {
    expect(planArguments(foragerAdapter).map((p) => p.id)).toEqual(WAS_ARG_ORDER);
  });

  it('draws each enumerated argument from exactly the old closed list', () => {
    const objectKind = param('Eat', 'objectKind');
    const buildKind = param('Build', 'buildKind');
    expect(kindsFor(foragerAdapter, objectKind)).toEqual(WAS_OBJECT_KIND_LIST);
    expect(kindsFor(foragerAdapter, buildKind)).toEqual(WAS_BUILD_KIND_LIST);
    expect(foragerAdapter.drives.map((d) => d.id)).toEqual(WAS_GOAL_NEEDS);
    // The refusal clause is data, so it is pinned against the list it names —
    // a fourth structure would otherwise leave the sentence saying three.
    expect(buildKind.hint).toBe(wasBuildKindHint('').trim());
    expect(buildKind.hint).toBe(`builds one of ${kindsWithTag(foragerAdapter, 'structure').join(', ')}`);
    expect(objectKind.hint).toBe('takes one of the kinds the world is made of');
  });
});

describe('the kinds are the sets this engine already kept', () => {
  // THIRTY-FIVE, not the 34 the brief says: `ObjectKind` and the parser's old
  // `OBJECT_KIND_LIST` both hold 35 members. Counted here so the number in the
  // repo is the one the code has, rather than the one the plan remembered.
  it('declares the 35 things and the 20 sources, each in its own order', () => {
    expect(kindsWithTag(foragerAdapter, 'object')).toEqual(WAS_OBJECT_KIND_LIST);
    expect(WAS_OBJECT_KIND_LIST).toHaveLength(35);
    expect(kindsWithTag(foragerAdapter, 'source')).toEqual(Object.keys(NODE_YIELD));
    expect(foragerAdapter.kinds).toHaveLength(35 + 20);
    expect(foragerAdapter.kindById.size).toBe(35 + 20);
    // Nothing is both, so the two vocabularies stayed apart in the move.
    for (const kind of foragerAdapter.kinds) {
      expect(kind.tags.includes('object') && kind.tags.includes('source'), kind.id).toBe(false);
    }
  });

  it('tags food the way the body does', () => {
    expect(kindsWithTag(foragerAdapter, 'nourishing')).toEqual([...NUTRITIOUS_FOODS]);
    expect(kindsWithTag(foragerAdapter, 'sickening')).toEqual([...SICKENING_FOODS]);
  });

  it('tags making the way the recipes do', () => {
    const inputs = new Set(CRAFT_RECIPES.flatMap((r) => Object.keys(r.inputs)));
    const outputs = new Set(CRAFT_RECIPES.map((r) => r.output));
    expect(new Set(kindsWithTag(foragerAdapter, 'material'))).toEqual(inputs);
    expect(new Set(kindsWithTag(foragerAdapter, 'tool'))).toEqual(outputs);
  });

  it('tags a food source as one whose yield can be eaten', () => {
    const edible = new Set(kindsWithTag(foragerAdapter, 'edible'));
    const yieldsFood = Object.entries(NODE_YIELD)
      .filter(([, yielded]) => edible.has(yielded))
      .map(([node]) => node);
    expect(kindsWithTag(foragerAdapter, 'foodSource')).toEqual(yieldsFood);
  });

  it('tags what can be built and what can be dug', () => {
    expect(kindsWithTag(foragerAdapter, 'structure')).toEqual(WAS_BUILD_KIND_LIST);
    expect(kindsWithTag(foragerAdapter, 'container')).toEqual(['container']);
    // What `Dig` puts in your hands: clay by water, stone elsewhere.
    expect(kindsWithTag(foragerAdapter, 'diggable')).toEqual(['stone', 'clay']);
    // What a being will TRY to eat is not what feeds it: meat nourishes and no
    // reflex has ever reached for it, and two edibles make you ill.
    expect(kindsWithTag(foragerAdapter, 'edible')).toEqual(['berry', 'tuber', 'mushroomRed', 'nightshade']);
  });
});

describe('an intent is held to what the world declares', () => {
  const every = (intent: Intent): ReturnType<typeof checkIntent> => checkIntent(foragerAdapter, intent);

  it('admits every act this world’s policy and parser can produce', () => {
    const legal: Intent[] = [
      { kind: 'MoveTo', x: 1, y: 2 },
      { kind: 'MoveTo', targetId: 4, x: 1, y: 2 },
      { kind: 'Gather', targetId: 9 },
      { kind: 'Dig' },
      { kind: 'Eat', objectKind: 'berry' },
      { kind: 'Sleep', durationTicks: 200 },
      { kind: 'Build', buildKind: 'shelter', x: 0, y: 0 },
      { kind: 'Craft' },
      { kind: 'Flee', x: -3, y: 4 },
      { kind: 'Idle', durationTicks: 40 },
      { kind: 'Speak', utterance: { speechAct: 'inform', text: 'hello' } },
      { kind: 'Give', targetId: 2, objectKind: 'meat' },
      { kind: 'Withdraw', objectKind: 'seed', targetId: 3 },
      { kind: 'Attack', targetId: 5 },
      { kind: 'Follow', targetId: 6 },
      { kind: 'Drink' },
    ];
    for (const intent of legal) expect(every(intent), intent.kind).toBeNull();
  });

  it('refuses an act this world does not have', () => {
    expect(every({ kind: 'Teleport' })).toBe('undeclared-action');
    expect(every({ kind: 'Snaffle', targetId: 1 })).toBe('undeclared-action');
  });

  it('refuses an argument the act cannot take, or a value it cannot mean', () => {
    expect(every({ kind: 'Eat', buildKind: 'shelter' })).toBe('bad-param');
    expect(every({ kind: 'Gather', objectKind: 'berry' })).toBe('bad-param');
    expect(every({ kind: 'Eat', objectKind: 'plutonium' })).toBe('bad-param');
    expect(every({ kind: 'Build', buildKind: 'tower' })).toBe('bad-param');
    // A node kind is a kind — but not one an `object` argument may name.
    expect(every({ kind: 'Eat', objectKind: 'berryBush' })).toBe('bad-param');
    expect(every({ kind: 'MoveTo', x: Number.NaN, y: 0 })).toBe('bad-param');
    expect(every({ kind: 'Idle', durationTicks: Number.POSITIVE_INFINITY })).toBe('bad-param');
    expect(every({ kind: 'Speak', utterance: undefined })).toBeNull(); // absent is not wrong
  });

  it('is a different refusal from a different world’s act, and counts apart', () => {
    expect(checkIntent(toyWorld, { kind: 'Gather', targetId: 1 })).toBe('undeclared-action');
    expect(checkIntent(toyWorld, { kind: 'Snaffle', targetId: 1 })).toBeNull();
    // The toy world's body cannot refuse an aimless take, so its edge does.
    expect(checkIntent(toyWorld, { kind: 'Snaffle' })).toBe('bad-param');
    expect(checkIntent(toyWorld, { kind: 'Nibble', objectKind: 'crumb' })).toBeNull();
    expect(checkIntent(toyWorld, { kind: 'Nibble', objectKind: 'lever' })).toBe('bad-param');
    // …and a bound it declares is a bound the edge keeps.
    expect(checkIntent(toyWorld, { kind: 'Dawdle', durationTicks: 99 })).toBeNull();
    expect(checkIntent(toyWorld, { kind: 'Dawdle', durationTicks: 100 })).toBe('bad-param');
  });
});

function param(action: string, id: string): KindParam {
  const found = foragerAdapter.actionById.get(action)?.params.find((p) => p.id === id);
  if (!found || found.type !== 'kind') throw new Error(`${action}.${id} is not a kind argument`);
  return found;
}
