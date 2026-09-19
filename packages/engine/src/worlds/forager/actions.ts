import type { ActionBinding, ParamSchema } from '../../contract/actions.js';
import type { IntentKind } from './types.js';

/**
 * THE FORAGER CONTINENT'S VERBS, DECLARED (W1-B3).
 *
 * Transcribed, not designed. Every id, and their ORDER, is `IntentKind`'s as it
 * stood — the order a prompt lists the vocabulary in, so changing it changes
 * what every model was shown. Every argument is one `YggdrasilSystem`'s switch
 * actually reads for that act, with the same spelling the wire has always used.
 *
 * NOTHING IS MARKED `required`, and that is a statement about THIS world rather
 * than laziness: its body answers for itself. `Gather` with no `targetId` is
 * refused by the body as `out-of-range`, and that refusal is an `IntentRejected`
 * event the being REMEMBERS. Refusing it one step earlier, at the world edge,
 * would delete the memory — a behaviour change dressed as validation. A world
 * whose body has no such answer marks its own params required.
 *
 * The `core` binding is the transferable part: `Gather` and `Dig` and `Withdraw`
 * are all `Take`, so a mind that has learned something about taking has
 * somewhere to put it when it wakes up in another world. It says nothing about
 * what any of them ACHIEVES — that stays physical, and stays to be discovered.
 */

// x/y are a point in this world's plane. B4 replaces the pair with one `place`
// param, at which point no coordinate reaches a mind at all.
const X: ParamSchema = { id: 'x', type: 'number' };
const Y: ParamSchema = { id: 'y', type: 'number' };
/** A node, a container or another being — whatever the act is aimed at. */
const TARGET: ParamSchema = { id: 'targetId', type: 'ref' };
/** Anything the world is made of. The hint is the parser's, word for word. */
const OBJECT_KIND: ParamSchema = {
  id: 'objectKind',
  type: 'kind',
  tag: 'object',
  hint: 'takes one of the kinds the world is made of',
};
/** Only what can be raised. `world-tables-transcribed` pins the hint's list
 *  against the tagged kinds, so it cannot drift from them. */
const BUILD_KIND: ParamSchema = {
  id: 'buildKind',
  type: 'kind',
  tag: 'structure',
  hint: 'builds one of shelter, wall, container',
};
const DURATION: ParamSchema = { id: 'durationTicks', type: 'duration' };
/** Speech is composed by the engine and transported opaquely. */
const SPEECH: ParamSchema = { id: 'utterance', type: 'speech' };

/** A binding whose id the compiler still checks against this world's union. */
type ForagerAction = ActionBinding & { readonly id: IntentKind };

const act = (id: IntentKind, core: ActionBinding['core'], params: readonly ParamSchema[]): ForagerAction => ({
  id,
  core,
  params,
});

export const FORAGER_ACTIONS: readonly ForagerAction[] = [
  act('MoveTo', 'Move', [X, Y, TARGET]),
  act('Gather', 'Take', [TARGET]),
  act('Dig', 'Take', []), // the ground where you stand; it takes nothing
  act('Eat', 'Use', [OBJECT_KIND]),
  act('Drink', 'Use', []), // from whatever water is within reach
  act('Sleep', 'Rest', [DURATION]),
  act('Build', 'Build', [BUILD_KIND, X, Y]),
  act('Deposit', 'Give', [OBJECT_KIND, TARGET]), // into a container, or the ground
  act('Withdraw', 'Take', [OBJECT_KIND, TARGET]),
  act('Give', 'Give', [TARGET, OBJECT_KIND]),
  act('Attack', 'Contest', [TARGET]),
  act('Craft', 'Combine', []), // whatever is in hand; what results is discovered
  act('Speak', 'Say', [SPEECH]),
  act('Follow', 'Attend', [TARGET]),
  act('Flee', 'Flee', [X, Y]),
  act('Idle', 'Wait', [DURATION]),
];
