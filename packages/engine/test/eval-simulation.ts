import { SealedTraceKey, attestRun, hashJudgeGate, JUDGE_GATE } from '../src/index.js';
import type { ArmId, BlindTrace, JudgeGateRule, RunAttestation, Side, TraceFeatures, TraceJudgement, TraceKey, TracePair } from '../src/index.js';

/**
 * THE SIMULATION HARNESS THE GATE TESTS SHARE.
 *
 * It exists in its own file for two reasons, both of them defects it fixes.
 *
 * ONE: round 4's harness called `blinded.key.unseal()` to learn which handle
 * was which arm, and then judged with that key — so every simulated run was, by
 * the round-5 rule, a run whose key had already been opened. The harness now
 * BUILDS the key from entries it already knows, which is the honest shape for a
 * simulation anyway: nothing is being blinded, the arms are the experiment's
 * own scaffolding, and `judgeTraces` is handed a key nobody has touched.
 *
 * TWO: it lays the pairs out in CLUSTERS. One seed × two arms is one
 * independent run, and a harness that produced 64 pairs with no seed structure
 * is the very pseudo-replication S1 is about.
 */

const FEATURES: TraceFeatures = {
  moments: 1,
  goalPersistence: 1,
  pastReference: 0,
  reactivity: 0,
  socialCoherence: 0,
  distinctActs: 1,
  actEntropy: 0,
  planSuccessRate: 1,
  unsupportedClaims: 0,
  ignoranceAdmissions: 0,
};

export interface Simulation {
  pairs: TracePair[];
  key: SealedTraceKey;
  /** The scaffolding: which handle the harness gave which arm. Never read by the gate. */
  armOf: Map<string, ArmId>;
  /** A CLEAN attestation, properly bound to this key and this rule. */
  attestation: RunAttestation;
  /**
   * A FRESH KEY AND ATTESTATION OVER THE SAME TRACES — what a Monte-Carlo cell
   * needs, and a fact about the round-5 rule rather than a convenience.
   *
   * `judgeTraces` unseals, and judging a key somebody has already unsealed is
   * stamped `blind: false` and refused (S4). So a simulation that judged ONE
   * key 600 times would measure 1 honest replication and 599 refusals — which
   * is exactly the mistake that made the first draft of the cluster type-I
   * table read 0.0000 in every cell. Each replication mints its own key.
   */
  fresh(): { key: SealedTraceKey; attestation: RunAttestation };
}

/**
 * `seeds` independent runs, `pairsPerSeed` pairs inside each. Handles are
 * ordinary opaque strings; nothing about them encodes an arm, and nothing in
 * `judgeTraces` reads this map.
 */
export function simulate(seeds: number, pairsPerSeed: number, rule: JudgeGateRule = JUDGE_GATE, label = 'sim'): Simulation {
  const entries: TraceKey[] = [];
  const traces = new Map<string, BlindTrace>();
  const pairs: TracePair[] = [];
  const armOf = new Map<string, ArmId>();
  let n = 0;
  for (let s = 0; s < seeds; s++) {
    const seed = `${label}-seed-${s}`;
    for (let i = 0; i < pairsPerSeed; i++) {
      const make = (arm: ArmId): BlindTrace => {
        const traceId = `h${(n++).toString(36).padStart(5, '0')}`;
        entries.push({ traceId, arm, seed, beingId: i + 1, runId: `${seed}-${arm}` });
        armOf.set(traceId, arm);
        const trace: BlindTrace = { traceId, text: 'the same words in every trace', features: FEATURES, moments: 1 };
        traces.set(traceId, trace);
        return trace;
      };
      const a = make('A');
      const b = make('B');
      // Left/right alternates, as `pairTraces` balances it by construction.
      const firstOnLeft = i % 2 === 0;
      pairs.push({
        pairId: `${label}-${s}-${i}`,
        cluster: seed,
        left: firstOnLeft ? a : b,
        right: firstOnLeft ? b : a,
      });
    }
  }
  const seedNames = Array.from({ length: seeds }, (_, s) => `${label}-seed-${s}`);
  let minted = 0;
  const fresh = (): { key: SealedTraceKey; attestation: RunAttestation } => {
    const key = new SealedTraceKey(entries, `${label}-public`, `${label}-secret-${(minted++).toString(36).padStart(16, '0')}`);
    return {
      key,
      attestation: attestRun(key, {
        degraded: false,
        reasons: [],
        thinkOutcomes: {},
        seeds: seedNames,
        ruleHash: hashJudgeGate(rule),
      }),
    };
  };
  const first = fresh();
  return { pairs, key: first.key, armOf, attestation: first.attestation, fresh };
}

/** Deterministic, seeded, and NOT the engine's own PRNG — an independent check. */
export function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export function judgement(preference: Side): TraceJudgement {
  return {
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
  };
}

/**
 * A judge with exactly the model `judgeGatePower` enumerates: it ties on a
 * share `q` of showings, answers by POSITION on a share `beta = 2|p − ½|` of
 * the rest, and otherwise prefers arm A with probability `w`.
 *
 * `shiftOf` is the S1 addition: a per-RUN offset to `w`, mean zero across runs.
 * That is the run-exchangeable null — every pair of a seed carries the same
 * quirk, which is exactly what one world, one winter and one set of neighbours
 * do to a cohort.
 */
export function stochasticJudge(
  w: number,
  q: number,
  p: number,
  armOf: Map<string, ArmId>,
  rng: () => number,
  shiftOf?: (cluster: string) => number,
): { id: string; compare: (pair: TracePair) => Promise<TraceJudgement> } {
  const beta = Math.min(1, 2 * Math.abs(p - 0.5));
  const favouredSide: Side = p >= 0.5 ? 'left' : 'right';
  return {
    id: `stochastic-w${w}-q${q}-p${p}`,
    compare: (pair: TracePair): Promise<TraceJudgement> => {
      if (rng() < q) return Promise.resolve(judgement('tie'));
      if (rng() < beta) return Promise.resolve(judgement(favouredSide));
      const leftIsA = armOf.get(pair.left.traceId) === 'A';
      const merit = Math.max(0, Math.min(1, w + (shiftOf ? shiftOf(pair.cluster) : 0)));
      const picksA = rng() < merit;
      return Promise.resolve(judgement(picksA === leftIsA ? 'left' : 'right'));
    },
  };
}

/**
 * THE PAIR-LEVEL RULE, ON ITS OWN — what `judgeGatePower` enumerates and
 * nothing more. The real gate now also applies the cluster-level test, which
 * the analytic model deliberately does not carry, so pinning the model against
 * `usableForVerdict` would be pinning it against a different rule. This reads
 * the same four conditions out of a finished aggregate.
 */
export function pairLevelVerdict(aggregate: {
  design: { enoughDecisive: boolean; minimumWins: number | null };
  wins: { A: number; B: number };
  position: { biased: boolean; undetermined: boolean };
}): boolean {
  const minimum = aggregate.design.minimumWins;
  if (!aggregate.design.enoughDecisive || minimum === null) return false;
  if (aggregate.wins.A < minimum && aggregate.wins.B < minimum) return false;
  return !aggregate.position.biased && !aggregate.position.undetermined;
}
