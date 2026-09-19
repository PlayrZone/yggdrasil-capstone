import type { ThinkPrompt } from '../consciousness/prompt.js';

/**
 * THE ONE SENTENCE THE HEADLINE WAS CONFOUNDED WITH.
 *
 * Arm A's prompt (`consciousness/prompt.ts`) tells the being it reasons only
 * from what it perceives and knows, that it has no knowledge of the world
 * beyond this, and not to invent facts. Arm B's prompt said none of that, on
 * the stated grounds that telling a baseline not to use its pretraining would
 * be "testing the instruction rather than the architecture".
 *
 * That reasoning is right about what B must not be, and wrong about what the
 * experiment then measures: with the instruction present in exactly one arm and
 * never ablated, a difference in leaking is one prompt sentence OR an
 * architecture, and no number in the table can tell you which.
 *
 * So the instruction is a FACTOR, not a property of an arm. Four arms:
 *
 *   A    Yggdrasil mind, instruction present   (as shipped)
 *   A−   Yggdrasil mind, instruction REMOVED   (ablation)
 *   B    plain agent, no instruction           (as shipped)
 *   B+   plain agent, instruction ADDED        (ablation)
 *
 * A vs A− and B+ vs B both isolate the sentence; A− vs B and A vs B+ both
 * isolate the architecture at a fixed level of the sentence.
 *
 * The lines below are copied verbatim from `buildThinkPrompt`. They are checked
 * against it at run time by `stripEpistemicInstruction`, which THROWS when the
 * prompt it is handed does not contain them: if that file is reworded, the
 * ablation fails loudly instead of quietly ablating nothing.
 */
export const EPISTEMIC_INSTRUCTION_LINES: readonly string[] = [
  'You reason ONLY from what you perceive and what you KNOW — your memories, the STORIES you carry,',
  'and the people you know, all given below. You have no knowledge of the world beyond this.',
  'Do not invent facts.',
];

/** The same instruction as prose, for an arm that is being GIVEN it. */
export const EPISTEMIC_INSTRUCTION_TEXT = [
  'You reason ONLY from what you perceive and what you remember, all given below.',
  'You have no knowledge of the world beyond this. Do not invent facts.',
].join('\n');

export class EpistemicAblationFailed extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EpistemicAblationFailed';
  }
}

/**
 * Remove the epistemic instruction from a composed prompt, on the way out.
 *
 * It is done here, in the instrument, rather than by editing
 * `consciousness/prompt.ts`: the ablation is a property of one ARM of one
 * experiment, and a flag on the mind's prompt builder would be a permanent
 * change to the engine for a temporary question.
 */
export function stripEpistemicInstruction(prompt: ThinkPrompt): ThinkPrompt {
  for (const fragment of EPISTEMIC_INSTRUCTION_LINES) {
    if (prompt.system.includes(fragment)) continue;
    throw new EpistemicAblationFailed(
      `the A− ablation cannot find the line it removes: "${fragment.slice(0, 48)}…". ` +
        'consciousness/prompt.ts has been reworded — update EPISTEMIC_INSTRUCTION_LINES before running A−, ' +
        'or the arm is not an ablation of anything.',
    );
  }
  // LINE BY LINE, so that a line the instruction never touched comes through
  // byte for byte. A whole-string tidy-up would have reflowed the JSON-shape
  // rows, whose leading spaces are part of what the model is shown, and an
  // ablation that also reformats the prompt is two changes wearing one name.
  const kept: string[] = [];
  for (const original of prompt.system.split('\n')) {
    let line = original;
    for (const fragment of EPISTEMIC_INSTRUCTION_LINES) {
      if (line.includes(fragment)) line = line.replace(fragment, '');
    }
    if (line === original) {
      kept.push(original);
      continue;
    }
    // The third fragment is a sentence at the head of a line that continues.
    const remainder = line.trim();
    if (remainder.length > 0) kept.push(remainder);
  }
  return { system: kept.join('\n').replace(/\n{3,}/g, '\n\n'), user: prompt.user };
}

/** Does this prompt still carry the instruction? Used by the ablation's own test. */
export function carriesEpistemicInstruction(prompt: ThinkPrompt): boolean {
  return EPISTEMIC_INSTRUCTION_LINES.every((line) => prompt.system.includes(line));
}
