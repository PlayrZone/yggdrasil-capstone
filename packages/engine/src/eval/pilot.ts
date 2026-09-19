import { runAb } from './ab.js';
import type { AbResult, AbVerdict } from './ab.js';
import type { JudgeAggregate } from './aggregate.js';
import { judgeTraces } from './aggregate.js';
import { MockTraceJudge } from './judge.js';
import { pairTraces } from './pairing.js';
import {
  JUDGE_GATE,
  judgeGatePower,
  pairsForJudgePower,
  wilsonInterval,
} from './stats.js';
import type { Interval, JudgeGateRule } from './stats.js';
import type { ArmId } from './types.js';

/**
 * THE PILOT MEASURES; IT DOES NOT DECIDE (decision D1, amended).
 *
 * Four rounds tried to squeeze a verdict out of ≤ 2,000 calls and four rounds
 * produced flattering arithmetic: a 1,120-call block with 0.0015 power, a
 * 40-pair block sized under a tie rate nothing had measured, a 64-pair block
 * whose pairs all came from one run. Each time the number printed beside the
 * block said it would work, because each time the number came from an
 * ASSUMPTION rather than from a measurement.
 *
 * A pilot's job is to measure the NUISANCE PARAMETERS the confirmatory design
 * needs — the judge's tie rate, how often it contradicts itself under order
 * reversal, how much of its preference is common to a run (ρ), what a being
 * actually costs in calls, how often a completion has to be retried, what the
 * leak judge's recall really is, and whether the arms ran their own minds. With
 * intervals, because a point estimate is what got the last four rounds here.
 *
 * So the artefact this file produces carries `role: 'pilot-estimation'` and
 * `usableForVerdict: false` **as a literal type**. There is no branch that sets
 * it true, no option that moves it, and nothing to post-process: a compiler
 * error is the only way to try. `designConfirmatory` then turns the estimates
 * into a design, with power computed at the PESSIMISTIC end of every measured
 * interval; running that design needs the owner's approval and is out of scope.
 */

// ─── The recipe, declared before anything is run ─────────────────────────────

export interface PilotRecipe {
  /**
   * SEEDS, MANY AND SMALL. One seed × two arms is one cluster (S1), so the
   * budget buys independent runs rather than more pairs inside one run —
   * which is also the only way ρ can be estimated at all.
   */
  seeds: number;
  /** Beings given a slow mind, per arm, per seed. Small on purpose. */
  cohortSize: number;
  /** Founders per run. */
  agentCount: number;
  ticks: number;
  arms: readonly [ArmId, ArmId];
  /** Block (a): the held-out labelled set for the tier-3 leak judge. */
  calibrationItems: number;
  /** …of which re-judged, for the judge's own self-consistency. */
  calibrationRejudged: number;
  /** `LlmMind` retries once on an unreadable reply; head-room as a share. */
  retryHeadRoomRate: number;
  /** The budget this recipe must fit inside. */
  budgetLimit: number;
}

export const PILOT_RECIPE: PilotRecipe = Object.freeze({
  seeds: 10,
  cohortSize: 4,
  agentCount: 16,
  ticks: 900,
  arms: ['A', 'B'] as const,
  calibrationItems: 184,
  calibrationRejudged: 46,
  retryHeadRoomRate: 0.1,
  budgetLimit: 2000,
});

// ─── The estimates ───────────────────────────────────────────────────────────

/** A measured rate, with the interval that says how little one pilot can pin down. */
export interface Estimate {
  value: number;
  interval: Interval;
  /** What the rate was measured over. A rate with no n is a decoration. */
  n: number;
}

