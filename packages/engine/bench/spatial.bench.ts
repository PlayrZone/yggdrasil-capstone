import { it } from 'vitest';
import { Experiment } from '../src/runner/Experiment.js';
import type { VisitCounter } from '../src/core/World.js';

/**
 * How fast does the body scale with population?
 *
 *   pnpm --filter @yggdrasil/engine bench
 *
 * NOT part of `pnpm test` — the package's vitest config only collects
 * `test/**\/*.test.ts`; this runs under `bench/vitest.config.ts`.
 *
 * Two passes per size, so neither measurement distorts the other:
 *  1. timed — no counter installed, reports ticks/second;
 *  2. counted — a VisitCounter injected into the world, reporting how many
 *     entities the tick looked at across full scans, spatial queries,
 *     whole-kind `each` walks and the per-tick `reconcile`. It counts ENTITIES,
 *     not work: probing an empty grid cell costs something and adds nothing to
 *     this number, so treat visits/tick as the scaling metric and ticks/second
 *     (which includes everything) as the cost one.
 *
 * Reflex-only (no mind backend), one fixed seed, sizes chosen so each pass
 * stays well under two minutes. Tick budgets shrink with population because
 * the pre-index cost is O(agents × entities); they are per-size constants, so
 * ticks/second stays comparable across runs of this file.
 */

const SEED = 'bench-spatial';
const SIZES: { agents: number; timedTicks: number; countedTicks: number }[] = [
  { agents: 100, timedTicks: 1500, countedTicks: 200 },
  { agents: 300, timedTicks: 700, countedTicks: 120 },
  { agents: 1000, timedTicks: 250, countedTicks: 60 },
];

function ticksPerSecond(agents: number, ticks: number): { tps: number; ms: number; entities: number } {
  const exp = new Experiment({ seed: SEED, agentCount: agents });
  exp.advance(1); // spawn wildlife + settle the first tick out of the measurement
  const entities = exp.world.size();
  const t0 = performance.now();
  exp.advance(ticks);
  const ms = performance.now() - t0;
  return { tps: (ticks / ms) * 1000, ms, entities };
}

function visitsPerTick(agents: number, ticks: number): number {
  const exp = new Experiment({ seed: SEED, agentCount: agents });
  exp.advance(1);
  const counter: VisitCounter = { visits: 0 };
  exp.world.setVisitCounter(counter);
  exp.advance(ticks);
  exp.world.setVisitCounter(null);
  return counter.visits / ticks;
}

it('ticks/second and entity visits/tick by population', () => {
  const rows: string[] = [];
  for (const { agents, timedTicks, countedTicks } of SIZES) {
    const { tps, ms, entities } = ticksPerSecond(agents, timedTicks);
    const visits = visitsPerTick(agents, countedTicks);
    rows.push(
      `${String(agents).padStart(5)} beings | ${String(entities).padStart(5)} entities | ` +
        `${tps.toFixed(1).padStart(8)} ticks/s | ${(visits / 1000).toFixed(1).padStart(9)}k visits/tick | ` +
        `${timedTicks} ticks in ${(ms / 1000).toFixed(1)}s`,
    );
  }
  console.log('\n' + rows.join('\n') + '\n');
});
