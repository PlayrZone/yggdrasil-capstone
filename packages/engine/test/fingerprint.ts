import { Experiment } from '../src/runner/Experiment.js';
import type { Entity } from '../src/core/Entity.js';
import type { Transform2D } from '../src/core/Transform2D.js';
import type { GahallianBody } from '../src/body/GahallianBody.js';
import type { ResourceNode } from '../src/body/ResourceNodeSystem.js';
import type { Structure } from '../src/body/PerceptionSystem.js';
import type { Animal } from '../src/body/WildlifeSystem.js';
import type { SeedInGround } from '../src/body/WorldRegularities.js';
import type { Intent } from '../src/contract/types.js';

/**
 * A deep, order-stable fingerprint of a whole run's state — the acceptance gate
 * for changes that must not alter behaviour. It walks every entity, every body,
 * every mind's memory/knowledge/relationships/narratives and the run's counters,
 * and folds them into two independent 32-bit accumulators plus a length, so a
 * single flipped field, a reordered list or a dropped record all change it.
 *
 * Floats go in via `String(v)`, which round-trips exactly in V8 — the comparison
 * is bit-exact, not tolerant.
 */
class Digest {
  private h1 = 0x811c9dc5;
  private h2 = 0x00001505;
  private n = 0;

  push(s: string): this {
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      this.h1 = Math.imul(this.h1 ^ c, 0x01000193);
      this.h2 = (Math.imul(this.h2, 33) ^ c) >>> 0;
    }
    this.n += s.length + 1;
    this.h1 = Math.imul(this.h1 ^ 0x1f, 0x01000193);
    this.h2 = (Math.imul(this.h2, 33) ^ 0x1f) >>> 0;
    return this;
  }

  num(v: number | undefined): this {
    return this.push(v === undefined ? '~' : String(v));
  }

  flag(v: boolean): this {
    return this.push(v ? '1' : '0');
  }

  /** A record with string keys, hashed in sorted-key order. */
  dict(o: Record<string, unknown> | undefined): this {
    if (!o) return this.push('~');
    for (const k of Object.keys(o).sort()) this.push(k).push(String(o[k]));
    return this.push('}');
  }

  toString(): string {
    return `${(this.h1 >>> 0).toString(16).padStart(8, '0')}${(this.h2 >>> 0)
      .toString(16)
      .padStart(8, '0')}:${this.n}`;
  }
}

function intent(d: Digest, i: Intent): void {
  d.push(i.kind).num(i.x).num(i.y).num(i.targetId).push(i.objectKind ?? '~');
  d.push(i.buildKind ?? '~').num(i.durationTicks);
  d.push(i.utterance?.speechAct ?? '~').num(i.utterance?.targetId).push(i.utterance?.text ?? '~');
}

function entity(d: Digest, e: Entity): void {
  d.num(e.id);
  for (const key of Object.keys(e.components).sort()) d.push(key);
  const t = e.components['Transform2D'] as Transform2D | undefined;
  if (t) d.num(t.x).num(t.y).num(t.z);

  const body = e.components['GahallianBody'] as GahallianBody | undefined;
  if (body) {
    d.push(body.name).num(body.birthTick).num(body.health).flag(body.alive);
    d.num(body.needs.hunger).num(body.needs.rest).num(body.needs.safety).num(body.needs.socialConnection);
    d.num(body.traits.curiosity).num(body.traits.aggression).num(body.traits.compassion);
    d.num(body.traits.ambition).num(body.traits.loyalty).num(body.traits.riskTolerance);
    d.dict(body.inventory as Record<string, unknown>);
    d.num(body.sickUntil).num(body.sleepingUntil).flag(body.sleptInShelter).num(body.sleepStartRest);
    d.num(body.planStep).flag(body.planDone).num(body.intentTicks).flag(body.hitThisTick);
    d.num(body.reproCooldownUntil).num(body.plan.length);
    for (const i of body.plan) intent(d, i);
  }

  const node = e.components['ResourceNode'] as ResourceNode | undefined;
  if (node) d.push(node.kind).num(node.stock).num(node.maxStock).num(node.regrowEvery).num(node.gatherCount);

  const s = e.components['Structure'] as Structure | undefined;
  if (s) d.push(s.kind).num(s.builtBy).num(s.builtTick).dict(s.inventory as Record<string, unknown>);

  const a = e.components['Animal'] as Animal | undefined;
  if (a) d.push(a.kind).num(a.heading).num(a.changeAt).num(a.targetId).num(a.lastAttack).num(a.health);

  const seed = e.components['SeedInGround'] as SeedInGround | undefined;
  if (seed) d.num(seed.plantedTick);
}

