import type { WorldAdapter } from './adapter.js';
import type { ActionId, KindId } from './ids.js';
import type { Intent } from './types.js';

/**
 * WHAT CAN BE DONE HERE, AND WHAT KINDS OF THING THERE ARE (W1-B3).
 *
 * A mind used to be typed against one world's verbs (`'MoveTo' | 'Gather' | …`)
 * and one world's stuff (`'berry' | 'stone' | …`). Both are now DATA a world
 * declares, and the mind carries `ActionId`/`KindId` — opaque strings whose
 * spelling is the world's and whose MEANING reaches the mind two ways:
 *
 *  · an action's `core` verb, from the closed vocabulary below. `MoveTo` and a
 *    town's `CatchBus` are both `Move`, so a skill learned about one is at least
 *    ADDRESSABLE in the other. The core verb is the transferable part; it says
 *    what kind of act this is, never what the act achieves (that stays physical,
 *    enforced by the body and discovered by the being).
 *  · a kind's `tags`, which say what it affords — the edible things, the
 *    materials, the structures — so a policy can ask "what here can be eaten"
 *    without knowing the word `berry`.
 *
 * NOTHING HERE IS A FACT SHOWN TO A MIND. The tables say what EXISTS, not what
 * works: a world may declare `nightshade` edible and the body will still make
 * you sick, which is the whole point.
 */

/**
 * THE CLOSED VOCABULARY EVERY WORLD BINDS TO (docs/rework/W1-B-worldadapter.md).
 * Twelve verbs, chosen to span what a being can do to a place, a thing, another
 * being and itself. A world that needs a thirteenth is a finding to report, not
 * a line to add quietly: the point of a closed set is that it means the same
 * thing in every world.
 */
export type CoreVerb =
  | 'Move'
  | 'Take'
  | 'Use'
  | 'Combine'
  | 'Give'
  | 'Say'
  | 'Attend'
  | 'Rest'
  | 'Build'
  | 'Contest'
  | 'Flee'
  | 'Wait';

/**
 * What a kind of thing AFFORDS. Every tag below is a distinction this engine
 * already makes somewhere in code — `NUTRITIOUS_FOODS`, `SICKENING_FOODS`, the
 * reflex policy's edible/diggable/food-node sets, `CRAFT_RECIPES`' inputs and
 * outputs, `BuildKind`, and the split between a thing you can hold (`object`)
 * and a place you win things from (`source`). They are named here as data so a
 * policy can read them; `test/world-tables-transcribed.test.ts` pins each set
 * against the constant it came from, so a tag cannot drift from its witness.
 */
export type AffordanceTag =
  /** A discrete thing: stuff you can hold, or an object standing in the world. */
  | 'object'
  /** A place or organism things are won from. */
  | 'source'
  /** Something a being might put in its mouth — not a claim that it is good. */
  | 'edible'
  | 'nourishing'
  | 'sickening'
  /** Goes INTO a making. */
  | 'material'
  /** Comes OUT of a making. */
  | 'tool'
  /** Can be raised where a being stands. */
  | 'structure'
  /** Holds what is put in it. */
  | 'container'
  /** Won from the ground rather than from a source. */
  | 'diggable'
  /** A source whose yield can be eaten. */
  | 'foodSource';

export interface KindSchema {
  readonly id: KindId;
  readonly tags: readonly AffordanceTag[];
}

/**
 * HOW AN ARGUMENT IS TYPED, and — load bearing — THE ORDER ARGUMENTS ARE READ
 * IN. Two illegal arguments in one intent produce two possible refusals, and
 * which one a model is told about is observable, so the order is a stated rule
 * (`PARAM_TYPE_ORDER`) rather than whichever table happened to be written first.
 *
 * `number` carries `x`/`y` today. B4 replaces both with a single `place`, at
 * which point no coordinate reaches a mind at all.
 */
export type ParamType = 'number' | 'ref' | 'kind' | 'enum' | 'duration' | 'speech';

/** Arguments are read type by type, in this order. See `ParamType`. */
export const PARAM_TYPE_ORDER: readonly ParamType[] = [
  'number',
  'ref',
  'kind',
  'enum',
  'duration',
  'speech',
];

interface ParamBase {
  readonly id: string;
  /**
   * The act cannot mean anything without it. DECLARED, NOT ENFORCED at the
   * mind→body edge in a world whose body answers for itself: refusing an
   * argument-less act here would delete the body's own refusal, and that
   * refusal is an event beings remember. A world with no such answer marks its
   * params required and `checkIntent` refuses them.
   */
  readonly required?: boolean;
}

export interface NumberParam extends ParamBase {
  readonly type: 'number' | 'duration';
  readonly min?: number;
  readonly max?: number;
}

/** Names something in the world by handle — a node, a container, a being. */
export interface RefParam extends ParamBase {
  readonly type: 'ref';
}

