import type { RuntimeView } from '../RuntimeView.js';

/** Gini coefficient of a non-negative distribution (0 = equal, →1 = concentrated). */
function giniOf(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  const sum = s.reduce((a, b) => a + b, 0);
  if (sum === 0) return 0;
  let cum = 0;
  for (let i = 0; i < n; i++) cum += (i + 1) * s[i]!;
  return (2 * cum) / (n * sum) - (n + 1) / n;
}

export interface LeadershipReport {
  leaders: { name: string; followers: number }[];
  maxFollowers: number;
  leaderCount: number;
  gini: number;
  followerShareTop: number;
}

/**
 * CYCLE 13 — Leadership. Nobody is assigned a role. But if respect accrues to
 * the visibly competent and beings are drawn to the respected, a few should end
 * up with many "followers" — beings whose strongest social pull points at them.
 * For each living being we find the individual it is most drawn to (latent, by
 * relationship — friendship/trust/respect/fear, ignoring sight), tally inbound
 * followers, and measure how CONCENTRATED followership is (a flat distribution =
 * no leaders; a skewed one = emergent leaders). Analysis only — never read back.
 *
 * Audit 01 §3.4 stands against this one: the affinity formula below is a copy of
 * the one `ReflexMind` steers by, so it reports the shape of a rule rather than
 * discovering a hierarchy. W1-D rewrites it; nothing is changed here.
 */
export function leadership(view: RuntimeView): LeadershipReport {
  const aliveIds = view.agentIds.filter((id) => view.agentBody(id)?.alive);
  const aliveSet = new Set(aliveIds);
  const followers = new Map<number, number>();
  for (const i of aliveIds) {
    const mind = view.minds.get(i);
    if (!mind) continue;
    let best = 0; // require a positive pull
    let bestId = -1;
    for (const [pid, r] of mind.relationships.asMap()) {
      if (pid === i || !aliveSet.has(pid)) continue;
      const aff = r.friendship - 50 + (r.trust - 50) * 0.5 - r.fear + (r.respect - 50) * 0.6;
      if (aff > best) {
        best = aff;
        bestId = pid;
      }
    }
    if (bestId >= 0) followers.set(bestId, (followers.get(bestId) ?? 0) + 1);
  }
  const list = [...followers.entries()]
    .map(([id, f]) => ({ name: view.nameOf(id), followers: f }))
    .sort((a, b) => b.followers - a.followers);
  const counts = aliveIds.map((id) => followers.get(id) ?? 0);
  const totalLinks = counts.reduce((a, b) => a + b, 0) || 1;
  const maxFollowers = list.length ? list[0]!.followers : 0;
  return {
    leaders: list.slice(0, 8),
    maxFollowers,
    leaderCount: list.filter((l) => l.followers >= 5).length,
    gini: Math.round(giniOf(counts) * 1000) / 1000,
    followerShareTop: Math.round((maxFollowers / totalLinks) * 1000) / 1000,
  };
}
