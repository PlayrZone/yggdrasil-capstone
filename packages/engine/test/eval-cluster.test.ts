import { describe, expect, it } from 'vitest';
import {
  CLUSTER_RHO_GRID,
  DECLARED_CONTRAST_FAMILY,
  JUDGE_GATE,
  MIN_PAIRED_SEEDS,
  betweenRunIcc,
  clusterJudgeGate,
  clustersOf,
  exactBinomialTwoSided,
  formatP,
  holmAdjusted,
  judgeGateDesign,
  judgeTraces,
  minimumPairedSeeds,
  pairedBootstrap,
  signFlipPermutation,
  signTest,
} from '../src/index.js';
import type { PairedSample } from '../src/index.js';
import { lcg, pairLevelVerdict, simulate, stochasticJudge } from './eval-simulation.js';

/**
 * S1, S2, S3/S5, S8 — THE UNIT OF ANALYSIS, THE POWER OF THE BLOCK THAT RAN,
 * AND THE TWO TESTS A VERDICT NEEDS.
 *
 * S1. The reviewer's finding, in one line: block (b) bought ONE seed, and in
 * population mode each arm is its own `Experiment`, so arm A's 64 beings share
 * one world and arm B's share another. `judgeGatePower` and the sign test
 * treated the 64 pairs as 64 independent Bernoulli draws and there was no
 * cluster term anywhere in `stats.ts`. Under a run-exchangeable null the gate
 * printed a VERDICT 0.0280 / 0.0713 / 0.3833 / 0.9340 of the time at
 * ρ = 0 / 0.10 / 0.25 / 0.50 — a judge quirk of 0.05 common to the run already
 * put type I at 1.4× α.
 *
 * Every number below is measured HERE, through the REAL `judgeTraces`, over a
 * ρ grid declared in `cluster.ts` before any of it was run.
 */

const ALPHA = JUDGE_GATE.alpha;

/**
 * P(the REAL gate prints a verdict) under a run-exchangeable null: the judge
 * has no merit preference on average (w = 0.5), but each RUN gets a shift of
 * ±ρ/2 that every pair of that run shares.
 */
async function typeIAtRho(
  rho: number,
  seeds: number,
  pairsPerSeed: number,
  runs: number,
  seed: number,
  mode: 'cluster' | 'pooled-pairs',
): Promise<number> {
  const sim = simulate(seeds, pairsPerSeed, JUDGE_GATE, `rho${String(rho).replace('.', '')}`);
  const rng = lcg(seed);
  let printed = 0;
  for (let run = 0; run < runs; run++) {
    // A fresh draw of the per-run shifts every replication: mean 0 across runs,
    // constant within one. Drawn from the same independent LCG, never the engine's.
    const shifts = new Map<string, number>();
    for (const pair of sim.pairs) {
      if (!shifts.has(pair.cluster)) shifts.set(pair.cluster, (rng() < 0.5 ? -1 : 1) * (rho / 2));
    }
    // A FRESH key per replication: `judgeTraces` unseals, and a re-judged key
    // is `blind: false` and refused. See `Simulation.fresh`.
    const run2 = sim.fresh();
    const aggregate = await judgeTraces(
      sim.pairs,
      run2.key,
      stochasticJudge(0.5, 0.3, 0.5, sim.armOf, rng, (c) => shifts.get(c) ?? 0),
      { arms: ['A', 'B'], integrity: run2.attestation },
    );
    // `pooled-pairs` is round 4's rule, reconstructed: the pair-level gate with
    // no cluster term at all. It is here so the table has a control.
    if (mode === 'cluster' ? aggregate.usableForVerdict : pairLevelVerdict(aggregate)) printed++;
  }
  return printed / runs;
}

