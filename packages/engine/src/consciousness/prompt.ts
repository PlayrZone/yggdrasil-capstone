import type { KnowledgeRecord, ThinkInput } from '../contract/types.js';
import { NEED_CRITICAL, NEED_PRESSING } from '../contract/types.js';

/**
 * Builds the consciousness prompt. The LLM is a pure reasoner: it receives
 * the agent's needs, perception, goals, and — critically — its KNOWLEDGE,
 * rendered with confidence qualifiers, and must reason only from what the
 * agent actually knows. It is never handed world truths it didn't learn
 * (the V2 knowledge-fidelity discipline; the Y4 eval gate enforces it).
 *
 * Output is plain strings so any backend (Fireworks, Ollama, a mock) can
 * adapt them to its own chat format.
 */
export interface ThinkPrompt {
  system: string;
  user: string;
}

const INTENT_VOCAB =
  'MoveTo, Gather, Dig, Eat, Drink, Sleep, Build, Deposit, Withdraw, Give, Attack, Craft, Speak, Follow, Flee, Idle';

export function buildThinkPrompt(input: ThinkInput): ThinkPrompt {
  const { snapshot, knowledge, recalledMemories, worldView, goals, trigger } = input;
  const t = snapshot.traits;

  const unnamed = !snapshot.name || snapshot.name.length === 0;
  const system = [
    unnamed
      ? `You are a young being who has no name yet. You live in a simple world.`
      : `You are the mind of ${snapshot.name}, a being living in a simple world.`,
    `You do not control movement step by step — you decide goals, plans, and what to say.`,
    `You reason ONLY from what you perceive and what you KNOW below. You have no knowledge`,
    `of the world beyond your own experience. Do not invent facts.`,
    ``,
    `Your personality (0-100): curiosity ${t.curiosity}, aggression ${t.aggression},`,
    `compassion ${t.compassion}, ambition ${t.ambition}, loyalty ${t.loyalty}, risk ${t.riskTolerance}.`,
    ``,
    unnamed
      ? `You have no name. Choose one for YOURSELF that fits who you are, and include it as "name":string in your JSON (just this once).`
      : ``,
    `Respond ONLY with JSON of this exact shape:`,
    `{${unnamed ? '"name":string,' : ''}"goals":[{"description":string,"need":string|null}],`,
    ` "plan":[{"kind":INTENT,...args}],`,
    ` "utterances":[{"targetId":number|null,"speechAct":"share-knowledge"|"share-episode"|"inform"|"request","text"?:string}]}`,
    `INTENT kind is one of: ${INTENT_VOCAB}.`,
    `Intent args: MoveTo{x,y|targetId}, Gather{targetId}, Eat{objectKind}, Build{buildKind,x,y},`,
    `Dig{} (dig the ground where you stand), Give{targetId,objectKind}, Deposit{objectKind,targetId?}, Sleep{durationTicks}, Idle{durationTicks},`,
    `Craft{} (try combining the raw materials you carry — whether anything useful results, and what, is for you to DISCOVER through trying),`,
    `Flee{x,y}, Follow{targetId}, Speak{} (put speech in utterances).`,
    `Keep the plan short (1-4 intents). The world validates every intent; impossible ones fail.`,
  ].join('\n');

  const user = [
    `Why you are thinking now: ${trigger}.`,
    ``,
    `NEEDS (0 satisfied, 100 desperate — ${NEED_PRESSING}+ pressing, ${NEED_CRITICAL}+ critical):`,
    `  hunger ${fmt(snapshot.needs.hunger)}, rest ${fmt(snapshot.needs.rest)}, safety ${fmt(snapshot.needs.safety)}, social ${fmt(snapshot.needs.socialConnection)}`,
    `HEALTH ${fmt(snapshot.health)}${snapshot.sick ? ' (SICK)' : ''}. It is ${worldView.season}, ${worldView.night ? 'night' : 'day'}.`,
    `INVENTORY: ${inventoryText(snapshot.inventory)}`,
    ``,
    `WHAT YOU KNOW:`,
    knowledgeText(knowledge),
    ``,
    `WHAT YOU SEE (within range):`,
    perceptionText(worldView),
    ``,
    `RECENT MEMORIES:`,
    recalledMemories.length > 0
      ? recalledMemories.slice(0, 8).map((m) => `  - ${m.summaryText}`).join('\n')
      : '  (nothing notable)',
    ``,
    `CURRENT GOALS: ${goals.length > 0 ? goals.map((g) => g.description).join('; ') : '(none)'}`,
    ``,
    `Decide what to do. Respond with JSON only.`,
  ].join('\n');

  return { system, user };
}

function fmt(n: number): string {
  return n.toFixed(0);
}

function inventoryText(inv: ThinkInput['snapshot']['inventory']): string {
  const entries = Object.entries(inv).filter(([, n]) => (n ?? 0) > 0);
  return entries.length > 0 ? entries.map(([k, n]) => `${k}×${n}`).join(', ') : 'empty';
}

/** Knowledge rendered with confidence qualifiers — the agent's worldview. */
export function knowledgeText(knowledge: KnowledgeRecord[]): string {
  const held = knowledge.filter((k) => k.status === 'held').slice(0, 12);
  if (held.length === 0) return '  (you have learned nothing yet)';
  return held
    .map((k) => {
      const qualifier =
        k.confidence >= 0.85
          ? 'You are sure'
          : k.confidence >= 0.6
            ? 'You believe'
            : 'You suspect';
      const provenance = k.origin === 'testimony' ? ' (you were told this)' : '';
      return `  - ${qualifier} (${(k.confidence * 100).toFixed(0)}%, seen ${k.evidenceCount}×): ${k.statement}${provenance}`;
    })
    .join('\n');
}

function perceptionText(view: ThinkInput['worldView']): string {
  const parts: string[] = [];
  if (view.resources.length > 0) {
    const counts = new Map<string, number>();
    for (const r of view.resources) counts.set(r.kind, (counts.get(r.kind) ?? 0) + 1);
    parts.push('  resources: ' + [...counts].map(([k, n]) => `${n} ${k}`).join(', '));
  }
  if (view.agents.length > 0) parts.push(`  ${view.agents.length} other being(s) nearby (ids: ${view.agents.slice(0, 6).map((a) => a.id).join(', ')})`);
  if (view.structures.length > 0) {
    const counts = new Map<string, number>();
    for (const s of view.structures) counts.set(s.kind, (counts.get(s.kind) ?? 0) + 1);
    parts.push('  structures: ' + [...counts].map(([k, n]) => `${n} ${k}`).join(', '));
  }
  return parts.length > 0 ? parts.join('\n') : '  (nothing of note within range)';
}
