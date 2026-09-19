import { z } from 'zod';
import {
  CallBudget,
  DEFAULT_CALL_BUDGET,
  FORAGER_PROBES,
  HARD_CALL_CEILING,
  foragerAdapter,
  judgeTraces,
  minimumDetectableWins,
  openLeakJudge,
  openTraceJudge,
  pairTraces,
  runAb,
  runIgnoranceProbe,
} from '@yggdrasil/engine';
import type { AbResult, ArmId, ArmSpec, BackendSpec, FetchLike, PreRegisteredQuestion } from '@yggdrasil/engine';
import { FileBudgetStore } from './budget.js';

/**
 * THE THREE EVAL TOOLS: `run_ab`, `ignorance_probe`, `judge_traces`.
 *
 * Read-only in effect — they touch no world a session owns, no DB row and no
 * file except the budget counter and the spend log. Mock by default: with no
 * key, or with no `allowPaid`, every one of them runs the free scripted mocks
 * and still proves the whole pipeline.
 *
 * THREE THINGS AN AGENT CALLING THESE TOOLS CANNOT DO, and each of them is a
 * round-1 hole:
 *
 *   IT CANNOT PASS A BACKEND. Every tool builds a `BackendSpec` — a description
 *   with a `kind` — and the engine's door constructs the client from that
 *   description plus a key this host reads from env, already wrapped in its
 *   budget. Round 1 passed an object and checked a `free` flag on it; a ten-line
 *   wrapper round a real Fireworks client got through unbudgeted. There is no
 *   flag to lie about any more, because there is no object to put one on.
 *
 *   IT CANNOT RAISE THE CAP. `ownerOverride` is gone from every schema, every
 *   interface and every call. The ceiling is the constant 2,000. Raising it
 *   takes a file a HUMAN writes at `~/.yggdrasil-lab/eval/ALLOW-ABOVE-CAP.json`,
 *   which nothing in this server reads except to report it and nothing anywhere
 *   writes. Round 1 accepted any non-empty string as an override, persisted the
 *   raised ceiling, and then needed no override at all on the next open.
 *
 *   IT CANNOT GET A METRIC TABLE OUT OF A RUN THAT RAN OUT OF MONEY. A halted
 *   run comes back `usable: false` with no verdict fields, and the spend line is
 *   written in a `finally` so the one run that blew its budget is not the one
 *   run with no record of it.
 */

export interface EvalToolDeps {
  registerTool: (name: string, config: unknown, handler: (args: never) => Promise<unknown>) => void;
  text: (s: string) => unknown;
  json: (v: unknown) => unknown;
  /** The audit trail. Called for every paid ATTEMPT, allowed or refused. */
  audit: (tool: string, detail: unknown) => void;
  announce: (kind: string, summary: string, opts?: { data?: Record<string, unknown> }) => void;
  /** Is a paid model configured at all? */
  hasLlmKey: () => boolean;
  llmModelId: () => string;
  /**
   * The provider key, read from env by the HOST. The engine reads no
   * environment of its own, so the key is handed to the door here. It is never
   * logged, never audited and never in a tool's arguments — no schema in this
   * file has a field for one.
   */
  llmApiKey?: () => string | undefined;
  /**
   * TEST ONLY. A `fetch` handed to the real provider client in place of the
   * network, so the paid code path — charging, retries, transport errors,
   * exhaustion — is exercised rather than being the one path nothing covers.
   * The server never passes it, and no tool argument could: a `fetch` is a
   * FUNCTION, and no zod schema in this file can express one, so nothing an
   * agent sends over the wire can reach this seam.
   */
  testFetch?: FetchLike;
}

const ARM_IDS = ['A', 'A-', 'B', 'B+'] as const;

const PaidArgs = {
  allowPaid: z
    .boolean()
    .optional()
    .describe('Required to reach the configured paid model. Without it the free scripted mocks run and the result says so.'),
  budgetId: z
    .string()
    .optional()
    .describe('Required with allowPaid. A plain name; the call counter under ~/.yggdrasil-lab/eval/budgets is shared by every process and survives restarts.'),
  budgetLimit: z
    .number()
    .int()
    .positive()
    .max(HARD_CALL_CEILING)
    .optional()
    .describe(
      `Calls this budget may ever spend. Default ${DEFAULT_CALL_BUDGET} (decision D1). A SMALLER cap may be asked for; ` +
        `larger is refused — no argument raises the ceiling, and raising it takes a file a human writes under the lab home.`,
    ),
};

