import type { World } from '../core/World.js';
import type { Entity } from '../core/Entity.js';
import type { Transform2D } from '../core/Transform2D.js';
import type { GahallianBody } from './GahallianBody.js';
import type { ResourceNode } from './ResourceNodeSystem.js';
import { NODE_YIELD, SEED_EVERY_N_GATHERS } from './ResourceNodeSystem.js';
import type { Structure } from './PerceptionSystem.js';
import { PerceptionSystem } from './PerceptionSystem.js';
import type { SimEventBus } from './SimEventBus.js';
import type { BuildKind, ContextFeatures, Intent, Needs, ObjectKind } from './contract.js';
import { NEED_CRITICAL } from './contract.js';
import {
  EXPOSURE_HEALTH_PER_TICK,
  EXPOSURE_SAFETY_PER_TICK,
  NUTRITIOUS_FOODS,
  SICKENING_FOODS,
  SICKNESS_TICKS,
} from './WorldRegularities.js';
import { coldPressure, hungerRateMultiplier } from './Climate.js';

const MOVE_SPEED = 0.5;
const ARRIVE_DISTANCE = 1.0;
const INTERACT_RANGE = 2.5;
const GIVE_RANGE = 3;
const ATTACK_RANGE = 2;
const ATTACK_DAMAGE = 15;
const SOCIAL_RANGE = 8;

const EAT_HUNGER_RELIEF = 55;
const SICK_SAFETY_HIT = 15;

const BUILD_COST: Record<BuildKind, number> = { shelter: 3, wall: 1, container: 2 };

const DECAY = {
  hunger: 0.022,
  restAwake: 0.03,
  safetyRecovery: 0.03,
  social: 0.02,
  socialNearOthers: 0.08,
  sleepRestRelief: 0.15,
  shelterSleepBonus: 1.6,
  starvationHealth: 0.05,
  sicknessHealth: 0.05,
  healthRegen: 0.01,
};

/**
 * The fixed-timestep life loop: needs decay, sickness, exposure, death,
 * and reflex execution of the current plan as validated intents. The body
 * experiences reality and enforces it — minds never mutate the world, and
 * every intent is validated against physics before it runs. Rejections
 * become events (and therefore memories: useful cognition fuel).
 *
 * Deterministic: no randomness, agents processed in entity-id order.
 */
export class YggdrasilSystem {
  constructor(private readonly perception = new PerceptionSystem()) {}

  step(world: World, tick: number, bus: SimEventBus): void {
    const agents: Entity[] = [];
    world.forEach((entity) => {
      const body = entity.components['GahallianBody'] as GahallianBody | undefined;
      if (body?.alive) agents.push(entity);
    });

    for (const entity of agents) {
      const body = entity.components['GahallianBody'] as GahallianBody;
      if (!body.alive) continue; // May have died to an earlier agent's attack this tick.
      const t = entity.components['Transform2D'] as Transform2D;
      const context = this.perception.contextAt(world, t.x, t.y, tick);

      this.decayNeeds(world, entity, body, context, tick);
      this.applyAfflictions(body, context, tick, entity, bus, t);
      if (!body.alive) {
        this.die(world, entity, body, t, tick, bus);
        continue;
      }

      if (body.sleepingUntil > tick) {
        this.sleepTick(body, context);
        continue;
      }
      if (body.sleepingUntil !== 0 && body.sleepingUntil <= tick) {
        this.wake(entity, body, t, tick, bus);
      }

      this.urgentOverride(body);
      this.executeStep(world, entity, body, t, context, tick, bus);

      body.hitThisTick = false;
    }
  }

  /** Hand a new plan to the body (the host calls this from MindOutput). */
  setPlan(body: GahallianBody, plan: Intent[]): void {
    body.plan = plan;
    body.planStep = 0;
    body.planDone = plan.length === 0;
    body.intentTicks = 0;
  }

  // ── Needs & afflictions ──────────────────────────────────────────────────

