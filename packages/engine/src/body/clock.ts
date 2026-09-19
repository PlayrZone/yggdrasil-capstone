/**
 * THE WORLD'S CLOCK, AND NOTHING ELSE — a leaf module that imports nothing.
 *
 * These four constants used to be split across `WorldRegularities.ts`
 * (`TICKS_PER_DAY`) and `Climate.ts` (the rest, derived from it), which put
 * `Climate → WorldRegularities → ResourceNodeSystem → Climate` in a cycle. In a
 * cycle the module that is entered SECOND runs against a half-initialised
 * first, so entering the body graph at `PerceptionSystem` left
 * `TICKS_PER_SEASON` and `TICKS_PER_YEAR` as `NaN` and `seasonAt()` returning
 * `undefined` — silently, and only for some import orders.
 *
 * A clock cannot depend on who imported what first. Both modules re-export
 * their own constants from here, so every existing import still resolves.
 * `test/body-module-order.test.ts` enters the graph at each body module in
 * turn and holds the constants finite.
 */
export const TICKS_PER_DAY = 2400;

export const SEASON_DAYS = 4;
export const TICKS_PER_SEASON = SEASON_DAYS * TICKS_PER_DAY;
export const TICKS_PER_YEAR = TICKS_PER_SEASON * 4;