describe('W1-E · S1 · the unit of analysis is the RUN, not the pair', () => {
  it('reproduces the reviewer\'s pseudo-replication on the OLD pair-level rule, and holds alpha on the new one', async () => {
    // 8 seeds x 8 pairs = 64 pairs, the same block round 4 priced — but laid
    // out as eight independent runs instead of one.
    const runs = 600;
    const rows: string[] = [];
    let worstCluster = 0;
    let seed = 20260920;
    for (const rho of CLUSTER_RHO_GRID) {
      const pooled = await typeIAtRho(rho, 8, 8, runs, (seed += 104729), 'pooled-pairs');
      const clustered = await typeIAtRho(rho, 8, 8, runs, (seed += 104729), 'cluster');
      worstCluster = Math.max(worstCluster, clustered);
      rows.push(
        `  rho ${rho.toFixed(2)}: round-4 pair-level rule ${pooled.toFixed(4)}  ·  round-5 cluster rule ${clustered.toFixed(4)}`,
      );
      // THE BAR: type I at or below alpha at EVERY pre-registered rho, through
      // the real gate. Monte-Carlo slack of 2 standard errors at alpha.
      const slack = 2 * Math.sqrt((ALPHA * (1 - ALPHA)) / runs);
      expect(clustered, `cluster-level type I at rho ${rho}`).toBeLessThanOrEqual(ALPHA + slack);
    }
    // eslint-disable-next-line no-console
    console.log(
      [
        '',
        `S1 · P(a VERDICT is printed) under a run-exchangeable null, 8 seeds x 8 pairs, ${runs} runs/cell,`,
        '   through the REAL judgeTraces, tie rate 0.30, w = 0.50:',
        ...rows,
        `   pre-registered rho grid: [${CLUSTER_RHO_GRID.join(', ')}], alpha ${ALPHA}`,
      ].join('\n'),
    );
    // And the control has to actually break, or the table is a demonstration
    // rather than a test: the old rule must inflate as rho grows.
    const worstPooled = await typeIAtRho(0.5, 8, 8, runs, 999331, 'pooled-pairs');
    expect(worstPooled).toBeGreaterThan(ALPHA * 2);
    expect(worstCluster).toBeLessThanOrEqual(ALPHA + 0.02);
  }, 900_000);

  it('prices what the cluster rule COSTS, so the pilot can size for it', async () => {
    /**
     * A gate whose type I is 0 is also a gate that may never fire, and a table
     * that printed only the type-I column would be hiding that. So: the same
     * block, the same rho grid, with a judge that really does prefer arm A at
     * the DECLARED 0.70 per showing.
     *
     * This is the number the estimation pilot exists to make sizable — it is
     * printed, not asserted against a target, because 8 x 8 is the SHAPE the
     * reviewer's block had and not a design anybody has approved.
     */
    const runs = 300;
    const rows: string[] = [];
    let seed = 515151;
    let best = 0;
    for (const rho of CLUSTER_RHO_GRID) {
      for (const shape of [
        // The reviewer's block, re-laid as clusters: too few decisive pairs per
        // seed, so most seeds land on exactly 0.5 and the sign test drops them.
        { seeds: 8, pairs: 8 },
        { seeds: 12, pairs: 16 },
        { seeds: 10, pairs: 32 },
      ]) {
        const sim = simulate(shape.seeds, shape.pairs, JUDGE_GATE, `pow${String(rho).replace('.', '')}x${shape.seeds}`);
        const rng = lcg((seed += 104729));
        let fired = 0;
        for (let run = 0; run < runs; run++) {
          const shifts = new Map<string, number>();
          for (const pair of sim.pairs) {
            if (!shifts.has(pair.cluster)) shifts.set(pair.cluster, (rng() < 0.5 ? -1 : 1) * (rho / 2));
          }
          const replication = sim.fresh();
          const aggregate = await judgeTraces(
            sim.pairs,
            replication.key,
            stochasticJudge(0.7, 0.3, 0.5, sim.armOf, rng, (c) => shifts.get(c) ?? 0),
            { arms: ['A', 'B'], integrity: replication.attestation },
          );
          if (aggregate.usableForVerdict && aggregate.cluster.meanDelta > 0) fired++;
        }
        if (rho === 0) best = Math.max(best, fired / runs);
        rows.push(
          `  rho ${rho.toFixed(2)}  ${String(shape.seeds).padStart(2)} seeds x ${String(shape.pairs).padStart(2)} pairs ` +
            `(${shape.seeds * shape.pairs} pairs): power ${(fired / runs).toFixed(4)}`,
        );
      }
    }
    // eslint-disable-next-line no-console
    console.log(
      ['', `S1 · POWER of the cluster rule at the declared effect w = 0.70, tie 0.30, ${runs} runs/cell:`, ...rows,
        '   The pairs-per-seed number is the one that matters: a seed with ~2 decisive pairs lands on exactly 0.5',
        '   about half the time, the sign test drops it, and the cluster n collapses. Sizing is designConfirmatory\'s job.'].join('\n'),
    );
    expect(rows.length).toBe(CLUSTER_RHO_GRID.length * 3);
    // THE GATE MUST BE ABLE TO FIRE. A rule with type I 0 and power 0 is not a
    // stricter rule, it is a broken one — so some declared shape has to reach a
    // usable power at the declared effect, or this whole design is unusable.
    expect(best, 'the cluster rule can reach power at the declared effect, at SOME shape').toBeGreaterThan(0.5);
  }, 1_800_000);

  it('refuses 64 pairs bought from ONE seed, whatever they say', async () => {
    const sim = simulate(1, 64, JUDGE_GATE, 'one-seed');
    const aggregate = await judgeTraces(sim.pairs, sim.key, stochasticJudge(1, 0, 0.5, sim.armOf, lcg(11)), {
      arms: ['A', 'B'],
      integrity: sim.attestation,
    });
    // A judge that prefers arm A on every single showing of all 64 pairs.
    expect(aggregate.wins.A).toBe(64);
    expect(aggregate.exactP).toBeLessThan(1e-6);
    expect(formatP(aggregate.exactP)).toBe('< 1e-6');
    // …and it decides nothing, because it is one run.
    expect(aggregate.cluster.clusters).toBe(1);
    expect(aggregate.cluster.decisiveClusters).toBe(1);
    expect(aggregate.usableForVerdict).toBe(false);
    expect(aggregate.note).toMatch(/One seed is n = 1/);
    expect(aggregate.note).toMatch(/64 pairs from one run are one observation/);
  }, 120_000);

  it('does print a verdict when the seeds are there, and names the seed count', async () => {
    const sim = simulate(MIN_PAIRED_SEEDS, 8, JUDGE_GATE, 'enough');
    const aggregate = await judgeTraces(sim.pairs, sim.key, stochasticJudge(1, 0, 0.5, sim.armOf, lcg(12)), {
      arms: ['A', 'B'],
      integrity: sim.attestation,
    });
    expect(aggregate.cluster.decisiveClusters).toBe(MIN_PAIRED_SEEDS);
    expect(aggregate.cluster.permutation?.p).toBeLessThanOrEqual(ALPHA);
    expect(aggregate.cluster.sign?.p).toBeLessThanOrEqual(ALPHA);
    expect(aggregate.cluster.bothTestsPass).toBe(true);
    expect(aggregate.design.role).toBe('confirmatory');
    expect(aggregate.usableForVerdict).toBe(true);
    expect(aggregate.note).toMatch(/SEEDS decisive/);
  }, 120_000);

  it('estimates the between-run correlation instead of assuming it', () => {
    // Three shapes, hand-built: no between-run structure, a lot of it, and one
    // that cannot be estimated at all.
    const flat = clustersOf(
      // 8 seeds x 5 pairs, alternating INSIDE each seed: all the variance is
      // within a run and none of it between.
      Array.from({ length: 40 }, (_, i) => ({
        cluster: `s${Math.floor(i / 5)}`,
        preferred: i % 2 === 0 ? 'A' : 'B',
        contradicted: false,
      })),
      'A',
      'B',
    );
    const split = clustersOf(
      // The same 8 seeds, but every pair of a run agrees with its run: all the
      // variance is BETWEEN runs, which is what round 4 assumed away.
      Array.from({ length: 40 }, (_, i) => ({
        cluster: `s${Math.floor(i / 5)}`,
        preferred: Math.floor(i / 5) < 4 ? 'A' : 'B',
        contradicted: false,
      })),
      'A',
      'B',
    );
    const low = betweenRunIcc(flat);
    const high = betweenRunIcc(split);
    expect(low).not.toBeNull();
    expect(high).not.toBeNull();
    expect(high!.rho).toBeGreaterThan(low!.rho);
    expect(high!.rho).toBeGreaterThan(0.5);
    // Too few seeds to say anything: null, not zero.
    expect(betweenRunIcc(clustersOf([{ cluster: 's0', preferred: 'A', contradicted: false }], 'A', 'B'))).toBeNull();
    // eslint-disable-next-line no-console
    console.log(`\nS1 · ICC: unstructured ${low!.rho} [${low!.interval.low}, ${low!.interval.high}] · run-structured ${high!.rho} [${high!.interval.low}, ${high!.interval.high}]`);
  });
});

