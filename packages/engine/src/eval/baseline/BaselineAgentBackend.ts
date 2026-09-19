import type { WorldAdapter } from '../../contract/adapter.js';
import type { ThinkInput } from '../../contract/types.js';
import type { IMindBackend } from '../../consciousness/IMindBackend.js';
import type { ThinkPrompt } from '../../consciousness/prompt.js';
import { accessBackend } from '../budget.js';
import type { BackendAccess } from '../budget.js';
import type { ArmId, IInterviewee, InterviewRequest, SentPrompt } from '../types.js';
import { BaselineMemory } from './memory.js';
import type { BaselineMemoryOptions } from './memory.js';
import { DEFAULT_PERSONA, buildBaselineInterviewPrompt, buildBaselinePrompt } from './prompt.js';
import type { BaselinePersona } from './prompt.js';

/**
 * ARM B: A PLAIN LLM-AGENT MIND IN A YGGDRASIL BODY.
 *
 * It plugs in at the seam that already exists. `IMindBackend.complete(prompt,
 * input)` documents its second argument as "the situation those messages were
 * built from, for backends that REASON rather than transport" — this is such a
 * backend. It IGNORES the Yggdrasil prompt entirely, keeps its own
 * Generative-Agents-lite memory per being, composes its own prompt, and sends
 * that through whatever transport it was given. Nothing under `agent/`,
 * `memory/`, `learning/`, `knowledge/`, `relationships/`, `narrative/` or
 * `consciousness/` is touched, and neither is the runner.
 *
 * ONE THING THIS SEAM CANNOT DO, stated plainly because it matters to anyone
 * reading a recorded row: `CognitionRecordV2.prompt` is the prompt `LlmMind`
 * composed, not the one this backend sent. The record layer has no way to be
 * told otherwise. `sentPrompts()` keeps the real bytes on the arm that produced
 * them — arm-private, never in a trace — and `eval/README.md` names the seam
 * the record layer would need.
 */

export interface BaselineAgentOptions {
  /** The world whose verbs and drives this agent is held to — the same as arm A's. */
  world: WorldAdapter;
  /**
   * How this ordinary agent reaches a model. A `BackendAccess`, because
   * `accessBackend` is the only door to a paid provider and this class walks
   * through it itself rather than trusting a caller to have done so.
   */
  transport: BackendAccess;
  memory?: BaselineMemoryOptions;
  persona?: BaselinePersona;
  /**
   * Reflect with the model instead of locally. Costs one extra call per
   * reflection, so it is off by default and the pilot recipe counts it.
   */
  modelSummaries?: boolean;
  /** Label for the run manifest. Default `baseline/<transport>`. */
  label?: string;
}

export class BaselineAgentBackend implements IMindBackend, IInterviewee {
  readonly modelId: string;
  readonly id: string;
  private readonly world: WorldAdapter;
  private readonly transport: IMindBackend;
  private readonly memories = new Map<number, BaselineMemory>();
  private readonly persona: BaselinePersona;
  private readonly memoryOptions: BaselineMemoryOptions;
  private readonly modelSummaries: boolean;
  private readonly sent: SentPrompt[] = [];

  constructor(options: BaselineAgentOptions) {
    this.world = options.world;
    this.transport = accessBackend(options.transport);
    this.persona = options.persona ?? DEFAULT_PERSONA;
    this.memoryOptions = options.memory ?? {};
    this.modelSummaries = options.modelSummaries ?? false;
    this.modelId = options.label ?? `baseline/${this.transport.modelId}`;
    this.id = this.modelId;
  }

  async complete(_prompt: ThinkPrompt, input: ThinkInput): Promise<string> {
    const memory = this.memoryFor(input.snapshot.id);
    memory.observe(input, this.world);
    if (memory.shouldSummarize()) await this.refresh(memory, input);
    const mine = buildBaselinePrompt(input, this.world, memory, this.persona);
    this.sent.push({ beingId: input.snapshot.id, tick: input.worldView.tick, prompt: mine });
    return this.transport.complete(mine, input);
  }

  async interview(request: InterviewRequest): Promise<string> {
    const memory = this.memoryFor(request.input.snapshot.id);
    const prompt = buildBaselineInterviewPrompt(request.input, this.world, memory, request.question, this.persona);
    return this.transport.complete(prompt, request.input);
  }

  /** What this arm actually sent, in order. Arm-private: never rendered into a trace. */
  sentPrompts(): readonly SentPrompt[] {
    return this.sent;
  }

  private memoryFor(beingId: number): BaselineMemory {
    let memory = this.memories.get(beingId);
    if (!memory) this.memories.set(beingId, (memory = new BaselineMemory(this.memoryOptions)));
    return memory;
  }

  private async refresh(memory: BaselineMemory, input: ThinkInput): Promise<void> {
    if (!this.modelSummaries) {
      memory.summarizeLocally();
      return;
    }
    const source = memory.summarySource();
    const reply = await this.transport.complete(
      {
        system: 'Summarise what has been happening to this person in two sentences, in the first person. Plain text only.',
        user: source.map((line) => `- ${line}`).join('\n'),
      },
      input,
    );
    // A summariser that answers with junk must not poison the window; the local
    // one is always a valid fallback and costs nothing.
    if (reply.trim().length > 0 && reply.trim().length < 600) memory.setSummary(reply);
    else memory.summarizeLocally();
  }
}

/**
 * MIXED-COHORT MODE. One run, one `LlmMind`, two minds behind it: the backend
 * routes on `ThinkInput.snapshot.id`, which is the being asking. Matched beings
 * then differ only in mind — same world, same seed, same tick, same neighbours,
 * same weather — which whole-population arms can never quite give you.
 */
export class ArmRouterBackend implements IMindBackend {
  readonly modelId: string;

  constructor(
    private readonly armOf: (beingId: number) => ArmId,
    private readonly a: IMindBackend,
    private readonly b: IMindBackend,
  ) {
    this.modelId = `mixed(A=${a.modelId}|B=${b.modelId})`;
  }

  complete(prompt: ThinkPrompt, input: ThinkInput): Promise<string> {
    const arm = this.armOf(input.snapshot.id);
    return (arm === 'A' ? this.a : this.b).complete(prompt, input);
  }
}
