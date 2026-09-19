import { placeFieldNames } from './edges.js';
import type { SpaceCodec } from './edges.js';
import type { PlaceRef } from './space.js';
import type {
  AgentSnapshot,
  Goal,
  Intent,
  MemoryRecord,
  MindOutput,
  ObservedAgent,
  ObservedResource,
  ObservedStructure,
  ThinkInput,
  Utterance,
  WorldView,
} from './types.js';

/**
 * THE CODEC AT THE EDGES (W1-B4).
 *
 * Inside, a mind holds an opaque `PlaceRef` and can say nothing about it.
 * Outside — to a model, in a corpus row, and to a body — a place is written the
 * way the WORLD writes one: two numbers `x`,`y` on the forager plane, a named
 * spot in a world with no plane. This file is the whole of the translation, and
 * it lives at exactly three seams:
 *
 *  · the PARSER/PROMPT edge (`consciousness/schema.ts` reads the world's
 *    fields; `contract/actions.ts` writes them into the argument paragraph);
 *  · the BODY edge (`SimRuntime.applyPlan`), where the forager body goes on
 *    receiving the same `x`,`y` it always has — and, because the recorder
 *    stores what the world was handed, so does every corpus row;
 *  · the MODEL'S OWN EDGE — anything standing in for a model has to WRITE what a
 *    model writes. `MockMindBackend` did not, and a being driven by it lost its
 *    destination on every act that had one (W1-B4 verifier, the fail). Naming
 *    only two seams is what let that one go unnoticed.
 *
 * Nothing between them ever sees a field name.
 *
 * EVERY FUNCTION HERE TAKES THE CODEC, NOT THE WORLD (round 4). It used to take
 * a `WorldAdapter` and ask `codecFor(world.space)`, which is the module-level
 * lookup round 3 walked through with one cast; there is no lookup now, so the
 * capability has to arrive as an argument. This is the one file in `contract/`
 * allowed to import `contract/edges.ts`, and `test/mind-type-graph.test.ts`
 * fails if a second one ever does — which is what makes a relay impossible
 * rather than merely unwritten.
 */

/**
 * THE ONE FIELD NAME THE ENGINE'S `Intent` GIVES A PLACE. A world's `place`
 * param carries this id — param ids ARE the intent's field names, which is what
 * `checkIntent` has always held a plan to — while the fields it is WRITTEN as
 * are the world's own (`SpaceOps.fields`). So two worlds share one mind-side
 * shape and share none of their wire.
 */
export const PLACE_FIELD = 'place';

/**
 * An act as a world writes it: the mind's own arguments, minus the opaque
 * place, plus whatever fields that place became. The index signature is what
 * makes it a WIRE form — a body, a parser and a row each read the fields their
 * own world declares, and none of them is typed against another's.
 */
export type WireIntent = Omit<Intent, 'place'> & Record<string, unknown>;

/** A decision as it is handed over and stored: the same, with a written plan. */
export interface WireOutput {
  goals: Goal[];
  plan: WireIntent[];
  utterances: Utterance[];
  name?: string;
  thought?: string;
}

/**
 * One act, written out. Keys are copied IN ORDER and the place expands where it
 * sits, so `{kind, place, targetId}` becomes `{kind, x, y, targetId}` — the
 * field order the wire has always had, which a corpus row is compared on byte
 * for byte.
 *
 * A place on an act that does not declare one is expanded too. That is not
 * tidiness: `{"kind":"Gather","x":1,"y":2}` is a thing a model writes, it
 * reached the body before this step, and the body's refusal is an event the
 * being remembers (W1-B3 verifier, the fail). Dropping it here would delete
 * that memory just as surely as refusing it at the gate did.
 */
export function encodeIntent(codec: SpaceCodec, intent: Intent): WireIntent {
  return writeIntent(codec, intent);
}

/** The same, internal — every plan the body is handed goes through here. */
function writeIntent(codec: SpaceCodec, intent: Intent): WireIntent {
  // AN ACT WITH NO PLACE IS ALREADY WRITTEN. Half this world's verbs take no
  // place at all (`Eat`, `Idle`, `Craft`, `Sleep`), and every plan the body is
  // handed passes through here on every tick of every run — so the copy is
  // skipped rather than made and thrown away. Identical by construction: with no
  // place to expand, the loop below copies each key to itself in order.
  if (intent.place === undefined || intent.place === null) return intent as unknown as WireIntent;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(intent)) {
    if (key === PLACE_FIELD && value !== undefined && value !== null) {
      Object.assign(out, codec.encode(value as PlaceRef));
    } else {
      out[key] = value;
    }
  }
  return out as WireIntent;
}

/** A whole decision, written out — its own key order kept. */
export function encodeOutput(codec: SpaceCodec, output: MindOutput): WireOutput {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(output)) {
    out[key] = key === 'plan' ? (value as Intent[]).map((intent) => writeIntent(codec, intent)) : value;
  }
  return out as unknown as WireOutput;
}

