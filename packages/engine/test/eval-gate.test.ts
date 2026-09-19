import { describe, expect, it } from 'vitest';
import {
  JUDGE_GATE,
  JUDGE_GATE_HASH,
  blindTraces,
  foragerAdapter,
  hashJudgeGate,
  judgeGateDesign,
  judgeGateOverrides,
  judgeGatePower,
  judgeTraces,
  minimumDetectableWins,
  pairsForJudgePower,
} from '../src/index.js';
import type {
  AggregateOptions,
  ArmId,
  BlindTrace,
  JudgeGateRule,
  RawBeingTrace,
  RunAttestation,
  Side,
  TraceJudgement,
  TracePair,
} from '../src/index.js';

/**
 * R1 AND R2 — THE GATE THAT COULD NOT RETURN A VERDICT, AND THE RULE THAT COULD
 * BE EDITED AFTER THE NUMBERS WERE IN.
 *
 * R1. Round 3's `judgeTraces` demanded that half of ALL judged pairs be
 * decisive, and a pair is decisive only when both showings name the same arm —
 * so every tie counts against that denominator. `judgeGatePower` modelled
 * P(A) = w², P(B) = (1−w)² and the rest inconsistent, WITH NO TIE MASS, and
 * never modelled the position check. The reviewer drove the REAL gate 2,000
 * times per cell and measured P(USABLE) = **0.0015** at w = 0.70, q = 0.30, 40
 * pairs, against a printed power of 0.827. The block bought no verdict and the
 * number beside it said it would.
 *
 * The fix is not a better number: it is that the gate and its power model are
 * now ONE enumeration, and this file holds them to each other by driving the
 * real `judgeTraces` through a judge whose tie rate and position preference are
 * known, at four tie rates and two position rates, and requiring the analytic
 * figure to land inside Monte-Carlo error every time.
 *
 * R2. `Object.isFrozen(JUDGE_GATE)` was FALSE and `judgeTraces` took
 * `options.gate`. The reviewer's repro — a rigged 21-of-40 split at exact
 * two-sided p = 0.8746 — printed `usableForVerdict: true` under
 * `{alpha: 0.9, minDecisiveRate: 0.01, declaredEffect: 0.99}`, and mutating
 * `JUDGE_GATE.alpha` in place made the DEFAULT path print it too. Both
 * reproductions are below, and both must now end refused.
 */

const CLEAN: RunAttestation = { degraded: false, reasons: [] };

/** Deterministic, seeded, and NOT the engine's own PRNG — this is an independent check. */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function simulationPairs(count: number): {
  pairs: TracePair[];
  key: ReturnType<typeof blindTraces>['key'];
  armOf: Map<string, ArmId>;
} {
  const moment = {
    t: 0,
    day: 1,
    night: false,
    season: 'spring',
    felt: [{ drive: 'hunger', pressure: 40 }],
    perceived: [{ kind: 'berryBush', count: 1 }],
    others: 0,
    carried: [{ kind: 'berry', count: 1 }],
    thought: 'the same words in every trace',
    did: ['Wait()'],
    said: [],
    happened: null,
  };
  const lives: RawBeingTrace[] = [];
  for (const arm of ['A', 'B'] as const) {
    for (let i = 0; i < count; i++) lives.push({ runId: `sim-${arm}`, arm, beingId: i + 1, moments: [{ ...moment }] });
  }
  const blinded = blindTraces(lives, foragerAdapter, { seed: 'gate-sim', secret: 'gate-sim-secret', minMoments: 1 });
  const armOf = new Map(blinded.key.unseal().map((k) => [k.traceId, k.arm]));
  const byArm = (arm: ArmId): BlindTrace[] => blinded.traces.filter((t) => armOf.get(t.traceId) === arm);
  const a = byArm('A');
  const b = byArm('B');
  const pairs = a.map((left, at) => ({ pairId: `sim-${at}`, left, right: b[at]! }));
  return { pairs, key: blinded.key, armOf };
}