describe('W1-E · S2 · a result knows its own power', () => {
  it('prints the power of the block that RAN, not the power it was sized for', async () => {
    // The reviewer's run 3, rebuilt: a realised tie rate of 0.5, where the true
    // power is 0.2618 and round 4 printed 0.802408 beside a verdict.
    const sim = simulate(8, 8, JUDGE_GATE, 'asrun');
    const aggregate = await judgeTraces(sim.pairs, sim.key, stochasticJudge(0.7, 0.5, 0.5, sim.armOf, lcg(21)), {
      arms: ['A', 'B'],
      integrity: sim.attestation,
    });
    expect(aggregate.design.power).toBeCloseTo(0.802408, 4);
    expect(aggregate.design.observedTieRate).toBeGreaterThan(0.4);
    expect(aggregate.design.poweredAsRun).toBeLessThan(0.35);
    expect(aggregate.design.adequatelyPoweredAsRun).toBe(false);
    expect(aggregate.design.role).toBe('underpowered-as-run');
    expect(aggregate.usableForVerdict).toBe(false);
    expect(aggregate.note).toMatch(/UNDERPOWERED AS RUN/);
    // …and never "no difference".
    expect(aggregate.note).toMatch(/absence of measurement/);
    // eslint-disable-next-line no-console
    console.log(
      `\nS2 · sized at tie ${aggregate.design.assumedTieRate} → power ${aggregate.design.power}; ` +
        `RAN at tie ${aggregate.design.observedTieRate} → power ${aggregate.design.poweredAsRun} (${aggregate.design.role})`,
    );
  }, 120_000);

  it('labels the assumptions ASSUMED until a pilot measures them', () => {
    expect(JUDGE_GATE.assumptionsMeasured).toBe(false);
    const design = judgeGateDesign(64, 20, JUDGE_GATE, { tieRate: 0.3, decidedAgreementRate: 0.6, decisiveClusters: 8 });
    expect(design.assumptionStatus).toBe('ASSUMED');
    expect(design.minDecisiveClusters).toBe(MIN_PAIRED_SEEDS);
  });

  it('refuses a coin-flip judge even when it is powered and clustered', () => {
    // 13 decisive pairs against 16 order-flips: the judge contradicted itself
    // more often than it agreed, and round 4 let that through at 0.15 decisive.
    const design = judgeGateDesign(64, 13, JUDGE_GATE, {
      tieRate: 0.3,
      decidedAgreementRate: 13 / (13 + 16),
      decisiveClusters: 8,
    });
    expect(design.observedDecidedAgreementRate).toBeLessThan(0.5);
    expect(design.role).not.toBe('confirmatory');
  });
});

