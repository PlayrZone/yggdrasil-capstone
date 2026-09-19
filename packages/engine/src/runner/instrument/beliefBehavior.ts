import { CLASSIC_SCALE } from '../../world/geography.js';
import type { RuntimeView } from '../RuntimeView.js';

interface SiteMeasure {
  text: string;
  holders: number;
  near: number;
  holdersNear: number;
  fractionNear: number;
  congregation: number;
}

export interface BeliefBehaviorReport {
  founderSites: SiteMeasure[];
  tragedySites: SiteMeasure[];
  avgFounderCongregation: number;
  avgTragedyCongregation: number;
  avgFounderFractionNear: number;
  avgTragedyFractionNear: number;
}

/**
 * CYCLE 10/11 — Belief → Behavior. Do held stories steer where beings are?
 *
 * Two measures, both seed-paired against a mythBehavior:false control:
 *  - CONGREGATION: living beings within R of a story's place ÷ a uniform-spread
 *    baseline. Inflated by general clustering, so only treatment−control is
 *    trustworthy. (Cycle 10 showed this ≈ confounded with habitat.)
 *  - FRACTION-NEAR (Cycle 11, the clean one): of the beings who CARRY a story,
 *    what fraction are physically within R of its place. Conditioning on
 *    holding the belief removes the habitat confound — if pilgrimage works,
 *    holders of a legend converge on its (often distant) site, so fractionNear
 *    rises in treatment vs control. Pure measurement — never read back.
 */
export function beliefBehavior(view: RuntimeView): BeliefBehaviorReport {
  type Site = { x: number; y: number; kind: string; text: string; holderPos: { x: number; y: number }[] };
  const sites = new Map<string, Site>();
  const positions: { x: number; y: number }[] = [];
  for (const id of view.agentIds) {
    if (!view.agentBody(id)?.alive) continue;
    const t = view.positionOf(id)!;
    const pos = { x: t.x, y: t.y };
    positions.push(pos);
    const mind = view.minds.get(id);
    if (!mind) continue;
    for (const n of mind.narratives.all()) {
      let s = sites.get(n.id);
      if (!s) sites.set(n.id, (s = { x: n.x, y: n.y, kind: n.id.slice(0, n.id.indexOf(':')), text: n.text, holderPos: [] }));
      s.holderPos.push(pos);
    }
  }
  const alive = positions.length || 1;
  const R = CLASSIC_SCALE.congregationRadius;
  const R2 = R * R;
  // Uniform-density baseline within R — over THIS world's area, not the 2 km
  // plane's. Held at the classic radius so the two worlds' numbers compare.
  const span = view.geography.span;
  const expected = (alive / (span * span)) * Math.PI * R2;
  const measure = (s: Site): SiteMeasure => {
    let near = 0;
    for (const p of positions) if ((p.x - s.x) ** 2 + (p.y - s.y) ** 2 <= R2) near++;
    let holdersNear = 0;
    for (const p of s.holderPos) if ((p.x - s.x) ** 2 + (p.y - s.y) ** 2 <= R2) holdersNear++;
    const holders = s.holderPos.length;
    return {
      text: s.text,
      holders,
      near,
      holdersNear,
      fractionNear: Math.round((holdersNear / Math.max(1, holders)) * 1000) / 1000,
      congregation: Math.round((near / Math.max(0.01, expected)) * 100) / 100,
    };
  };
  const founderSites: SiteMeasure[] = [];
  const tragedySites: SiteMeasure[] = [];
  for (const s of sites.values()) {
    if (s.holderPos.length < 8) continue; // only widely-shared stories count as belief
    if (s.x === 0 && s.y === 0) continue; // location-less (LLM-retold) stories
    const m = measure(s);
    if (s.kind === 'home' || s.kind === 'slew') founderSites.push(m);
    else if (s.kind === 'fell' || s.kind === 'attack') tragedySites.push(m);
  }
  founderSites.sort((a, b) => b.fractionNear - a.fractionNear || b.holders - a.holders);
  tragedySites.sort((a, b) => a.fractionNear - b.fractionNear || b.holders - a.holders);
  const avg = (arr: { congregation: number }[]): number =>
    arr.length ? Math.round((arr.reduce((x, m) => x + m.congregation, 0) / arr.length) * 100) / 100 : 0;
  const avgFrac = (arr: { fractionNear: number }[]): number =>
    arr.length ? Math.round((arr.reduce((x, m) => x + m.fractionNear, 0) / arr.length) * 1000) / 1000 : 0;
  return {
    founderSites: founderSites.slice(0, 12),
    tragedySites: tragedySites.slice(0, 12),
    avgFounderCongregation: avg(founderSites),
    avgTragedyCongregation: avg(tragedySites),
    avgFounderFractionNear: avgFrac(founderSites),
    avgTragedyFractionNear: avgFrac(tragedySites),
  };
}
