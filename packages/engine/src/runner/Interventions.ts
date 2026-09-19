import { CRAFT_RECIPES } from '../body/index.js';
import { emptyContext, heardEvent } from '../contract/adapter.js';
import type { SimEvent } from '../contract/types.js';
import type { Needs, ObjectKind } from '../worlds/forager/types.js';
import type { SimRuntime } from './Runtime.js';

const NEED_KEYS = ['hunger', 'rest', 'safety', 'socialConnection'] as const satisfies readonly (keyof Needs)[];

function clampNeed(v: number): number {
  return Math.max(0, Math.min(100, v));
}

/**
 * THE ONE DOOR A NON-NUMBER COULD COME THROUGH (W1-B2 verifier §3, backlog 4).
 *
 * Every event the engine itself emits writes real numbers into its need-delta
 * slots. An AUTHORED event is written by a host, and a slot holding `undefined`
 * — or a string, or `NaN` — used to reach `importanceOf` and make a memory's
 * importance `NaN`, which in turn made one being's eviction order depend on the
 * JavaScript engine's sort. B3 makes `importanceOf` total; this closes the door
 * as well, so the SCAFFOLD LEDGER and the bus agree on what was authored rather
 * than the ledger keeping a value nothing could act on.
 *
 * Clamped to 0, in place, and only where the value is unusable: a deed nobody
 * can measure the effect of moved nothing. Key order is untouched, so a
 * well-formed authored event is byte-identical through here.
 */
function clampAuthoredDeltas(payload: Record<string, unknown>): void {
  for (const slot of ['needDeltas', 'targetNeedDeltas']) {
    const deltas = payload[slot];
    if (typeof deltas !== 'object' || deltas === null) continue;
    const row = deltas as Record<string, unknown>;
    for (const [drive, value] of Object.entries(row)) {
      if (typeof value !== 'number' || !Number.isFinite(value)) row[drive] = 0;
    }
  }
}

/**
 * SANCTIONED SCAFFOLDING (recorded).
 *
 * Experiments legitimately intervene — freedom from want isolates the
 * cultural variable. What was illegitimate was doing it by reaching into
 * bodies, so no captured act could say it had happened. These are the same
 * interventions, through the front door, written into the scaffold ledger and
 * stamped onto every cognition record produced afterwards.
 *
 * Every method here writes to the world, so this is runtime-side, not
 * instrument-side: an intervention is an input, a measurement never is.
 */
export class Interventions {
  constructor(private readonly rt: SimRuntime) {}

  /** Mark a living being CONSCIOUS — from now it reasons via the LLM, born into
   * the culture that already exists around it. The rest stay reflex. */
  makeConscious(id: number): boolean {
    const rt = this.rt;
    if (!rt.minds.has(id) || !rt.agentBody(id)?.alive) return false;
    rt.conscious.add(id);
    rt.scaffold.madeConscious(id, rt.tick);
    return true;
  }

  /**
   * Set needs/health from outside. `patch` is absolute pressure values, not
   * deltas — a driver "provisioning" a being is declaring a state, not nudging
   * one. Returns how many living beings were touched.
   */
  provisionNeeds(
    ids: Iterable<number>,
    patch: Partial<Needs> & { health?: number; clearSickness?: boolean },
  ): number {
    const rt = this.rt;
    const touched: number[] = [];
    for (const id of ids) {
      const body = rt.agentBody(id);
      if (!body?.alive) continue;
      for (const key of NEED_KEYS) {
        const v = patch[key];
        if (v !== undefined) body.needs[key] = clampNeed(v);
      }
      if (patch.health !== undefined) body.health = Math.max(0, Math.min(100, patch.health));
      if (patch.clearSickness) body.sickUntil = 0;
      touched.push(id);
    }
    rt.scaffold.provisionedNeeds(touched, rt.tick);
    return touched.length;
  }

  /**
   * Put items in a being's hands. `mode: 'floor'` tops the stack up to the
   * given count (what the Phase 2 drivers did); `'add'` adds that many.
   */
  grantItems(id: number, items: Partial<Record<ObjectKind, number>>, mode: 'floor' | 'add' = 'floor'): boolean {
    const body = this.rt.agentBody(id);
    if (!body?.alive) return false;
    for (const [kind, n] of Object.entries(items) as [ObjectKind, number][]) {
      const have = body.inventory[kind] ?? 0;
      body.inventory[kind] = mode === 'add' ? have + n : Math.max(have, n);
    }
    this.rt.scaffold.grantedItems(id, this.rt.tick);
    return true;
  }

