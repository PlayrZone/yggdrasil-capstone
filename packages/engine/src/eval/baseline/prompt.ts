import { actionVocabulary } from '../../contract/actions.js';
import type { WorldAdapter } from '../../contract/adapter.js';
import type { ThinkInput } from '../../contract/types.js';
import type { ThinkPrompt } from '../../consciousness/prompt.js';
import { askOver } from '../interview.js';
import type { BaselineMemory } from './memory.js';

/**
 * THE ORDINARY AGENT'S PROMPT — a persona line, a rolling window of raw
 * observations, its needs, and the list of things it can do. That is the whole
 * of it, and every omission is deliberate:
 *
 *   no WHAT YOU KNOW      — there are no mined beliefs to show it.
 *   no STORIES YOU CARRY  — there is no narrative store behind it.
 *   no THOSE YOU KNOW     — relationships are scalars it never sees.
 *   no "you have no knowledge of the world beyond this" — the Yggdrasil prompt's
 *                           epistemic instruction is exactly what this arm is a
 *                           control FOR. Telling the baseline not to use its
 *                           pretraining would be testing the instruction, not
 *                           the architecture.
 *
 * What it DOES share with arm A is everything about the body: the same world,
 * the same drives, the same verbs and arguments, and the same output shape — so
 * the parser and the body treat both arms identically and a difference in
 * behaviour is a difference in mind.
 */

export interface BaselinePersona {
  /** One line of who this is. The only identity the baseline carries. */
  line(input: ThinkInput): string;
}

export const DEFAULT_PERSONA: BaselinePersona = {
  line: (input) => {
    const name = input.snapshot.name && input.snapshot.name.length > 0 ? input.snapshot.name : 'someone with no name yet';
    return `You are ${name}, a person living among others. Play this person and decide what they do next.`;
  },
};

export function buildBaselinePrompt(
  input: ThinkInput,
  world: WorldAdapter,
  memory: BaselineMemory,
  persona: BaselinePersona = DEFAULT_PERSONA,
): ThinkPrompt {
  const unnamed = !input.snapshot.name || input.snapshot.name.length === 0;
  const system = [
    persona.line(input),
    `You act through a fixed list of actions. Anything not on the list cannot be done.`,
    `ACTIONS: ${actionVocabulary(world)}.`,
    `Action arguments: ${argumentHelp(world)}.`,
    unnamed ? `You have no name. Choose one and include it as "name":string in your JSON.` : ``,
    `Respond ONLY with JSON of this exact shape:`,
    `{${unnamed ? '"name":string,' : ''}"thought":string,"goals":[{"description":string,"need":string|null}],`,
    ` "plan":[{"kind":ACTION,...args}],`,
    ` "utterances":[{"targetId":number|null,"speechAct":"share-knowledge"|"share-episode"|"inform"|"request","text"?:string}]}`,
    `"thought" is one short first-person sentence. Keep the plan to 1-4 actions.`,
  ]
    .filter((line) => line.length > 0)
    .join('\n');

  const user = [
    `WHAT YOU REMEMBER (a summary of what has been happening):`,
    memory.summary().length > 0 ? `  ${memory.summary()}` : '  (nothing yet)',
    ``,
    `RECENT OBSERVATIONS (most recent last):`,
    memory.recent().length > 0 ? memory.recent().map((line) => `  - ${line}`).join('\n') : '  (nothing yet)',
    ``,
    `HOW YOU FEEL (0 fine, 100 desperate):`,
    `  ${world.drives.map((d) => `${d.id} ${Math.round(input.snapshot.needs[d.id] ?? 0)}`).join(', ')}`,
    `HEALTH ${Math.round(input.snapshot.health)}${input.snapshot.sick ? ' (sick)' : ''}. It is ${input.worldView.season}, ${input.worldView.night ? 'night' : 'day'}.`,
    `CARRYING: ${inventoryText(input)}`,
    `NEARBY: ${nearbyText(input)}`,
    ``,
    `CURRENT GOALS: ${input.goals.length > 0 ? input.goals.map((g) => g.description).join('; ') : '(none)'}`,
    ``,
    `Decide what to do. Respond with JSON only.`,
  ].join('\n');

  return { system, user };
}

/**
 * The interview turn: the same situation this mind reasons over, plus one
 * question, framed by the SAME words arm A's interview uses (`eval/interview.ts`)
 * so the probe is not measuring the interviewer. Only the context above the
 * question differs, which is the whole experiment.
 */
export function buildBaselineInterviewPrompt(
  input: ThinkInput,
  world: WorldAdapter,
  memory: BaselineMemory,
  question: string,
  persona: BaselinePersona = DEFAULT_PERSONA,
): ThinkPrompt {
  const base = buildBaselinePrompt(input, world, memory, persona);
  return askOver({ system: persona.line(input), user: base.user }, question, BASELINE_CLOSING);
}

/** Where the baseline prompt stops describing and starts asking for a decision. */
export const BASELINE_CLOSING = 'Decide what to do. Respond with JSON only.';

function argumentHelp(world: WorldAdapter): string {
  return world.actions
    .map((action) => {
      const args = action.params.filter((p) => p.type !== 'speech').map((p) => p.id);
      return `${action.id}{${args.join(',')}}`;
    })
    .join(', ');
}

function inventoryText(input: ThinkInput): string {
  const entries = Object.entries(input.snapshot.inventory).filter(([, n]) => (n ?? 0) > 0);
  return entries.length > 0 ? entries.map(([k, n]) => `${k}×${n}`).join(', ') : 'nothing';
}

function nearbyText(input: ThinkInput): string {
  const parts: string[] = [];
  const counts = new Map<string, number>();
  for (const r of input.worldView.resources) counts.set(r.kind, (counts.get(r.kind) ?? 0) + 1);
  for (const [kind, n] of counts) parts.push(`${n} ${kind}`);
  if (input.worldView.agents.length > 0) {
    parts.push(`people (ids: ${input.worldView.agents.slice(0, 6).map((a) => a.id).join(', ')})`);
  }
  const structures = new Map<string, number>();
  for (const s of input.worldView.structures) structures.set(s.kind, (structures.get(s.kind) ?? 0) + 1);
  for (const [kind, n] of structures) parts.push(`${n} ${kind}`);
  return parts.length > 0 ? parts.join(', ') : 'nothing within reach';
}
