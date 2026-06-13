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
  const utterance = event.payload['utterance'] as Utterance | undefined;

  let type: SimEventType = event.type;
  let subjects: number[];
  let origin: MemoryRecord['origin'] = 'experience';
  let deltas = needDeltas;
  let toldBy: number | undefined;

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
    switch (event.type) {
      case 'AgentDied':
        type = 'WitnessedDeath';
        break;
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
    summaryText: summarize(type, subjects, objectKind),
    importance: importanceOf(type, deltas),
    origin,
    toldBy,
    utterance,
  };
}

function summarize(type: SimEventType, subjects: number[], objectKind?: ObjectKind): string {
  const who = subjects.length > 0 ? ` involving agent #${subjects[0]}` : '';
  const what = objectKind ? ` (${objectKind})` : '';
  return `${type}${what}${who}`;
}
