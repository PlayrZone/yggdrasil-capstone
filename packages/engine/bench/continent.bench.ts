import { it } from 'vitest';
import { Experiment } from '../src/runner/Experiment.js';
import type { Entity } from '../src/core/Entity.js';
import type { Transform2D } from '../src/core/Transform2D.js';
import type { ScenarioId } from '../src/worlds/forager/scale.js';
import { scaleReport } from '../src/worlds/forager/scale.js';
import { FOUNDING_VALLEY } from '../src/world/continent.js';

/**
 * WHAT THE TRUE-SCALE WORLD COSTS, AND WHETHER IT WORKS AS A HOME.
 *
 *   pnpm --filter @yggdrasil/engine bench
 *
 * Reported in TOTAL terms — absolute milliseconds and absolute megabytes at
 * fixed checkpoints, for both scenarios — because a ratio can hide a
 * regression and once did.
 *
 * Budgets this file exists to check (M1):
 *   · world build < 10 s at 150 founders
 *   · steady-state tick cost ≤ 2× the classic world's at the same population
 *   · heap after 1 sim-day ≤ 2× classic
 *   · 300 beings × 1 sim-day headless in < 90 s
 *   · 12 sim-days at 150 founders: population viable, births happen, and the
 *     beings stay where living is possible
 */

const DAY = 2400;
const gc = (globalThis as { gc?: () => void }).gc;

function heapMb(): number {
  gc?.();
  return process.memoryUsage().heapUsed / 1e6;
}

function entityCount(exp: Experiment): { nodes: number; animals: number; total: number } {
  let nodes = 0;
  let animals = 0;
  exp.world.forEach((e: Entity) => {
    if (e.components['ResourceNode']) nodes++;
    if (e.components['Animal']) animals++;
  });
  return { nodes, animals, total: exp.world.size() };
}

function positions(exp: Experiment): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (const id of exp.agentIds) {
    if (!exp.agentBody(id)?.alive) continue;
    const t = exp.agentEntity(id)!.components['Transform2D'] as Transform2D;
    out.push({ x: t.x, y: t.y });
  }
  return out;
}

it('cost of a world sixteen times the size', () => {
  const rows: string[] = [];
  for (const scenario of ['forager-classic', 'forager-continent'] as ScenarioId[]) {
    const before = heapMb();
    const t0 = performance.now();
    const exp = new Experiment({ seed: 'bench-continent', agentCount: 150, scenario });
    exp.advance(1);
    const buildS = (performance.now() - t0) / 1000;
    const counts = entityCount(exp);

    const t1 = performance.now();
    exp.advance(DAY - 1);
    const daySec = (performance.now() - t1) / 1000;
    const heapDay1 = heapMb();

    // Steady state: a second day, at whatever population day one left behind.
    const alive = exp.aliveCount();
    const t2 = performance.now();
    exp.advance(600);
    const tickMs = (performance.now() - t2) / 600;

    rows.push(
      `${scenario.padEnd(18)} build ${buildS.toFixed(2)}s | ${String(counts.total).padStart(6)} entities ` +
        `(${counts.nodes} nodes, ${counts.animals} animals) | day 1 in ${daySec.toFixed(1)}s ` +
        `= ${(DAY / daySec).toFixed(0)} ticks/s | steady ${tickMs.toFixed(3)} ms/tick @ ${alive} alive | ` +
        `heap ${before.toFixed(0)} → ${heapDay1.toFixed(0)} MB`,
    );
  }
  console.log('\n' + rows.join('\n') + '\n');
}, 600_000);

it('300 beings for one sim-day on the continent', () => {
  const t0 = performance.now();
  const exp = new Experiment({ seed: 'bench-300', agentCount: 300, scenario: 'forager-continent' });
  exp.advance(DAY);
  const s = (performance.now() - t0) / 1000;
  console.log(
    `\n300 beings × 1 sim-day: ${s.toFixed(1)}s (budget 90) | ${(DAY / s).toFixed(0)} ticks/s | ` +
      `${exp.aliveCount()} alive | heap ${heapMb().toFixed(0)} MB\n`,
  );
}, 600_000);

it('twelve days in the valley: is it a home?', () => {
  const DAYS = 12;
  const exp = new Experiment({ seed: 'bench-home', agentCount: 150, scenario: 'forager-continent' });
  const rows: string[] = [
    'day | alive | births | deaths | mean m from valley | p90 | max | >1 km | wall s',
  ];
  for (let day = 1; day <= DAYS; day++) {
    const t0 = performance.now();
    exp.advance(DAY);
    const wall = (performance.now() - t0) / 1000;
    const at = positions(exp);
    const d = at
      .map((p) => Math.hypot(p.x - FOUNDING_VALLEY.x, p.y - FOUNDING_VALLEY.y))
      .sort((a, b) => a - b);
    const mean = d.reduce((s, v) => s + v, 0) / Math.max(1, d.length);
    const p90 = d[Math.floor(d.length * 0.9)] ?? 0;
    const far = d.filter((v) => v > 1000).length;
    const deaths = Object.values(exp.deathsByCause).reduce((s, v) => s + v, 0);
    rows.push(
      `${String(day).padStart(3)} | ${String(exp.aliveCount()).padStart(5)} | ${String(exp.birthCount).padStart(6)} | ` +
        `${String(deaths).padStart(6)} | ${mean.toFixed(0).padStart(18)} | ${p90.toFixed(0).padStart(4)} | ` +
        `${(d[d.length - 1] ?? 0).toFixed(0).padStart(5)} | ${String(far).padStart(5)} | ${wall.toFixed(1).padStart(6)}`,
    );
  }
  console.log(
    `\n${JSON.stringify(scaleReport('forager-continent'))}\n\n` +
      rows.join('\n') +
      `\n\ndeaths by cause: ${JSON.stringify(exp.deathsByCause)}\n` +
      `structures built: ${exp.buildCount} | knowledge held: ${exp.totalKnowledge()}\n`,
  );
}, 600_000);
