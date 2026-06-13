import type {
  Goal,
  Intent,
  KnowledgeRecord,
  MindOutput,
  NeedKey,
  ObjectKind,
  ObservedResource,
  ThinkInput,
} from '../contract/types.js';
import type { IMind } from './IMind.js';

// Things an agent might TRY to eat (nutritious + poisonous). The reflex only
// eats one if its held knowledge hasn't flagged it as sickening — discovery
// drives the avoidance.
const EDIBLE: ObjectKind[] = ['berry', 'tuber', 'mushroomRed', 'nightshade'];
const FOOD_NODES = new Set(['berryBush', 'foodPlant', 'mushroomPatch', 'tuberPlant', 'nightshadePlant']);
const POISON_NODE_YIELD: Partial<Record<string, ObjectKind>> = {
  mushroomPatch: 'mushroomRed',
  nightshadePlant: 'nightshade',
};

/**
 * The deterministic mind: needs-greedy goal selection, trivial plans, no
 * LLM. The Y0–Y2 mind and the permanent fallback — if the model backend is
 * ever down, the world keeps running on this.
 *
 * It already consumes knowledge in one bounded way: it will not plan to
 * eat an objectKind its held knowledge says leads to sickness. That is the
 * Y2 "discovery without consciousness" demo in miniature.
 */
export class ReflexMind implements IMind {
  think(input: ThinkInput): MindOutput {
    const { snapshot, worldView, knowledge } = input;
    const need = mostPressingNeed(input);
    const goals: Goal[] = [];
    const plan: Intent[] = [];
    const utterances: MindOutput['utterances'] = [];

    if (need === 'hunger') {
      goals.push(goal(input, 'find food and eat', 'hunger'));
      const safe = safeEdibleInInventory(snapshot.inventory, knowledge);
      if (safe) {
        plan.push({ kind: 'Eat', objectKind: safe });
      } else {
        const node = nearestFoodNode(input, knowledge);
        if (node) {
          plan.push({ kind: 'MoveTo', targetId: node.id, x: node.x, y: node.y });
          plan.push({ kind: 'Gather', targetId: node.id });
        } else {
          // No food in sight — head back to where food was last found
          // (foraging memory, an instinct), else roam to discover some.
          const remembered = rememberedFoodSpot(input);
          plan.push(remembered ? { kind: 'MoveTo', x: remembered.x, y: remembered.y } : wander(input));
        }
      }
    } else if (need === 'rest') {
      goals.push(goal(input, 'sleep', 'rest'));
      const shelter = nearestStructure(input, 'shelter');
      if (shelter) plan.push({ kind: 'MoveTo', targetId: shelter.id, x: shelter.x, y: shelter.y });
      plan.push({ kind: 'Sleep', durationTicks: 200 });
    } else if (need === 'safety') {
      goals.push(goal(input, 'get to safety', 'safety'));
      const threat = nearestFearedAgent(input);
      if (threat) {
        plan.push({ kind: 'Flee', x: threat.x, y: threat.y });
      } else {
        const shelter = nearestStructure(input, 'shelter');
        if (shelter) {
          plan.push({ kind: 'MoveTo', targetId: shelter.id, x: shelter.x, y: shelter.y });
          plan.push({ kind: 'Idle', durationTicks: 100 });
        } else if ((snapshot.inventory.wood ?? 0) >= 3) {
          plan.push({ kind: 'Build', buildKind: 'shelter', x: snapshot.x, y: snapshot.y });
        } else {
          const tree = nearestNode(input, 'tree');
          if (tree) {
            plan.push({ kind: 'MoveTo', targetId: tree.id, x: tree.x, y: tree.y });
            plan.push({ kind: 'Gather', targetId: tree.id });
          } else {
            plan.push(wander(input));
          }
        }
      }
    } else if (need === 'socialConnection') {
      goals.push(goal(input, 'seek company', 'socialConnection'));
      const other = nearestAgent(input);
      if (other) {
        plan.push({ kind: 'MoveTo', x: other.x, y: other.y });
        // Compassionate agents pass their best knowledge along — the
        // testimony channel exists from the first reflex generation.
        const best = knowledge[0];
        if (best && snapshot.traits.compassion >= 50) {
          utterances.push({
            targetId: other.id,
            speechAct: 'share-knowledge',
            rule: best.rule,
            ruleConfidence: best.confidence,
            text: phraseKnowledge(best.statement, best.confidence),
          });
        } else {
          utterances.push({ targetId: other.id, speechAct: 'inform', text: greeting(input) });
        }
        plan.push({ kind: 'Idle', durationTicks: 40 });
      } else {
        plan.push(wander(input));
      }
    } else {
      // Nothing pressing: curiosity-scaled wandering keeps experience
      // (and therefore learning) flowing.
      goals.push(goal(input, 'explore', undefined));
      plan.push(wander(input));
      plan.push({ kind: 'Idle', durationTicks: 60 });
    }

    return { goals, plan, utterances };
  }
}

function goal(input: ThinkInput, description: string, need: NeedKey | undefined): Goal {
  return { id: input.worldView.tick, description, need, createdTick: input.worldView.tick };
}

// Per-need urgency thresholds (instinct priorities, not "ideas"): hunger is
// sought EARLY so foraging has runway before starvation; rest/social don't
// dominate the agent into sleeping/socialising through hunger.
const NEED_THRESHOLD: Record<NeedKey, number> = {
  hunger: 48,
  rest: 70,
  safety: 60,
  socialConnection: 74,
};