/** One of the world's kinds, optionally only those carrying a tag. */
export interface KindParam extends ParamBase {
  readonly type: 'kind';
  readonly tag?: AffordanceTag;
  /** The clause after the action's own name when a value is refused. */
  readonly hint?: string;
}

/** One of a list of values this world declares for this argument alone. */
export interface EnumParam extends ParamBase {
  readonly type: 'enum';
  readonly values: readonly string[];
  readonly hint?: string;
}

/**
 * Something SAID rides here. Never parsed out of a plan — a mind puts speech in
 * `utterances`, and the engine composes the intent — and never inspected by the
 * edge, because physics transports an utterance without interpreting it.
 */
export interface SpeechParam extends ParamBase {
  readonly type: 'speech';
}

export type ParamSchema = NumberParam | RefParam | KindParam | EnumParam | SpeechParam;

export interface ActionBinding {
  readonly id: ActionId;
  readonly core: CoreVerb;
  readonly params: readonly ParamSchema[];
}

/** The world's verbs as a prompt lists them, in declared order. */
export function actionVocabulary(world: WorldAdapter): string {
  return world.actions.map((action) => action.id).join(', ');
}

/** The first action this world binds to a core verb, or undefined. */
export function actionForCore(world: WorldAdapter, core: CoreVerb): ActionBinding | undefined {
  for (const action of world.actions) if (action.core === core) return action;
  return undefined;
}

/** Every kind carrying a tag, in the order the world declared them. */
export function kindsWithTag(world: WorldAdapter, tag: AffordanceTag): KindId[] {
  const out: KindId[] = [];
  for (const kind of world.kinds) if (kind.tags.includes(tag)) out.push(kind.id);
  return out;
}

/** The ids a `kind` argument may draw on: tagged, or every kind there is. */
export function kindsFor(world: WorldAdapter, param: KindParam): KindId[] {
  return param.tag === undefined ? world.kinds.map((k) => k.id) : kindsWithTag(world, param.tag);
}

/**
 * EVERY ARGUMENT A PLAN CAN CARRY IN THIS WORLD, in the order a parser must read
 * them: by type (`PARAM_TYPE_ORDER`), and within a type by where it first
 * appears in the declared actions. Speech is left out — it is never parsed.
 *
 * The union rather than per-action params, because an argument is as closed as
 * the verb whatever verb it was given to: `{"kind":"Eat","buildKind":"tower"}`
 * is a refusal, not an `Eat` with a field quietly dropped.
 */
export function planArguments(world: WorldAdapter): ParamSchema[] {
  const out: ParamSchema[] = [];
  const seen = new Set<string>();
  for (const type of PARAM_TYPE_ORDER) {
    if (type === 'speech') continue;
    for (const action of world.actions) {
      for (const param of action.params) {
        if (param.type !== type || seen.has(param.id)) continue;
        seen.add(param.id);
        out.push(param);
      }
    }
  }
  return out;
}

/** Why an intent cannot be what this world means. `null` = it can. */
export type IntentRefusal = 'undeclared-action' | 'bad-param';

/**
 * THE MIND→BODY EDGE, asked of one intent. An action the world never declared,
 * an argument the action does not take, a kind it has never heard of, a number
 * it cannot act on: each is refused, because past this point the body would
 * either execute something the world does not contain or silently ignore the
 * part of the decision it could not read.
 *
 * It asks only about what the WORLD says. Whether the act is possible HERE AND
 * NOW — in range, in stock, affordable — stays the body's, and its refusal is
 * an event a being remembers.
 */
export function checkIntent(world: WorldAdapter, intent: Intent): IntentRefusal | null {
  const action = world.actionById.get(intent.kind);
  if (!action) return 'undeclared-action';
  for (const [key, value] of Object.entries(intent)) {
    if (key === 'kind' || value === undefined) continue;
    const param = action.params.find((p) => p.id === key);
    if (!param || !paramAccepts(world, param, value)) return 'bad-param';
  }
  for (const param of action.params) {
    if (param.required && (intent as unknown as Record<string, unknown>)[param.id] === undefined) return 'bad-param';
  }
  return null;
}

function paramAccepts(world: WorldAdapter, param: ParamSchema, value: unknown): boolean {
  switch (param.type) {
    case 'number':
    case 'duration':
    case 'ref': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return false;
      if (param.type === 'ref') return true;
      return (param.min === undefined || value >= param.min) && (param.max === undefined || value <= param.max);
    }
    case 'kind':
      return typeof value === 'string' && kindsFor(world, param).includes(value);
    case 'enum':
      return typeof value === 'string' && param.values.includes(value);
    // Speech transits opaquely: the engine composed it, and physics never reads
    // inside it. All the edge can say is that something is there.
    case 'speech':
      return typeof value === 'object' && value !== null;
  }
}
