import { describeEpisode } from '../../src/memory/memoryFromEvent.js';
import type {
  ContextFeatureKey,
  ContextFeatures,
  MemoryRecord,
  NeedKey,
  Needs,
  ObjectKind,
  RelationshipRecord,
  SimEvent,
  SimEventType,
  Utterance,
} from '../../src/contract/types.js';

/**
 * THE FORAGER WORLD AS THE MIND OWNED IT, the moment before W1-B1 moved it out:
 * every table copied verbatim from the file it lived in, plus the perspective
 * switch as it was written. Nothing here imports the adapter, on purpose — this
 * is the independent "before" that `world-tables-transcribed.test.ts` checks
 * the "after" against, and the two must never come to share a source.
 */

/** memory/importance.ts */
export const BASE: Record<SimEventType, number> = {
  GatherSucceeded: 0.25,
  GatherFailed: 0.3,
  AteFood: 0.25,
  DrankWater: 0.15,
  BecameSick: 0.85,
  RecoveredFromSickness: 0.5,
  SleptSafely: 0.15,
  SleptExposed: 0.35,
  SufferedExposure: 0.5,
  ReceivedItem: 0.6,
  GaveItem: 0.45,
  WasAttacked: 0.9,
  AttackedAgent: 0.7,
  AttackedByPredator: 0.92,
  FoughtPredator: 0.8,
  KilledPredator: 0.88,
  Crafted: 0.78,
  ChildBorn: 0.9,
  AgentDied: 0.95,
  WitnessedDeath: 0.9,
  SeedDeposited: 0.2,
  PlantSprouted: 0.55,
  BuiltStructure: 0.5,
  DepositedItem: 0.2,
  WithdrewItem: 0.25,
  UtteranceSpoken: 0.35,
  IntentRejected: 0.3,
  SawAgent: 0.1,
  FoundResource: 0.3,
};

export const EVENT_IDS = Object.keys(BASE) as SimEventType[];

export type Deltas = Partial<Omit<RelationshipRecord, 'interactionCount' | 'lastInteractionTick'>>;

/** relationships/RelationshipStore.ts */
export const EVENT_DELTAS: Partial<Record<SimEventType, Deltas>> = {
  ReceivedItem: { trust: 6, friendship: 5 },
  GaveItem: { friendship: 2 },
  WasAttacked: { trust: -15, fear: 12, friendship: -10 },
  AttackedAgent: { fear: -2 },
  WitnessedDeath: { fear: 4 },
  UtteranceSpoken: { friendship: 1 },
  SleptSafely: {},
};
export const OBSERVER_APPLICABLE: ReadonlySet<SimEventType> = new Set<SimEventType>(['WitnessedDeath']);

/** learning/ContextMiner.ts + learning/OutcomeMiner.ts */
export const FEATURES: ContextFeatureKey[] = ['nearWater', 'night', 'inShelter', 'highland'];
export function wasFeatureActive(context: ContextFeatures, f: ContextFeatureKey): boolean {
  if (f === 'highland') return context.elevationBand === 2;
  return context[f];
}

/** consciousness/ReflexMind.ts, and contract/types.ts's two global thresholds. */
export const NEED_THRESHOLD: Record<NeedKey, number> = {
  hunger: 48,
  rest: 70,
  safety: 60,
  socialConnection: 74,
};
export const WAS_NEED_PRESSING = 60;
export const WAS_NEED_CRITICAL = 85;

/** learning/SuccessionMiner.ts */
export const DEFAULT_EXCLUDE: SimEventType[] = ['SawAgent', 'UtteranceSpoken', 'IntentRejected'];

/** runner/Runtime.ts `mindOptions` */
export const WAS_MIND_OPTIONS = {
  thinkInterval: (tr: { curiosity: number }): number => Math.round(180 - tr.curiosity * 1.1),
  consolidateInterval: (tr: { curiosity: number; ambition: number }): number =>
    Math.round(420 - (tr.curiosity * 0.6 + tr.ambition * 0.4) * 2.2),
  memoryHotCapacity: (tr: { curiosity: number; ambition: number }): number =>
    Math.round(256 + ((tr.curiosity + tr.ambition) / 2) * 5),
};

/** memory/memoryFromEvent.ts — the perspective switch, verbatim. */
export function wasMemoryFromEvent(
  event: SimEvent,
  selfId: number,
  context: ContextFeatures,
): Omit<MemoryRecord, 'id'> | undefined {
  const isActor = event.actorId === selfId;
  const isTarget = event.targetIds.includes(selfId);
  const needDeltas = (isActor ? (event.payload['needDeltas'] as Partial<Needs> | undefined) : undefined) ?? {};
  const targetNeedDeltas =
    (isTarget ? (event.payload['targetNeedDeltas'] as Partial<Needs> | undefined) : undefined) ?? {};
  const objectKind = event.payload['objectKind'] as ObjectKind | undefined;
  const craftInputs = event.payload['inputs'] as Partial<Record<ObjectKind, number>> | undefined;
  const utterance = event.payload['utterance'] as Utterance | undefined;

  let type: SimEventType = event.type;
  let subjects: number[];
  let origin: MemoryRecord['origin'] = 'experience';
  let deltas = needDeltas;
  let toldBy: number | undefined;
  let causedBy: number | undefined;

  if (isActor) {
    subjects = event.targetIds.filter((id) => id !== selfId);
  } else if (isTarget) {
    subjects = [event.actorId];
    deltas = targetNeedDeltas;
    switch (event.type) {
      case 'AttackedAgent':
        type = 'WasAttacked';
        break;
      case 'GaveItem':
        type = 'ReceivedItem';
        break;
      case 'UtteranceSpoken':
        toldBy = event.actorId;
        break;
      default:
        break;
    }
  } else {
    origin = 'observation';
    subjects = [event.actorId, ...event.targetIds].filter((id) => id !== selfId && id > 0);
    const actorDeltas = event.payload['needDeltas'] as Partial<Needs> | undefined;
    if (actorDeltas) {
      const seen: Partial<Needs> = {};
      for (const [k, v] of Object.entries(actorDeltas) as [keyof Needs, number][]) seen[k] = v * 0.5;
      deltas = seen;
    }
    switch (event.type) {
      case 'AgentDied': {
        type = 'WitnessedDeath';
        const killerId = event.payload['killerId'];
        if (typeof killerId === 'number' && killerId !== selfId) causedBy = killerId;
        break;
      }
      case 'UtteranceSpoken': {
        toldBy = event.actorId;
        break;
      }
      case 'IntentRejected':
        return undefined;
      default:
        break;
    }
  }

  let magnitude = 0;
  for (const delta of Object.values(deltas)) magnitude = Math.max(magnitude, Math.abs(delta) / 100);

  return {
    tick: event.tick,
    type,
    subjects,
    objectKind,
    craftInputs,
    context,
    needDeltas: deltas,
    outcome:
      event.type === 'GatherFailed' || event.type === 'IntentRejected'
        ? 'failure'
        : event.type.endsWith('Succeeded')
          ? 'success'
          : 'neutral',
    x: event.x,
    y: event.y,
    summaryText: describeEpisode(type, subjects, objectKind, causedBy),
    importance: Math.min(1, BASE[type] + magnitude * 0.3),
    origin,
    toldBy,
    causedBy,
    utterance,
  };
}