interface PaidRequest {
  allowPaid?: boolean | undefined;
  budgetId?: string | undefined;
  budgetLimit?: number | undefined;
}

interface Chosen {
  paid: boolean;
  budget: CallBudget | null;
  /** What the arms reason through. A description; never a client. */
  spec: (arm: ArmId) => BackendSpec;
  refusal?: string;
}

export function registerEvalTools(deps: EvalToolDeps): void {
  const store = new FileBudgetStore();

  /** One place decides whether anything costs money, and writes it down. */
  function choose(tool: string, runId: string, purpose: string, estimate: number, request: PaidRequest): Chosen {
    const wantsPaid = request.allowPaid === true;
    const keyed = deps.hasLlmKey() || deps.testFetch !== undefined;
    if (wantsPaid) {
      deps.audit(tool, {
        attempted: 'paid',
        model: keyed ? deps.llmModelId() : 'none-configured',
        estimate,
        budgetId: request.budgetId ?? null,
        budgetLimit: request.budgetLimit ?? DEFAULT_CALL_BUDGET,
        ceiling: safeCeiling(),
      });
    }
    if (!wantsPaid || !keyed) return { paid: false, budget: null, spec: mockSpec };
    if (!request.budgetId) {
      return {
        paid: true,
        budget: null,
        spec: mockSpec,
        refusal:
          `refused: a paid run needs a named budget (decision D1). Pass budgetId; the cap defaults to ${DEFAULT_CALL_BUDGET} calls ` +
          `and this run is estimated at ~${estimate}.`,
      };
    }
    try {
      const budget = CallBudget.open(store, {
        id: request.budgetId,
        purpose,
        runId,
        ...(request.budgetLimit !== undefined ? { limit: request.budgetLimit } : {}),
      });
      if (budget.remaining < estimate) {
        return {
          paid: true,
          budget: null,
          spec: mockSpec,
          refusal: `refused: budget "${budget.id}" has ${budget.remaining} of ${budget.limit} calls left and this run needs ~${estimate}.`,
        };
      }
      const model = deps.llmModelId();
      const paidSpec: BackendSpec = deps.testFetch
        ? { kind: 'test-fetch', model, fetch: deps.testFetch }
        : { kind: 'fireworks', model };
      return { paid: true, budget, spec: () => paidSpec };
    } catch (err) {
      return { paid: true, budget: null, spec: mockSpec, refusal: `refused: ${String(err)}` };
    }
  }

  /**
   * The free arms are the scripted proof pair: a faithful mind and an omniscient
   * one. They cost nothing and the instrument's sign is known in advance.
   */
  function mockSpec(arm: ArmId): BackendSpec {
    return { kind: 'mock', mind: arm === 'A' || arm === 'A-' ? 'faithful' : 'omniscient' };
  }

  function armsFor(chosen: Chosen, ids: readonly ArmId[]): ArmSpec[] {
    return ids.map((id) => ({ id, backend: chosen.spec(id) }));
  }

  /** Everything the door needs, assembled in one place so no call site forgets the key. */
  function doorContext(chosen: Chosen): { world: typeof foragerAdapter; budget?: CallBudget; apiKey?: string } {
    return { world: foragerAdapter, ...doorExtras(chosen) };
  }

  /** The same two, for `runAb`, which builds its own door context per arm. */
  function doorExtras(chosen: Chosen): { budget?: CallBudget; apiKey?: string } {
    const key = deps.llmApiKey?.();
    return {
      ...(chosen.budget ? { budget: chosen.budget } : {}),
      ...(key ? { apiKey: key } : {}),
    };
  }

  function safeCeiling(): unknown {
    try {
      return store.ceiling();
    } catch (err) {
      return { error: String(err) };
    }
  }

  /** Every tool closes its budget line, including the run that threw. */
  async function withSpend<T>(chosen: Chosen, body: () => Promise<T>): Promise<T> {
    try {
      return await body();
    } finally {
      chosen.budget?.closeRun();
    }
  }

  function unusable(result: AbResult): result is Extract<AbResult, { usable: false }> {
    return result.usable === false;
  }

  const AbArgs = {
    seed: z.string().describe('The run seed. Every arm uses it, so the difference is the mind.'),
    seeds: z
      .array(z.string())
      .min(1)
      .max(8)
      .optional()
      .describe('Several seeds. A paired difference is computed PER SEED, so this is the n of every interval in the result.'),
    ticks: z.number().int().positive().max(20_000).optional().describe('Ticks to run. Default 600.'),
    cohortSize: z.number().int().positive().max(64).optional().describe('Beings given a slow mind. Default 4.'),
    agentCount: z.number().int().positive().max(400).optional().describe('Founders. Default 24.'),
    arms: z
      .array(z.enum(ARM_IDS))
      .min(2)
      .max(4)
      .optional()
      .describe(
        'Which arms to run. A = Yggdrasil mind, A- = the same with the epistemic instruction REMOVED, ' +
          'B = plain LLM agent, B+ = the same agent WITH that instruction. Default A and B. ' +
          'A vs A- and B+ vs B isolate the sentence; A- vs B and A vs B+ isolate the architecture.',
      ),
    mode: z.enum(['population', 'mixed']).optional().describe('population = one run per arm. mixed = one run, matched beings (two arms only).'),
    ...PaidArgs,
  };

  deps.registerTool(
    'run_ab',
    {
      title: 'Run a blind A/B against a plain LLM agent',
      description:
        'Same world, same seed, same bodies. Arm A thinks with the Yggdrasil mind; arm B with a plain LLM role-play agent ' +
        '(persona + traits + a Generative-Agents retrieval over its own observation log + needs + the action list, no mined ' +
        'knowledge, no stories, no relationships). Arms A- and B+ ablate the epistemic instruction in each direction, so the ' +
        'headline can separate architecture from one sentence of prompt. Returns per-seed, per-arm objective metrics and ' +
        'PAIRED differences with a bootstrap interval — one difference per seed, never a subtraction of two pooled numbers — ' +
        'plus the blinded traces. Exactly one metric per contrast is pre-registered as primary; every other row is labelled ' +
        'exploratory and ships a multiple-comparison note. Knowledge formed is reported per arm with a flag saying whether ' +
        "that arm's mind can read it — it is never paired. Read-only. Mock by default; the paid path needs allowPaid AND a named budget.",
      inputSchema: AbArgs,
    },
    async (args: never) => {
      const a = args as unknown as z.infer<z.ZodObject<typeof AbArgs>>;
      const seeds = a.seeds ?? [a.seed];
      const ticks = a.ticks ?? 600;
      const cohortSize = a.cohortSize ?? 4;
      const arms = (a.arms ?? ['A', 'B']) as ArmId[];
      const mode = a.mode ?? 'population';
      if (mode === 'mixed' && arms.length !== 2) {
        return deps.text('refused: mixed mode splits one cohort between exactly two arms.');
      }
      const estimate = estimateCalls(ticks, cohortSize, seeds.length, arms.length, mode);
      const chosen = choose('run_ab', `ab-${seeds.join('+')}`, 'blind A/B vs a plain LLM agent', estimate, a);
      if (chosen.refusal) return deps.text(chosen.refusal);

      const result = await withSpend(chosen, () =>
        runAb(
          {
            seeds,
            ticks,
            cohortSize,
            ...(a.agentCount !== undefined ? { agentCount: a.agentCount } : {}),
            preRegistered: PRE_REGISTERED,
          },
          { arms: armsFor(chosen, arms), ...doorExtras(chosen) },
          mode,
        ),
      );

      if (unusable(result)) {
        deps.announce('report', `A/B on ${seeds.join('+')} STOPPED: ${result.reason}`, { data: { paid: chosen.paid } });
        return deps.json({
          paid: chosen.paid,
          usable: false,
          reason: result.reason,
          detail: result.detail,
          budget: budgetLine(chosen),
          manifest: result.manifest,
          integrity: result.integrity,
        });
      }

      deps.announce('report', `A/B on ${seeds.join('+')}: ${summarise(result)}`, { data: { paid: chosen.paid } });
      return deps.json({
        paid: chosen.paid,
        usable: true,
        budget: budgetLine(chosen),
        manifest: result.manifest,
        integrity: result.integrity,
        mode: result.mode,
        seeds: result.seeds,
        arms: result.arms,
        perSeed: result.perSeed,
        contrasts: result.contrasts,
        traceCount: result.traces.length,
        traces: result.traces.map((t) => ({ traceId: t.traceId, moments: t.moments, features: t.features })),
      });
    },
  );

  const ProbeArgs = {
    seed: z.string(),
    seeds: z.array(z.string()).min(1).max(8).optional(),
    ticks: z.number().int().positive().max(20_000).optional().describe('Ticks before the interview. Default 400.'),
    cohortSize: z.number().int().positive().max(16).optional().describe('Beings interviewed per arm. Default 3.'),
    limit: z.number().int().positive().max(400).optional().describe('Cap on interviews per arm.'),
    arms: z.array(z.enum(ARM_IDS)).min(2).max(4).optional(),
    useLeakJudge: z
      .boolean()
      .optional()
      .describe('Run the tier-3 reader as well as the lexical tier. Free (a strict deterministic mock) unless allowPaid is set.'),
    ...PaidArgs,
  };

  deps.registerTool(
    'ignorance_probe',
    {
      title: 'Interview beings about things they cannot know',
      description:
        'Audit 04 §5 #1, the most discriminating test. Runs a short A/B, then interviews each being OUTSIDE the causal flow — ' +
        'no tick advances, no memory is written — about things true in the real world and absent from its experience (metals, ' +
        'germs, distant geography, money, writing, seasons elsewhere, making fire, farming) PLUS matched controls about what it ' +
        "HAS lived through. The question's own words are stripped from the answer before leak detection, because a question " +
        'names its concept and an echo is not evidence; a disavowal ("I have never…", "no one has told me…") is scored as ' +
        'admitted ignorance even when it repeats the concept; and a control counts as grounded only when the answer cites the ' +
        'being\'s own knowledge or memories ABOUT THE THING ASKED, so parroting unrelated own-nouns scores zero and "I do not ' +
        'know" to a control is a miss. Leak rates are a LOWER bound and the detector recall ships with them. Read-only. Mock by ' +
        'default; paid needs allowPaid AND a named budget.',
      inputSchema: ProbeArgs,
    },
    async (args: never) => {
      const a = args as unknown as z.infer<z.ZodObject<typeof ProbeArgs>>;
      const seeds = a.seeds ?? [a.seed];
      const ticks = a.ticks ?? 400;
      const cohortSize = a.cohortSize ?? 3;
      const arms = (a.arms ?? ['A', 'B']) as ArmId[];
      const interviews = cohortSize * seeds.length * FORAGER_PROBES.length * arms.length;
      const estimate =
        estimateCalls(ticks, cohortSize, seeds.length, arms.length, 'population') +
        interviews * (a.useLeakJudge === true ? 2 : 1);
      const chosen = choose('ignorance_probe', `probe-${seeds.join('+')}`, 'ignorance probe', estimate, a);
      if (chosen.refusal) return deps.text(chosen.refusal);

      const payload = await withSpend(chosen, async () => {
        const result = await runAb(
          { seeds, ticks, cohortSize, preRegistered: PRE_REGISTERED },
          { arms: armsFor(chosen, arms), ...doorExtras(chosen) },
          'population',
        );
        if (unusable(result)) return { result, reports: null };
        const judge =
          a.useLeakJudge === true
            ? openLeakJudge(
                chosen.paid && chosen.budget ? { kind: 'llm', backend: chosen.spec('A') } : { kind: 'mock' },
                doorContext(chosen),
              )
            : undefined;
        const reports: Record<string, unknown> = {};
        for (const arm of arms) {
          reports[arm] = await runIgnoranceProbe(result.subjects[arm] ?? [], {
            world: foragerAdapter,
            ...(a.limit !== undefined ? { limit: a.limit } : {}),
            ...(judge ? { judge } : {}),
          });
        }
        return { result, reports };
      });

      if (unusable(payload.result)) {
        return deps.json({
          paid: chosen.paid,
          usable: false,
          reason: payload.result.reason,
          detail: payload.result.detail,
          budget: budgetLine(chosen),
          manifest: payload.result.manifest,
        });
      }

      const reports = payload.reports as Record<string, ProbeLike>;
      deps.announce(
        'report',
        `Ignorance probe on ${seeds.join('+')}: ${arms.map((arm) => `${arm} sep ${reports[arm]?.separation ?? 'n/a'}`).join(', ')}`,
      );
      return deps.json({
        paid: chosen.paid,
        usable: true,
        budget: budgetLine(chosen),
        manifest: payload.result.manifest,
        detector: reports[arms[0]!]?.detector,
        arms: Object.fromEntries(
          arms.map((arm) => [
            arm,
            { absent: reports[arm]?.absent, controls: reports[arm]?.controls, separation: reports[arm]?.separation },
          ]),
        ),
        sampleAnswers: arms.flatMap((arm) => (reports[arm]?.answers ?? []).slice(0, 3).map((x) => ({ arm, ...trimAnswer(x) }))),
      });
    },
  );

  const JudgeArgs = {
    seed: z.string(),
    seeds: z.array(z.string()).min(1).max(8).optional(),
    ticks: z.number().int().positive().max(20_000).optional().describe('Ticks to run before judging. Default 600.'),
    cohortSize: z.number().int().positive().max(32).optional().describe('Beings per arm. Default 4.'),
    arms: z.array(z.enum(ARM_IDS)).length(2).optional().describe('The two arms to contrast. Default A and B.'),
    ...PaidArgs,
  };

  deps.registerTool(
    'judge_traces',
    {
      title: 'Blind pairwise judgement of behaviour traces',
      description:
        'Runs an A/B, blinds the traces (opaque handles drawn over a seeded PERMUTATION of the pooled traces, no handle and no ' +
        'cadence column in the text a judge reads, the arm key sealed until every judgement is recorded), pairs one trace from ' +
        'each arm, balances left/right placement, and judges every pair TWICE — once in each order. The PAIR is the unit of ' +
        'analysis: a pair is won only when both orders name the same arm, and the both-orders consistency rate is reported ' +
        'beside the win rate. Returns the win rate with a Wilson interval and an exact two-sided sign-test p, the minimum ' +
        'detectable effect for the number of pairs actually judged, a per-criterion breakdown, and a position-bias check with ' +
        'its own interval. The default judge is a deterministic rule-based mock over arm-free trace features; the LLM judge ' +
        'needs allowPaid AND a named budget.',
      inputSchema: JudgeArgs,
    },
    async (args: never) => {
      const a = args as unknown as z.infer<z.ZodObject<typeof JudgeArgs>>;
      const seeds = a.seeds ?? [a.seed];
      const ticks = a.ticks ?? 600;
      const cohortSize = a.cohortSize ?? 4;
      const arms = (a.arms ?? ['A', 'B']) as [ArmId, ArmId];
      // Two showings per pair, and at most cohortSize × seeds pairs.
      const estimate = estimateCalls(ticks, cohortSize, seeds.length, 2, 'population') + cohortSize * seeds.length * 2;
      const chosen = choose('judge_traces', `judge-${seeds.join('+')}`, 'blind trace A/B', estimate, a);
      if (chosen.refusal) return deps.text(chosen.refusal);

      const payload = await withSpend(chosen, async () => {
        const result = await runAb(
          { seeds, ticks, cohortSize, preRegistered: PRE_REGISTERED },
          { arms: armsFor(chosen, arms), ...doorExtras(chosen) },
          'population',
        );
        if (unusable(result)) return { result, aggregate: null, pairing: null };
        const judge = openTraceJudge(
          chosen.paid && chosen.budget ? { kind: 'llm', backend: chosen.spec(arms[0]) } : { kind: 'mock' },
          doorContext(chosen),
        );
        const pairing = pairTraces(result.traces, result.key, seeds.join('+'), arms);
        const aggregate = await judgeTraces(pairing.pairs, result.key, judge, { arms });
        return { result, aggregate, pairing };
      });

      if (unusable(payload.result)) {
        return deps.json({
          paid: chosen.paid,
          usable: false,
          reason: payload.result.reason,
          detail: payload.result.detail,
          budget: budgetLine(chosen),
          manifest: payload.result.manifest,
        });
      }
      const aggregate = payload.aggregate!;
      deps.announce(
        'report',
        `Trace A/B on ${seeds.join('+')}: ${arms[0]} win rate ${aggregate.winRateA} over ${aggregate.decisivePairs} decisive pairs (p ${aggregate.exactP})`,
      );
      return deps.json({
        paid: chosen.paid,
        usable: true,
        budget: budgetLine(chosen),
        manifest: payload.result.manifest,
        pairing: payload.pairing?.manifest,
        ...aggregate,
        judged: aggregate.judged.slice(0, 8),
        whatThisManyPairsCouldDecide: minimumDetectableWins(aggregate.pairs),
      });
    },
  );
}

