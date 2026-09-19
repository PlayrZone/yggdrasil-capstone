import type { EventRoleSchema, WorldAdapter } from '../contract/adapter.js';
import type { ContextRecord, DriveDeltas, DriveId, EventId, ItemCounts, KindId } from '../contract/ids.js';
import type { WorldGate } from '../contract/gate.js';
import type { MemoryRecord, SimEvent, Utterance } from '../contract/types.js';
import { importanceOf } from './importance.js';

/**
 * One physical event, N subjective memories. The same SimEvent reads
 * differently depending on who you were in it: the giver remembers giving, the
 * receiver receiving, a bystander records an observation. This perspective
 * mapping is where subjective worldviews start to diverge.
 *
 * WHAT differs per perspective is the world's (`events[].roles`); the parts
 * that are the same for every event live here, because they are the mechanism:
 * who the subjects are, that a target reads its own need-change, and that a
 * bystander gets a discounted read of the actor's.
 *
 * THIS IS THE EDGE (W1-B2): an event the world does not declare forms no
 * memory at all, and is counted on `gate`. It used to fall through as a
 * salience of zero and a neutral outcome — a memory of something the world has
 * never heard of, indistinguishable from a dull one.
 *
 * Returns undefined when the event is not memorable from this perspective.
 */
export function memoryFromEvent(
  world: WorldAdapter,
  event: SimEvent,
  selfId: number,
  context: ContextRecord,
  gate?: WorldGate,
): Omit<MemoryRecord, 'id'> | undefined {
  const schema = world.eventById.get(event.type);
  if (!schema) {
    gate?.admitEvent(world, event.type);
    return undefined;
  }
  const isActor = event.actorId === selfId;
  const isTarget = event.targetIds.includes(selfId);
  const needDeltas = (isActor ? (event.payload['needDeltas'] as DriveDeltas | undefined) : undefined) ?? {};
  const targetNeedDeltas =
    (isTarget ? (event.payload['targetNeedDeltas'] as DriveDeltas | undefined) : undefined) ?? {};
  const objectKind = event.payload['objectKind'] as KindId | undefined;
  const craftInputs = event.payload['inputs'] as ItemCounts | undefined;
  const utterance = event.payload['utterance'] as Utterance | undefined;

  let role: EventRoleSchema | undefined;
  let subjects: number[];
  let origin: MemoryRecord['origin'] = 'experience';
  let deltas = needDeltas;

  if (isActor) {
    role = schema.roles?.actor;
    subjects = event.targetIds.filter((id) => id !== selfId);
  } else if (isTarget) {
    role = schema.roles?.target;
    subjects = [event.actorId];
    deltas = targetNeedDeltas;
  } else {
    // Bystander. Watching others is real input for the miners — this is
    // the demonstration/observation channel of knowledge transfer.
    role = schema.roles?.bystander;
    origin = 'observation';
    subjects = [event.actorId, ...event.targetIds].filter((id) => id !== selfId && id > 0);
    // You can roughly SEE the actor's outcome — they eat and look relieved, or
    // sicken — a DISCOUNTED read of their need-change. This is what lets
    // watching an elder actually teach you (demonstration learning).
    const actorDeltas = event.payload['needDeltas'] as DriveDeltas | undefined;
    if (actorDeltas) {
      const seen: DriveDeltas = {};
      for (const [k, v] of Object.entries(actorDeltas) as [DriveId, number][]) seen[k] = v * 0.5;
      deltas = seen;
    }
  }

  if (role?.ignores) return undefined;

  // A perspective that records something ELSE names a second event, and that
  // one has to exist too, or the memory would carry a type this world cannot
  // weigh, recognise or retell.
  const type: EventId = role?.recordsAs ?? event.type;
  if (type !== event.type && !world.eventById.has(type)) {
    gate?.admitEvent(world, type);
    return undefined;
  }
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
    outcome: schema.outcome ?? 'neutral',
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
  type: EventId,
  subjects: readonly number[],
  objectKind?: KindId,
  causedBy?: number,
): string {
  const who = subjects.length > 0 ? ` involving agent #${subjects[0]}` : '';
  const what = objectKind ? ` (${objectKind})` : '';
  const by = causedBy !== undefined ? ` caused by agent #${causedBy}` : '';
  return `${type}${what}${who}${by}`;
}