function mind(d: Digest, exp: Experiment, agentId: number): void {
  const m = exp.minds.get(agentId);
  if (!m) {
    d.num(agentId).push('nomind');
    return;
  }
  d.num(agentId);

  const memories = m.memory.all();
  d.num(memories.length).num(m.memory.hotCount).num(m.memory.totalCount);
  for (const r of memories) {
    d.num(r.id).num(r.tick).push(r.type).push(r.origin).push(r.outcome).num(r.importance);
    d.num(r.x).num(r.y).push(r.summaryText).num(r.toldBy).num(r.causedBy).push(r.objectKind ?? '~');
    d.push(r.subjects.join(','));
    d.push(r.utterance?.speechAct ?? '~').push(r.utterance?.narrativeId ?? '~');
    d.num(r.utterance?.narrativeFirstTick);
    d.dict(r.craftInputs as Record<string, unknown> | undefined);
  }

  const knowledge = m.knowledge.all();
  d.num(knowledge.length);
  for (const k of knowledge) {
    d.num(k.id).push(k.ruleKey).push(k.statement).num(k.confidence).num(k.evidenceCount);
    d.num(k.contradictionCount).push(k.status).push(k.origin).num(k.testimonyFrom);
    d.num(k.firstFormed).num(k.lastReinforced).push(k.sourceMemoryIds.join(','));
  }

  const partners = [...m.relationships.asMap().keys()].sort((a, b) => a - b);
  d.num(partners.length);
  for (const pid of partners) {
    const r = m.relationships.asMap().get(pid)!;
    d.num(pid).num(r.trust).num(r.respect).num(r.friendship).num(r.fear);
    d.num(r.interactionCount).num(r.lastInteractionTick);
  }

  const stories = m.narratives.all().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  d.num(stories.length);
  for (const s of stories) {
    d.push(s.id).push(s.text).num(s.x).num(s.y).num(s.firstTick).flag(s.firsthand);
    d.num(s.timesHeard).num(s.retellable);
  }

  d.num(m.goals.length);
  for (const g of m.goals) d.num(g.id).push(g.description).push(g.need ?? '~').num(g.createdTick);
}

/** The whole run's state, hashed. Identical input state ⇒ identical string. */
export function fingerprintOf(exp: Experiment): string {
  const d = new Digest();
  d.push(exp.seed).num(exp.tick).num(exp.eventCount).num(exp.birthCount).num(exp.aliveCount());
  d.num(exp.exchangeCount).num(exp.conflictCount).num(exp.sicknessCount).num(exp.shareCount);
  d.num(exp.seedPlantCount).num(exp.sproutCount).num(exp.buildCount).num(exp.totalKnowledge());
  d.dict(exp.deathsByCause as unknown as Record<string, unknown>);
  d.num(exp.world.size());

  d.push(exp.agentIds.join(','));
  for (const b of exp.births) d.num(b.child).num(b.parents[0]).num(b.parents[1]).num(b.tick);
  for (const id of [...exp.craftsByAgent.keys()].sort((a, b) => a - b)) {
    d.num(id).num(exp.craftsByAgent.get(id));
  }

  const entities: Entity[] = [];
  exp.world.forEach((e) => entities.push(e));
  entities.sort((a, b) => a.id - b.id);
  d.num(entities.length);
  for (const e of entities) entity(d, e);

  for (const ev of exp.eventLog) {
    d.num(ev.tick).push(ev.type).num(ev.actorId).push(ev.targetIds.join(',')).num(ev.x).num(ev.y);
  }

  for (const id of [...exp.agentIds].sort((a, b) => a - b)) mind(d, exp, id);
  return d.toString();
}

/** Ticks at which every golden run is fingerprinted. */
export const GOLDEN_CHECKPOINTS = [1200, 3000] as const;

export interface GoldenRun {
  readonly name: string;
  readonly seed: string;
  readonly agents: number;
  /** Pre-run seeding, so the culture + craft-observation paths are locked too. */
  readonly setup?: (exp: Experiment) => void;
  readonly craftLearning?: boolean;
}

/** Three seeds × two population sizes, plus one seeded-culture/craft world. */
export const GOLDEN_RUNS: readonly GoldenRun[] = [
  { name: 'alpha-20', seed: 'golden-alpha', agents: 20 },
  { name: 'alpha-70', seed: 'golden-alpha', agents: 70 },
  { name: 'beta-20', seed: 'golden-beta', agents: 20 },
  { name: 'beta-70', seed: 'golden-beta', agents: 70 },
  { name: 'gamma-20', seed: 'golden-gamma', agents: 20 },
  { name: 'gamma-70', seed: 'golden-gamma', agents: 70 },
  {
    name: 'seeded-30',
    seed: 'golden-seeded',
    agents: 30,
    craftLearning: true,
    setup: (exp) => {
      exp.seedMyth('The first makers raised a home by the great river', { timesHeard: 5 });
      exp.seedRecipe('spear', exp.agentIds.slice(0, 2));
    },
  },
];

/** Run one config to each checkpoint, fingerprinting the whole state at each. */
export function fingerprintsFor(run: GoldenRun): string[] {
  const exp = new Experiment({
    seed: run.seed,
    agentCount: run.agents,
    ...(run.craftLearning ? { craftLearning: true } : {}),
  });
  run.setup?.(exp);
  const out: string[] = [];
  let at = 0;
  for (const cp of GOLDEN_CHECKPOINTS) {
    exp.advance(cp - at);
    at = cp;
    out.push(fingerprintOf(exp));
  }
  return out;
}