/**
 * A DECISION AS A MODEL WOULD HAVE SENT IT — the text, not the object.
 *
 * Anything standing in for a model has to WRITE what a model writes, and the
 * things that stand in for one (`MockMindBackend`, the eval mocks) hold a
 * policy's `MindOutput`, which carries opaque places. This is the whole of the
 * crossing, bound to a world's codec once, so that a stand-in can be handed one
 * function instead of a capability it would then be holding.
 */
export function replyWriter(codec: SpaceCodec): (output: MindOutput) => string {
  return (output) => JSON.stringify(encodeOutput(codec, output));
}

/** A plan, written out. */
export function encodePlan(codec: SpaceCodec, plan: readonly Intent[]): WireIntent[] {
  if (plan.length === 0) return [];
  return plan.map((intent) => writeIntent(codec, intent));
}

/**
 * A WHOLE PLAN READ THE OTHER WAY — every act's wire fields lifted back into
 * the one opaque place the engine's `Intent` carries (round 4).
 *
 * THIS IS WHERE A MODEL'S ANSWER BECOMES A DECISION ABOUT A PLACE, and it is at
 * the EDGE on purpose. `consciousness/schema.ts` reads a model's JSON and the
 * fields are the world's, so until round 4 the parser held a bound `decode` —
 * the one door a mind directory still had onto the codec, and the one that
 * makes triangulation possible (mint three places of known coordinates, ask
 * `distance` three times, and the handle you were given is pinned). So the
 * parser now yields the fields AS WRITTEN and this runs where the plan enters
 * the world (`SimRuntime.applyPlan`), which is the first point that holds the
 * world's edges.
 *
 * IT IS A NO-OP ON A PLAN THAT ALREADY CARRIES PLACES — the reflex path, which
 * never went near a parser — because a world's fields are simply not in those
 * acts. One function therefore handles both shapes, and neither is special-cased.
 */
export function liftPlan(codec: SpaceCodec, plan: readonly Intent[]): Intent[] {
  if (plan.length === 0) return [];
  // `liftPlace` is the same operation a stored row takes on its way back, and
  // it is the same operation here: the place lands at the position of the FIRST
  // field it was written as, so `encodePlan` puts it back byte for byte.
  return plan.map((intent) => liftPlace<Intent>(codec, intent as unknown as Record<string, unknown>));
}

/**
 * ONE RECORD WITH ITS PLACE WRITTEN BACK IN — a memory, a snapshot, a thing
 * seen — so that a stored row reads exactly as it did when the place was two
 * sibling fields. The place expands AT ITS OWN KEY, so `x` and `y` land where
 * they have always been and a corpus recorded before this step and after it are
 * the same bytes.
 *
 * IT ASKS THE WORLD, and that is the whole of the change the W1-B4 verifier
 * asked for (backlog 5). It used to `Object.assign(out, value)` — the contract
 * layer prising a place open with no adapter and no cast, on an invariant it
 * never stated: that a place's runtime value IS its wire form. That invariant
 * is a fact about the forager plane, not about space, and a world whose handle
 * is an index into a side table would have been written to disk as `{}`. Now
 * there is ONE reviewed serialisation seam, `space.encode`, and this is the only
 * caller of it outside a world's own module.
 */
export function inlinePlace<T extends object>(codec: SpaceCodec, row: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === PLACE_FIELD && value !== undefined && value !== null) {
      Object.assign(out, codec.encode(value as PlaceRef));
    } else out[key] = value;
  }
  return out;
}

/**
 * The inverse, which DOES need the world: only it knows which sibling fields
 * were a place. The place is rebuilt at the position of the first of them, so a
 * row that is read and written again comes back byte-identical.
 */
export function liftPlace<T>(codec: SpaceCodec, row: Record<string, unknown>): T {
  const fields = placeFieldNames(codec);
  const carried: Record<string, unknown> = {};
  let present = false;
  for (const field of fields) {
    if (field in row) {
      present = true;
      carried[field] = row[field];
    }
  }
  if (!present) return row as T;
  const place = codec.decode(carried);
  const out: Record<string, unknown> = {};
  let placed = false;
  for (const [key, value] of Object.entries(row)) {
    if (!fields.includes(key)) {
      out[key] = value;
      continue;
    }
    if (placed) continue;
    placed = true;
    if (place !== undefined) out[PLACE_FIELD] = place;
  }
  return out as T;
}

// ─── A ThinkInput across a process boundary ──────────────────────────────────

/**
 * A `ThinkInput` AS IT CROSSES TO ANOTHER PROCESS — every opaque place replaced,
 * AT ITS OWN KEY, by the fields this world writes one as.
 *
 * A place is now an instance whose whole state is private, so `structuredClone`
 * — which is what `postMessage` and Electron's IPC do — copies own enumerable
 * properties and arrives with `{}`. Before W1-B4 a place WAS its `{x, y}`, so
 * the crossing worked by accident; the lab's sim worker posts a `ThinkInput` to
 * the renderer, which forwards it to main, which rebuilds the prompt from it and
 * bills a call against the match. So the codec has to run at the edge, and this
 * is that edge's half of it.
 *
 * THE BYTES ARE THE BYTES THAT ALWAYS CROSSED: `{x, y}` under `place`, in the
 * record's own key order, which is exactly what the clone used to produce. The
 * IPC gate's questions (`snapshot.place is a place in this world`) are unchanged
 * and so is every stored trace of the paid path.
 */
