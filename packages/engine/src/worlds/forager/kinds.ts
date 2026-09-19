import type { AffordanceTag, KindSchema } from '../../contract/actions.js';
import type { ForagerKind } from './types.js';

/**
 * EVERYTHING THIS CONTINENT CONTAINS, DECLARED (W1-B3).
 *
 * Two vocabularies the engine has always kept apart, in one table: the 34
 * `ObjectKind`s (stuff you can hold, and the objects standing in the world) and
 * the 20 `ResourceNodeKind`s (the places and organisms stuff is won FROM). The
 * order is each union's own, `ObjectKind` first — it decides the order a closed
 * vocabulary is listed back to a model that wrote something outside it.
 *
 * THE TAGS ARE A TRANSCRIPTION TOO. Each one names a set this engine already
 * keeps somewhere, and `test/world-tables-transcribed.test.ts` checks every one
 * against the constant it came from:
 *   object      — `ObjectKind` (also `schema.ts`'s old OBJECT_KIND_LIST)
 *   source      — `ResourceNodeKind` (`NODE_YIELD`'s keys)
 *   nourishing  — `WorldRegularities.NUTRITIOUS_FOODS`
 *   sickening   — `WorldRegularities.SICKENING_FOODS`
 *   edible      — the reflex policy's `EDIBLE` (what a being might TRY)
 *   material    — everything `CRAFT_RECIPES` consumes
 *   tool        — everything `CRAFT_RECIPES` produces
 *   structure   — `BuildKind` / `BUILD_COST`'s keys
 *   container   — the one structure that holds what is put in it
 *   diggable    — the reflex policy's `DIGGABLE`
 *   foodSource  — the reflex policy's `FOOD_NODES`
 *
 * A tag says what a thing AFFORDS, never what it does to you: `nightshade` is
 * `edible` here and the body will still make you sick, and discovering that is
 * the experiment.
 */

/** A row whose id the compiler still checks against this world's unions. */
type ForagerKindSchema = KindSchema & { readonly id: ForagerKind };

const kind = (id: ForagerKind, ...tags: AffordanceTag[]): ForagerKindSchema => ({ id, tags });

export const FORAGER_KINDS: readonly ForagerKindSchema[] = [
  // ── Stuff and objects (ObjectKind, in its own order) ──────────────────────
  // basic
  kind('water', 'object'),
  kind('wood', 'object', 'material'),
  kind('stone', 'object', 'material', 'diggable'),
  kind('clay', 'object', 'diggable'),
  kind('fiber', 'object', 'material'),
  kind('berry', 'object', 'edible', 'nourishing'),
  kind('tuber', 'object', 'edible', 'nourishing'),
  kind('seed', 'object'),
  kind('mushroomRed', 'object', 'edible', 'sickening'),
  kind('nightshade', 'object', 'edible', 'sickening'),
  // Meat feeds a body, but no reflex has ever reached for it: `EDIBLE` is what
  // a being TRIES, and this world's hunting is Slice 2.
  kind('meat', 'object', 'nourishing'),
  kind('hide', 'object'),
  // intermediate
  kind('charcoal', 'object'),
  kind('leather', 'object'),
  kind('rope', 'object', 'tool'),
  kind('spear', 'object', 'tool'),
  kind('club', 'object', 'tool'),
  kind('handaxe', 'object', 'tool'),
  kind('brick', 'object'),
  kind('copper', 'object'),
  kind('tin', 'object'),
  kind('iron', 'object'),
  kind('bronze', 'object'),
  // advanced
  kind('copperOre', 'object'),
  kind('tinOre', 'object'),
  kind('ironOre', 'object'),
  kind('coal', 'object'),
  kind('salt', 'object'),
  // rare
  kind('silver', 'object'),
  kind('gold', 'object'),
  kind('gemstone', 'object'),
  // built structures / world objects
  kind('shelter', 'object', 'structure'),
  kind('wall', 'object', 'structure'),
  kind('container', 'object', 'structure', 'container'),
  kind('corpse', 'object'),

  // ── Where things are won from (ResourceNodeKind, in `NODE_YIELD`'s order) ──
  // `ResourceNodeKind` is a type and has no runtime order to pin against, so
  // these follow `NODE_YIELD` — the table that says what each one gives — and
  // `world-tables-transcribed` holds them to it entry for entry.
  kind('berryBush', 'source', 'foodSource'),
  kind('foodPlant', 'source', 'foodSource'),
  kind('mushroomPatch', 'source', 'foodSource'),
  kind('tuberPlant', 'source', 'foodSource'),
  kind('nightshadePlant', 'source', 'foodSource'),
  kind('tree', 'source'),
  kind('stoneDeposit', 'source'),
  kind('waterSource', 'source'),
  kind('river', 'source'),
  kind('clayDeposit', 'source'),
  kind('fiberPlant', 'source'),
  kind('copperVein', 'source'),
  kind('tinVein', 'source'),
  kind('ironVein', 'source'),
  kind('coalSeam', 'source'),
  kind('saltFlat', 'source'),
  kind('silverVein', 'source'),
  kind('goldVein', 'source'),
  kind('gemVein', 'source'),
  kind('game', 'source'),
];
