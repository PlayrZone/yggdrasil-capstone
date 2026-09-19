import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

/**
 * THE CLOCK DOES NOT DEPEND ON WHO IMPORTED WHAT FIRST (W1-B2, item 6).
 *
 * `Climate → WorldRegularities → ResourceNodeSystem → Climate` was a cycle, and
 * in a cycle the module entered SECOND runs against a half-initialised first:
 * entering the body graph at `PerceptionSystem` left `TICKS_PER_SEASON` and
 * `TICKS_PER_YEAR` as `NaN` and `seasonAt()` returning `undefined`. Silently,
 * and only for some import orders — which is why it survived a whole engine's
 * worth of tests that all happened to enter at `body/index.ts`.
 *
 * The four constants moved to `body/clock.ts`, a leaf that imports nothing, and
 * both modules re-export their own. This test enters a FRESH module graph at
 * every body module in turn and demands the clock be finite and the seasons
 * real, so the cycle cannot come back unnoticed.
 */

const BODY = fileURLToPath(new URL('../src/body/', import.meta.url));

/**
 * Written out rather than built from the listing: the bundler will not rewrite
 * a computed specifier, so each entry has to be a literal. The listing is then
 * checked against these keys, so a new body module fails here until it is
 * added and covered.
 */
const ENTRY_POINTS: Record<string, () => Promise<unknown>> = {
  Climate: () => import('../src/body/Climate.js'),
  clock: () => import('../src/body/clock.js'),
  contract: () => import('../src/body/contract.js'),
  GahallianBody: () => import('../src/body/GahallianBody.js'),
  genesis: () => import('../src/body/genesis.js'),
  identities: () => import('../src/body/identities.js'),
  index: () => import('../src/body/index.js'),
  PerceptionSystem: () => import('../src/body/PerceptionSystem.js'),
  prng: () => import('../src/body/prng.js'),
  ResourceNodeSystem: () => import('../src/body/ResourceNodeSystem.js'),
  SimEventBus: () => import('../src/body/SimEventBus.js'),
  WildlifeSystem: () => import('../src/body/WildlifeSystem.js'),
  WorldRegularities: () => import('../src/body/WorldRegularities.js'),
  YggdrasilSystem: () => import('../src/body/YggdrasilSystem.js'),
};

describe('the body clock is initialised whatever the import order', () => {
  it('covers every module in the body, with none invented', () => {
    const onDisk = readdirSync(BODY, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.ts'))
      .map((e) => e.name.replace(/\.ts$/, ''))
      .sort();
    expect(Object.keys(ENTRY_POINTS).sort()).toEqual(onDisk);
    expect(onDisk).toContain('PerceptionSystem'); // the entry that used to break
  });

  for (const [module, enter] of Object.entries(ENTRY_POINTS)) {
    it(`is finite when the graph is entered at ${module}`, async () => {
      vi.resetModules();
      await enter();

      const climate = await import('../src/body/Climate.js');
      const regularities = await import('../src/body/WorldRegularities.js');
      const clock = await import('../src/body/clock.js');

      for (const [name, value] of [
        ['TICKS_PER_DAY', regularities.TICKS_PER_DAY],
        ['SEASON_DAYS', climate.SEASON_DAYS],
        ['TICKS_PER_SEASON', climate.TICKS_PER_SEASON],
        ['TICKS_PER_YEAR', climate.TICKS_PER_YEAR],
      ] as const) {
        expect(Number.isFinite(value), `${name} after entering at ${module}`).toBe(true);
        expect(value, `${name} after entering at ${module}`).toBeGreaterThan(0);
      }

      // The values, not merely finite ones — a cycle that resolved to some
      // other number would be just as wrong.
      expect(regularities.TICKS_PER_DAY).toBe(2400);
      expect(climate.TICKS_PER_SEASON).toBe(climate.SEASON_DAYS * regularities.TICKS_PER_DAY);
      expect(climate.TICKS_PER_YEAR).toBe(climate.TICKS_PER_SEASON * 4);
      expect(clock.TICKS_PER_DAY).toBe(regularities.TICKS_PER_DAY);
      expect(clock.TICKS_PER_SEASON).toBe(climate.TICKS_PER_SEASON);

      // And the functions derived from them still answer.
      expect(climate.seasonAt(0)).toBe('spring');
      expect(climate.seasonAt(climate.TICKS_PER_SEASON * 3)).toBe('winter');
      expect(climate.seasonAt(climate.TICKS_PER_YEAR)).toBe('spring');
      expect(regularities.isNight(0)).toBe(false);
      expect(regularities.isNight(Math.floor(regularities.TICKS_PER_DAY * 0.9))).toBe(true);

      // And the world's declared clock is the body's own, from this entry too.
      const { foragerAdapter } = await import('../src/worlds/forager/adapter.js');
      expect(foragerAdapter.time.ticksPerSeason).toBe(climate.TICKS_PER_SEASON);
      expect(foragerAdapter.time.seasonAt(climate.TICKS_PER_SEASON)).toBe('summer');
    });
  }
});