  private decayNeeds(
    world: World,
    entity: Entity,
    body: GahallianBody,
    context: ContextFeatures,
    tick: number,
  ): void {
    const sleeping = body.sleepingUntil > 0;
    // Cold burns energy — hunger climbs faster in autumn/winter.
    body.needs.hunger = clamp(body.needs.hunger + DECAY.hunger * hungerRateMultiplier(tick));
    if (!sleeping) body.needs.rest = clamp(body.needs.rest + DECAY.restAwake);
    if (!context.night || context.inShelter) {
      body.needs.safety = clamp(body.needs.safety - DECAY.safetyRecovery);
    }

    const t = entity.components['Transform2D'] as Transform2D;
    let companyNear = false;
    world.forEach((other) => {
      if (companyNear || other.id === entity.id) return;
      const ob = other.components['GahallianBody'] as GahallianBody | undefined;
      if (!ob?.alive) return;
      const ot = other.components['Transform2D'] as Transform2D | undefined;
      if (!ot) return;
      const dx = ot.x - t.x;
      const dy = ot.y - t.y;
      if (dx * dx + dy * dy <= SOCIAL_RANGE * SOCIAL_RANGE) companyNear = true;
    });
    body.needs.socialConnection = clamp(
      body.needs.socialConnection + (companyNear ? -DECAY.socialNearOthers : DECAY.social),
    );
  }

  private applyAfflictions(
    body: GahallianBody,
    context: ContextFeatures,
    tick: number,
    entity: Entity,
    bus: SimEventBus,
    t: Transform2D,
  ): void {
    const sick = body.sickUntil > tick;
    if (body.sickUntil !== 0 && body.sickUntil <= tick) {
      body.sickUntil = 0;
      bus.emit({
        tick,
        type: 'RecoveredFromSickness',
        actorId: entity.id,
        targetIds: [],
        x: t.x,
        y: t.y,
        payload: { needDeltas: { safety: -10 } satisfies Partial<Needs> },
      });
      body.needs.safety = clamp(body.needs.safety - 10);
    }

    if (sick) body.health -= DECAY.sicknessHealth;
    if (body.needs.hunger >= 100) body.health -= DECAY.starvationHealth;

    // Winter cold presses even by day when unsheltered; night + winter is
    // the real killer. Shelter negates it — the pressure that rewards building.
    const cold = coldPressure(tick);
    if (cold > 0 && !context.inShelter) {
      body.needs.safety = clamp(body.needs.safety + EXPOSURE_SAFETY_PER_TICK * cold);
      body.health -= EXPOSURE_HEALTH_PER_TICK * cold;
    }

    const exposed = context.night && !context.inShelter;
    if (exposed) {
      body.needs.safety = clamp(body.needs.safety + EXPOSURE_SAFETY_PER_TICK);
      body.health -= EXPOSURE_HEALTH_PER_TICK;
      if (tick % 150 === 0) {
        bus.emit({
          tick,
          type: 'SufferedExposure',
          actorId: entity.id,
          targetIds: [],
          x: t.x,
          y: t.y,
          payload: { needDeltas: { safety: 12 } satisfies Partial<Needs> },
        });
      }
    }

    if (!sick && body.needs.hunger < 60 && body.health < 100) {
      body.health = Math.min(100, body.health + DECAY.healthRegen);
    }
    if (body.health <= 0) body.alive = false;
  }

  private die(
    world: World,
    entity: Entity,
    body: GahallianBody,
    t: Transform2D,
    tick: number,
    bus: SimEventBus,
  ): void {
    const cause = body.hitThisTick
      ? 'violence'
      : body.sickUntil > tick
        ? 'sickness'
        : body.needs.hunger >= 100
          ? 'starvation'
          : 'exposure';
    // A corpse drops its inventory where it falls — an open container,
    // like every container (no access control; "theft" is a judgment).
    if (Object.keys(body.inventory).length > 0) {
      world.createEntity({
        Transform2D: { x: t.x, y: t.y } satisfies Transform2D,
        Structure: {
          kind: 'container',
          builtBy: entity.id,
          builtTick: tick,
          inventory: { ...body.inventory },
        } satisfies Structure,
      });
      body.inventory = {};
    }
    bus.emit({
      tick,
      type: 'AgentDied',
      actorId: entity.id,
      targetIds: [],
      x: t.x,
      y: t.y,
      payload: { cause },
    });
  }

