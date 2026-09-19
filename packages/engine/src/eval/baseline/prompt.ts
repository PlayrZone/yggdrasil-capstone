import { actionVocabulary } from '../../contract/actions.js';
import type { WorldAdapter } from '../../contract/adapter.js';
import type { ThinkInput } from '../../contract/types.js';
import type { ThinkPrompt } from '../../consciousness/prompt.js';
import { EPISTEMIC_INSTRUCTION_TEXT } from '../epistemic.js';
import { askOver } from '../interview.js';
import type { BaselineMemory } from './memory.js';

/**
 * THE ORDINARY AGENT'S PROMPT — and the line between "withheld" and "the
 * independent variable", which round 1 drew in the wrong place.
 *
 * Still absent, because each is Yggdrasil's own machinery and its absence IS
 * the experiment:
 *
 *   no WHAT YOU KNOW      — there are no mined beliefs to show it.
 *   no STORIES YOU CARRY  — there is no narrative store behind it.
 *   no THOSE YOU KNOW     — relationships are scalars it never sees.
 *   no YOUR FAMILY, no place a story pulls it toward.
 *
 * Now PRESENT, because withholding them was never a design choice — it was an
 * unexamined asymmetry that made arm B worse at the task for reasons unrelated
 * to what the pilot is asking:
 *
 *   its TRAITS       — arm A is told its own personality. A baseline told to
 *                      "play this person" and then not told who the person is
 *                      loses consistency for nothing.
 *   the THRESHOLDS   — arm A is told where a need turns pressing and where it
 *                      turns critical. Without them a number out of 100 is not
 *                      a signal, and arm B would be guessing at triage.
 *
 * And the epistemic instruction is now a FACTOR rather than a property of an
 * arm (`eval/epistemic.ts`): `epistemicInstruction: true` makes this arm B+.
 * Round 1 gave the sentence to A alone and never ablated it, so any difference
 * in leaking was one sentence OR an architecture and no number could say which.
 * The default is still off, so plain arm B is unchanged.
 *
 * What it has always shared with arm A is everything about the body: the same
 * world, the same drives, the same verbs and arguments, and the same output
 * shape — so the parser and the body treat both arms identically and a
 * difference in behaviour is a difference in mind.
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

export interface BaselinePromptOptions {
  persona?: BaselinePersona;
  /**
   * Arm B+ — the epistemic ablation. When true the same instruction arm A
   * carries is appended to this arm's system prompt.
   */
  epistemicInstruction?: boolean;
}

export function buildBaselinePrompt(
  input: ThinkInput,
  world: WorldAdapter,
  memory: BaselineMemory,
  options: BaselinePromptOptions = {},
): ThinkPrompt {
  const persona = options.persona ?? DEFAULT_PERSONA;
  const t = input.snapshot.traits;
  const unnamed = !input.snapshot.name || input.snapshot.name.length === 0;
  // The instruction sits where arm A's sits — immediately under who you are,
  // above everything about the task. Appending it to the end instead would
  // ablate the sentence at a different position in the context than the arm it
  // is being compared with, which is a second difference nobody asked for.
  const system = [
    persona.line(input),
    options.epistemicInstruction === true ? EPISTEMIC_INSTRUCTION_TEXT : ``,
    `Your personality (0-100): curiosity ${t.curiosity}, aggression ${t.aggression},`,
    `compassion ${t.compassion}, ambition ${t.ambition}, loyalty ${t.loyalty}, risk ${t.riskTolerance}.`,
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

  // The same pair of thresholds arm A quotes, from the same place: this world's
  // four drives share them, and a per-drive paragraph is B5's work in both files.
  const pressing = world.drives[0]?.pressingAt ?? 0;
  const critical = world.drives[0]?.criticalAt ?? 0;
  const recalled = memory.retrieve(input, world);

  const user = [
    `WHAT YOU REMEMBER (a summary of what has been happening):`,
    memory.summary().length > 0 ? `  ${memory.summary()}` : '  (nothing yet)',
    ``,
    `WHAT COMES TO MIND NOW (what this moment brings back, most fitting first):`,
    recalled.length > 0 ? recalled.map((o) => `  - ${o.text}`).join('\n') : '  (nothing yet)',
    ``,
    `HOW YOU FEEL (0 satisfied, 100 desperate — ${pressing}+ pressing, ${critical}+ critical):`,
    `  ${world.drives.map((d) => `${d.id} ${Math.round(input.snapshot.needs[d.id] ?? 0)}`).join(', ')}`,
    `HEALTH ${Math.round(input.snapshot.health)}${input.snapshot.sick ? ' (sick)' : ''}. It is ${input.worldView.season}, ${input.worldView.night ? 'night' : 'day'}.`,
    `CARRYING: ${inventoryText(input)}`,
    `NEARBY: ${nearbyText(input)}`,
    ``,
    `CURRENT GOALS: ${input.goals.length > 0 ? input.goals.map((g) => g.description).join('; ') : '(none)'}`,
    ``,
    BASELINE_CLOSING,
  ].join('\n');

  return { system, user };
}

/**
 * The interview turn: the same situation this mind reasons over, plus one
 * question, framed by the SAME words arm A's interview uses (`eval/interview.ts`)
 * so the probe is not measuring the interviewer. Only the context above the
 * question differs, which is the whole experiment — and B+ carries its
 * instruction into the interview exactly as arm A carries its own, or the
 * ablation would stop at the door of the one measurement it exists for.
 */
export function buildBaselineInterviewPrompt(
  input: ThinkInput,
  world: WorldAdapter,
  memory: BaselineMemory,
  question: string,
  options: BaselinePromptOptions = {},
): ThinkPrompt {
  const persona = options.persona ?? DEFAULT_PERSONA;
  const base = buildBaselinePrompt(input, world, memory, options);
  const system =
    options.epistemicInstruction === true
      ? `${persona.line(input)}\n${EPISTEMIC_INSTRUCTION_TEXT}`
      : persona.line(input);
  return askOver({ system, user: base.user }, question, BASELINE_CLOSING);
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
