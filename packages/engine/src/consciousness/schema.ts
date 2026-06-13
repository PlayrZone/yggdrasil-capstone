import type { Goal, Intent, IntentKind, MindOutput, SpeechAct, Utterance } from '../contract/types.js';

/**
 * Parse + validate raw LLM output into a MindOutput. The contract is strict
 * JSON; anything off-shape is rejected so a hallucinating model can't push
 * an invalid plan into the world. The Body still validates each intent
 * against physics afterward — this is the structural gate before that.
 */

const INTENT_KINDS = new Set<IntentKind>([
  'MoveTo', 'Gather', 'Dig', 'Eat', 'Drink', 'Sleep', 'Build', 'Deposit', 'Withdraw',
  'Give', 'Attack', 'Speak', 'Follow', 'Flee', 'Idle',
]);
const SPEECH_ACTS = new Set<SpeechAct>(['share-knowledge', 'share-episode', 'inform', 'request']);
const BUILD_KINDS = new Set(['shelter', 'wall', 'container']);

export class MindOutputError extends Error {}

/** Throws MindOutputError on any structural problem. */
export function parseMindOutput(raw: string): MindOutput {
  let data: unknown;
  try {
    data = JSON.parse(extractJson(raw));
  } catch {
    throw new MindOutputError('not valid JSON');
  }
  if (typeof data !== 'object' || data === null) throw new MindOutputError('not an object');
  const obj = data as Record<string, unknown>;

  const goals = parseGoals(obj['goals']);
  const plan = parsePlan(obj['plan']);
  const utterances = parseUtterances(obj['utterances']);
  const rawName = obj['name'];
  const name = typeof rawName === 'string' && rawName.trim() ? rawName.trim().slice(0, 24) : undefined;
  return name === undefined ? { goals, plan, utterances } : { goals, plan, utterances, name };
}

/** Tolerate models that wrap JSON in prose or ```json fences. */
function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) return fenced[1].trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) return raw.slice(start, end + 1);
  return raw;
}

function parseGoals(value: unknown): Goal[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new MindOutputError('goals must be an array');
  return value.slice(0, 6).map((g, i) => {
    const o = asObject(g, 'goal');
    return {
      id: i,
      description: String(o['description'] ?? 'goal').slice(0, 120),
      ...(typeof o['need'] === 'string' ? { need: o['need'] as Goal['need'] } : {}),
      createdTick: 0,
    };
  });
}

function parsePlan(value: unknown): Intent[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new MindOutputError('plan must be an array');
  const plan: Intent[] = [];
  for (const item of value.slice(0, 8)) {
    const o = asObject(item, 'intent');
    const kind = o['kind'];
    if (typeof kind !== 'string' || !INTENT_KINDS.has(kind as IntentKind)) {
      throw new MindOutputError(`invalid intent kind: ${String(kind)}`);
    }
    const intent: Intent = { kind: kind as IntentKind };
    if (isNum(o['x'])) intent.x = o['x'];
    if (isNum(o['y'])) intent.y = o['y'];
    if (isNum(o['targetId'])) intent.targetId = o['targetId'];
    if (typeof o['objectKind'] === 'string') intent.objectKind = o['objectKind'] as Intent['objectKind'];
    if (typeof o['buildKind'] === 'string' && BUILD_KINDS.has(o['buildKind'])) {
      intent.buildKind = o['buildKind'] as Intent['buildKind'];
    }
    if (isNum(o['durationTicks'])) intent.durationTicks = o['durationTicks'];
    plan.push(intent);
  }
  return plan;
}

function parseUtterances(value: unknown): Utterance[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new MindOutputError('utterances must be an array');
  const out: Utterance[] = [];
  for (const item of value.slice(0, 4)) {
    const o = asObject(item, 'utterance');
    const speechAct = o['speechAct'];
    if (typeof speechAct !== 'string' || !SPEECH_ACTS.has(speechAct as SpeechAct)) {
      throw new MindOutputError(`invalid speechAct: ${String(speechAct)}`);
    }
    const u: Utterance = { speechAct: speechAct as SpeechAct };
    if (isNum(o['targetId'])) u.targetId = o['targetId'];
    if (typeof o['text'] === 'string') u.text = o['text'].slice(0, 240);
    out.push(u);
  }
  return out;
}

function asObject(v: unknown, what: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null) throw new MindOutputError(`${what} must be an object`);
  return v as Record<string, unknown>;
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