export interface PilotEstimates {
  /** Share of SHOWINGS the judge called a tie — the parameter the gate is sized under. */
  judgeTieRate: Estimate;
  /** Share of pairs whose two orders agreed at all (ties count as agreement). */
  bothOrdersConsistencyRate: Estimate;
  /** Among pairs both orders decided, the share that named the same arm. Chance is 0.50. */
  decidedAgreementRate: Estimate | null;
  /**
   * How much of the judge's preference is common to a RUN. Null when too few
   * seeds had two decisive pairs — which is information, not a gap: it says the
   * pilot needs to be spread wider still.
   */
  betweenRunIcc: { rho: number; seeds: number; interval: Interval } | null;
  /** Completions per being per tick budget — what block (b) actually costs. */
  callsPerBeing: { completions: number; beings: number; ticks: number; perBeing: number };
  /** Share of thinks that needed a second completion, per arm. */
  retryRate: Record<string, number>;
  /** Share of thinks the world carried instead of the mind, per arm — at the SOURCE. */
  fallbackRate: Record<string, number>;
  /**
   * The tier-3 leak judge's recall and precision as LOWER BOUNDS. Null when the
   * calibration block was not run (it is paid, and this file never pays).
   */
  leakJudgeCalibration: { recall: Estimate; precision: Estimate } | null;
  /** Per arm: did it run its own mind, and was anything refused or idle. */
  integrityByArm: Record<string, { parsedIntactRate: number; refusalRate: number; idleShare: number; acceptedPerBeing: number }>;
}

/**
 * THE PILOT ARTEFACT. `usableForVerdict` is the literal `false`: no code path
 * can produce one that says otherwise, and `role` names what it is.
 */
export interface PilotArtefact {
  role: 'pilot-estimation';
  usableForVerdict: false;
  seeds: readonly string[];
  estimates: PilotEstimates;
  /** What this pilot cost, block by block, as measured rather than as planned. */
  calls: PilotCallTable;
  /** The gate rule the estimates are FOR. Never applied here. */
  ruleHash: string;
  note: string;
}

// ─── The dry run: the arithmetic comes from the code ─────────────────────────

export interface PilotCallBlock {
  id: string;
  what: string;
  calls: number;
}

export interface PilotCallTable {
  blocks: PilotCallBlock[];
  /** Everything above, before head-room. */
  subtotal: number;
  retryHeadRoom: number;
  total: number;
  budgetLimit: number;
  reserve: number;
  /** False when the recipe does not fit — the one thing this table exists to say. */
  fits: boolean;
  /** Measured, not assumed: completions ÷ beings, over the recipe's tick budget. */
  thinksPerBeing: number;
  /** The recipe these numbers came from. */
  recipe: PilotRecipe;
}

/**
 * RUN THE EXACT PILOT PATH WITH A COUNTING MOCK BACKEND AND COUNT (S7).
 *
 * Round 4's table said 1,024 calls for block (b) and the reviewer counted 918
 * through `runAb` — because thinks per being are a function of TICKS and the
 * trait cadence and the README quoted neither. The README now quotes THIS
 * function's output, and `test/eval-pilot.test.ts` pins the two together: if
 * the cadence changes, the test fails and the README is wrong on purpose
 * instead of by accident.
 *
 * Nothing here can cost anything: the arms are mocks, there is no budget and no
 * door context, and the judge is the deterministic rule-based one.
 */
export async function dryRunPilot(recipe: PilotRecipe = PILOT_RECIPE): Promise<PilotCallTable> {
  return (await executePilot(recipe, 'pilot-dry')).table;
}

/**
 * ONE PASS, both products: the measured call table and the run the estimates
 * are read off. `dryRunPilot` and `runPilotEstimation` differ only in what they
 * keep, so they must not differ in what they RUN — a README that quoted one
 * arithmetic while the pilot executed another is the whole of S7.
 */
