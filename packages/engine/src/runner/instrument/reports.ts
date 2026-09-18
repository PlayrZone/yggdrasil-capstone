import { TICKS_PER_SEASON } from '../../body/Climate.js';
import type { KnowledgeRule } from '../../contract/types.js';
import { analyzeDiffusion, analyzeBeliefAccuracy } from '../../analysis/diffusion.js';
import type { BeliefAccuracy, BeliefCluster } from '../../analysis/diffusion.js';
import { analyzeSociety } from '../../analysis/society.js';
import type { SocietyReport } from '../../analysis/society.js';
import { analyzeCulture } from '../../analysis/culture.js';
import type { CultureReport } from '../../analysis/culture.js';
import { analyzeMyth } from '../../analysis/myth.js';
import type { MythReport } from '../../analysis/myth.js';
import { analyzeSacredPlaces } from '../../analysis/sacredPlaces.js';
import type { SacredPlacesReport } from '../../analysis/sacredPlaces.js';
import type { Archetype } from '../../analysis/archetype.js';
import type { RuntimeView } from '../RuntimeView.js';
import { agentKnowledge, archetypeOf, structures } from './observatory.js';
import { leadership } from './leadership.js';

/**
 * The INFLUENCE / social-structure read-out: detects possible mentors,
 * innovators, families, tribes, and resource-holders from who taught whom,
 * whose discoveries spread, who is bonded to whom, and who descends from
 * whom. Pure analysis — never read back into the sim.
 */
export function society(view: RuntimeView): SocietyReport {
  const alive = view.agentIds.filter((id) => view.agentBody(id)?.alive).map((id) => ({ id, name: view.nameOf(id) }));
  const teaching: { teacher: number; student: number }[] = [];
  const bonds: { a: number; b: number }[] = [];
  const trust: { holder: number; toward: number }[] = [];
  const seenBond = new Set<string>();
  for (const a of alive) {
    const mind = view.minds.get(a.id);
    if (!mind) continue;
    for (const k of mind.knowledge.all()) {
      if (k.origin === 'testimony' && k.testimonyFrom != null) teaching.push({ teacher: k.testimonyFrom, student: a.id });
    }
    for (const [pid, r] of mind.relationships.asMap()) {
      if (r.friendship > 62 && r.interactionCount >= 8) {
        const key = a.id < pid ? `${a.id}-${pid}` : `${pid}-${a.id}`;
        if (!seenBond.has(key)) {
          seenBond.add(key);
          bonds.push({ a: a.id, b: pid });
        }
      }
      if (r.trust > 62 && r.interactionCount >= 8) trust.push({ holder: a.id, toward: pid });
    }
  }
  const origination = analyzeDiffusion(agentKnowledge(view))
    .filter((c) => c.originatorId != null)
    .map((c) => ({ originator: c.originatorId!, reach: c.livingHolders }));
  const kin: { parent: number; child: number }[] = [];
  for (const b of view.births) {
    kin.push({ parent: b.parents[0], child: b.child });
    kin.push({ parent: b.parents[1], child: b.child });
  }
  const caches = structures(view).filter((s) => s.kind === 'container').map((s) => ({ owner: s.builtBy }));
  const specialists: { id: number; archetype: string; dominance: number }[] = [];
  const knowledge: { id: number; count: number }[] = [];
  for (const a of alive) {
    const r = archetypeOf(view, a.id);
    if (r && r.sampleSize > 0) specialists.push({ id: a.id, archetype: r.archetype, dominance: r.dominance });
    knowledge.push({ id: a.id, count: view.minds.get(a.id)?.knowledge.held().length ?? 0 });
  }
  return analyzeSociety({ alive, teaching, origination, bonds, kin, caches, specialists, trust, knowledge });
}

/**
 * CULTURE: what each tribe believes (not how much) — shared beliefs, how far
 * tribes diverge, and the superstition test (competing false beliefs). Pure
 * analysis; never read back.
 */
export function culture(view: RuntimeView): CultureReport {
  const tribes = society(view).tribes;
  const beliefs = new Map<number, { key: string; statement: string; rule: KnowledgeRule }[]>();
  const narratives = new Map<number, { id: string; text: string }[]>();
  for (const id of view.agentIds) {
    if (!view.agentBody(id)?.alive) continue;
    const mind = view.minds.get(id);
    if (!mind) continue;
    beliefs.set(id, mind.knowledge.held().map((k) => ({ key: k.ruleKey, statement: k.statement, rule: k.rule })));
    narratives.set(id, mind.narratives.all().map((n) => ({ id: n.id, text: n.text })));
  }
  return analyzeCulture(tribes, beliefs, narratives);
}

