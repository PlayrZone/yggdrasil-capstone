import type { KnowledgeRule } from '../contract/types.js';
import { classifyRuleTruth, type RuleTruth } from './groundTruth.js';

/**
 * CULTURE — not how MUCH a group knows, but WHAT it knows. Two tribes in the
 * same world can hold different beliefs (and different *false* beliefs); that
 * difference is culture. This measures each tribe's shared beliefs, how far
 * tribes diverge, and — the superstition test — whether tribes hold competing
 * false beliefs. Analysis only; never written back.
 */

export interface TribeBelief {
  statement: string;
  truth: RuleTruth;
}

export interface CultureReport {
  /** Per tribe: the beliefs its members SHARE (held by ≥40% of the tribe). */
  tribes: { size: number; shared: number; trueCount: number; falseCount: number; superstitions: string[]; signature: string[] }[];
  /** 0 = identical cultures, 1 = totally distinct (avg pairwise Jaccard distance of shared beliefs). */
  divergence: number;
  /** The two most culturally different tribes + what each believes that the other doesn't. */
  mostDivergent: { aSize: number; bSize: number; distance: number; aOnly: string[]; bOnly: string[] } | null;
  /** Per-tribe SHARED STORIES — narratives most of the tribe carries (its identity). */
  tribeStories: { size: number; stories: string[] }[];
  /** The single most widely-shared story in the whole world. */
  topStory: { text: string; holders: number } | null;
  labels: string[];
}

interface AgentBelief {
  key: string;
  statement: string;
  rule: KnowledgeRule;
}

function sharedCulture(members: number[], beliefs: Map<number, AgentBelief[]>): Map<string, TribeBelief> {
  const freq = new Map<string, { count: number; statement: string; truth: RuleTruth }>();
  for (const id of members) {
    const seen = new Set<string>();
    for (const b of beliefs.get(id) ?? []) {
      if (seen.has(b.key)) continue;
      seen.add(b.key);
      const cur = freq.get(b.key);
      if (cur) cur.count++;
      else freq.set(b.key, { count: 1, statement: b.statement, truth: classifyRuleTruth(b.rule) });
    }
  }
  const threshold = Math.max(2, Math.ceil(members.length * 0.4));
  const shared = new Map<string, TribeBelief>();
  for (const [key, v] of freq) if (v.count >= threshold) shared.set(key, { statement: v.statement, truth: v.truth });
  return shared;
}

function jaccardDistance(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const k of a) if (b.has(k)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : 1 - inter / union;
}

export function analyzeCulture(
  tribes: { members: number[]; size: number }[],
  beliefs: Map<number, AgentBelief[]>,
  narratives?: Map<number, { id: string; text: string }[]>,
): CultureReport {
  const cultures = tribes.map((t) => ({ tribe: t, shared: sharedCulture(t.members, beliefs) }));

  const tribeReports = cultures.map(({ tribe, shared }) => {
    const vals = [...shared.values()];
    const superstitions = vals.filter((b) => b.truth === 'false').map((b) => b.statement);
    return {
      size: tribe.size,
      shared: shared.size,
      trueCount: vals.filter((b) => b.truth === 'true').length,
      falseCount: superstitions.length,
      superstitions: superstitions.slice(0, 8),
      signature: vals.slice(0, 6).map((b) => b.statement),
    };
  });

  // Pairwise divergence of shared-belief sets.
  let total = 0;
  let pairs = 0;
  let worst: CultureReport['mostDivergent'] = null;
  for (let i = 0; i < cultures.length; i++) {
    for (let j = i + 1; j < cultures.length; j++) {
      const a = new Set(cultures[i]!.shared.keys());
      const b = new Set(cultures[j]!.shared.keys());
      if (a.size === 0 || b.size === 0) continue;
      const d = jaccardDistance(a, b);
      total += d;
      pairs++;
      if (!worst || d > worst.distance) {
        const aOnly = [...cultures[i]!.shared.entries()].filter(([k]) => !b.has(k)).map(([, v]) => v.statement).slice(0, 5);
        const bOnly = [...cultures[j]!.shared.entries()].filter(([k]) => !a.has(k)).map(([, v]) => v.statement).slice(0, 5);
        worst = { aSize: cultures[i]!.tribe.size, bSize: cultures[j]!.tribe.size, distance: Math.round(d * 100) / 100, aOnly, bOnly };
      }
    }
  }
  const divergence = pairs ? Math.round((total / pairs) * 100) / 100 : 0;

  // ── Shared stories per tribe (narrative identity) ────────────────────────
  const tribeStories = tribes.map((t) => {
    const freq = new Map<string, { count: number; text: string }>();
    for (const id of t.members) {
      for (const n of narratives?.get(id) ?? []) {
        const cur = freq.get(n.id);
        if (cur) cur.count++;
        else freq.set(n.id, { count: 1, text: n.text });
      }
    }
    const threshold = Math.max(2, Math.ceil(t.size * 0.4));
    const stories = [...freq.values()].filter((s) => s.count >= threshold).map((s) => s.text).slice(0, 6);
    return { size: t.size, stories };
  });
  // Most widely-held story across everyone.
  const globalFreq = new Map<string, { count: number; text: string }>();
  if (narratives) for (const ns of narratives.values()) for (const n of ns) {
    const cur = globalFreq.get(n.id);
    if (cur) cur.count++;
    else globalFreq.set(n.id, { count: 1, text: n.text });
  }
  let topStory: CultureReport['topStory'] = null;
  for (const s of globalFreq.values()) if (!topStory || s.count > topStory.holders) topStory = { text: s.text, holders: s.count };

  const labels: string[] = [];
  if (pairs > 0) labels.push(`Cultural divergence: ${Math.round(divergence * 100)}% of tribes' shared beliefs differ between groups`);
  if (topStory && topStory.holders >= 5) labels.push(`Shared story (${topStory.holders} carry it): "${topStory.text}"`);
  const tribesWithStories = tribeStories.filter((t) => t.stories.length > 0).length;
  if (tribesWithStories > 0) labels.push(`Narrative identity: ${tribesWithStories} tribes carry their own shared stories`);
  const withSuperstition = tribeReports.filter((t) => t.falseCount > 0);
  if (withSuperstition.length > 0) {
    const distinctSuperstitions = new Set(withSuperstition.flatMap((t) => t.superstitions));
    labels.push(`Competing superstitions: ${distinctSuperstitions.size} distinct FALSE beliefs held across ${withSuperstition.length} tribes`);
  }
  if (worst && worst.aOnly.length && worst.bOnly.length) {
    labels.push(`Distinct cultures: one tribe believes "${worst.aOnly[0]}"; another instead "${worst.bOnly[0]}"`);
  }

  return { tribes: tribeReports, divergence, mostDivergent: worst, tribeStories, topStory, labels };
}