  // ── Sleep ────────────────────────────────────────────────────────────────

  private sleepTick(body: GahallianBody, context: ContextFeatures): void {
    const relief = DECAY.sleepRestRelief * (body.sleptInShelter ? DECAY.shelterSleepBonus : 1);
    body.needs.rest = clamp(body.needs.rest - relief);
    if (context.night && !context.inShelter) {
      // Exposure while sleeping outside is already applied in afflictions.
    }
  }

  private wake(entity: Entity, body: GahallianBody, t: Transform2D, tick: number, bus: SimEventBus): void {
    const restDelta = body.needs.rest - body.sleepStartRest;
    bus.emit({
      tick,
      type: body.sleptInShelter ? 'SleptSafely' : 'SleptExposed',
      actorId: entity.id,
      targetIds: [],
      x: t.x,
      y: t.y,
      payload: { needDeltas: { rest: restDelta } satisfies Partial<Needs> },
    });
    body.sleepingUntil = 0;
    this.advance(body);
  }

  // ── Reflex execution ─────────────────────────────────────────────────────

  /** Critical hunger interrupts anything when there is safe food in hand. */
  private urgentOverride(body: GahallianBody): void {
    if (body.needs.hunger < NEED_CRITICAL) return;
    if ((body.inventory.berry ?? 0) <= 0) return;
    const current = body.plan[body.planStep];
    if (current?.kind === 'Eat') return;
    body.plan.splice(body.planStep, 0, { kind: 'Eat', objectKind: 'berry' });
  }