export type SentThinkInput = Omit<ThinkInput, 'snapshot' | 'worldView' | 'recalledMemories' | 'sacredPlace' | 'tragedyPlaces'> & {
  snapshot: Omit<AgentSnapshot, 'place'> & { place: Record<string, unknown> };
  worldView: Omit<WorldView, 'agents' | 'resources' | 'structures'> & {
    agents: (Omit<ObservedAgent, 'place'> & { place: Record<string, unknown> })[];
    resources: (Omit<ObservedResource, 'place'> & { place: Record<string, unknown> })[];
    structures: (Omit<ObservedStructure, 'place'> & { place: Record<string, unknown> })[];
  };
  recalledMemories: (Omit<MemoryRecord, 'place'> & { place?: Record<string, unknown> })[];
  sacredPlace?: Record<string, unknown>;
  tragedyPlaces?: Record<string, unknown>[];
};

/** Every place in a think input, written as this world writes one. */
export function encodeThinkInputPlaces(codec: SpaceCodec, input: ThinkInput): SentThinkInput {
  // Tolerant of a partial input, because this runs at a TRANSPORT seam: a
  // backend stub, a replayed row, a being that perceived nothing. A field that
  // is not there is not written, and a field that is not a place is passed on
  // for the far side's gate to refuse.
  const write = <T>(row: T): T => {
    if (row === null || typeof row !== 'object') return row;
    const place = (row as { place?: PlaceRef }).place;
    return place === undefined ? row : ({ ...row, place: codec.encode(place) } as unknown as T);
  };
  const each = (rows: unknown): unknown => (Array.isArray(rows) ? rows.map(write) : rows);
  const out: Record<string, unknown> = { ...(input as unknown as Record<string, unknown>) };
  if (out['snapshot'] !== undefined) out['snapshot'] = write(out['snapshot']);
  const seen = out['worldView'];
  if (seen !== null && typeof seen === 'object') {
    const view = seen as Record<string, unknown>;
    out['worldView'] = {
      ...view,
      agents: each(view['agents']),
      resources: each(view['resources']),
      structures: each(view['structures']),
    };
  }
  if (out['recalledMemories'] !== undefined) out['recalledMemories'] = each(out['recalledMemories']);
  if (input.sacredPlace !== undefined) out['sacredPlace'] = codec.encode(input.sacredPlace);
  if (Array.isArray(input.tragedyPlaces)) out['tragedyPlaces'] = input.tragedyPlaces.map((p) => codec.encode(p));
  return out as unknown as SentThinkInput;
}

/**
 * …and back, on the far side. Tolerant by design: what arrives is untrusted
 * JSON that a gate has already bounded, and a field the world cannot read as a
 * place simply yields none — which makes the rebuilt prompt differ from the one
 * that was sent, which is a refusal, which is the outcome that edge wants.
 */
export function decodeThinkInputPlaces(codec: SpaceCodec, sent: unknown): ThinkInput {
  const asRow = (value: unknown): Record<string, unknown> | undefined =>
    value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
  const read = (value: unknown): PlaceRef | undefined => {
    const row = asRow(value);
    return row === undefined ? undefined : codec.decode(row);
  };
  const lift = (value: unknown): unknown => {
    const row = asRow(value);
    if (row === undefined || !('place' in row)) return value;
    const place = read(row['place']);
    return place === undefined ? withoutPlace(row) : { ...row, place };
  };
  const source = asRow(sent) ?? {};
  const out: Record<string, unknown> = { ...source };
  out['snapshot'] = lift(source['snapshot']);
  const seen = asRow(source['worldView']);
  if (seen) {
    out['worldView'] = {
      ...seen,
      agents: (seen['agents'] as unknown[] | undefined)?.map(lift) ?? [],
      resources: (seen['resources'] as unknown[] | undefined)?.map(lift) ?? [],
      structures: (seen['structures'] as unknown[] | undefined)?.map(lift) ?? [],
    };
  }
  out['recalledMemories'] = (source['recalledMemories'] as unknown[] | undefined)?.map(lift) ?? [];
  if ('sacredPlace' in source) {
    const place = read(source['sacredPlace']);
    if (place === undefined) delete out['sacredPlace'];
    else out['sacredPlace'] = place;
  }
  if (Array.isArray(source['tragedyPlaces'])) {
    out['tragedyPlaces'] = (source['tragedyPlaces'] as unknown[])
      .map(read)
      .filter((p): p is PlaceRef => p !== undefined);
  }
  return out as unknown as ThinkInput;
}

/** A record whose place could not be read is a record with no place. */
function withoutPlace(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) if (key !== PLACE_FIELD) out[key] = value;
  return out;
}