/**
 * MYTH FORMATION: how stories distort as they spread — how many versions a
 * story has fractured into, which beings became heroes or villains in the
 * retelling, and whether tribes now tell the same event differently. Analysis.
 */
export function myth(view: RuntimeView): MythReport {
  const tribes = society(view).tribes;
  const narratives = new Map<number, { id: string; text: string; firstTick: number }[]>();
  const names = new Map<number, string>();
  for (const id of view.agentIds) {
    names.set(id, view.nameOf(id));
    if (!view.agentBody(id)?.alive) continue;
    const mind = view.minds.get(id);
    // firstTick rides along: a story's age is its own record, not its id.
    if (mind) narratives.set(id, mind.narratives.all().map((n) => ({ id: n.id, text: n.text, firstTick: n.firstTick })));
  }
  return analyzeMyth(narratives, tribes, names, view.tick);
}

/**
 * CYCLE 12 — Sacred places. Where do many distinct widely-held stories cluster
 * at one LOCATION, making it multivalent (a founding AND a slaying AND a death
 * at one spot)? Aggregates each story's living-holder count + place, then finds
 * spatial clusters of ≥2 distinct stories. Analysis only — never read back.
 */
export function sacredPlaces(view: RuntimeView): SacredPlacesReport {
  const sites = new Map<string, { x: number; y: number; kind: string; text: string; holders: number }>();
  for (const id of view.agentIds) {
    if (!view.agentBody(id)?.alive) continue;
    const mind = view.minds.get(id);
    if (!mind) continue;
    for (const n of mind.narratives.all()) {
      let s = sites.get(n.id);
      if (!s) sites.set(n.id, (s = { x: n.x, y: n.y, kind: n.id.slice(0, n.id.indexOf(':')), text: n.text, holders: 0 }));
      s.holders++;
    }
  }
  return analyzeSacredPlaces([...sites.values()]);
}

export interface InstitutionsReport {
  generations: number;
  topSacredSite: { x: number; y: number; distinctStories: number; multivalent: boolean; maxGrandeur: number } | null;
  oldestMyth: { ageTicks: number; holders: number; text: string } | null;
  topLeader: { name: string; followers: number } | null;
  knowledgeLineages: number;
}

/**
 * CYCLE 14 — Institutions. A snapshot of the candidate institutions right now:
 * the principal sacred site, the oldest surviving myth, the top leader, and the
 * count of knowledge lineages — plus how many generations have elapsed. Sampling
 * this over a run (and seeing which of these PERSIST as individuals turn over) is
 * how we tell an institution (a pattern that outlives its founders) from a
 * transient. Composes existing analyzers; analysis only, never read back.
 */
export function institutions(view: RuntimeView): InstitutionsReport {
  const sp = sacredPlaces(view);
  const m = myth(view);
  const ld = leadership(view);
  const soc = society(view);
  return {
    generations: Math.round((view.tick / TICKS_PER_SEASON) * 10) / 10,
    topSacredSite: sp.richest
      ? { x: sp.richest.x, y: sp.richest.y, distinctStories: sp.richest.distinctStories, multivalent: sp.richest.multivalent, maxGrandeur: sp.richest.maxGrandeur }
      : null,
    oldestMyth: m.oldestSurviving
      ? { ageTicks: m.oldestSurviving.ageTicks, holders: m.oldestSurviving.holders, text: m.oldestSurviving.text }
      : null,
    topLeader: ld.leaders[0] ?? null,
    knowledgeLineages: soc.knowledgeLineages,
  };
}

export interface AnalysisSnapshot {
  diffusion: BeliefCluster[];
  accuracy: BeliefAccuracy;
  archetypes: { archetype: Archetype; count: number }[];
  cultureCount: number;
}

/**
 * A complete analysis snapshot for the observatory: how knowledge has spread
 * across the population (diffusion clusters, incl. culture — beliefs that
 * outlived their discoverer) and the behavioral-archetype distribution. All
 * post-hoc labelling; nothing here is read back into the simulation.
 */
export function analysis(view: RuntimeView): AnalysisSnapshot {
  const diffusion = analyzeDiffusion(agentKnowledge(view));
  const accuracy = analyzeBeliefAccuracy(diffusion);
  const counts = new Map<Archetype, number>();
  for (const id of view.agentIds) {
    if (!view.agentBody(id)?.alive) continue;
    const r = archetypeOf(view, id);
    if (r && r.sampleSize > 0) counts.set(r.archetype, (counts.get(r.archetype) ?? 0) + 1);
  }
  const archetypes = [...counts.entries()].map(([archetype, count]) => ({ archetype, count })).sort((a, b) => b.count - a.count);
  return { diffusion, accuracy, archetypes, cultureCount: diffusion.filter((c) => c.outlivedOriginator).length };
}