function mostPressingNeed(input: ThinkInput): NeedKey | undefined {
  let best: NeedKey | undefined;
  let bestMargin = 0;
  for (const key of ['hunger', 'rest', 'safety', 'socialConnection'] as NeedKey[]) {
    const margin = input.snapshot.needs[key] - NEED_THRESHOLD[key];
    if (margin >= 0 && margin >= bestMargin) {
      best = key;
      bestMargin = margin;
    }
  }
  return best;
}

// ── English speech (so a human can follow them) ──────────────────────────────
// Reflex agents speak plain English; the LLM mind writes its own. These are
// instinctive vocalisations, not seeded ideas — phrasings of what the agent
// already knows or needs.

function phraseKnowledge(statement: string, confidence: number): string {
  const lead = confidence >= 0.85 ? 'I know that' : confidence >= 0.6 ? 'I believe' : 'I think maybe';
  return `${lead} ${lowerFirst(statement)}.`;
}

const GREETINGS = [
  'Hello.',
  'You there — are you well?',
  'Have you found much to eat?',
  'It is good to see another.',
  'Stay near. It is safer together.',
];
function greeting(input: ThinkInput): string {
  const h = hash2(input.snapshot.id, Math.floor(input.worldView.tick / 600));
  return GREETINGS[Math.floor(h * GREETINGS.length)] ?? 'Hello.';
}

function lowerFirst(s: string): string {
  return s.length ? s[0]!.toLowerCase() + s.slice(1) : s;
}

/** Most recent place this agent successfully gathered edible food (memory). */
function rememberedFoodSpot(input: ThinkInput): { x: number; y: number } | undefined {
  for (let i = input.recalledMemories.length - 1; i >= 0; i--) {
    const m = input.recalledMemories[i]!;
    if (
      m.type === 'GatherSucceeded' &&
      (m.objectKind === 'berry' || m.objectKind === 'tuber') &&
      m.x !== undefined &&
      m.y !== undefined
    ) {
      return { x: m.x, y: m.y };
    }
  }
  return undefined;
}

/** Held knowledge "eating X is followed by sickness" vetoes eating X. */
function knownHarmful(kind: ObjectKind, knowledge: KnowledgeRecord[]): boolean {
  return knowledge.some(
    (k) =>
      k.status === 'held' &&
      ((k.rule.kind === 'succession' &&
        k.rule.causeType === 'AteFood' &&
        k.rule.causeObject === kind &&
        k.rule.effectType === 'BecameSick') ||
        (k.rule.kind === 'outcome-association' &&
          k.rule.actionType === 'AteFood' &&
          k.rule.need === 'safety' &&
          k.rule.direction === 'worsens' &&
          k.rule.feature === null)),
  );
}

function safeEdibleInInventory(
  inventory: ThinkInput['snapshot']['inventory'],
  knowledge: KnowledgeRecord[],
): ObjectKind | undefined {
  for (const kind of EDIBLE) {
    if ((inventory[kind] ?? 0) > 0 && !knownHarmful(kind, knowledge)) return kind;
  }
  return undefined;
}

function nearestFoodNode(input: ThinkInput, knowledge: KnowledgeRecord[]): ObservedResource | undefined {
  const candidates = input.worldView.resources.filter(
    (r) => FOOD_NODES.has(r.kind) && r.stock > 0 && !nodeYieldsKnownHarm(r, knowledge),
  );
  return nearest(input, candidates);
}

function nodeYieldsKnownHarm(node: ObservedResource, knowledge: KnowledgeRecord[]): boolean {
  const yielded = POISON_NODE_YIELD[node.kind];
  if (!yielded) return false;
  return knownHarmful(yielded, knowledge);
}

function nearestNode(input: ThinkInput, kind: ObservedResource['kind']): ObservedResource | undefined {
  return nearest(
    input,
    input.worldView.resources.filter((r) => r.kind === kind && r.stock > 0),
  );
}

function nearestStructure(input: ThinkInput, kind: 'shelter' | 'wall' | 'container') {
  return nearest(
    input,
    input.worldView.structures.filter((s) => s.kind === kind),
  );
}

function nearestAgent(input: ThinkInput) {
  return nearest(input, input.worldView.agents);
}

function nearestFearedAgent(input: ThinkInput) {
  const feared = input.worldView.agents.filter((a) => (input.relationships.get(a.id)?.fear ?? 0) >= 40);
  return nearest(input, feared);
}

function nearest<T extends { x: number; y: number; id?: number }>(
  input: ThinkInput,
  items: T[],
): T | undefined {
  const { x, y } = input.snapshot;
  let best: T | undefined;
  let bestD = Infinity;
  for (const item of items) {
    const dx = item.x - x;
    const dy = item.y - y;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      best = item;
      bestD = d;
    }
  }
  return best;
}

/**
 * Deterministic pseudo-wander: direction hashed from (agentId, tick) so
 * identical runs take identical walks; curiosity stretches the stride.
 */
function wander(input: ThinkInput): Intent {
  const { id, traits, x, y } = input.snapshot;
  // Persist a heading across a stretch of ticks (hash by a coarse time bucket)
  // so roaming actually traverses ground to find sparse food, rather than
  // jittering in place. Curiosity lengthens the stride.
  const h = hash2(id, Math.floor(input.worldView.tick / 240));
  const angle = h * Math.PI * 2;
  const stride = 22 + (traits.curiosity / 100) * 26;
  return { kind: 'MoveTo', x: x + Math.cos(angle) * stride, y: y + Math.sin(angle) * stride };
}

function hash2(a: number, b: number): number {
  let h = 0x811c9dc5;
  h ^= a | 0;
  h = Math.imul(h, 0x01000193);
  h ^= b | 0;
  h = Math.imul(h, 0x01000193);
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
