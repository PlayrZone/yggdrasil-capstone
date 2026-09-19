/**
 * THE MIND'S VOCABULARY OF NAMES (W1-B2).
 *
 * A mind that can live in any world may not know the names of any of them, so
 * every world-supplied name reaches it as one of these: an OPAQUE string whose
 * meaning is the `WorldAdapter`'s to declare, and the mind's only to carry,
 * compare and look up.
 *
 * PLAIN `string`, NOT A BRAND, and the direction of assignability is the whole
 * reason. A world's own literal union (`'AteFood' | 'GaveItem' | …`) is
 * assignable to `string`, so world data flows INTO the mind for free and
 * nothing on the world side had to be rewritten to hand it over. The reverse is
 * not assignable, so a world module that wants its narrow type back has to say
 * so explicitly, at its own edge, where a reader can see it — which is exactly
 * the asymmetry this step is about. A brand would invert it: every one of the
 * several hundred literals the forager world writes would need a cast, and it
 * would buy no safety the compiler can actually check, because what makes an id
 * VALID is whether the adapter DECLARED it — a question about data, asked in
 * `contract/gate.ts`.
 */

/** Names one kind of thing that can happen. Declared by `WorldAdapter.events`. */
export type EventId = string;

/** Names one pressure a being acts on. Declared by `WorldAdapter.drives`. */
export type DriveId = string;

/** Names one circumstance the miners look for. Declared by `WorldAdapter.context`. */
export type ContextFeatureId = string;

/**
 * Names one kind of thing that exists — a material, a structure, a resource.
 * `WorldAdapter.kinds` declares these from B3; until then nothing validates
 * them, and the mind merely carries them.
 */
export type KindId = string;

/** Drive pressures as a being feels them: one number per drive the world declares. */
export type DriveLevels = Record<DriveId, number>;

/** A change in pressure, per drive it moved. */
export type DriveDeltas = Partial<Record<DriveId, number>>;

/**
 * The circumstances a memory formed in, as named SLOTS. The keys are the
 * world's own slot names (`ContextSchema.source`) rather than feature ids,
 * because one slot can carry several features — an elevation number carries a
 * `highland` band — and the mind reads a slot only through a schema.
 */
export type ContextRecord = Record<string, boolean | number>;

/** How many of each kind of thing: an inventory, a recipe's inputs, a cache. */
export type ItemCounts = Partial<Record<KindId, number>>;