/**
 * A judge with exactly the model `judgeGatePower` enumerates: it ties on a
 * share `q` of showings, answers by POSITION on a share `beta = 2|p − ½|` of
 * the rest, and otherwise prefers arm A with probability `w`.
 */
function stochasticJudge(
  w: number,
  q: number,
  p: number,
  armOf: Map<string, ArmId>,
  rng: () => number,
): { id: string; compare: (pair: TracePair) => Promise<TraceJudgement> } {
  const beta = Math.min(1, 2 * Math.abs(p - 0.5));
  const favouredSide: Side = p >= 0.5 ? 'left' : 'right';
  const judgement = (preference: Side): TraceJudgement => ({
    preference,
    confidence: preference === 'tie' ? 0 : 1,
    reasons: ['simulated'],
    byCriterion: {
      pursues: preference,
      consistent: preference,
      reactive: preference,
      social: preference,
      ignorance: preference,
    },
  });
  return {
    id: `stochastic-w${w}-q${q}-p${p}`,
    compare: (pair: TracePair): Promise<TraceJudgement> => {
      if (rng() < q) return Promise.resolve(judgement('tie'));
      if (rng() < beta) return Promise.resolve(judgement(favouredSide));
      const leftIsA = armOf.get(pair.left.traceId) === 'A';
      const picksA = rng() < w;
      return Promise.resolve(judgement(picksA === leftIsA ? 'left' : 'right'));
    },
  };
}

async function measureGate(
  pairCount: number,
  w: number,
  q: number,
  p: number,
  runs: number,
  seed: number,
): Promise<{ usable: number; forA: number }> {
  const { pairs, key, armOf } = simulationPairs(pairCount);
  const rng = lcg(seed);
  let usable = 0;
  let forA = 0;
  for (let run = 0; run < runs; run++) {
    const aggregate = await judgeTraces(pairs, key, stochasticJudge(w, q, p, armOf, rng), {
      arms: ['A', 'B'],
      integrity: CLEAN,
    });
    if (aggregate.usableForVerdict) {
      usable++;
      if (aggregate.design.minimumWins !== null && aggregate.wins.A >= aggregate.design.minimumWins) forA++;
    }
  }
  return { usable: usable / runs, forA: forA / runs };
}

// ─── R1 ──────────────────────────────────────────────────────────────────────