  private executeStep(
    world: World,
    entity: Entity,
    body: GahallianBody,
    t: Transform2D,
    context: ContextFeatures,
    tick: number,
    bus: SimEventBus,
  ): void {
    const intent = body.plan[body.planStep];
    if (!intent) {
      body.planDone = true;
      return;
    }
    body.intentTicks++;

    const reject = (reason: string): void => {
      bus.emit({
        tick,
        type: 'IntentRejected',
        actorId: entity.id,
        targetIds: [],
        x: t.x,
        y: t.y,
        payload: { intentKind: intent.kind, reason },
      });
      this.advance(body);
    };

    switch (intent.kind) {
      case 'MoveTo': {
        const target = this.resolvePoint(world, intent);
        if (!target) return reject('no-target');
        if (this.moveToward(t, target.x, target.y)) this.advance(body);
        return;
      }
      case 'Gather': {
        const node = this.componentNear<ResourceNode>(world, t, intent.targetId, 'ResourceNode', INTERACT_RANGE);
        if (!node) return reject('out-of-range');
        if (node.value.stock <= 0) {
          bus.emit({
            tick,
            type: 'GatherFailed',
            actorId: entity.id,
            targetIds: [node.id],
            x: t.x,
            y: t.y,
            payload: { nodeKind: node.value.kind },
          });
          this.advance(body);
          return;
        }
        node.value.stock--;
        node.value.gatherCount++;
        const yieldKind = NODE_YIELD[node.value.kind];
        addItem(body.inventory, yieldKind, 1);
        // Food bushes hand out a seed every Nth gather — the physical fact
        // agriculture can be discovered from.
        if (
          (node.value.kind === 'berryBush' || node.value.kind === 'foodPlant') &&
          node.value.gatherCount % SEED_EVERY_N_GATHERS === 0
        ) {
          addItem(body.inventory, 'seed', 1);
        }
        bus.emit({
          tick,
          type: 'GatherSucceeded',
          actorId: entity.id,
          targetIds: [node.id],
          x: t.x,
          y: t.y,
          payload: { objectKind: yieldKind },
        });
        this.advance(body);
        return;
      }
      case 'Dig': {
        // Dig the ground where you stand — clay by water, stone elsewhere.
        // A capability, not an instruction: nothing tells them to do it; the
        // reflex never does. It lets earth/clay/stone be won anywhere, so
        // building (and later brick/clay craft) can be DISCOVERED.
        const dug: ObjectKind = context.nearWater ? 'clay' : 'stone';
        addItem(body.inventory, dug, 1);
        bus.emit({
          tick,
          type: 'GatherSucceeded',
          actorId: entity.id,
          targetIds: [],
          x: t.x,
          y: t.y,
          payload: { objectKind: dug, dug: true },
        });
        this.advance(body);
        return;
      }
      case 'Eat': {
        const kind = intent.objectKind ?? 'berry';
        if ((body.inventory[kind] ?? 0) <= 0) return reject('not-in-inventory');
        removeItem(body.inventory, kind, 1);
        // Nutritious foods relieve hunger; poisonous ones barely (and sicken);
        // eating non-food (clay, ore…) does nothing — all discoverable.
        const sickening = SICKENING_FOODS.has(kind);
        const relief = NUTRITIOUS_FOODS.has(kind) ? EAT_HUNGER_RELIEF : sickening ? 8 : 0;
        const before = body.needs.hunger;
        body.needs.hunger = clamp(body.needs.hunger - relief);
        bus.emit({
          tick,
          type: 'AteFood',
          actorId: entity.id,
          targetIds: [],
          x: t.x,
          y: t.y,
          payload: {
            objectKind: kind,
            needDeltas: { hunger: body.needs.hunger - before } satisfies Partial<Needs>,
          },
        });
        if (sickening) {
          body.sickUntil = tick + SICKNESS_TICKS;
          body.needs.safety = clamp(body.needs.safety + SICK_SAFETY_HIT);
          bus.emit({
            tick,
            type: 'BecameSick',
            actorId: entity.id,
            targetIds: [],
            x: t.x,
            y: t.y,
            payload: { needDeltas: { safety: SICK_SAFETY_HIT } satisfies Partial<Needs> },
          });
        }
        this.advance(body);
        return;
      }
      case 'Drink': {
        const node = this.nearestNodeOfKind(world, t, 'waterSource', GIVE_RANGE);
        if (!node) return reject('no-water');
        const before = body.needs.hunger;
        body.needs.hunger = clamp(body.needs.hunger - 2);
        bus.emit({
          tick,
          type: 'DrankWater',
          actorId: entity.id,
          targetIds: [node.id],
          x: t.x,
          y: t.y,
          payload: { needDeltas: { hunger: body.needs.hunger - before } satisfies Partial<Needs> },
        });
        this.advance(body);
        return;
      }
      case 'Sleep': {
        body.sleepingUntil = tick + (intent.durationTicks ?? 200);
        body.sleptInShelter = context.inShelter;
        body.sleepStartRest = body.needs.rest;
        return;
      }
      case 'Build': {
        const kind = intent.buildKind ?? 'shelter';
        const cost = BUILD_COST[kind];
        if ((body.inventory.wood ?? 0) < cost) return reject('not-enough-wood');
        removeItem(body.inventory, 'wood', cost);
        const x = intent.x ?? t.x;
        const y = intent.y ?? t.y;
        const built = world.createEntity({
          Transform2D: { x, y } satisfies Transform2D,
          Structure: { kind, builtBy: entity.id, builtTick: tick, inventory: {} } satisfies Structure,
        });
        bus.emit({
          tick,
          type: 'BuiltStructure',
          actorId: entity.id,
          targetIds: [built.id],
          x,
          y,
          payload: { buildKind: kind, needDeltas: { safety: kind === 'shelter' ? -10 : 0 } },
        });
        if (kind === 'shelter') body.needs.safety = clamp(body.needs.safety - 10);
        this.advance(body);
        return;
      }
      case 'Deposit': {
        const kind = intent.objectKind ?? 'seed';
        if ((body.inventory[kind] ?? 0) <= 0) return reject('not-in-inventory');
        if (intent.targetId !== undefined) {
          const container = this.componentNear<Structure>(world, t, intent.targetId, 'Structure', GIVE_RANGE);
          if (!container || container.value.kind !== 'container') return reject('no-container');
          removeItem(body.inventory, kind, 1);
          container.value.inventory[kind] = ((container.value.inventory[kind] as number | undefined) ?? 0) + 1;
          bus.emit({
            tick,
            type: 'DepositedItem',
            actorId: entity.id,
            targetIds: [container.id],
            x: t.x,
            y: t.y,
            payload: { objectKind: kind },
          });
        } else {
          // Depositing on the ground. Seeds go into the soil.
          removeItem(body.inventory, kind, 1);
          if (kind === 'seed') {
            world.createEntity({
              Transform2D: { x: t.x, y: t.y } satisfies Transform2D,
              SeedInGround: { plantedTick: tick },
            });
            bus.emit({
              tick,
              type: 'SeedDeposited',
              actorId: entity.id,
              targetIds: [],
              x: t.x,
              y: t.y,
              payload: { objectKind: kind },
            });
          } else {
            bus.emit({
              tick,
              type: 'DepositedItem',
              actorId: entity.id,
              targetIds: [],
              x: t.x,
              y: t.y,
              payload: { objectKind: kind },
            });
          }
        }
        this.advance(body);
        return;
      }
      case 'Withdraw': {
        const kind = intent.objectKind;
        if (!kind) return reject('no-object-kind');
        const container = this.componentNear<Structure>(world, t, intent.targetId, 'Structure', GIVE_RANGE);
        if (!container || container.value.kind !== 'container') return reject('no-container');
        const available = (container.value.inventory[kind] as number | undefined) ?? 0;
        if (available <= 0) return reject('container-empty');
        container.value.inventory[kind] = available - 1;
        addItem(body.inventory, kind, 1);
        bus.emit({
          tick,
          type: 'WithdrewItem',
          actorId: entity.id,
          targetIds: [container.id],
          x: t.x,
          y: t.y,
          payload: { objectKind: kind },
        });
        this.advance(body);
        return;
      }
      case 'Give': {
        const kind = intent.objectKind ?? 'berry';
        if ((body.inventory[kind] ?? 0) <= 0) return reject('not-in-inventory');
        const receiver = this.livingAgentNear(world, t, intent.targetId, GIVE_RANGE);
        if (!receiver) return reject('no-receiver');
        removeItem(body.inventory, kind, 1);
        const receiverBody = receiver.components['GahallianBody'] as GahallianBody;
        addItem(receiverBody.inventory, kind, 1);
        bus.emit({
          tick,
          type: 'GaveItem',
          actorId: entity.id,
          targetIds: [receiver.id],
          x: t.x,
          y: t.y,
          payload: { objectKind: kind },
        });
        this.advance(body);
        return;
      }
      case 'Attack': {
        const victim = this.livingAgentNear(world, t, intent.targetId, ATTACK_RANGE);
        if (!victim) return reject('out-of-range');
        const victimBody = victim.components['GahallianBody'] as GahallianBody;
        victimBody.health -= ATTACK_DAMAGE;
        victimBody.needs.safety = clamp(victimBody.needs.safety + 25);
        victimBody.hitThisTick = true;
        bus.emit({
          tick,
          type: 'AttackedAgent',
          actorId: entity.id,
          targetIds: [victim.id],
          x: t.x,
          y: t.y,
          payload: { targetNeedDeltas: { safety: 25 } satisfies Partial<Needs> },
        });
        if (victimBody.health <= 0) {
          victimBody.alive = false;
          const vt = victim.components['Transform2D'] as Transform2D;
          this.die(world, victim, victimBody, vt, tick, bus);
        }
        this.advance(body);
        return;
      }
      case 'Speak': {
        if (!intent.utterance) return reject('nothing-to-say');
        bus.emit({
          tick,
          type: 'UtteranceSpoken',
          actorId: entity.id,
          targetIds: intent.utterance.targetId !== undefined ? [intent.utterance.targetId] : [],
          x: t.x,
          y: t.y,
          payload: { utterance: intent.utterance },
        });
        this.advance(body);
        return;
      }
      case 'Follow': {
        const target = this.livingAgentNear(world, t, intent.targetId, Infinity);
        if (!target || body.intentTicks > 300) return this.advance(body);
        const tt = target.components['Transform2D'] as Transform2D;
        const dx = tt.x - t.x;
        const dy = tt.y - t.y;
        if (dx * dx + dy * dy <= GIVE_RANGE * GIVE_RANGE) return this.advance(body);
        this.moveToward(t, tt.x, tt.y);
        return;
      }
      case 'Flee': {
        if (intent.x === undefined || intent.y === undefined) return reject('no-threat');
        if (body.intentTicks > 60) return this.advance(body);
        const dx = t.x - intent.x;
        const dy = t.y - intent.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        t.x += (dx / d) * MOVE_SPEED * 1.5; // Fear is fast.
        t.y += (dy / d) * MOVE_SPEED * 1.5;
        return;
      }
      case 'Idle': {
        if (body.intentTicks >= (intent.durationTicks ?? 30)) this.advance(body);
        return;
      }
    }
  }

