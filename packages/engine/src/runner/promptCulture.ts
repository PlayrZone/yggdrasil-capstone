import type { AgentMind } from '../agent/AgentMind.js';
import type { KnownPerson, KnownStory, RelationshipRecord, ThinkInput } from '../contract/types.js';
import { kinOf } from './kinship.js';
import type { BirthRecord } from './RuntimeView.js';

/** What assembling a being's culture needs from the host: names, who is still
 *  alive, and the kinship ledger. */
export interface CultureHost {
  readonly births: readonly BirthRecord[];
  nameOf(agentId: number): string;
  agentBody(agentId: number): { alive: boolean } | undefined;
}

/**
 * Render a relationship as a FELT phrase a being would use — never a role label
 * ("mentor"/"leader"). Returns the most salient feeling + its strength (for
 * ranking which people to surface), or null for a neutral acquaintance.
 */
function relationshipFeeling(r: RelationshipRecord): { feeling: string; salience: number } | null {
  const cand: { feeling: string; salience: number }[] = [];
  if (r.fear >= 40) cand.push({ feeling: 'you are afraid of them', salience: r.fear });
  if (r.trust >= 58) cand.push({ feeling: r.trust >= 70 ? 'you trust them deeply' : 'you trust them', salience: r.trust - 50 });
  if (r.friendship >= 58) cand.push({ feeling: r.friendship >= 70 ? 'you are very close to them' : 'you are friendly with them', salience: r.friendship - 50 });
  if (r.respect >= 60) cand.push({ feeling: 'you look up to them', salience: r.respect - 50 });
  if (r.interactionCount >= 10) cand.push({ feeling: 'you have spent much time together', salience: Math.min(20, r.interactionCount) });
  if (cand.length === 0) return null;
  cand.sort((a, b) => b.salience - a.salience);
  return cand[0]!;
}

/**
 * Assemble the CULTURE a conscious being knows: the stories it carries, the
 * family it knows it has, and the people it knows (rendered as FEELING, never
 * a role label). Names are resolved here because only the host holds them.
 * Doctrine: only what a Gahallian could reasonably know — no analysis labels,
 * no hidden world facts.
 *
 * Lexicon-side by nature (it speaks English about this world), so it sits with
 * the scenario rather than inside the runtime: W1-B moves it behind the
 * adapter's `lexicon`.
 */
export function enrichCulture(
  host: CultureHost,
  input: ThinkInput,
  agentId: number,
  mind: AgentMind,
  offerMaking: boolean,
): ThinkInput {
  // Stories ordered by how often the being has HEARD each (intrinsic salience) —
  // so the tale its people tell most leads, instead of being buried in the list.
  const held = [...mind.narratives.all()].sort((a, b) => b.timesHeard - a.timesHeard);
  // The id rides along so a being can name WHICH tale it is retelling.
  const stories: KnownStory[] = held.map((n) => ({ id: n.id, text: n.text, firsthand: n.firsthand }));
  const top = held[0];
  const mostTold = top && top.timesHeard >= 2 ? top.text : undefined; // a tale actually retold
  const scored: { person: KnownPerson; salience: number }[] = [];
  for (const [pid, r] of mind.relationships.asMap()) {
    if (!host.agentBody(pid)?.alive) continue;
    const felt = relationshipFeeling(r);
    if (felt) scored.push({ person: { name: host.nameOf(pid), feeling: felt.feeling }, salience: felt.salience });
  }
  scored.sort((a, b) => b.salience - a.salience);
  return {
    ...input,
    stories,
    ...(mostTold ? { mostTold } : {}),
    kin: kinOf(host.births, (id) => host.nameOf(id), agentId),
    social: scored.slice(0, 8).map((s) => s.person),
    offerMaking,
  };
}