/**
 * THE PRE-REGISTRATION, in code, before any run.
 *
 * One metric per question. Everything else the table prints is exploratory and
 * carries a multiple-comparison note — round 1 printed ~30 comparisons with no
 * correction, which buys about one and a half findings from noise every run.
 */
const PRE_REGISTERED: readonly PreRegisteredQuestion[] = [
  {
    question: 'Is the Yggdrasil arm objectively better off in the world than a plain LLM agent?',
    primaryMetric: 'planSuccessRate',
    contrast: ['A', 'B'],
    direction: 'higher',
  },
  {
    question: 'Is the difference the architecture rather than one sentence of prompt?',
    primaryMetric: 'planSuccessRate',
    contrast: ['A-', 'B'],
    direction: 'higher',
  },
  {
    question: 'How much does the epistemic instruction alone do inside the Yggdrasil mind?',
    primaryMetric: 'planSuccessRate',
    contrast: ['A', 'A-'],
    direction: 'higher',
  },
  {
    question: 'How much does the epistemic instruction alone do inside a plain agent?',
    primaryMetric: 'planSuccessRate',
    contrast: ['B+', 'B'],
    direction: 'higher',
  },
];

interface ProbeLike {
  absent: unknown;
  controls: unknown;
  separation: number;
  detector: unknown;
  answers: { probeId: string; kind: string; answer: string; leaked: boolean; admittedIgnorance: boolean; grounded: boolean }[];
}