describe('W1-E · R1 · the gate and its power model are one thing', () => {
  it('reproduces the tie-free figures the reviewer verified, and prices in the position check', () => {
    // The reviewer's exact enumeration of round 3's model: power
    // 0.1975/0.7360/0.8093/0.8268/0.8803 at 10/30/38/40/50 pairs. This model
    // agrees on all of them BEFORE the position check and prices the check in
    // afterwards — which is the part round 3 called an upper bound and printed
    // anyway.
    const tieFree = { tieRate: 0, positionLeftRate: 0.5 };
    const roundThreeRule: JudgeGateRule = { ...JUDGE_GATE, minDecisiveRate: 0.5 };
    const rows = [10, 30, 38, 40, 50].map((pairs) => {
      const power = judgeGatePower(pairs, roundThreeRule, tieFree);
      return `  ${pairs} pairs: power ${power.power}, type I ${power.typeIError}, position voids ${power.positionVoidRate}`;
    });
    // eslint-disable-next-line no-console
    console.log(['', "round 3's rule (minDecisiveRate 0.5) with no ties, position check INCLUDED:", ...rows].join('\n'));
    expect(judgeGatePower(40, roundThreeRule, tieFree).expectedDecisiveRate).toBeCloseTo(0.58, 6);
    expect(judgeGatePower(40, roundThreeRule, tieFree).power).toBeCloseTo(0.8, 2);
    expect(judgeGatePower(10, roundThreeRule, tieFree).power).toBeCloseTo(0.1975, 2);
  });

  it('shows the 1,120-call block buying nothing the moment the judge ties — the R1 defect', () => {
    const roundThree: JudgeGateRule = { ...JUDGE_GATE, minDecisiveRate: 0.5 };
    const rows: string[] = [];
    for (const q of [0, 0.15, 0.3, 0.5]) {
      const power = judgeGatePower(40, roundThree, { tieRate: q, positionLeftRate: 0.5 });
      rows.push(`  tie ${q}: expected decisive ${power.expectedDecisiveRate} (floor 0.5 of 40), power ${power.power}`);
    }
    // eslint-disable-next-line no-console
    console.log(['', "round 3's 40-pair block, by tie rate:", ...rows].join('\n'));
    // The reviewer's measured 0.0015 at q = 0.30; the enumeration says 0.0029,
    // and 0.0015 was one 2,000-run sample of it.
    expect(judgeGatePower(40, roundThree, { tieRate: 0.3, positionLeftRate: 0.5 }).power).toBeLessThan(0.02);
    // Break-even for the old floor is a ~7% tie rate.
    expect(judgeGatePower(40, roundThree, { tieRate: 0.072, positionLeftRate: 0.5 }).expectedDecisiveRate).toBeLessThan(0.51);
  });

  it('pre-registers a tie rate and a position rate, with the reasoning', () => {
    expect(JUDGE_GATE.assumedTieRate).toBe(0.3);
    expect(JUDGE_GATE.assumedPositionLeftRate).toBe(0.5);
    expect(JUDGE_GATE.targetPower).toBe(0.8);
    expect(JUDGE_GATE.justification).toMatch(/TIE RATE/);
    expect(JUDGE_GATE.justification).toMatch(/POSITION LEFT RATE/);
    // The floor is half the decisive rate the assumptions imply, not a half of
    // everything judged.
    const expected = judgeGatePower(64, JUDGE_GATE).expectedDecisiveRate;
    expect(JUDGE_GATE.minDecisiveRate).toBeLessThan(expected);
    expect(JUDGE_GATE.minDecisiveRate).toBeCloseTo(expected / 2, 1);
  });

  it('sizes the design under those assumptions, and the answer fits the 2,000-call ceiling', () => {
    const needed = pairsForJudgePower(JUDGE_GATE.targetPower, JUDGE_GATE);
    expect(needed).toBe(64);
    expect(judgeGatePower(needed!, JUDGE_GATE).power).toBeGreaterThanOrEqual(0.8);
    expect(judgeGatePower(needed! - 1, JUDGE_GATE).power).toBeLessThan(0.8);

    // The pilot arithmetic, computed rather than quoted: two arms only, because
    // three do not fit. 8 thinks per being per arm, two orders per pair, the
    // 230-call calibration block, and 10% retry head-room.
    const pairs = needed!;
    const traces = pairs * 8 * 2;
    const judging = pairs * 2;
    const calibration = 184 + 46;
    const subtotal = traces + judging + calibration;
    const retries = Math.ceil(subtotal * 0.1);
    const total = subtotal + retries;
    // eslint-disable-next-line no-console
    console.log(
      `\npilot: ${pairs} pairs → traces ${traces} + judging ${judging} + calibration ${calibration} = ${subtotal}, ` +
        `retry head-room ${retries}, TOTAL ${total}, reserve ${2000 - total}`,
    );
    expect(total).toBeLessThanOrEqual(2000);
    expect(2000 - total).toBeGreaterThanOrEqual(300);
    // THREE arms does not fit, which is why the recipe drops A− rather than power.
    expect(Math.ceil((pairs * 8 * 3 + pairs * 4 + calibration) * 1.1)).toBeGreaterThan(2000);
  });

  it('matches a 2,000-run simulation through the REAL gate at every tie rate and both position rates', async () => {
    const pairCount = 64;
    const runs = 2000;
    const rows: string[] = [];
    let worst = 0;
    let seed = 20260919;
    for (const p of [0.5, 0.6]) {
      for (const q of [0, 0.15, 0.3, 0.5]) {
        const analytic = judgeGatePower(pairCount, JUDGE_GATE, { tieRate: q, positionLeftRate: p }).power;
        const measured = (await measureGate(pairCount, 0.7, q, p, runs, (seed += 7919))).usable;
        // Monte-Carlo error at 2,000 draws: 3 standard errors, never below a
        // floor that a rate near 0 or 1 still needs.
        const error = Math.max(0.012, 3 * Math.sqrt(Math.max(analytic * (1 - analytic), 1e-4) / runs));
        worst = Math.max(worst, Math.abs(measured - analytic));
        rows.push(
          `  tie ${q.toFixed(2)} position ${p.toFixed(2)}: analytic ${analytic.toFixed(4)} · simulated ` +
            `${measured.toFixed(4)} · |diff| ${Math.abs(measured - analytic).toFixed(4)} (allowed ${error.toFixed(4)})`,
        );
        expect(Math.abs(measured - analytic), `power at tie ${q}, position ${p}`).toBeLessThanOrEqual(error);
      }
    }
    // eslint-disable-next-line no-console
    console.log(['', `judge-gate power at ${pairCount} pairs, w = 0.70, ${runs} runs through the real gate:`, ...rows].join('\n'));
    expect(worst).toBeLessThan(0.05);
  }, 900_000);

  it('keeps type I at or below alpha under EVERY tie rate and under position bias', async () => {
    const rows: string[] = [];
    for (const q of [0, 0.15, 0.3, 0.5, 0.7, 0.9]) {
      const cells = [0.3, 0.4, 0.5, 0.55, 0.6, 0.7].map((p) => {
        const typeI = judgeGatePower(64, JUDGE_GATE, { tieRate: q, positionLeftRate: p }).typeIError;
        expect(typeI, `type I at tie ${q}, position ${p}`).toBeLessThanOrEqual(JUDGE_GATE.alpha);
        return typeI.toFixed(4);
      });
      rows.push(`  tie ${q.toFixed(2)}: ` + cells.join('  '));
    }
    // eslint-disable-next-line no-console
    console.log(['', 'type I at 64 pairs, position 0.30/0.40/0.50/0.55/0.60/0.70:', ...rows].join('\n'));

    // And through the real gate, at the pre-registered conditions.
    const measured = await measureGate(64, 0.5, 0.3, 0.5, 2000, 77777);
    // eslint-disable-next-line no-console
    console.log(`type I simulated at tie 0.30: ${measured.usable.toFixed(4)} against alpha ${JUDGE_GATE.alpha}`);
    expect(measured.usable).toBeLessThanOrEqual(JUDGE_GATE.alpha);
  }, 600_000);

  it('never lets a judge that always answers one side reach a verdict', async () => {
    const always = await measureGate(64, 0.5, 0, 1, 400, 4242);
    expect(always.usable).toBe(0);
    // Analytically too, for every effect size: one side means every pair flips
    // with the order, so nothing is ever decisive.
    for (const w of [0.5, 0.7, 1]) {
      expect(judgeGatePower(64, JUDGE_GATE, { effect: w, tieRate: 0, positionLeftRate: 1 }).power).toBe(0);
      expect(judgeGatePower(64, JUDGE_GATE, { effect: w, tieRate: 0, positionLeftRate: 0 }).power).toBe(0);
    }
    // And a judge that ties on everything is unmeasured, not unbiased.
    expect(judgeGatePower(64, JUDGE_GATE, { tieRate: 1 }).power).toBe(0);
  }, 300_000);

  it('labels an under-powered block exploratory and refuses it a verdict of either sign', async () => {
    // 40 pairs is round 3's block. Even with a judge that prefers arm A on
    // every single showing, it cannot print a verdict, because 40 pairs does
    // not reach 0.80 power under the pre-registration.
    const { pairs, key, armOf } = simulationPairs(40);
    const decisive = stochasticJudge(1, 0, 0.5, armOf, lcg(1));
    const aggregate = await judgeTraces(pairs, key, decisive, { arms: ['A', 'B'], integrity: CLEAN });
    expect(aggregate.wins.A).toBe(40);
    expect(aggregate.exactP).toBeLessThan(0.001);
    expect(aggregate.design.adequatelyPowered).toBe(false);
    expect(aggregate.design.role).toBe('exploratory');
    expect(aggregate.usableForVerdict).toBe(false);
    expect(aggregate.note).toMatch(/EXPLORATORY/);
    expect(aggregate.note).toMatch(/absence of measurement/);
  }, 120_000);

  it('does print a verdict at the size the design asks for', async () => {
    const { pairs, key, armOf } = simulationPairs(64);
    const decisive = stochasticJudge(1, 0, 0.5, armOf, lcg(2));
    const aggregate = await judgeTraces(pairs, key, decisive, { arms: ['A', 'B'], integrity: CLEAN });
    expect(aggregate.design.adequatelyPowered).toBe(true);
    expect(aggregate.design.role).toBe('confirmatory');
    expect(aggregate.preRegistered).toBe(true);
    expect(aggregate.usableForVerdict).toBe(true);
    expect(aggregate.note).toMatch(/Pre-registered rule/);
  }, 120_000);
});

