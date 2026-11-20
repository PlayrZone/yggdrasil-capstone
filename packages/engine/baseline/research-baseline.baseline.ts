import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { Experiment } from '../src/runner/Experiment.js';
import type { ScenarioId } from '../src/runner/options.js';
import { ENGINE_VERSION } from '../src/version.js';
import { fingerprintOf } from '../test/fingerprint.js';

interface RunSpec {
  readonly name: string;
  readonly scenario: ScenarioId;
  readonly seed: string;
  readonly beings: number;
  readonly ticks: number;
  /** Also run `<seed>-other` for this many ticks and require a different fingerprint. */
  readonly otherSeedPrefix?: number;
  /** Also advance in two halves and compare against the single advance. */
  readonly splitCheck?: boolean;
  /** Throughput probe: repeat at full ticks only if run A took at most this long, else at `fallbackRepeatTicks`. */
  readonly repeatBudgetMs?: number;
  readonly fallbackRepeatTicks?: number;
}

export const RUNS: readonly RunSpec[] = [
  { name: 'classic-100',  scenario: 'forager-classic',   seed: 'cos650-m2-classic',     beings: 100,  ticks: 4800, otherSeedPrefix: 400, splitCheck: true },
  { name: 'continent-60', scenario: 'forager-continent', seed: 'cos650-m2-continent',   beings: 60,   ticks: 4800, otherSeedPrefix: 400 },
  { name: 'classic-300',  scenario: 'forager-classic',   seed: 'cos650-m2-classic-300', beings: 300,  ticks: 2400, otherSeedPrefix: 400 },
  { name: 'classic-1000', scenario: 'forager-classic',   seed: 'cos650-m2-scale',       beings: 1000, ticks: 600,  repeatBudgetMs: 60_000, fallbackRepeatTicks: 200 },
];

const TICKS_PER_DAY = 2400;
const SPEECH_ACTS = ['share-knowledge', 'share-episode', 'inform', 'request'] as const;

interface Check {
  name: string;
  pass: boolean;
  detail: string;
}

interface Measured {
  exp: Experiment;
  fingerprint: string;
  eventsObserved: number;
  utterances: number;
  utterancesByAct: Record<string, number>;
  constructMs: number;
  advanceMs: number;
}

/**
 * Build and advance one run. Utterances are counted from a bus listener, not
 * from `eventLog`, because the log is capped at 400 events. The listener only
 * reads, and every run in this file carries one, so it cannot split A from B.
 */
function measure(spec: RunSpec, seed: string, advances: readonly number[]): Measured {
  const t0 = performance.now();
  const exp = new Experiment({ seed, agentCount: spec.beings, scenario: spec.scenario });
  const t1 = performance.now();
  let eventsObserved = 0;
  let utterances = 0;
  const utterancesByAct: Record<string, number> = Object.fromEntries(SPEECH_ACTS.map((a) => [a, 0]));
  const off = exp.bus.on((ev) => {
    eventsObserved++;
    if (ev.type !== 'UtteranceSpoken') return;
    utterances++;
    const act = (ev.payload['utterance'] as { speechAct?: string } | undefined)?.speechAct ?? 'unknown';
    utterancesByAct[act] = (utterancesByAct[act] ?? 0) + 1;
  });
  const t2 = performance.now();
  for (const n of advances) exp.advance(n);
  const t3 = performance.now();
  off();
  return {
    exp,
    fingerprint: fingerprintOf(exp),
    eventsObserved,
    utterances,
    utterancesByAct,
    constructMs: t1 - t0,
    advanceMs: t3 - t2,
  };
}

function round(v: number, places = 1): number {
  const f = 10 ** places;
  return Math.round(v * f) / f;
}

function git(args: string[]): string | undefined {
  try {
    return execFileSync('git', args, { cwd: PACKAGE_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return undefined;
  }
}

const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url));

function csvCell(v: unknown): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

