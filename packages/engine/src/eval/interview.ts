import type { WorldAdapter } from '../contract/adapter.js';
import { buildThinkPrompt } from '../consciousness/prompt.js';
import type { ThinkPrompt } from '../consciousness/prompt.js';
import { accessBackend } from './budget.js';
import type { BackendAccess } from './budget.js';
import type { IInterviewee, InterviewRequest } from './types.js';

/**
 * THE INTERVIEW TURN, owned in one place.
 *
 * An interview is the being's own situation plus one question, and the two arms
 * must be asked in the same words or the probe is measuring the interviewer.
 * The instruction and the question frame below are therefore shared: arm A
 * appends them to the Yggdrasil prompt, arm B appends them to its own window
 * prompt, and both read as ordinary English to a model.
 *
 * They double as the marker a deterministic mock uses to tell an interview from
 * a think (`isInterview`). That is a real instruction doing a second job, not a
 * hidden token: nothing is injected that a model would not otherwise be sent.
 */

export const INTERVIEW_INSTRUCTION =
  'Someone is talking with you. Answer them in your own words, in one or two sentences. Do not use JSON.';

export const QUESTION_PREFIX = 'They ask you: ';

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

/** Where `buildThinkPrompt` stops asking for context and starts asking for a decision. */
const YGGDRASIL_CLOSING = 'Decide what to do. Respond with JSON only.';

/**
 * ARM A'S INTERVIEWEE. The Yggdrasil mind answers over the same prompt it
 * thinks over — its knowledge, its stories, the people it knows — with the
 * decision instruction replaced by a question.
 *
 * It goes STRAIGHT to the backend, never through `LlmMind`: a think through
 * `LlmMind` logs a cognition, may retry, and may fall back to the world's reflex
 * policy, all of which would put the interview inside the run it is supposed to
 * be outside of.
 *
 * It takes a `BackendAccess`, not a backend, so an interview is one more thing
 * that cannot reach a provider without a budget (`accessBackend` is the only
 * door — see `budget.ts`).
 */
export function yggdrasilInterviewee(access: BackendAccess, world: WorldAdapter, id?: string): IInterviewee {
  const backend = accessBackend(access);
  return {
    id: id ?? `yggdrasil:${backend.modelId}`,
    interview(request: InterviewRequest): Promise<string> {
      const prompt = askOver(buildThinkPrompt(request.input, world), request.question, YGGDRASIL_CLOSING);
      return backend.complete(prompt, request.input);
    },
  };
}

export { YGGDRASIL_CLOSING };
