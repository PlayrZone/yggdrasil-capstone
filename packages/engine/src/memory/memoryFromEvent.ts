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
 * Returns undefined when the event is not memorable from this perspective.
 */
export function memoryFromEvent(
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
    // Bystander. Watching others is real input for the miners — this is
    // the demonstration/observation channel of knowledge transfer.
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
    switch (event.type) {
      case 'AgentDied': {
        type = 'WitnessedDeath';
        // The memory is ABOUT the one who died (already the subject). The hand
        // behind it rides separately, and only when a person's blow did it —
        // a starvation, an exposure or a beast names nobody, and a killer does
        // not witness itself into fearing itself.
        const killerId = event.payload['killerId'];
        if (typeof killerId === 'number' && killerId !== selfId) causedBy = killerId;
        break;
      }
      case 'UtteranceSpoken': {
        // Eavesdropping: an overheard utterance is testimony too.
        toldBy = event.actorId;
        break;
      }
      case 'IntentRejected':
        return undefined; // Other people's failed intents are invisible.
      default:
        break;
    }
  }

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
    summaryText: summarize(type, subjects, objectKind, causedBy),
    importance: importanceOf(type, deltas),
    origin,
    toldBy,
    causedBy,
    utterance,
  };
}

function summarize(
  type: SimEventType,
  subjects: number[],
  objectKind?: ObjectKind,
  causedBy?: number,
): string {
  const who = subjects.length > 0 ? ` involving agent #${subjects[0]}` : '';
  const what = objectKind ? ` (${objectKind})` : '';
  const by = causedBy !== undefined ? ` caused by agent #${causedBy}` : '';
  return `${type}${what}${who}${by}`;
}
