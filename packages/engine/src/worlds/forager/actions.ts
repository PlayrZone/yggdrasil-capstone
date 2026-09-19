import type { ActionBinding, ParamSchema, PromptArgs } from '../../contract/actions.js';
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

const act = (
  id: IntentKind,
  core: ActionBinding['core'],
  params: readonly ParamSchema[],
  promptArgs?: PromptArgs,
): ForagerAction => (promptArgs === undefined ? { id, core, params } : { id, core, params, promptArgs });

/**
 * HOW THE PROMPT WRITES THE ARGUMENTS, transcribed like everything else here.
 *
 * The paragraph used to be four hand-written lines inside `prompt.ts`, which
 * meant a second world was shown THIS world's shapes (W1-B3 verifier, backlog
 * 2). The names in the braces are `params` now; what is declared below is the
 * part a param list cannot say, and every bit of it is reproduced EXACTLY as
 * the prompt has always read — not as it ought to read:
 *
 *  · The order is the paragraph's, which is not the vocabulary's order above.
 *  · `Drink`, `Withdraw` and `Attack` are MISSING from it, and stay missing. A
 *    model has always been offered all sixteen verbs and told the shapes of
 *    thirteen. That is a finding for B5 (the lexicon owns this prose), and
 *    fixing it here would change what every model is shown, silently, inside a
 *    step whose whole claim is that nothing changed.
 *  · `x,y|targetId` and `targetId?` say "either/or" and "optional", which a
 *    list of params cannot; `Dig`, `Craft` and `Speak` each carry a sentence.
 */
export const FORAGER_ACTIONS: readonly ForagerAction[] = [
  act('MoveTo', 'Move', [X, Y, TARGET], { at: 1, shape: 'x,y|targetId' }),
  act('Gather', 'Take', [TARGET], { at: 2 }),
  act('Dig', 'Take', [], { at: 5, gloss: '(dig the ground where you stand)' }), // the ground where you stand; it takes nothing
  act('Eat', 'Use', [OBJECT_KIND], { at: 3 }),
  act('Drink', 'Use', []), // from whatever water is within reach
  act('Sleep', 'Rest', [DURATION], { at: 8 }),
  act('Build', 'Build', [BUILD_KIND, X, Y], { at: 4, endsLine: true }),
  act('Deposit', 'Give', [OBJECT_KIND, TARGET], { at: 7, shape: 'objectKind,targetId?' }), // into a container, or the ground
  act('Withdraw', 'Take', [OBJECT_KIND, TARGET]),
  act('Give', 'Give', [TARGET, OBJECT_KIND], { at: 6 }),
  act('Attack', 'Contest', [TARGET]),
  // whatever is in hand; what results is discovered
  act('Craft', 'Combine', [], {
    at: 10,
    gloss:
      '(try combining the raw materials you carry — whether anything useful results, and what, is for you to DISCOVER through trying)',
    endsLine: true,
  }),
  act('Speak', 'Say', [SPEECH], { at: 13, gloss: '(put speech in utterances)' }),
  act('Follow', 'Attend', [TARGET], { at: 12 }),
  act('Flee', 'Flee', [X, Y], { at: 11 }),
  act('Idle', 'Wait', [DURATION], { at: 9, endsLine: true }),
];