  private advance(body: GahallianBody): void {
    body.planStep++;
    body.intentTicks = 0;
    if (body.planStep >= body.plan.length) body.planDone = true;
  }

  /** Move one tick toward (x, y); true when arrived. */
  private moveToward(t: Transform2D, x: number, y: number): boolean {
    const dx = x - t.x;
    const dy = y - t.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d <= ARRIVE_DISTANCE) return true;
    t.x += (dx / d) * MOVE_SPEED;
    t.y += (dy / d) * MOVE_SPEED;
    return false;
  }

  private resolvePoint(world: World, intent: Intent): { x: number; y: number } | undefined {
    if (intent.targetId !== undefined) {
      const target = world.getEntity(intent.targetId);
      const tt = target?.components['Transform2D'] as Transform2D | undefined;
      if (tt) return { x: tt.x, y: tt.y };
    }
    if (intent.x !== undefined && intent.y !== undefined) return { x: intent.x, y: intent.y };
    return undefined;
  }

  private componentNear<T>(
    world: World,
    t: Transform2D,
    targetId: number | undefined,
    componentKey: string,
    range: number,
  ): { id: number; value: T } | undefined {
    if (targetId === undefined) return undefined;
    const entity = world.getEntity(targetId);
    const value = entity?.components[componentKey] as T | undefined;
    const tt = entity?.components['Transform2D'] as Transform2D | undefined;
    if (!entity || !value || !tt) return undefined;
    const dx = tt.x - t.x;
    const dy = tt.y - t.y;
    if (dx * dx + dy * dy > range * range) return undefined;
    return { id: entity.id, value };
  }

  private nearestNodeOfKind(
    world: World,
    t: Transform2D,
    kind: ResourceNode['kind'],
    range: number,
  ): { id: number } | undefined {
    let best: { id: number } | undefined;
    let bestD = range * range;
    world.forEach((entity) => {
      const node = entity.components['ResourceNode'] as ResourceNode | undefined;
      if (node?.kind !== kind) return;
      const tt = entity.components['Transform2D'] as Transform2D | undefined;
      if (!tt) return;
      const dx = tt.x - t.x;
      const dy = tt.y - t.y;
      const d = dx * dx + dy * dy;
      if (d <= bestD) {
        best = { id: entity.id };
        bestD = d;
      }
    });
    return best;
  }

  private livingAgentNear(
    world: World,
    t: Transform2D,
    targetId: number | undefined,
    range: number,
  ): Entity | undefined {
    if (targetId === undefined) return undefined;
    const entity = world.getEntity(targetId);
    const body = entity?.components['GahallianBody'] as GahallianBody | undefined;
    const tt = entity?.components['Transform2D'] as Transform2D | undefined;
    if (!entity || !body?.alive || !tt) return undefined;
    if (range === Infinity) return entity;
    const dx = tt.x - t.x;
    const dy = tt.y - t.y;
    return dx * dx + dy * dy <= range * range ? entity : undefined;
  }
}

function clamp(v: number): number {
  return Math.min(100, Math.max(0, v));
}

function addItem(inventory: GahallianBody['inventory'], kind: ObjectKind, n: number): void {
  inventory[kind] = (inventory[kind] ?? 0) + n;
}

function removeItem(inventory: GahallianBody['inventory'], kind: ObjectKind, n: number): void {
  const left = (inventory[kind] ?? 0) - n;
  if (left <= 0) delete inventory[kind];
  else inventory[kind] = left;
}