describe('research baseline', () => {
  it('runs every seeded configuration, proves repeatability, and writes the evidence', () => {
    const started = performance.now();
    const checks: Check[] = [];
    const runs: Record<string, unknown>[] = [];
    const csvRows: Record<string, string | number>[] = [];
    const summary: string[][] = [];
    const check = (name: string, pass: boolean, detail: string): boolean => {
      checks.push({ name, pass, detail });
      return pass;
    };

    for (const spec of RUNS) {
      const a = measure(spec, spec.seed, [spec.ticks]);
      const exp = a.exp;
      const aWallMs = a.constructMs + a.advanceMs;

      let repeatTicks = spec.ticks;
      let repeatA = a.fingerprint;
      let repeatNote = 'run B advanced the same ticks as run A';
      if (spec.repeatBudgetMs !== undefined && aWallMs > spec.repeatBudgetMs) {
        repeatTicks = spec.fallbackRepeatTicks ?? spec.ticks;
        repeatA = measure(spec, spec.seed, [repeatTicks]).fingerprint;
        repeatNote = `run A took ${round(aWallMs / 1000)} s (> ${spec.repeatBudgetMs / 1000} s budget), so the repeat check uses fresh A/B runs at ${repeatTicks} ticks`;
      }
      const b = measure(spec, spec.seed, [repeatTicks]);
      const repeatPass = check(`${spec.name}: same seed -> same fingerprint`, b.fingerprint === repeatA,
        `A=${repeatA} B=${b.fingerprint} @${repeatTicks} ticks; ${repeatNote}`);

      let otherSeed: Record<string, unknown> | undefined;
      if (spec.otherSeedPrefix !== undefined) {
        const n = spec.otherSeedPrefix;
        const ref = measure(spec, spec.seed, [n]);
        const other = measure(spec, `${spec.seed}-other`, [n]);
        const metricsOf = (m: Measured) => ({
          events: m.exp.eventCount, alive: m.exp.aliveCount(), births: m.exp.birthCount,
          utterances: m.utterances, knowledge: m.exp.totalKnowledge(),
        });
        const refMetrics = metricsOf(ref);
        const otherMetrics = metricsOf(other);
        const metricsDiffer = JSON.stringify(refMetrics) !== JSON.stringify(otherMetrics);
        const pass = check(`${spec.name}: different seed -> different fingerprint`, other.fingerprint !== ref.fingerprint,
          `@${n} ticks: seed=${ref.fingerprint} seed-other=${other.fingerprint}; ` +
          `(the digest hashes the seed string itself; simulated metrics also differ: ${metricsDiffer})`);
        otherSeed = {
          ticks: n, seedFingerprint: ref.fingerprint, otherSeed: `${spec.seed}-other`,
          otherFingerprint: other.fingerprint, pass, metricsDiffer, seedMetrics: refMetrics, otherMetrics,
        };
      }

      let split: Record<string, unknown> | undefined;
      if (spec.splitCheck) {
        const half = spec.ticks / 2;
        const s = measure(spec, spec.seed, [half, spec.ticks - half]);
        const pass = check(`${spec.name}: ${half}+${spec.ticks - half} ticks == ${spec.ticks} in one call`,
          s.fingerprint === a.fingerprint, `single=${a.fingerprint} split=${s.fingerprint}`);
        split = { advances: [half, spec.ticks - half], singleFingerprint: a.fingerprint, splitFingerprint: s.fingerprint, pass };
      }

      check(`${spec.name}: backend is reflex (no model called)`, exp.backendLabel === 'reflex', `backendLabel=${exp.backendLabel}`);
      check(`${spec.name}: bus listener saw every counted event`, a.eventsObserved === exp.eventCount,
        `observed=${a.eventsObserved} eventCount=${exp.eventCount}`);
      check(`${spec.name}: share-knowledge utterances == shareCount`, a.utterancesByAct['share-knowledge'] === exp.shareCount,
        `utterances=${a.utterancesByAct['share-knowledge']} shareCount=${exp.shareCount}`);

      const seconds = a.advanceMs / 1000;
      const stepsPerSecond = round(spec.ticks / seconds, 2);
      const shareKnowledgeFraction = a.utterances > 0 ? round((a.utterancesByAct['share-knowledge'] ?? 0) / a.utterances, 4) : 0;
      const deaths = { ...exp.deathsByCause };
      const deathsCell = Object.keys(deaths).sort().map((k) => `${k}:${deaths[k]}`).join(';');

      const metrics = {
        ticks: exp.tick,
        simDays: exp.tick / TICKS_PER_DAY,
        beingsAtStart: spec.beings,
        aliveAtEnd: exp.aliveCount(),
        births: exp.birthCount,
        deathsByCause: deaths,
        deathsTotal: Object.values(deaths).reduce((s, v) => s + v, 0),
        eventCount: exp.eventCount,
        utterances: a.utterances,
        utterancesBySpeechAct: a.utterancesByAct,
        shareKnowledgeFraction,
        shares: exp.shareCount,
        builds: exp.buildCount,
        exchanges: exp.exchangeCount,
        conflicts: exp.conflictCount,
        totalKnowledge: exp.totalKnowledge(),
        backendLabel: exp.backendLabel,
        geographyId: exp.geography.id,
      };
      runs.push({
        name: spec.name,
        scenario: spec.scenario,
        seed: spec.seed,
        beings: spec.beings,
        ticks: spec.ticks,
        metrics,
        repeat: { ticks: repeatTicks, fingerprintA: repeatA, fingerprintB: b.fingerprint, pass: repeatPass, note: repeatNote },
        fingerprintAtEnd: a.fingerprint,
        ...(otherSeed ? { otherSeed } : {}),
        ...(split ? { splitAdvance: split } : {}),
        wallClock: { constructMs: round(a.constructMs), advanceMs: round(a.advanceMs), stepsPerSecond },
      });

      const row: Record<string, string | number> = {
        name: spec.name, scenario: spec.scenario, seed: spec.seed, beings: spec.beings, ticks: exp.tick,
        simDays: metrics.simDays, aliveAtEnd: metrics.aliveAtEnd, births: metrics.births,
        deathsTotal: metrics.deathsTotal, deathsByCause: deathsCell, events: metrics.eventCount,
        utterances: metrics.utterances,
      };
      for (const act of Object.keys(a.utterancesByAct).sort()) row[`utt_${act}`] = a.utterancesByAct[act] ?? 0;
      Object.assign(row, {
        shareKnowledgeFraction, shares: metrics.shares, builds: metrics.builds, exchanges: metrics.exchanges,
        conflicts: metrics.conflicts, totalKnowledge: metrics.totalKnowledge, backendLabel: metrics.backendLabel,
        geographyId: metrics.geographyId, fingerprint: a.fingerprint, repeatTicks, repeat: repeatPass ? 'PASS' : 'FAIL',
        advanceMs: round(a.advanceMs), stepsPerSecond,
      });
      csvRows.push(row);
      summary.push([spec.name, String(spec.beings), String(exp.tick), String(metrics.aliveAtEnd), String(metrics.eventCount),
        stepsPerSecond.toFixed(2), a.fingerprint, `${repeatPass ? 'PASS' : 'FAIL'}${repeatTicks !== spec.ticks ? ` @${repeatTicks}` : ''}`]);
    }

    const outDir = process.env['YGG_BASELINE_OUT'] || join(PACKAGE_ROOT, 'baseline', 'results');
    mkdirSync(outDir, { recursive: true });
    const totalMs = performance.now() - started;
    const status = git(['status', '--porcelain']);
    const results = {
      generatedAt: new Date().toISOString(),
      engineVersion: ENGINE_VERSION,
      node: process.version,
      platform: `${process.platform}-${process.arch}`,
      cpuModel: cpus()[0]?.model.trim() ?? 'unknown',
      logicalCpus: cpus().length,
      gitCommit: git(['rev-parse', 'HEAD'])?.trim() ?? 'unknown',
      gitDirty: status === undefined ? 'unknown' : status.trim().length > 0,
      totalWallMs: round(totalMs),
      runs,
      checks,
    };
    writeFileSync(join(outDir, 'baseline-results.json'), `${JSON.stringify(results, null, 2)}\n`);

    const columns = [...new Set(csvRows.flatMap((r) => Object.keys(r)))];
    const csv = [columns.join(','), ...csvRows.map((r) => columns.map((c) => csvCell(r[c] ?? '')).join(','))].join('\n');
    writeFileSync(join(outDir, 'baseline-metrics.csv'), `${csv}\n`);

    const header = ['run', 'beings', 'ticks', 'alive', 'events', 'steps/s', 'fingerprint', 'repeat'];
    const widths = header.map((h, i) => Math.max(h.length, ...summary.map((r) => (r[i] ?? '').length)));
    const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i] ?? 0)).join('  ').trimEnd();
    const failed = checks.filter((c) => !c.pass);
    const text = [
      `Yggdrasil research baseline — engine ${ENGINE_VERSION}, ${results.gitCommit.slice(0, 12)}${results.gitDirty === true ? ' (dirty)' : ''}, ${results.generatedAt}`,
      `${results.cpuModel} x${results.logicalCpus}, node ${results.node}, backend reflex (no model called)`,
      '',
      line(header),
      line(widths.map((w) => '-'.repeat(w))),
      ...summary.map(line),
      '',
      `checks: ${checks.length - failed.length}/${checks.length} pass${failed.length ? ` — FAILED: ${failed.map((c) => c.name).join('; ')}` : ''}`,
      `total wall time: ${round(totalMs / 1000)} s`,
    ].join('\n');
    writeFileSync(join(outDir, 'baseline-summary.txt'), `${text}\n`);
    console.log(`\n${text}\nwritten to ${outDir}`);

    expect(failed, failed.map((c) => `${c.name}: ${c.detail}`).join('\n')).toEqual([]);
  });
});