async function executePilot(
  recipe: PilotRecipe,
  label: string,
): Promise<{ table: PilotCallTable; result: AbResult; pairs: ReturnType<typeof pairTraces>['pairs']; seeds: string[] }> {
  const seeds = Array.from({ length: recipe.seeds }, (_, i) => `${label}-${i}`);
  const result = await runAb(
    {
      seeds,
      ticks: recipe.ticks,
      cohortSize: recipe.cohortSize,
      agentCount: recipe.agentCount,
      blindSecret: `${label}-secret-0123456789abcdef`.slice(0, 32),
    },
    {
      arms: [
        { id: recipe.arms[0], backend: { kind: 'mock', mind: 'faithful' } },
        { id: recipe.arms[1], backend: { kind: 'mock', mind: 'omniscient' } },
      ],
    },
    'population',
  );
  if (!result.usable) throw new Error(`the pilot path could not complete: ${result.reason} — ${result.detail}`);

  const pairing = pairTraces(result.traces, result.key, seeds.join('+'), [recipe.arms[0], recipe.arms[1]]);
  const beings = recipe.seeds * recipe.cohortSize * recipe.arms.length;
  const traceCalls = result.integrity.completions;
  const judgeCalls = pairing.pairs.length * 2;
  const blocks: PilotCallBlock[] = [
    { id: 'a', what: `calibrate the tier-3 leak judge against ${recipe.calibrationItems} already-labelled outputs`, calls: recipe.calibrationItems },
    { id: 'a2', what: `${recipe.calibrationRejudged} of them judged a second time, for the judge's self-consistency`, calls: recipe.calibrationRejudged },
    {
      id: 'b',
      what:
        `${recipe.seeds} seeds x ${recipe.cohortSize} beings/arm x ${recipe.arms.length} arms at ${recipe.ticks} ticks ` +
        `= ${beings} beings, MEASURED through runAb`,
      calls: traceCalls,
    },
    { id: 'b2', what: `${pairing.pairs.length} pairs x 2 orders (pairs never cross a seed)`, calls: judgeCalls },
  ];
  const subtotal = blocks.reduce((s, b) => s + b.calls, 0);
  // Head-room is on the blocks that actually go through `LlmMind`, which is the
  // only thing that retries. The calibration blocks are single judge calls.
  const retryHeadRoom = Math.ceil((traceCalls + judgeCalls) * recipe.retryHeadRoomRate);
  const total = subtotal + retryHeadRoom;
  return {
    table: {
      blocks,
      subtotal,
      retryHeadRoom,
      total,
      budgetLimit: recipe.budgetLimit,
      reserve: recipe.budgetLimit - total,
      fits: total <= recipe.budgetLimit,
      thinksPerBeing: Math.round((traceCalls / beings) * 100) / 100,
      recipe,
    },
    result,
    pairs: pairing.pairs,
    seeds,
  };
}

/** The allowance a run of this recipe is handed, from the table it measured. */
export function allowanceFor(table: PilotCallTable): number {
  const traces = table.blocks.find((b) => b.id === 'b')?.calls ?? 0;
  return traces + Math.ceil(traces * table.recipe.retryHeadRoomRate);
}

// ─── Turning a run into estimates ────────────────────────────────────────────

/**
 * Read the nuisance parameters off a completed run and its aggregate. Nothing
 * here can print a verdict: the aggregate's own `usableForVerdict` is ignored,
 * and the artefact's is the literal `false`.
 */
