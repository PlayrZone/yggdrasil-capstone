import type { ThinkPrompt } from '../consciousness/prompt.js';

/**
 * THE INTERVIEW TURN, owned in one place — and NOTHING ELSE.
 *
 * An interview is the being's own situation plus one question, and the two arms
 * must be asked in the same words or the probe is measuring the interviewer.
 * The instruction and the question frame below are therefore shared: every arm
 * appends them to whatever context its own mind reasons over, and both read as
 * ordinary English to a model.
 *
 * They double as the marker a deterministic mock uses to tell an interview from
 * a think (`isInterview`). That is a real instruction doing a second job, not a
 * hidden token: nothing is injected that a model would not otherwise be sent.
 *
 * This file is PURE — no backend, no door, no world. It is imported by the
 * scripted mocks, by the baseline agent and by the Yggdrasil interviewee, and
 * an import cycle through any of them is what split it out of `arms.ts`.
 */

export const INTERVIEW_INSTRUCTION =
  'Someone is talking with you. Answer them in your own words, in one or two sentences. Do not use JSON.';

export const QUESTION_PREFIX = 'They ask you: ';

/** Where `buildThinkPrompt` stops asking for context and starts asking for a decision. */
export const YGGDRASIL_CLOSING = 'Decide what to do. Respond with JSON only.';

export function isInterview(prompt: ThinkPrompt): boolean {
  return prompt.system.includes(INTERVIEW_INSTRUCTION);
}

/** The question an interview prompt carries, for a backend that reasons over it. */
export function questionIn(prompt: ThinkPrompt): string | undefined {
  const at = prompt.user.lastIndexOf(QUESTION_PREFIX);
  if (at < 0) return undefined;
  const rest = prompt.user.slice(at + QUESTION_PREFIX.length);
  const open = rest.indexOf('"');
  const close = rest.indexOf('"', open + 1);
  return open >= 0 && close > open ? rest.slice(open + 1, close) : undefined;
}

/** Append the question to a body of context the mind already reasons over. */
export function askOver(base: ThinkPrompt, question: string, closing: string): ThinkPrompt {
  const withoutClosing = base.user.includes(closing) ? base.user.slice(0, base.user.indexOf(closing)) : base.user;
  return {
    system: `${base.system}\n\n${INTERVIEW_INSTRUCTION}`,
    user: `${withoutClosing.trimEnd()}\n\n${QUESTION_PREFIX}"${question}"\n\nAnswer in your own words.`,
  };
}
