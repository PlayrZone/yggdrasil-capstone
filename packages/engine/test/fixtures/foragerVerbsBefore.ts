import type { BuildKind, IntentKind, NeedKey, ObjectKind } from '../../src/worlds/forager/types.js';

/**
 * THE VERBS AND VOCABULARIES AS THE MIND OWNED THEM, the moment before W1-B3
 * moved them out: the parser's four closed lists, the prompt's one-line verb
 * vocabulary, and the order `parsePlan` read an intent's arguments in.
 *
 * Copied verbatim out of `consciousness/{schema,prompt}.ts` at `6d44eea`, and —
 * like `foragerTablesBefore.ts` — deliberately importing nothing from the
 * adapter. This is the independent "before"; the adapter is the "after"; the
 * two must never come to share a source, or the comparison says nothing.
 *
 * THE ARGUMENT ORDER IS NOT COSMETIC. `{"kind":"Build","buildKind":"tower",
 * "durationTicks":1e999}` is illegal twice over and the model is told about
 * exactly one of them, so the order decides the reason code. `schema.ts` read
 * them in the order below; the adapter's `planArguments` must reproduce it.
 */

/** consciousness/schema.ts INTENT_KINDS — also `contract/types.ts`'s IntentKind. */
export const WAS_INTENT_KINDS: readonly IntentKind[] = [
  'MoveTo', 'Gather', 'Dig', 'Eat', 'Drink', 'Sleep', 'Build', 'Deposit', 'Withdraw',
  'Give', 'Attack', 'Craft', 'Speak', 'Follow', 'Flee', 'Idle',
];

/** consciousness/schema.ts OBJECT_KIND_LIST — "the kinds the world is made of". */
export const WAS_OBJECT_KIND_LIST: readonly ObjectKind[] = [
  'water', 'wood', 'stone', 'clay', 'fiber', 'berry', 'tuber', 'seed', 'mushroomRed', 'nightshade',
  'meat', 'hide', 'charcoal', 'leather', 'rope', 'spear', 'club', 'handaxe', 'brick',
  'copper', 'tin', 'iron', 'bronze', 'copperOre', 'tinOre', 'ironOre', 'coal', 'salt',
  'silver', 'gold', 'gemstone', 'shelter', 'wall', 'container', 'corpse',
];

/** consciousness/schema.ts BUILD_KIND_LIST. */
export const WAS_BUILD_KIND_LIST: readonly BuildKind[] = ['shelter', 'wall', 'container'];

/** consciousness/schema.ts GOAL_NEEDS. */
export const WAS_GOAL_NEEDS: readonly NeedKey[] = ['hunger', 'rest', 'safety', 'socialConnection'];

/** consciousness/prompt.ts INTENT_VOCAB, byte for byte. */
export const WAS_INTENT_VOCAB =
  'MoveTo, Gather, Dig, Eat, Drink, Sleep, Build, Deposit, Withdraw, Give, Attack, Craft, Speak, Follow, Flee, Idle';

/**
 * consciousness/prompt.ts's ARGUMENT PARAGRAPH, byte for byte: the four lines
 * of the system prompt that followed the verb line, as they were typed out
 * inside the mind. Three of the sixteen verbs above never appear in it, and
 * that is reproduced rather than repaired — see `worlds/forager/actions.ts`.
 */
export const WAS_INTENT_ARG_LINES: readonly string[] = [
  'MoveTo{x,y|targetId}, Gather{targetId}, Eat{objectKind}, Build{buildKind,x,y},',
  'Dig{} (dig the ground where you stand), Give{targetId,objectKind}, Deposit{objectKind,targetId?}, Sleep{durationTicks}, Idle{durationTicks},',
  'Craft{} (try combining the raw materials you carry — whether anything useful results, and what, is for you to DISCOVER through trying),',
  'Flee{x,y}, Follow{targetId}, Speak{} (put speech in utterances).',
];

/** The order `parsePlan` read them in, statement by statement. */
export const WAS_ARG_ORDER: readonly string[] = ['x', 'y', 'targetId', 'objectKind', 'buildKind', 'durationTicks'];

/** The two refusal clauses `readEnum` was handed, with the verb interpolated. */
export const wasObjectKindHint = (kind: string): string => `${kind} takes one of the kinds the world is made of`;
export const wasBuildKindHint = (kind: string): string =>
  `${kind} builds one of ${WAS_BUILD_KIND_LIST.join(', ')}`;
export const WAS_NEED_HINT = `a goal serves one of ${WAS_GOAL_NEEDS.join(', ')}`;