export function estimatePilot(
  result: AbVerdict,
  aggregate: JudgeAggregate,
  table: PilotCallTable,
  calibration?: { recallHits: number; recallOf: number; precisionHits: number; precisionOf: number },
): PilotArtefact {
  const showings = aggregate.showings;
  const ties = aggregate.position.ties;
  const beings = table.recipe.seeds * table.recipe.cohortSize * table.recipe.arms.length;
  const decided = aggregate.decisivePairs + aggregate.contradictedPairs;

  const retryRate: Record<string, number> = {};
  const fallbackRate: Record<string, number> = {};
  for (const [arm, row] of Object.entries(result.integrity.thinkOutcomes)) {
    if (row.thinks === 0) continue;
    retryRate[arm] = row.retryRate;
    fallbackRate[arm] = row.fallbackRate;
  }
  const integrityByArm: PilotEstimates['integrityByArm'] = {};
  for (const [arm, row] of Object.entries(result.integrity.byArm)) {
    integrityByArm[arm] = {
      parsedIntactRate: row.parsedIntactRate,
      refusalRate: row.refusalRate,
      idleShare: row.idleShare,
      // S6 of round 4: the primary metric moves with how many impossible acts an
      // arm pads its plan with, so accepted-acts-per-being travels beside it.
      acceptedPerBeing: beings > 0 ? Math.round((row.accepted / beings) * 100) / 100 : 0,
    };
  }

  return {
    role: 'pilot-estimation',
    usableForVerdict: false,
    seeds: result.seeds,
    estimates: {
      judgeTieRate: estimate(ties, showings),
      bothOrdersConsistencyRate: estimate(
        Math.round(aggregate.bothOrdersConsistencyRate * aggregate.pairs),
        aggregate.pairs,
      ),
      decidedAgreementRate: decided > 0 ? estimate(aggregate.decisivePairs, decided) : null,
      betweenRunIcc: aggregate.betweenRunIcc,
      callsPerBeing: {
        completions: result.integrity.completions,
        beings,
        ticks: table.recipe.ticks,
        perBeing: beings > 0 ? Math.round((result.integrity.completions / beings) * 100) / 100 : 0,
      },
      retryRate,
      fallbackRate,
      leakJudgeCalibration: calibration
        ? {
            recall: estimate(calibration.recallHits, calibration.recallOf),
            precision: estimate(calibration.precisionHits, calibration.precisionOf),
          }
        : null,
      integrityByArm,
    },
    calls: table,
    ruleHash: aggregate.design.ruleHash,
    note:
      'PILOT — ESTIMATION ONLY. This artefact measures the nuisance parameters a confirmatory design needs and ' +
      'CANNOT return a verdict: `usableForVerdict` is the literal false and no code path sets it otherwise. Every ' +
      'rate carries an interval because one pilot pins none of them down; feed them to `designConfirmatory`, which ' +
      'sizes the real block at the PESSIMISTIC end of each interval.',
  };
}

function estimate(hits: number, of: number): Estimate {
  return { value: of > 0 ? Math.round((hits / of) * 10000) / 10000 : 0, interval: wilsonInterval(hits, of), n: of };
}

// ─── From estimates to a confirmatory design ─────────────────────────────────

export interface ConfirmatoryTargets {
  /** The per-showing win rate the confirmatory block must be powered for. */
  effect: number;
  power: number;
  /** Seeds are clusters; this is the floor the family correction imposes. */
  minSeeds: number;
  /** Price per call, for the cost line. Zero when unknown. */
  costPerCall: number;
}

export interface ConfirmatoryDesign {
  /** Independent runs. The n of every test. */
  seeds: number;
  /** Pairs bought inside each seed. */
  pairsPerSeed: number;
  pairs: number;
  beingsPerArmPerSeed: number;
  /** The tie rate the design was sized at — the PESSIMISTIC end of the measured interval. */
  sizedAtTieRate: number;
  /** The ICC the design was sized at, likewise pessimistic. */
  sizedAtIcc: number;
  /** Power at those pessimistic values, through the same enumeration the gate uses. */
  powerAtPessimistic: number;
  /** Completions the whole thing costs, head-room included. */
  calls: number;
  cost: number;
  /** False when no design under the search cap reaches the target at these estimates. */
  reachable: boolean;
  /** What the design rests on, in words, naming which estimate moved which number. */
  note: string;
}

/**
 * SIZE THE CONFIRMATORY BLOCK FROM MEASURED VALUES, AT THE PESSIMISTIC END.
 *
 * The tie rate is taken at the HIGH end of its interval (more ties, fewer
 * decisive pairs, less power) and the ICC at the HIGH end of its (more of the
 * judge's preference common to a run, so pairs inside a run count for less).
 * The design inflates the pairs it buys per seed by the usual cluster factor
 * `1 + (m − 1)ρ` and spends the rest of the budget on SEEDS, because seeds are
 * what the test's n is.
 *
 * Running the design it returns needs the owner's approval. Nothing in this
 * file runs it.
 */
