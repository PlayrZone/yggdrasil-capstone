/**
 * Sacred places — the analysis of how a LOCATION, not just a story, becomes
 * meaningful. A single place can accrete many distinct stories over generations:
 * a founding here, a slaying here, a death here. When several widely-held stories
 * cluster at one spot it becomes MULTIVALENT — a place that means many things to
 * many beings, which is what an unambiguously sacred site is. This finds those
 * clusters, grades them, and (across checkpoints) shows whether they ACCRETE.
 * Analysis only — never read back into the simulation.
 */
import { grandeur } from './myth.js';

export interface StorySite {
  x: number;
  y: number;
  kind: string; // home | slew | fell | attack
  text: string;
  holders: number;
}

export interface SacredPlace {
  x: number;
  y: number;
  /** How many DISTINCT stories are anchored at this place. */
  distinctStories: number;
  /** Sum of holders across the place's stories — its total reach. */
  totalHolders: number;
  /** Unique story kinds present (home/slew/fell/attack). */
  kinds: string[];
  /** True if it mixes founding/heroic AND tragic stories — it means many things. */
  multivalent: boolean;
  /** Highest legend tier among its stories (0 plain … 4 full legend). */
  maxGrandeur: number;
  topTexts: string[];
}

export interface SacredPlacesReport {
  places: SacredPlace[];
  /** Number of multi-story sacred places. */
  count: number;
  richest: SacredPlace | null;
  /** How many are multivalent (founding/heroic AND tragic at one spot). */
  multivalentCount: number;
}

/**
 * Greedy spatial clustering of widely-held story sites: a high-holder site seeds
 * a cluster and absorbs other story sites within `radius`. A cluster of ≥2
 * distinct stories is a sacred place.
 */
export function analyzeSacredPlaces(
  sites: StorySite[],
  opts: { radius?: number; minHolders?: number; minStories?: number } = {},
): SacredPlacesReport {
  const { radius = 70, minHolders = 8, minStories = 2 } = opts;
  const pts = sites
    .filter((s) => s.holders >= minHolders && !(s.x === 0 && s.y === 0))
    .sort((a, b) => b.holders - a.holders);
  const used = new Array<boolean>(pts.length).fill(false);
  const r2 = radius * radius;
  const places: SacredPlace[] = [];

  for (let i = 0; i < pts.length; i++) {
    if (used[i]) continue;
    const seed = pts[i]!;
    const cluster: StorySite[] = [seed];
    used[i] = true;
    for (let j = i + 1; j < pts.length; j++) {
      if (used[j]) continue;
      const p = pts[j]!;
      if ((p.x - seed.x) ** 2 + (p.y - seed.y) ** 2 <= r2) {
        cluster.push(p);
        used[j] = true;
      }
    }
    if (cluster.length < minStories) continue;
    const kinds = [...new Set(cluster.map((c) => c.kind))];
    const founderK = kinds.some((k) => k === 'home' || k === 'slew');
    const tragicK = kinds.some((k) => k === 'fell' || k === 'attack');
    places.push({
      x: Math.round(cluster.reduce((s, c) => s + c.x, 0) / cluster.length),
      y: Math.round(cluster.reduce((s, c) => s + c.y, 0) / cluster.length),
      distinctStories: cluster.length,
      totalHolders: cluster.reduce((s, c) => s + c.holders, 0),
      kinds,
      multivalent: founderK && tragicK,
      maxGrandeur: Math.max(...cluster.map((c) => grandeur(c.text))),
      topTexts: cluster.slice(0, 4).map((c) => c.text),
    });
  }
  places.sort((a, b) => b.distinctStories - a.distinctStories || b.totalHolders - a.totalHolders);
  return {
    places,
    count: places.length,
    richest: places[0] ?? null,
    multivalentCount: places.filter((p) => p.multivalent).length,
  };
}
