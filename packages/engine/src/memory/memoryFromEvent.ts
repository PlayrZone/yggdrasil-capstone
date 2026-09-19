import type { EventRoleSchema, WorldAdapter } from '../contract/adapter.js';
import type {
  ContextFeatures,
  MemoryRecord,
  Needs,
  ObjectKind,
  SimEvent,
  SimEventType,
  Utterance,
} from '../contract/types.js';
import { importanceOf } from './importance.js';

/**
 * One physical event, N subjective memories. The same SimEvent reads
 * differently depending on who you were in it: the giver remembers
 * GaveItem, the receiver remembers ReceivedItem, a bystander records an
 * observation. This perspective mapping is where subjective worldviews
 * start to diverge.
 *
 * WHAT differs per perspective is the world's (`events[].roles`); the parts
 * that are the same for every event live here, because they are the mechanism:
 * who the subjects are, that a target reads its own need-change, and that a
 * bystander gets a discounted read of the actor's.
 *
 * Returns undefined when the event is not memorable from this perspective.
 */
export function memoryFromEvent(
  world: WorldAdapter,
  event: SimEvent,
  selfId: number,
  context: ContextFeatures,
): Omit<MemoryRecord, 'id'> | undefined {
  const schema = world.eventById.get(event.type);
  const isActor = event.actorId === selfId;
  const isTarget = event.targetIds.includes(selfId);
  const needDeltas = (isActor ? (event.payload['needDeltas'] as Partial<Needs> | undefined) : undefined) ?? {};
  const targetNeedDeltas =
    (isTarget ? (event.payload['targetNeedDeltas'] as Partial<Needs> | undefined) : undefined) ?? {};
  const objectKind = event.payload['objectKind'] as ObjectKind | undefined;
  const craftInputs = event.payload['inputs'] as Partial<Record<ObjectKind, number>> | undefined;
  const utterance = event.payload['utterance'] as Utterance | undefined;

  let role: EventRoleSchema | undefined;
  let subjects: number[];
  let origin: MemoryRecord['origin'] = 'experience';
  let deltas = needDeltas;

  if (isActor) {
    role = schema?.roles?.actor;
    subjects = event.targetIds.filter((id) => id !== selfId);
  } else if (isTarget) {
    role = schema?.roles?.target;
    subjects = [event.actorId];
    deltas = targetNeedDeltas;
  } else {
    // Bystander. Watching others is real input for the miners — this is
    // the demonstration/observation channel of knowledge transfer.
    role = schema?.roles?.bystander;
    origin = 'observation';
    subjects = [event.actorId, ...event.targetIds].filter((id) => id !== selfId && id > 0);
    // You can roughly SEE the actor's outcome — they eat and look relieved, or
    // sicken — a DISCOUNTED read of their need-change. This is what lets
    // watching an elder actually teach you (demonstration learning).
    const actorDeltas = event.payload['needDeltas'] as Partial<Needs> | undefined;
    if (actorDeltas) {
      const seen: Partial<Needs> = {};
      for (const [k, v] of Object.entries(actorDeltas) as [keyof Needs, number][]) seen[k] = v * 0.5;
      deltas = seen;
    }
  }

  if (role?.ignores) return undefined;

  const type: SimEventType = role?.recordsAs ?? event.type;
  const toldBy = role?.heard ? event.actorId : undefined;
  let causedBy: number | undefined;
  if (role?.causedByFrom !== undefined) {
    const dealtBy = event.payload[role.causedByFrom];
    // A killer does not witness itself into fearing itself.
    if (typeof dealtBy === 'number' && dealtBy !== selfId) causedBy = dealtBy;
  }

  return {
    tick: event.tick,
    type,
    subjects,
    objectKind,
    craftInputs,
    context,
    needDeltas: deltas,
    outcome: schema?.outcome ?? 'neutral',
    x: event.x,
    y: event.y,
    summaryText: describeEpisode(type, subjects, objectKind, causedBy),
    importance: importanceOf(world, type, deltas),
    origin,
    toldBy,
    causedBy,
    utterance,
  };
}

/**
 * The engine's one rendering of an episode. `EvidenceSnapshot` stores the parts
 * and not the string, so an inspector calls this to read a belief's evidence
 * back — same function, so the two can never drift.
 */
export function describeEpisode(
  type: SimEventType,
  subjects: readonly number[],
  objectKind?: ObjectKind,
  causedBy?: number,
): string {
  const who = subjects.length > 0 ? ` involving agent #${subjects[0]}` : '';
  const what = objectKind ? ` (${objectKind})` : '';
  const by = causedBy !== undefined ? ` caused by agent #${causedBy}` : '';
  return `${type}${what}${who}${by}`;
}