export function designConfirmatory(
  estimates: PilotEstimates,
  targets: ConfirmatoryTargets,
  rule: JudgeGateRule = JUDGE_GATE,
): ConfirmatoryDesign {
  const tie = Math.min(0.95, estimates.judgeTieRate.interval.high);
  const rho = Math.min(1, estimates.betweenRunIcc?.interval.high ?? 0.5);
  const pairsNeeded = pairsForJudgePower(targets.power, rule, 400, { effect: targets.effect, tieRate: tie });
  const seeds = Math.max(targets.minSeeds, rule.minDecisiveClusters);
  // The effective number of independent pairs inside a cluster of m is
  // m / (1 + (m − 1)ρ), so buying `m` per seed buys less than `m`. Solve for the
  // m that makes `seeds` clusters carry `pairsNeeded` effective pairs.
  const perSeedEffective = pairsNeeded !== null ? pairsNeeded / seeds : Number.POSITIVE_INFINITY;
  const pairsPerSeed =
    pairsNeeded === null
      ? 0
      : rho >= 1
        ? Math.ceil(perSeedEffective * 8)
        : Math.max(1, Math.ceil(perSeedEffective / Math.max(0.05, 1 - rho * (perSeedEffective - 1) / Math.max(1, perSeedEffective))));
  const pairs = seeds * pairsPerSeed;
  const perBeing = Math.max(1, estimates.callsPerBeing.perBeing);
  const traceCalls = Math.ceil(seeds * pairsPerSeed * 2 * perBeing);
  const judgeCalls = pairs * 2;
  const retry = Math.max(...Object.values(estimates.retryRate), 0);
  const calls = Math.ceil((traceCalls + judgeCalls) * (1 + retry));
  const power = pairsNeeded === null ? 0 : judgeGatePower(pairs, rule, { effect: targets.effect, tieRate: tie }).power;
  return {
    seeds,
    pairsPerSeed,
    pairs,
    beingsPerArmPerSeed: pairsPerSeed,
    sizedAtTieRate: round(tie),
    sizedAtIcc: round(rho),
    powerAtPessimistic: round(power),
    calls,
    cost: Math.round(calls * targets.costPerCall * 100) / 100,
    reachable: pairsNeeded !== null && power >= targets.power,
    note:
      `Sized at the PESSIMISTIC end of every measured interval: tie rate ${round(tie)} (measured ` +
      `${estimates.judgeTieRate.value} over ${estimates.judgeTieRate.n} showings, interval ` +
      `[${estimates.judgeTieRate.interval.low}, ${estimates.judgeTieRate.interval.high}]) and ICC ${round(rho)} ` +
      `(${estimates.betweenRunIcc ? `measured ${estimates.betweenRunIcc.rho} over ${estimates.betweenRunIcc.seeds} seeds` : 'NOT MEASURED — 0.5 assumed, which is the reviewer\'s 0.38-type-I cell'}). ` +
      `${seeds} seeds because the unit of analysis is the RUN and the declared family needs ${rule.minDecisiveClusters}; ` +
      `${pairsPerSeed} pairs inside each because a cluster of m carries m/(1+(m-1)rho) independent pairs. ` +
      'RUNNING THIS NEEDS THE OWNER\'S APPROVAL.',
  };
}

/** The mock-only end-to-end estimation pass, for tests and for the README. */
export async function runPilotEstimation(recipe: PilotRecipe = PILOT_RECIPE): Promise<{
  result: AbResult;
  aggregate: JudgeAggregate | null;
  artefact: PilotArtefact | null;
  table: PilotCallTable;
}> {
  const executed = await executePilot(recipe, 'pilot-est');
  const result = executed.result;
  if (!result.usable) return { result, aggregate: null, artefact: null, table: executed.table };
  const aggregate = await judgeTraces(executed.pairs, result.key, new MockTraceJudge(), {
    arms: [recipe.arms[0], recipe.arms[1]],
    integrity: result.attestation,
  });
  return { result, aggregate, artefact: estimatePilot(result, aggregate, executed.table), table: executed.table };
}

function round(v: number): number {
  return Math.round(v * 10000) / 10000;
}
