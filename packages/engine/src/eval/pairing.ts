import { hashSeed, mulberry32 } from '../body/prng.js';
import type { SealedTraceKey } from './trace.js';
import type { ArmId, BlindTrace } from './types.js';

/**
 * PAIRING — the experimenter's step, deliberately not the judge's.
 *
 * It lives in its own file because of where round 1 put it: `pairTraces` sat in
 * `judge.ts` and read the arm key to split the two groups, which meant the
 * module that defines judges imported the answer key. Nothing was leaking
 * through it, but "the judging code path cannot read the key" is a claim about
 * the import graph, and the import graph said otherwise.
 *
 * `judge.ts` now imports `TracePair` from here and nothing else, and a
 * `TracePair` carries two traces, a bookkeeping id, and no arm.
 */

export interface TracePair {
  /** Bookkeeping only. It is never sent to a judge — see `LlmTraceJudge`. */
  pairId: string;
  /**
   * THE CLUSTER (S1): the seed both of these traces came from. Never sent to a
   * judge either, and never an arm — both arms of a seed carry the same string.
   * `judgeTraces` groups by it, because a pair is not an independent
   * observation and a run is.
   */
  cluster: string;
  left: BlindTrace;
  right: BlindTrace;
}

/** Where each side came from, recorded so the placement is auditable. */
export interface PairPlacement {
  pairId: string;
  /** 0 = the first group's trace sat on the left in the forward order; 1 = the second's. */
  leftGroup: 0 | 1;
}

export interface PairingManifest {
  seed: string;
  groups: [ArmId, ArmId];
  pairs: number;
  /** Traces of the larger group that had no partner. */
  unpaired: number;
  /** True when left/right was balanced by construction, not by coin flips. */
  balancedPlacement: true;
  /**
   * PAIRS NEVER CROSS A RUN (S1). One pair is two beings of the SAME seed, so a
   * cluster is a clean unit; a pair made of arm A in seed 3 and arm B in seed 7
   * would carry both runs' differences and belong to neither. Per cluster:
   * how many pairs it contributed and how many traces went unpartnered in it.
   */
  byCluster: { cluster: string; pairs: number; unpaired: number }[];
  placements: PairPlacement[];
}

export interface PairingResult {
  pairs: TracePair[];
  manifest: PairingManifest;
}

/**
 * Shuffle traces into pairs, one from each of two arms, with seeded randomness.
 *
 * LEFT/RIGHT IS BALANCED, NOT SAMPLED. Round 1 flipped a coin per pair
 * (`rng() < 0.5`), which at 5 pairs lands 5–0 one way about 6% of the time and
 * 4–1 a third of the time; the position-bias check then has a real imbalance to
 * explain and cannot tell it from the judge. Here exactly ⌈n/2⌉ pairs put the
 * first group on the left and the rest put it on the right, and WHICH pairs is
 * the seeded part. Every pair is still judged in both orders on top of that.
 */
export function pairTraces(
  traces: readonly BlindTrace[],
  key: SealedTraceKey,
  seed: string,
  groups: [ArmId, ArmId] = ['A', 'B'],
): PairingResult {
  const byId = new Map(traces.map((t) => [t.traceId, t]));
  // The key's own rows carry the cluster; `handlesOf` carries only the handle.
  const clusterOf = new Map(key.clusters().map((row) => [row.traceId, row.seed]));
  const take = (arm: ArmId): BlindTrace[] =>
    key
      .handlesOf(arm)
      .map((id) => byId.get(id))
      .filter((t): t is BlindTrace => t !== undefined);

  const first = take(groups[0]);
  const second = take(groups[1]);
  const rng = mulberry32(hashSeed(`pair:${seed}`));
  shuffle(first, rng);
  shuffle(second, rng);

  // WITHIN A CLUSTER, ALWAYS. Ordering the clusters by name rather than by the
  // order the traces happened to arrive keeps the pairing reproducible.
  const bucket = (list: readonly BlindTrace[]): Map<string, BlindTrace[]> => {
    const out = new Map<string, BlindTrace[]>();
    for (const trace of list) {
      const cluster = clusterOf.get(trace.traceId) ?? '(unclustered)';
      const rows = out.get(cluster);
      if (rows) rows.push(trace);
      else out.set(cluster, [trace]);
    }
    return out;
  };
  const firstBy = bucket(first);
  const secondBy = bucket(second);
  const clusters = [...new Set([...firstBy.keys(), ...secondBy.keys()])].sort();

  const pairs: TracePair[] = [];
  const placements: PairPlacement[] = [];
  const byCluster: { cluster: string; pairs: number; unpaired: number }[] = [];
  let unpaired = 0;
  for (const cluster of clusters) {
    const mine = firstBy.get(cluster) ?? [];
    const theirs = secondBy.get(cluster) ?? [];
    const n = Math.min(mine.length, theirs.length);
    const spare = Math.abs(mine.length - theirs.length);
    unpaired += spare;
    byCluster.push({ cluster, pairs: n, unpaired: spare });
    const placement = balancedFlags(n, rng);
    for (let i = 0; i < n; i++) {
      const one = mine[i]!;
      const other = theirs[i]!;
      const firstOnLeft = placement[i]!;
      const pairId = `pair-${(pairs.length + 1).toString(36).padStart(3, '0')}`;
      pairs.push({ pairId, cluster, left: firstOnLeft ? one : other, right: firstOnLeft ? other : one });
      placements.push({ pairId, leftGroup: firstOnLeft ? 0 : 1 });
    }
  }

  return {
    pairs,
    manifest: {
      seed,
      groups,
      pairs: pairs.length,
      unpaired,
      balancedPlacement: true,
      byCluster,
      placements,
    },
  };
}

/** ⌈n/2⌉ trues and ⌊n/2⌋ falses, in a seeded order. */
function balancedFlags(n: number, rng: () => number): boolean[] {
  const flags = Array.from({ length: n }, (_, i) => i < Math.ceil(n / 2));
  shuffle(flags, rng);
  return flags;
}

function shuffle<T>(items: T[], rng: () => number): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = items[i]!;
    items[i] = items[j]!;
    items[j] = a;
  }
}