// ─── R2 ──────────────────────────────────────────────────────────────────────

/** A judge that hands arm A exactly `wins` of the pairs and arm B the rest, in both orders. */
function riggedJudge(
  armOf: Map<string, ArmId>,
  winsForA: number,
): { id: string; compare: (pair: TracePair) => Promise<TraceJudgement> } {
  const seen = new Map<string, number>();
  let next = 0;
  const ordinal = (pair: TracePair): number => {
    const a = armOf.get(pair.left.traceId) === 'A' ? pair.left.traceId : pair.right.traceId;
    let at = seen.get(a);
    if (at === undefined) seen.set(a, (at = next++));
    return at;
  };
  return {
    id: 'rigged',
    compare: (pair: TracePair): Promise<TraceJudgement> => {
      const wantsA = ordinal(pair) < winsForA;
      const leftIsA = armOf.get(pair.left.traceId) === 'A';
      const preference: Side = wantsA === leftIsA ? 'left' : 'right';
      return Promise.resolve({
        preference,
        confidence: 1,
        reasons: ['rigged'],
        byCriterion: {
          pursues: preference,
          consistent: preference,
          reactive: preference,
          social: preference,
          ignorance: preference,
        },
      });
    },
  };
}

describe('W1-E · R2 · the pre-registration is a control, not a naming convention', () => {
  it('is deep-frozen, and a mutation throws rather than silently taking', () => {
    expect(Object.isFrozen(JUDGE_GATE)).toBe(true);
    // ESM is strict mode, so a write to a frozen property throws.
    expect(() => {
      (JUDGE_GATE as { alpha: number }).alpha = 0.9;
    }).toThrow();
    expect(JUDGE_GATE.alpha).toBe(0.05);
    expect(() => {
      (JUDGE_GATE as { minDecisiveRate: number }).minDecisiveRate = 0.01;
    }).toThrow();
    expect(JUDGE_GATE.minDecisiveRate).toBe(0.15);
    // The rule travels as a hash, so an artefact is bound to the text of it.
    expect(JUDGE_GATE_HASH).toBe(hashJudgeGate(JUDGE_GATE));
    expect(JUDGE_GATE_HASH).toMatch(/^[0-9a-f]{64}$/);
    expect(hashJudgeGate({ ...JUDGE_GATE, alpha: 0.9 })).not.toBe(JUDGE_GATE_HASH);
  });

  it("refuses the reviewer's 21-of-40 repro on the verdict path", async () => {
    const { pairs, key, armOf } = simulationPairs(40);
    const aggregate = await judgeTraces(pairs, key, riggedJudge(armOf, 21), { arms: ['A', 'B'], integrity: CLEAN });
    expect(aggregate.decisivePairs).toBe(40);
    expect(aggregate.wins.A).toBe(21);
    // The reviewer's number, reproduced.
    expect(aggregate.exactP).toBeCloseTo(0.8746, 3);
    expect(aggregate.preRegistered).toBe(true);
    expect(aggregate.usableForVerdict).toBe(false);
  }, 120_000);

  it('ignores a gate smuggled in beside the pre-registered one', async () => {
    const { pairs, key, armOf } = simulationPairs(40);
    // The round-3 call, verbatim. `AggregateOptions` no longer has a `gate`
    // field at all, so this is what an old caller (or an agent copying an old
    // example) would send; it must change nothing.
    const smuggled = {
      arms: ['A', 'B'] as [ArmId, ArmId],
      integrity: CLEAN,
      alpha: 0.9,
      gate: { alpha: 0.9, minDecisiveRate: 0.01, declaredEffect: 0.99 },
    } as unknown as AggregateOptions;
    const aggregate = await judgeTraces(pairs, key, riggedJudge(armOf, 21), smuggled);
    expect(aggregate.design.alpha).toBe(0.05);
    expect(aggregate.design.minDecisiveRate).toBe(0.15);
    expect(aggregate.design.declaredEffect).toBe(0.7);
    expect(aggregate.design.ruleHash).toBe(JUDGE_GATE_HASH);
    expect(aggregate.usableForVerdict).toBe(false);
  }, 120_000);

  it('lets an explicit exploratory path move a value, and stamps every one of them', async () => {
    const { pairs, key, armOf } = simulationPairs(40);
    const aggregate = await judgeTraces(pairs, key, riggedJudge(armOf, 21), {
      arms: ['A', 'B'],
      integrity: CLEAN,
      exploratory: {
        reason: "the reviewer's repro: what would a rule chosen after the numbers have said?",
        gate: { alpha: 0.9, minDecisiveRate: 0.01, declaredEffect: 0.99 },
      },
    });
    // It answers the question that was asked — and refuses to be a verdict.
    expect(aggregate.preRegistered).toBe(false);
    expect(aggregate.usableForVerdict).toBe(false);
    expect(aggregate.exploratoryReason).toMatch(/repro/);
    expect(aggregate.design.preRegistered).toBe(false);
    expect(aggregate.design.role).toBe('exploratory');
    expect(aggregate.design.ruleHash).not.toBe(JUDGE_GATE_HASH);
    const moved = Object.fromEntries(aggregate.design.overrides.map((o) => [o.field, [o.preRegistered, o.used]]));
    expect(moved['alpha']).toEqual([0.05, 0.9]);
    expect(moved['minDecisiveRate']).toEqual([0.15, 0.01]);
    expect(moved['declaredEffect']).toEqual([0.7, 0.99]);
    expect(aggregate.note).toMatch(/EXPLORATORY/);
    // eslint-disable-next-line no-console
    console.log(`\nR2 exploratory repro: ${aggregate.note}`);
  }, 120_000);

  it('reports the overrides of any rule handed to the design function', () => {
    expect(judgeGateOverrides(JUDGE_GATE)).toEqual([]);
    const loose: JudgeGateRule = { ...JUDGE_GATE, alpha: 0.9, minDecisiveRate: 0.01 };
    expect(judgeGateOverrides(loose).map((o) => o.field).sort()).toEqual(['alpha', 'minDecisiveRate']);
    const design = judgeGateDesign(40, 40, loose);
    expect(design.preRegistered).toBe(false);
    expect(design.role).toBe('exploratory');
    // The threshold itself is still the exact sign test at whatever alpha it was given.
    expect(design.minimumWins).toBe(minimumDetectableWins(40, 0.9).minimumWins);
  });
});
