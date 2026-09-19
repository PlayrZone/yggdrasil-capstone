import type { Animal } from '../../body/WildlifeSystem.js';
import type { ResourceNode } from '../../body/ResourceNodeSystem.js';
import type { Structure } from '../../body/PerceptionSystem.js';
import type { KinTie, KnownStory, SimEvent } from '../../contract/types.js';
import type { ObjectKind } from '../../worlds/forager/types.js';
import { classifyFromCounts } from '../../analysis/archetype.js';
import type { Archetype, ArchetypeResult } from '../../analysis/archetype.js';
import type { AgentKnowledge } from '../../analysis/diffusion.js';
import type { Region } from '../../world/regions.js';
import { kinOf } from '../kinship.js';
import type { RuntimeView } from '../RuntimeView.js';

export interface AgentInfo {
  id: number;
  name: string;
  alive: boolean;
  x: number;
  y: number;
  sleeping: boolean;
  sick: boolean;
  hungerCritical: boolean;
}

/** Lightweight per-frame info for a viewport's instance sync. */
export function agentInfos(view: RuntimeView): AgentInfo[] {
  const infos: AgentInfo[] = [];
  for (const id of view.agentIds) {
    const body = view.agentBody(id);
    const t = view.positionOf(id);
    if (!body || !t) continue;
    infos.push({
      id,
      name: body.name,
      alive: body.alive,
      x: t.x,
      y: t.y,
      sleeping: body.sleepingUntil > view.tick,
      sick: body.sickUntil > view.tick,
      hungerCritical: body.needs.hunger >= 85,
    });
  }
  return infos;
}

/** Wild animals currently roaming (moving — read every frame). */
export function animals(view: RuntimeView): { id: number; x: number; y: number; kind: string }[] {
  const out: { id: number; x: number; y: number; kind: string }[] = [];
  view.each('Animal', (e) => {
    const a = e.components['Animal'] as Animal;
    const t = e.components['Transform2D'] as { x: number; y: number } | undefined;
    if (t) out.push({ id: e.id, x: t.x, y: t.y, kind: a.kind });
  });
  return out;
}

/** Static resource nodes (food, water, ore, …) for the world view (read once). */
export function resourceNodes(view: RuntimeView): { id: number; x: number; y: number; kind: string }[] {
  const out: { id: number; x: number; y: number; kind: string }[] = [];
  view.each('ResourceNode', (e) => {
    if (e.components['Animal']) return; // animals are rendered separately
    const n = e.components['ResourceNode'] as ResourceNode;
    const t = e.components['Transform2D'] as { x: number; y: number } | undefined;
    if (t) out.push({ id: e.id, x: t.x, y: t.y, kind: n.kind });
  });
  return out;
}

/** Structures the Gahallians have built (shelters, walls, containers, drops). */
export function structures(view: RuntimeView): { id: number; x: number; y: number; kind: string; builtBy: number }[] {
  const out: { id: number; x: number; y: number; kind: string; builtBy: number }[] = [];
  view.each('Structure', (e) => {
    const s = e.components['Structure'] as Structure;
    const t = e.components['Transform2D'] as { x: number; y: number } | undefined;
    if (t) out.push({ id: e.id, x: t.x, y: t.y, kind: s.kind, builtBy: s.builtBy });
  });
  return out;
}

export function recentEvents(view: RuntimeView, limit: number): SimEvent[] {
  return view.eventLog.slice(-limit);
}

/** Behavior-derived archetype label (analysis-side; never read back). */
export function archetypeOf(view: RuntimeView, agentId: number): ArchetypeResult | null {
  const mind = view.minds.get(agentId);
  return mind ? classifyFromCounts(mind.memory.experienceCounts()) : null;
}

export interface AgentDetail {
  id: number;
  name: string;
  alive: boolean;
  x: number;
  y: number;
  region: Region;
  archetype: Archetype | null;
  needs: Record<string, number>;
  traits: Record<string, number>;
  inventory: Record<string, number>;
  knowledge: { statement: string; confidence: number; status: string }[];
}

/** Full inspector view of one agent (click-to-select in the lab). */
export function agentDetail(view: RuntimeView, id: number): AgentDetail | null {
  const body = view.agentBody(id);
  const t = view.positionOf(id);
  if (!body || !t) return null;
  const mind = view.minds.get(id);
  const arche = archetypeOf(view, id);
  return {
    id,
    name: view.nameOf(id),
    alive: body.alive,
    x: t.x,
    y: t.y,
    region: view.geography.regionAt(t.x, t.y),
    archetype: arche && arche.sampleSize > 0 ? arche.archetype : null,
    needs: { ...body.needs } as Record<string, number>,
    traits: { ...body.traits } as Record<string, number>,
    inventory: { ...body.inventory } as Record<string, number>,
    knowledge: mind
      ? mind.knowledge.held().slice(0, 30).map((k) => ({ statement: k.statement, confidence: k.confidence, status: k.status }))
      : [],
  };
}

export interface ConsciousState {
  name: string;
  conscious: boolean;
  thought: string | null;
  goals: string[];
  stories: KnownStory[];
  kin: KinTie[];
  knowledge: string[];
}

/**
 * A conscious being's inner state, for the observatory: what it is thinking,
 * the goals it pursues, the stories that shaped it, and the family it knows.
 * Answers "what does this being believe, why, and what shaped it" — all from
 * what the being itself holds, nothing engine-only.
 */
export function consciousState(view: RuntimeView, id: number): ConsciousState | null {
  const mind = view.minds.get(id);
  if (!mind) return null;
  return {
    name: view.nameOf(id),
    conscious: view.conscious.has(id),
    thought: view.lastThought.get(id) ?? null,
    goals: mind.goals.map((g) => g.description),
    stories: mind.narratives.all().map((n) => ({ text: n.text, firsthand: n.firsthand })),
    kin: kinOf(view.births, (who) => view.nameOf(who), id),
    knowledge: mind.knowledge.held().slice(0, 12).map((k) => k.statement),
  };
}

/** Living beings who HOLD a craft-recipe for `output` (learned it, may or may
 *  not have crafted yet) — the apprenticeship's reach, distinct from makers. */
export function recipeHolders(view: RuntimeView, output: ObjectKind): number[] {
  const key = `craft:${output}`;
  const holders: number[] = [];
  for (const id of view.agentIds) {
    if (!view.agentBody(id)?.alive) continue;
    const rec = view.minds.get(id)?.knowledge.get(key);
    if (rec && rec.status === 'held') holders.push(id);
  }
  return holders;
}

/** Per-agent held+forming knowledge for the diffusion analyzer. */
export function agentKnowledge(view: RuntimeView): AgentKnowledge[] {
  const out: AgentKnowledge[] = [];
  for (const id of view.agentIds) {
    const mind = view.minds.get(id);
    if (!mind) continue;
    out.push({ agentId: id, alive: view.agentBody(id)?.alive ?? false, knowledge: mind.knowledge.all() });
  }
  return out;
}

export function totalKnowledge(view: RuntimeView): number {
  let total = 0;
  for (const mind of view.minds.values()) total += mind.knowledge.held().length;
  return total;
}