describe('W1-E · S3/S5/S8 · two tests, and a family of four', () => {
  it('states its assumption as SIGN SYMMETRY, and shows what the round-4 claim was worth', () => {
    /**
     * Round 4's test drew `rng() < 0.5 ? draw() : -draw()`, FORCING sign
     * symmetry — on which the sign-flip test is exact TAUTOLOGICALLY, for
     * lognormal as for anything — and the README sold the resulting row as
     * "type I ≤ 0.05 on normal, lognormal and t₃ differences", i.e. as a fact
     * about SHAPE. It measured nothing about shape.
     *
     * Two nulls, and they are not the same null:
     *
     *   EXCHANGEABLE — the arm labels within a seed could be swapped. This is
     *     what a seed-paired A/B actually guarantees, and under it BOTH tests
     *     are exact at any shape. Round 4's generator is this one, correctly
     *     labelled at last.
     *   MEAN-ZERO SKEWED — the reviewer's: lognormal minus its mean. Its mean
     *     is 0 and its MEDIAN is about −0.65, so it is not exchangeable and it
     *     is not a null for the sign test either. The permutation test's level
     *     goes to 0.11 here, and that is the honest cost of the assumption.
     */
    const rng = lcg(31337);
    const normal = (): number => {
      const u = Math.max(1e-12, rng());
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
    };
    const lognormalMinusMean = (): number => Math.exp(normal()) - Math.exp(0.5);
    const cells: { label: string; draw: () => number; exchangeable: boolean; n: number }[] = [
      { label: 'n= 6 EXCHANGEABLE, normal magnitudes   ', draw: (): number => (rng() < 0.5 ? 1 : -1) * Math.abs(normal()), exchangeable: true, n: 6 },
      { label: 'n= 6 EXCHANGEABLE, lognormal magnitudes', draw: (): number => (rng() < 0.5 ? 1 : -1) * Math.exp(normal()), exchangeable: true, n: 6 },
      { label: 'n= 6 MEAN-ZERO SKEWED (NOT exchangeable)', draw: lognormalMinusMean, exchangeable: false, n: 6 },
      // At n = 6 the two tests coincide almost exactly — both reject only on a
      // clean sweep — so a row where they can DIVERGE is the honest one to
      // print beside them.
      { label: 'n=10 EXCHANGEABLE, lognormal magnitudes', draw: (): number => (rng() < 0.5 ? 1 : -1) * Math.exp(normal()), exchangeable: true, n: 10 },
      { label: 'n=10 MEAN-ZERO SKEWED (NOT exchangeable)', draw: lognormalMinusMean, exchangeable: false, n: 10 },
    ];
    const rows: string[] = [];
    const trials = 3000;
    for (const cell of cells) {
      let permutationRejects = 0;
      let signRejects = 0;
      let bothReject = 0;
      for (let t = 0; t < trials; t++) {
        const values = Array.from({ length: cell.n }, cell.draw);
        const p = signFlipPermutation(values, { seed: `skew-${t}` })?.p ?? 1;
        const s = signTest(values)?.p ?? 1;
        if (p <= 0.05) permutationRejects++;
        if (s <= 0.05) signRejects++;
        if (p <= 0.05 && s <= 0.05) bothReject++;
      }
      const perm = permutationRejects / trials;
      const sign = signRejects / trials;
      const both = bothReject / trials;
      rows.push(
        `  ${cell.label}: permutation ${perm.toFixed(4)} · sign ${sign.toFixed(4)} · BOTH REQUIRED ${both.toFixed(4)}`,
      );
      // The procedure that actually decides is "both must clear alpha", and it
      // can never be more liberal than either test alone. That is the whole
      // reason the sign test travels beside the permutation test.
      expect(both, `joint <= permutation on ${cell.label}`).toBeLessThanOrEqual(perm + 1e-9);
      expect(both, `joint <= sign on ${cell.label}`).toBeLessThanOrEqual(sign + 1e-9);
      if (cell.exchangeable) {
        // Under the null a seed-paired A/B EARNS, both hold their level at any shape.
        expect(perm, `permutation level, ${cell.label}`).toBeLessThanOrEqual(0.05 + 0.015);
        expect(sign, `sign level, ${cell.label}`).toBeLessThanOrEqual(0.05 + 0.015);
      } else {
        // And the round-4 claim must stay dead: if someone restores "holds its
        // level on lognormal differences", this assertion fails.
        expect(perm, 'the permutation test does NOT hold its level on mean-zero skew').toBeGreaterThan(0.05);
      }
    }
    // eslint-disable-next-line no-console
    console.log(
      ['', `S3/S5 · measured type I, alpha 0.05, ${trials} trials/cell:`, ...rows,
        '  the assumption is SIGN SYMMETRY, not a list of distributions.'].join('\n'),
    );
  }, 300_000);

  it('sets MIN_PAIRED_SEEDS from the DECLARED family under Holm, and it is 8', () => {
    expect(DECLARED_CONTRAST_FAMILY).toBe(4);
    // The reviewer computed 8 for a family of four. Verified, not quoted.
    expect(minimumPairedSeeds(0.05, 1)).toBe(6);
    expect(minimumPairedSeeds(0.05, 4)).toBe(8);
    expect(MIN_PAIRED_SEEDS).toBe(8);
    // The arithmetic, stated: 4 x 2/2^7 = 0.0625 > 0.05, 4 x 2/2^8 = 0.03125.
    expect((4 * 2) / Math.pow(2, 7)).toBeGreaterThan(0.05);
    expect((4 * 2) / Math.pow(2, 8)).toBeLessThanOrEqual(0.05);
    // At 7 seeds a clean sweep is p = 0.015625 uncorrected — significant alone,
    // and NOT significant as one of four.
    expect(exactBinomialTwoSided(7, 7)).toBeCloseTo(0.015625, 6);
    expect(holmAdjusted([
      { label: 'a', p: exactBinomialTwoSided(7, 7) },
      { label: 'b', p: 1 },
      { label: 'c', p: 1 },
      { label: 'd', p: 1 },
    ])[0]!.adjusted).toBeGreaterThan(0.05);
    expect(holmAdjusted([
      { label: 'a', p: exactBinomialTwoSided(8, 8) },
      { label: 'b', p: 1 },
      { label: 'c', p: 1 },
      { label: 'd', p: 1 },
    ])[0]!.adjusted).toBeLessThanOrEqual(0.05);
  });

  it('marks a row ineligible below 8 seeds and eligible at 8', () => {
    const rows = (n: number): PairedSample[] => Array.from({ length: n }, (_, i) => ({ seed: `s${i}`, a: 1, b: 0 }));
    expect(pairedBootstrap('m', rows(7)).verdictEligible).toBe(false);
    expect(pairedBootstrap('m', rows(8)).verdictEligible).toBe(true);
    // Both tests travel on the row, and both clear alpha on a clean sweep of 8.
    const eight = pairedBootstrap('m', rows(8));
    expect(eight.sign).not.toBeNull();
    expect(eight.sign!.p).toBeLessThanOrEqual(0.05);
    expect(eight.bothTestsPass).toBe(true);
    // …and the family-adjusted p is null until a contrast table corrects it.
    expect(eight.familyAdjustedP).toBeNull();
  });

  it('never prints an exact p of zero', () => {
    // The reviewer's S8: round 4's `exactBinomialTwoSided(60, 64)` was exactly
    // 0 and the note printed "exact two-sided p = 0".
    const p = exactBinomialTwoSided(60, 64);
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThan(1e-6);
    expect(formatP(p)).toBe('< 1e-6');
    expect(formatP(0.0625)).toBe('0.0625');
  });

  it('requires BOTH tests, so one alone cannot carry a cluster verdict', () => {
    // Eight seeds, seven of them favouring A and one dead against it hard
    // enough to move the mean: the permutation test on the MEAN can still be
    // dragged around by one extreme seed, and the sign test cannot.
    const lopsided = [0.5, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05].map((d, i) => ({
      seed: `s${i}`,
      pairs: 8,
      decisivePairs: 8,
      winsA: Math.round((0.5 + d) * 8),
      contradictedPairs: 0,
    }));
    const gate = clusterJudgeGate(lopsided, JUDGE_GATE);
    expect(gate.sign).not.toBeNull();
    expect(gate.permutation).not.toBeNull();
    expect(gate.bothTestsPass).toBe(gate.permutation!.p <= ALPHA && gate.sign!.p <= ALPHA);
  });
});
