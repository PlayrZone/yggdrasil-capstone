import type { WorldAdapter } from '../contract/adapter.js';
import type { ThinkInput } from '../contract/types.js';
import type { IMindBackend } from '../consciousness/IMindBackend.js';
import { buildThinkPrompt } from '../consciousness/prompt.js';
import type { ThinkPrompt } from '../consciousness/prompt.js';
import { BaselineAgentBackend } from './baseline/BaselineAgentBackend.js';
import type { BaselineAgentOptions } from './baseline/BaselineAgentBackend.js';
import { openBackend } from './door.js';
import type { BackendSpec, DoorContext } from './door.js';
import { stripEpistemicInstruction } from './epistemic.js';
import { YGGDRASIL_CLOSING, askOver } from './interview.js';
import type { ArmFamily, ArmId, IInterviewee, InterviewRequest } from './types.js';

/**
 * WHAT AN ARM IS, AS DATA.
 *
 * Round 1 hard-coded two: `backends.a` went to the Yggdrasil mind and
 * `backends.b` to the baseline agent, and the epistemic instruction rode along
 * with whichever one it happened to be attached to. The headline number was
 * therefore a difference of architecture AND of one prompt sentence, with no
 * way to attribute it — the reviewer's D7, and the single most expensive
 * mistake in the item, because it makes a paid pilot uninterpretable.
 *
 * An arm is now `{id, backend}`, the id says which mind and whether the
 * instruction is present, and the runner loops over however many it is given.
 * Four are meaningful:
 *
 *   A vs B      the headline, confounded on purpose so it can be decomposed
 *   A vs A−     the instruction, inside the Yggdrasil mind
 *   B+ vs B     the instruction, inside a plain agent
 *   A− vs B     the architecture, with the instruction absent from both
 *   A  vs B+    the architecture, with the instruction present in both
 */

export interface ArmSpec {
  id: ArmId;
  /** The transport this arm reasons through. A description, never an object. */
  backend: BackendSpec;
  /** Options for the B-family agent. Ignored by the A family. */
  baseline?: Omit<BaselineAgentOptions, 'world' | 'transport' | 'epistemicInstruction'>;
}

export interface BuiltArm {
  id: ArmId;
  family: ArmFamily;
  /** True when this arm's prompt carries the epistemic instruction. */
  epistemicInstruction: boolean;
  /** What the runner's `LlmMind` talks to. */
  mind: IMindBackend;
  /** The same mind, asked a question instead of for a decision. */
  interviewee: IInterviewee;
  /** True when this arm's mind actually reads the beliefs its miners form. */
  knowledgeReachesMind: boolean;
  /** For the run manifest. Never contains a key. */
  label: string;
  /** Arm B's real sent bytes, for the arms that compose their own prompt. */
  sentPrompts: () => readonly { beingId: number; tick: number; prompt: ThinkPrompt }[];
}

export function familyOf(arm: ArmId): ArmFamily {
  return arm === 'A' || arm === 'A-' ? 'yggdrasil' : 'baseline';
}

export function carriesInstruction(arm: ArmId): boolean {
  return arm === 'A' || arm === 'B+';
}

/** Every contrast worth naming, given the arms a run actually has. */
export function contrastsFor(arms: readonly ArmId[]): { label: string; isolates: string; pair: [ArmId, ArmId] }[] {
  const has = (id: ArmId): boolean => arms.includes(id);
  const rows: { label: string; isolates: string; pair: [ArmId, ArmId] }[] = [];
  if (has('A') && has('B')) rows.push({ label: 'A vs B', isolates: 'architecture + instruction (confounded)', pair: ['A', 'B'] });
  if (has('A') && has('A-')) rows.push({ label: 'A vs A-', isolates: 'the instruction, inside the Yggdrasil mind', pair: ['A', 'A-'] });
  if (has('B+') && has('B')) rows.push({ label: 'B+ vs B', isolates: 'the instruction, inside a plain agent', pair: ['B+', 'B'] });
  if (has('A-') && has('B')) rows.push({ label: 'A- vs B', isolates: 'the architecture, instruction absent from both', pair: ['A-', 'B'] });
  if (has('A') && has('B+')) rows.push({ label: 'A vs B+', isolates: 'the architecture, instruction present in both', pair: ['A', 'B+'] });
  return rows;
}

export function buildArm(spec: ArmSpec, context: DoorContext): BuiltArm {
  const family = familyOf(spec.id);
  const instruction = carriesInstruction(spec.id);
  const transport = openBackend(spec.backend, { ...context, label: `arm ${spec.id}` });

  if (family === 'yggdrasil') {
    const mind = instruction ? transport : new EpistemicAblationBackend(transport);
    return {
      id: spec.id,
      family,
      epistemicInstruction: instruction,
      mind,
      interviewee: yggdrasilInterviewee(mind, context.world, `yggdrasil:${spec.id}`),
      knowledgeReachesMind: true,
      label: `${spec.id}/yggdrasil(${transport.modelId})`,
      sentPrompts: () => [],
    };
  }

  const agent = new BaselineAgentBackend({
    ...(spec.baseline ?? {}),
    world: context.world,
    transport,
    epistemicInstruction: instruction,
    label: `baseline-${spec.id}/${transport.modelId}`,
  });
  return {
    id: spec.id,
    family,
    epistemicInstruction: instruction,
    mind: agent,
    interviewee: agent,
    knowledgeReachesMind: false,
    label: `${spec.id}/baseline(${transport.modelId})`,
    sentPrompts: () => agent.sentPrompts(),
  };
}

/**
 * ARM A−. It strips the epistemic instruction out of the composed prompt on the
 * way to the transport, rather than asking `consciousness/prompt.ts` for a flag:
 * the ablation belongs to one arm of one experiment, and a permanent parameter
 * on the mind's prompt builder would be a change to the engine for a temporary
 * question. `stripEpistemicInstruction` throws if the lines are not there, so a
 * reworded prompt fails the arm loudly instead of ablating nothing.
 */
class EpistemicAblationBackend implements IMindBackend {
  constructor(private readonly inner: IMindBackend) {}

  get modelId(): string {
    return this.inner.modelId;
  }

  complete(prompt: ThinkPrompt, input: ThinkInput): Promise<string> {
    return this.inner.complete(stripEpistemicInstruction(prompt), input);
  }
}

/**
 * THE A-FAMILY INTERVIEWEE. The Yggdrasil mind answers over the same prompt it
 * thinks over — its knowledge, its stories, the people it knows — with the
 * decision instruction replaced by a question.
 *
 * It goes STRAIGHT to the backend, never through `LlmMind`: a think through
 * `LlmMind` logs a cognition, may retry, and may fall back to the world's reflex
 * policy, all of which would put the interview inside the run it is supposed to
 * stand outside of.
 *
 * It takes a backend that has ALREADY been through the door. There is no
 * overload that takes a spec and no overload that takes a raw client, so an
 * interview is one more thing that cannot reach a provider unbudgeted.
 */
export function yggdrasilInterviewee(backend: IMindBackend, world: WorldAdapter, id?: string): IInterviewee {
  return {
    id: id ?? `yggdrasil:${backend.modelId}`,
    interview(request: InterviewRequest): Promise<string> {
      const prompt = askOver(buildThinkPrompt(request.input, world), request.question, YGGDRASIL_CLOSING);
      return backend.complete(prompt, request.input);
    },
  };
}