  /**
   * Move a being. `markMoved` is the spatial index's contract for a position
   * written directly — without it the being stays findable only where it used
   * to be until the next tick reconciles, and a query made in between (say the
   * witnesses of an authored event) would be answered about the old place.
   */
  relocate(id: number, x: number, y: number): boolean {
    const rt = this.rt;
    const entity = rt.agentEntity(id);
    if (!entity) return false;
    const t = entity.components['Transform2D'] as { x: number; y: number } | undefined;
    if (!t) return false;
    t.x = x;
    t.y = y;
    rt.geography.clamp(t);
    rt.world.spatial.markMoved(id);
    rt.scaffold.relocated(id, rt.tick);
    return true;
  }

  /**
   * Emit an event nobody did — an authored deed, to test how a people reads
   * one. The witnesses are resolved before it goes out, so every being it
   * reaches carries the fact in its scaffold from then on.
   */
  authorEvent(event: SimEvent): number {
    const rt = this.rt;
    clampAuthoredDeltas(event.payload);
    const witnesses = rt.perception.witnessesOf(rt.world, event);
    rt.scaffold.authoredEvent(event, witnesses);
    rt.bus.emit(event);
    return witnesses.length;
  }

  /**
   * CULTURAL SEEDING (Exp 10): inject one shared myth into a people, as if long
   * told. `timesHeard` sets its familiarity (high → it becomes the tale told
   * most). It is a STORY the minds then interpret — no behavioural instruction,
   * no role, no incentive. The experiment of whether culture can steer curiosity.
   */
  seedMyth(text: string, opts: { id?: string; x?: number; y?: number; timesHeard?: number; toAgentIds?: number[] } = {}): void {
    const rt = this.rt;
    const id = opts.id ?? 'seed:myth';
    // A myth with no site is anchored at the world's own beginning — the
    // middle of the classic plane, the founding valley on the continent.
    const x = opts.x ?? rt.geography.origin.x;
    const y = opts.y ?? rt.geography.origin.y;
    const timesHeard = opts.timesHeard ?? 6;
    const ids = opts.toAgentIds ?? rt.agentIds;
    for (const aid of ids) {
      const mind = rt.minds.get(aid);
      if (mind) mind.narratives.seed(id, text, x, y, rt.tick, timesHeard);
    }
    rt.scaffold.seededMyth(id, text, ids, rt.tick);
  }

  /**
   * Phase 3 Exp 1 setup: give a being the SKILL of a craft — as if it had
   * discovered (or long ago been taught) the recipe. It now holds the
   * craft-recipe as firm knowledge and will practise it; whether the skill
   * then SPREADS by observation is the experiment, not this seeding. The
   * recipe's materials come from the engine's one source of truth (CRAFT_RECIPES),
   * so a seeded maker makes exactly what anyone could discover.
   */
  seedRecipe(output: ObjectKind, toAgentIds: number[]): void {
    const rt = this.rt;
    const recipe = CRAFT_RECIPES.find((r) => r.output === output);
    if (!recipe) throw new Error(`no recipe makes ${output}`);
    for (const aid of toAgentIds) {
      const mind = rt.minds.get(aid);
      if (!mind) continue;
      mind.knowledge.applyEvidence(
        {
          rule: { kind: 'craft-recipe', output, inputs: recipe.inputs },
          confidence: 0.95,
          evidenceCount: 6, // > HELD_MIN_EVIDENCE, so it is held from the start
          contradictionCount: 0,
          sourceMemoryIds: [],
        },
        rt.tick,
      );
    }
    rt.scaffold.seededRecipe(output, toAgentIds, rt.tick);
  }

  /**
   * The user gives the Gahallians an idea (never the engine). Lands as a
   * high-salience thought in the target (or every living agent for 'all').
   * Returns how many received it. The doctrine holds: the world seeds nothing;
   * only the human outside may whisper a thought in.
   */
  giveIdea(text: string, target: number | 'all'): number {
    const rt = this.rt;
    const clean = text.trim().slice(0, 200);
    if (!clean) return 0;
    // A thought arrives as the kind of happening this world uses to carry
    // something said, in a context in which nothing this world notices is the
    // case — both read off the adapter, because a whisper from outside comes
    // from nowhere in particular and the mind has no way to invent either. A
    // world with no speech in it cannot be whispered to.
    const heard = heardEvent(rt.adapter);
    if (heard === undefined) return 0;
    const ids = target === 'all' ? rt.agentIds : [target];
    const reached: number[] = [];
    for (const id of ids) {
      const mind = rt.minds.get(id);
      if (mind && rt.agentBody(id)?.alive) {
        // A fresh context per being, as the literal it replaces was: no two
        // memories in the world share one.
        mind.injectIdea(clean, rt.tick, heard, emptyContext(rt.adapter));
        reached.push(id);
      }
    }
    rt.scaffold.gaveIdea(clean, reached, rt.tick);
    return reached.length;
  }
}
