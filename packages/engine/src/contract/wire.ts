import type { WorldAdapter } from './adapter.js';
import { placeFieldNames } from './space.js';
import type { PlaceRef } from './space.js';
import type { Goal, Intent, MindOutput, Utterance } from './types.js';

/**
 * THE CODEC AT THE EDGES (W1-B4).
 *
 * Inside, a mind holds an opaque `PlaceRef` and can say nothing about it.
 * Outside — to a model, in a corpus row, and to a body — a place is written the
 * way the WORLD writes one: two numbers `x`,`y` on the forager plane, a named
 * spot in a world with no plane. This file is the whole of the translation, and
 * it lives at exactly two seams:
 *
 *  · the PARSER/PROMPT edge (`consciousness/schema.ts` reads the world's
 *    fields; `contract/actions.ts` writes them into the argument paragraph);
 *  · the BODY edge (`SimRuntime.applyPlan`), where the forager body goes on
 *    receiving the same `x`,`y` it always has — and, because the recorder
 *    stores what the world was handed, so does every corpus row.
 *
 * Nothing between the two ever sees a field name.
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
export function encodeIntent(world: WorldAdapter, intent: Intent): WireIntent {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(intent)) {
    if (key === PLACE_FIELD && value !== undefined && value !== null) {
      Object.assign(out, world.space.encode(value as PlaceRef));
    } else {
      out[key] = value;
    }
  }
  return out as WireIntent;
}

/** A whole decision, written out — its own key order kept. */
export function encodeOutput(world: WorldAdapter, output: MindOutput): WireOutput {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(output)) {
    out[key] = key === 'plan' ? (value as Intent[]).map((intent) => encodeIntent(world, intent)) : value;
  }
  return out as unknown as WireOutput;
}

/** A plan, written out. */
export function encodePlan(world: WorldAdapter, plan: readonly Intent[]): WireIntent[] {
  return plan.map((intent) => encodeIntent(world, intent));
}

/**
 * ONE RECORD WITH ITS PLACE WRITTEN BACK IN — a memory, a snapshot, a thing
 * seen — so that a stored row reads exactly as it did when the place was two
 * sibling fields. The place expands AT ITS OWN KEY, so `x` and `y` land where
 * they have always been and a corpus recorded before this step and after it are
 * the same bytes.
 *
 * World-neutral on purpose: a place's wire fields are its own runtime fields,
 * so writing one out needs no adapter at all, and `serializeThinkInput` keeps
 * the single-argument form that every caller already has.
 */
export function inlinePlace<T extends object>(row: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === PLACE_FIELD && value !== undefined && value !== null) Object.assign(out, value);
    else out[key] = value;
  }
  return out;
}

/**
 * The inverse, which DOES need the world: only it knows which sibling fields
 * were a place. The place is rebuilt at the position of the first of them, so a
 * row that is read and written again comes back byte-identical.
 */
export function liftPlace<T>(world: WorldAdapter, row: Record<string, unknown>): T {
  const fields = placeFieldNames(world.space);
  const carried: Record<string, unknown> = {};
  let present = false;
  for (const field of fields) {
    if (field in row) {
      present = true;
      carried[field] = row[field];
    }
  }
  if (!present) return row as T;
  const place = world.space.decode(carried);
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