/**
 * Roughly how many completions a run will cost: one per think, per conscious
 * being, per arm, per seed. Think cadence is a trait curve around ~100 ticks, so
 * this is deliberately generous — a refusal that under-quotes is worse than one
 * that over-quotes.
 */
function estimateCalls(ticks: number, cohortSize: number, seeds: number, arms: number, mode: 'population' | 'mixed'): number {
  const thinksPerBeing = Math.max(1, Math.ceil(ticks / 80));
  const perSeed = mode === 'population' ? thinksPerBeing * cohortSize * arms : thinksPerBeing * cohortSize;
  return perSeed * seeds + 8;
}

function budgetLine(chosen: Chosen): { id: string; limit: number; spent: number; remaining: number; ceiling: unknown } | null {
  const budget = chosen.budget;
  return budget
    ? { id: budget.id, limit: budget.limit, spent: budget.spent, remaining: budget.remaining, ceiling: budget.ceiling }
    : null;
}

function summarise(result: Extract<AbResult, { usable: true }>): string {
  const headline = result.contrasts[0];
  const primary = headline?.primary;
  return primary
    ? `${headline!.label} ${primary.metric} ${primary.meanDelta} over ${primary.n} seed(s)` +
        `${primary.ci ? ` CI [${primary.ci.low}, ${primary.ci.high}]` : ' (no interval at n=1)'}, ${result.traces.length} blind traces`
    : `${result.traces.length} blind traces over ${result.seeds.length} seed(s)`;
}

interface TrimmedAnswer {
  probeId: string;
  kind: string;
  leaked: boolean;
  admittedIgnorance: boolean;
  grounded: boolean;
  answer: string;
}

function trimAnswer(answer: {
  probeId: string;
  kind: string;
  answer: string;
  leaked: boolean;
  admittedIgnorance: boolean;
  grounded: boolean;
}): TrimmedAnswer {
  return {
    probeId: answer.probeId,
    kind: answer.kind,
    leaked: answer.leaked,
    admittedIgnorance: answer.admittedIgnorance,
    grounded: answer.grounded,
    answer: answer.answer.slice(0, 240),
  };
}
