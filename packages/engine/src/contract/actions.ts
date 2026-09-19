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
 * `place` is the one type whose WIRE FORM is world data rather than a single
 * field: it is written as `SpaceOps.fields`, which is `x,y` on the forager
 * plane and a named spot in a world that has no coordinates (W1-B4).
 */
export type ParamType = 'place' | 'number' | 'ref' | 'kind' | 'enum' | 'duration' | 'speech';

/**
 * Arguments are read type by type, in this order. See `ParamType`.
 *
 * `place` leads because the two coordinates it replaced led: which of two
 * illegal arguments a model is told about is decided here, and `{"kind":"Eat",
 * "objectKind":"plutonium","x":1e999}` has always been answered `bad-number`
 * about `x` rather than `bad-arg` about the plutonium.
 */
export const PARAM_TYPE_ORDER: readonly ParamType[] = [
  'place',
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
   * refusal is an event beings remember. A world with no such answer sets
   * `strictArgs` and marks its params required, and the edge refuses them.
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

/**
 * WHERE THE ACT IS AIMED. The mind carries one opaque `PlaceRef` here; the wire
 * carries whatever this world writes a place as, in that order — `x`,`y` on the
 * forager plane, a spot id in a world with no plane. The codec between the two
 * is `contract/wire.ts`, at the parser edge and at the body edge, and nowhere
 * in between.
 *
 * THE FIELDS ARE DECLARED HERE RATHER THAN READ OFF THE CODEC (round 4). They
 * used to be `codecFor(world.space).fields`, which put a codec lookup inside
 * `contract/actions.ts` — a module the whole mind imports, and therefore a door
 * that had to be shut. What the parser and the prompt's argument paragraph
 * actually need is the NAMES and TYPES of the fields, which is world data like
 * every other line in a `ParamSchema`; what neither of them may have is the
 * thing that turns those fields into a place. So the names are declared and the
 * codec is handed to the edges.
 *
 * A planar world writes `PLANE_FIELDS` here (`worlds/plane.ts`), which is the
 * same constant its codec is built from; `test/world-space.test.ts` pins the
 * two against each other so a world cannot declare one wire and write another.
 */
export interface PlaceParam extends ParamBase {
  readonly type: 'place';
  /** The wire fields a place is written as here, in the order written. */
  readonly fields: readonly ParamSchema[];
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

export type ParamSchema = PlaceParam | NumberParam | RefParam | KindParam | EnumParam | SpeechParam;

/**
 * THE FIELDS ONE ARGUMENT IS WRITTEN AS ON THE WIRE. Every param is its own
 * single field except a place, which is as many fields as this world writes a
 * place with — so the parser, the prompt's argument paragraph and the body all
 * agree about `x,y` without any of them containing the letters.
 *
 * The world argument is no longer read — the fields are on the param — and is
 * kept so that every caller of this reads the same as it did. It is also the
 * honest signature for a world whose wire ever depends on more than the param.
 */
export function wireFieldsOf(_world: WorldAdapter, param: ParamSchema): readonly ParamSchema[] {
  return param.type === 'place' ? param.fields : [param];
}

/**
 * HOW AN ACT IS WRITTEN IN THE PROMPT'S ARGUMENT PARAGRAPH (W1-B3 verifier,
 * backlog 2). The paragraph used to be four lines of one world's argument
 * shapes typed out inside the mind, so a second world was shown the forager
 * continent's — the same leak B3 closed for the VERB list and left open for the
 * shapes it had just declared.
 *
 * The shapes themselves come from `params`; what cannot be derived is declared
 * here, because every part of it is a statement about this world's prose:
 * WHICH acts the paragraph bothers to describe, in what ORDER, and where it
 * breaks its lines. Absent means the paragraph does not mention this act at
 * all — which is today's text, not an omission to be tidied up: three of the
 * forager world's sixteen acts are missing from it, and B5 (the lexicon) is
 * where that is decided, not here.
 */
export interface PromptArgs {
  /** Where this act falls in the paragraph. */
  readonly at: number;
  /** The text between the braces, when the declared params do not say it —
   *  `x,y|targetId` is "one or the other", which a param list cannot be. */
  readonly shape?: string;
  /** What follows the braces, in parentheses. */
  readonly gloss?: string;
  /** The paragraph breaks its line after this act. */
  readonly endsLine?: boolean;
}

export interface ActionBinding {
  readonly id: ActionId;
  readonly core: CoreVerb;
  readonly params: readonly ParamSchema[];
  /** How a prompt writes this act's arguments. Absent = it does not. */
  readonly promptArgs?: PromptArgs;
}

/** The world's verbs as a prompt lists them, in declared order. */
export function actionVocabulary(world: WorldAdapter): string {
  return world.actions.map((action) => action.id).join(', ');
}

/**
 * THE ARGUMENT-SHAPE PARAGRAPH, as lines, from what the world declared. Empty
 * in a world that describes no act's arguments — a prompt then says nothing
 * about them rather than quoting another world's.
 *
 * A speech param is never written: the engine composes an utterance out of what
 * a mind said, so a model cannot put one in a plan and telling it otherwise
 * would be a lie about the contract.
 */
export function argumentShapes(world: WorldAdapter): string[] {
  const written: { readonly at: number; readonly text: string; readonly breaks: boolean }[] = [];
  for (const action of world.actions) {
    const how = action.promptArgs;
    if (how === undefined) continue;
    const shape =
      how.shape ??
      action.params
        .filter((p) => p.type !== 'speech')
        .flatMap((p) => wireFieldsOf(world, p))
        .map((p) => p.id)
        .join(',');
    written.push({
      at: how.at,
      text: `${action.id}{${shape}}${how.gloss === undefined ? '' : ` ${how.gloss}`}`,
      breaks: how.endsLine === true,
    });
  }
  if (written.length === 0) return [];
  written.sort((a, b) => a.at - b.at);
  const lines: string[] = [];
  let line = '';
  for (let i = 0; i < written.length; i++) {
    const entry = written[i]!;
    line += entry.text;
    if (i === written.length - 1) lines.push(`${line}.`);
    else if (entry.breaks) {
      lines.push(`${line},`);
      line = '';
    } else line += ', ';
  }
  return lines;
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
 * COULD THIS VALUE BE A PLACE IN THIS WORLD? Handed in rather than asked of the
 * world (round 4), because the only thing that can answer it is the world's
 * codec and this module is imported by the whole mind — so a lookup here would
 * be exactly the door `contract/edges.ts` exists to remove. The caller that
 * holds a gate holds the world's edges (`SimRuntime.applyPlan`) and passes
 * `edges.codec.isPlace`.
 *
 * It is NOT ownership: a world mints non-finite and half-written places of its
 * own, and this asks whether the act is one the world can act on. See
 * `SpaceCodec.isPlace` for the distinction.
 */
export type PlaceTest = (value: unknown) => boolean;

/**
 * CAN THIS WORLD MEAN THIS INTENT? An action it never declared, an argument
 * that action does not take, a kind it has never heard of, a number it cannot
 * act on: each is something the world's own tables say is not an act of this
 * world.
 *
 * IT IS A QUESTION, NOT A VERDICT. What is done about an answer belongs to the
 * edge (`WorldGate.admitIntent`), and the two parts differ: an undeclared
 * ACTION is refused everywhere, because nothing downstream could execute it,
 * while an undeclared ARGUMENT is refused only in a world that asked for it
 * (`WorldAdapter.strictArgs`). In a world whose body answers for itself the
 * argument rides through, and the body's own refusal is an event a being
 * remembers — see `strictArgs` for why deleting that is not validation.
 *
 * It asks only about what the WORLD says. Whether the act is possible HERE AND
 * NOW — in range, in stock, affordable — stays the body's.
 */
export function checkIntent(world: WorldAdapter, intent: Intent, isPlace: PlaceTest): IntentRefusal | null {
  const action = world.actionById.get(intent.kind);
  if (!action) return 'undeclared-action';
  for (const [key, value] of Object.entries(intent)) {
    if (key === 'kind' || value === undefined) continue;
    const param = action.params.find((p) => p.id === key);
    if (!param || !paramAccepts(world, param, value, isPlace)) return 'bad-param';
  }
  for (const param of action.params) {
    if (param.required && (intent as unknown as Record<string, unknown>)[param.id] === undefined) return 'bad-param';
  }
  return null;
}

function paramAccepts(world: WorldAdapter, param: ParamSchema, value: unknown, isPlace: PlaceTest): boolean {
  switch (param.type) {
    // Only this world can say whether a place is one of its own, and it is
    // asked about the HANDLE, never about the fields it was written with.
    case 'place':
      return isPlace(value);
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
