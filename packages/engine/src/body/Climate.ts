import type { Season } from './contract.js';
import { TICKS_PER_DAY, TICKS_PER_SEASON } from './clock.js';

/**
 * Deterministic seasons + coarse weather. Pure functions of the tick, so they
 * replay exactly and need no stored state. Seasons drive the year's survival
 * rhythm; winter is meant to be a serious challenge (forage collapses, cold
 * presses) — the pressure that can select for shelter and stored food.
 *
 * Year = 4 seasons × SEASON_DAYS days. Tune SEASON_DAYS to trade off how fast
 * a run cycles through winters against how long groups have to adapt. The
 * numbers themselves live in `./clock.js`, a leaf — see the cycle it breaks.
 */
export { SEASON_DAYS, TICKS_PER_SEASON, TICKS_PER_YEAR } from './clock.js';

const ORDER: Season[] = ['spring', 'summer', 'autumn', 'winter'];

export function seasonAt(tick: number): Season {
  return ORDER[Math.floor(tick / TICKS_PER_SEASON) % 4]!;
}

/** Plant growth/regrowth multiplier by season (winter = none). */
export function growthFactor(tick: number): number {
  switch (seasonAt(tick)) {
    case 'spring':
      return 1;
    case 'summer':
      return 1;
    case 'autumn':
      return 0.5;
    case 'winter':
      return 0;
  }
}

/** How much harder forage/survival is (0 easy … 1 brutal). Winter bites. */
export function coldPressure(tick: number): number {
  switch (seasonAt(tick)) {
    case 'summer':
      return 0;
    case 'spring':
      return 0.1;
    case 'autumn':
      return 0.3;
    case 'winter':
      return 1;
  }
}

/** Hunger burns faster in the cold. */
export function hungerRateMultiplier(tick: number): number {
  return 1 + coldPressure(tick) * 0.6;
}

export type Weather = 'clear' | 'rain' | 'storm' | 'drought' | 'heatwave' | 'coldsnap';

/**
 * Coarse daily weather, deterministic per day (no stored state, no RNG at
 * runtime). Weather is the episodic pressure layer; Slice 2 makes it bite
 * (growth/exposure/perception). For now it's surfaced for the Observatory and
 * the cold-snap nudge below.
 */
export function weatherAt(tick: number): Weather {
  const day = Math.floor(tick / TICKS_PER_DAY);
  const season = seasonAt(tick);
  // FNV-ish hash of the day → stable pseudo-random pick, biased by season.
  let h = (day * 2654435761) >>> 0;
  h ^= h >>> 13;
  const r = (h >>> 0) / 4294967296;
  if (season === 'winter') return r < 0.5 ? 'coldsnap' : r < 0.7 ? 'storm' : 'clear';
  if (season === 'summer') return r < 0.2 ? 'heatwave' : r < 0.35 ? 'drought' : r < 0.6 ? 'clear' : 'rain';
  if (season === 'spring') return r < 0.55 ? 'rain' : r < 0.7 ? 'storm' : 'clear';
  return r < 0.4 ? 'rain' : r < 0.55 ? 'storm' : 'clear'; // autumn
}
