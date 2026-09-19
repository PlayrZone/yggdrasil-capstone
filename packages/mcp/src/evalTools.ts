import { z } from 'zod';
import {
  CallBudget,
  FORAGER_PROBES,
  FaithfulMockBackend,
  LlmTraceJudge,
  MockTraceJudge,
  OmniscientMockBackend,
  foragerAdapter,
  judgeTraces,
  pairTraces,
  runAb,
  runIgnoranceProbe,
} from '@yggdrasil/engine';
import type { AbBackends, AbResult, BackendAccess, IMindBackend, ITraceJudge } from '@yggdrasil/engine';
import { FileBudgetStore } from './budget.js';

/**
 * THE THREE EVAL TOOLS: `run_ab`, `ignorance_probe`, `judge_traces`.
 *
 * Read-only in effect — they touch no world a session owns, no DB row and no
 * file except the budget counter and the spend log. Mock by default: with no
 * key, or with no `allowPaid`, every one of them runs the free scripted mocks
 * and still proves the whole pipeline.
 *
 * The paid path needs BOTH `allowPaid: true` AND a named budget. That is
 * decision D1 as a tool signature: a caller cannot spend by forgetting a flag,
 * and every attempt — allowed or refused — lands in the append-only `actions`
 * table.
 */

export interface EvalToolDeps {
  registerTool: (name: string, config: unknown, handler: (args: never) => Promise<unknown>) => void;
  text: (s: string) => unknown;
  json: (v: unknown) => unknown;
  /** The audit trail. Called for every paid ATTEMPT, allowed or refused. */
  audit: (tool: string, detail: unknown) => void;
  announce: (kind: string, summary: string, opts?: { data?: Record<string, unknown> }) => void;
  makeLlmBackend: () => IMindBackend | null;
  llmModelId: () => string;
}

const PaidArgs = {
  allowPaid: z
    .boolean()
    .optional()
    .describe('Required to reach the configured paid model. Without it the free scripted mocks run and the result says so.'),
  budgetId: z
    .string()
    .optional()
    .describe('Required with allowPaid. A plain name; the call counter under ~/.yggdrasil-lab/eval/budgets survives process restarts.'),
  budgetLimit: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Calls this budget may ever spend. Default 2000 (decision D1). Above that needs ownerOverride.'),
  ownerOverride: z.string().optional().describe("The owner's written reason for a cap above 2000. Persisted and logged."),
};

interface PaidRequest {
  allowPaid?: boolean | undefined;
  budgetId?: string | undefined;
  budgetLimit?: number | undefined;
  ownerOverride?: string | undefined;
}

interface Chosen {
  paid: boolean;
  budget: CallBudget | null;
  backend: IMindBackend;
  refusal?: string;
}

export function registerEvalTools(deps: EvalToolDeps): void {
  const store = new FileBudgetStore();

  /** One place decides whether anything costs money, and writes it down. */
  function choose(tool: string, runId: string, purpose: string, estimate: number, request: PaidRequest): Chosen {
    const paidBackend = request.allowPaid === true ? deps.makeLlmBackend() : null;
    if (request.allowPaid === true) {
      deps.audit(tool, {
        attempted: 'paid',
        model: paidBackend ? deps.llmModelId() : 'none-configured',
        estimate,
        budgetId: request.budgetId ?? null,
        ownerOverride: request.ownerOverride ?? null,
      });
    }
    if (!paidBackend) {
      return { paid: false, budget: null, backend: new FaithfulMockBackend(foragerAdapter) };
    }
    if (!request.budgetId) {
      return {
        paid: true,
        budget: null,
        backend: paidBackend,
        refusal:
          `refused: a paid run needs a named budget (decision D1). Pass budgetId; the cap defaults to 2000 calls ` +
          `and this run is estimated at ~${estimate}.`,
      };
    }
    try {
      const budget = CallBudget.open(store, {
        id: request.budgetId,
        purpose,
        runId,
        ...(request.budgetLimit !== undefined ? { limit: request.budgetLimit } : {}),
        ...(request.ownerOverride !== undefined ? { ownerOverride: request.ownerOverride } : {}),
      });
      if (budget.remaining < estimate) {
        return {
          paid: true,
          budget: null,
          backend: paidBackend,
          refusal: `refused: budget "${budget.id}" has ${budget.remaining} of ${budget.limit} calls left and this run needs ~${estimate}.`,
        };
      }
      return { paid: true, budget, backend: paidBackend };
    } catch (err) {
      return { paid: true, budget: null, backend: paidBackend, refusal: `refused: ${String(err)}` };
    }
  }

  function armsFor(chosen: Chosen): AbBackends {
    if (chosen.paid && chosen.budget) {
      const access: BackendAccess = { backend: chosen.backend, budget: chosen.budget };
      return { a: access, b: access };
    }
    // The free arms are the scripted proof pair: a faithful mind and an
    // omniscient one. They cost nothing and the instrument's sign is known.
    return {
      a: { backend: new FaithfulMockBackend(foragerAdapter) },
      b: { backend: new OmniscientMockBackend(foragerAdapter) },
    };
  }

  const AbArgs = {
    seed: z.string().describe('The run seed. Both arms use it, so the difference is the mind.'),
    ticks: z.number().int().positive().max(20_000).optional().describe('Ticks to run. Default 600.'),
    cohortSize: z.number().int().positive().max(64).optional().describe('Beings given a slow mind. Default 4.'),
    agentCount: z.number().int().positive().max(400).optional().describe('Founders. Default 24.'),
    mode: z.enum(['population', 'mixed']).optional().describe('population = two runs, one arm each. mixed = one run, matched beings.'),
    ...PaidArgs,
  };

  deps.registerTool(
    'run_ab',
    {
      title: 'Run a blind A/B against a plain LLM agent',
      description:
        'Same world, same seed, same bodies: arm A thinks with the Yggdrasil mind, arm B with a plain LLM role-play agent (persona + rolling raw observations + needs + the action list, no mined knowledge, no stories, no relationships). Returns objective per-arm metrics with seed-paired differences (survival, births/deaths by cause, plan success, behavioural entropy, diet breadth, dispersal, speech answered) and BLINDED behaviour traces with every arm-identifying artefact stripped. Knowledge formed is reported per arm with a flag saying whether that arm\'s mind can read it — it is never paired. Read-only. Mock by default; the paid path needs allowPaid AND a named budget.',
      inputSchema: AbArgs,
    },
    async (args: never) => {
      const a = args as unknown as z.infer<z.ZodObject<typeof AbArgs>>;
      const ticks = a.ticks ?? 600;
      const cohortSize = a.cohortSize ?? 4;
      const estimate = estimateCalls(ticks, cohortSize, a.mode ?? 'population');
      const chosen = choose('run_ab', `ab-${a.seed}`, 'blind A/B vs a plain LLM agent', estimate, a);
      if (chosen.refusal) return deps.text(chosen.refusal);
      const result = await runAb(
        {
          seed: a.seed,
          ticks,
          cohortSize,
          ...(a.agentCount !== undefined ? { agentCount: a.agentCount } : {}),
        },
        armsFor(chosen),
        a.mode ?? 'population',
      );
      chosen.budget?.closeRun();
      deps.announce('report', `A/B on seed ${a.seed}: ${summarise(result)}`, { data: { paid: chosen.paid } });
      return deps.json({
        paid: chosen.paid,
        budget: budgetLine(chosen),
        mode: result.mode,
        metrics: result.metrics,
        paired: result.paired,
        traceCount: result.traces.length,
        traces: result.traces.map((t) => ({ traceId: t.traceId, moments: t.moments, features: t.features })),
      });
    },
  );

  const ProbeArgs = {
    seed: z.string(),
    ticks: z.number().int().positive().max(20_000).optional().describe('Ticks before the interview. Default 400.'),
    cohortSize: z.number().int().positive().max(16).optional().describe('Beings interviewed per arm. Default 3.'),
    limit: z.number().int().positive().max(400).optional().describe('Cap on interviews per arm.'),
    ...PaidArgs,
  };

  deps.registerTool(
    'ignorance_probe',
    {
      title: 'Interview beings about things they cannot know',
      description:
        'Audit 04 §5 #1, the most discriminating test. Runs a short A/B, then interviews each being OUTSIDE the causal flow — no tick advances, no memory is written — with questions about things true in the real world and absent from this being\'s experience (metals, germs, distant geography, money, writing, seasons elsewhere, making fire, farming) PLUS matched controls about what it HAS lived through. Scores leaks with the tier-2 lexical detector (blind recall stated on the result — a lower bound, never a clean bill), counts explicit admissions of ignorance, and checks that control answers actually cite things in the being\'s own knowledge, memories, inventory or perception. Read-only. Mock by default; paid needs allowPaid AND a named budget.',
      inputSchema: ProbeArgs,
    },
    async (args: never) => {
      const a = args as unknown as z.infer<z.ZodObject<typeof ProbeArgs>>;
      const ticks = a.ticks ?? 400;
      const cohortSize = a.cohortSize ?? 3;
      const estimate = estimateCalls(ticks, cohortSize, 'population') + cohortSize * FORAGER_PROBES.length * 2;
      const chosen = choose('ignorance_probe', `probe-${a.seed}`, 'ignorance probe', estimate, a);
      if (chosen.refusal) return deps.text(chosen.refusal);
      const result = await runAb({ seed: a.seed, ticks, cohortSize }, armsFor(chosen), 'population');
      const options = a.limit !== undefined ? { limit: a.limit } : {};
      const reportA = await runIgnoranceProbe(result.subjects.A, options);
      const reportB = await runIgnoranceProbe(result.subjects.B, options);
      chosen.budget?.closeRun();
      deps.announce('report', `Ignorance probe on seed ${a.seed}: A sep ${reportA.separation}, B sep ${reportB.separation}`);
      return deps.json({
        paid: chosen.paid,
        budget: budgetLine(chosen),
        detector: reportA.detector,
        A: { absent: reportA.absent, controls: reportA.controls, separation: reportA.separation },
        B: { absent: reportB.absent, controls: reportB.controls, separation: reportB.separation },
        sampleAnswers: [...reportA.answers.slice(0, 3), ...reportB.answers.slice(0, 3)].map(trimAnswer),
      });
    },
  );

  const JudgeArgs = {
    seed: z.string(),
    ticks: z.number().int().positive().max(20_000).optional().describe('Ticks to run before judging. Default 600.'),
    cohortSize: z.number().int().positive().max(32).optional().describe('Beings per arm. Default 4.'),
    ...PaidArgs,
  };

  deps.registerTool(
    'judge_traces',
    {
      title: 'Blind pairwise judgement of behaviour traces',
      description:
        'Runs an A/B, blinds the traces, pairs one from each arm with seeded randomness, and judges every pair TWICE — once in each order — so position bias is measured rather than assumed away. Returns the win rate with a Wilson interval, the tie rate, a per-criterion breakdown (pursues something over time / consistent with its past / reacts to the world / social coherence / does not know what it should not), and the order-swap consistency. The default judge is a deterministic rule-based mock over arm-free trace features; the LLM judge needs allowPaid AND a named budget.',
      inputSchema: JudgeArgs,
    },
    async (args: never) => {
      const a = args as unknown as z.infer<z.ZodObject<typeof JudgeArgs>>;
      const ticks = a.ticks ?? 600;
      const cohortSize = a.cohortSize ?? 4;
      // Two judgements per pair, and at most cohortSize pairs.
      const estimate = estimateCalls(ticks, cohortSize, 'population') + cohortSize * 2;
      const chosen = choose('judge_traces', `judge-${a.seed}`, 'blind trace A/B', estimate, a);
      if (chosen.refusal) return deps.text(chosen.refusal);
      const result = await runAb({ seed: a.seed, ticks, cohortSize }, armsFor(chosen), 'population');
      const judge: ITraceJudge =
        chosen.paid && chosen.budget
          ? // The judge is a model too, and it spends the SAME budget the run
            // did — a separate wrapper would be a second allowance nobody asked for.
            new LlmTraceJudge({ backend: chosen.backend, budget: chosen.budget })
          : new MockTraceJudge();
      const pairs = pairTraces(result.traces, result.key, a.seed);
      const aggregate = await judgeTraces(pairs, result.key, judge);
      chosen.budget?.closeRun();
      deps.announce('report', `Trace A/B on seed ${a.seed}: arm A win rate ${aggregate.winRateA} (${aggregate.decisive} decisive)`);
      return deps.json({ paid: chosen.paid, budget: budgetLine(chosen), ...aggregate, judged: aggregate.judged.slice(0, 8) });
    },
  );
}

/**
 * Roughly how many completions a run will cost: one per think, per conscious
 * being, per arm. Think cadence is a trait curve around ~100 ticks, so this is
 * deliberately generous — a refusal that under-quotes is worse than one that
 * over-quotes.
 */
function estimateCalls(ticks: number, cohortSize: number, mode: 'population' | 'mixed'): number {
  const thinksPerBeing = Math.max(1, Math.ceil(ticks / 80));
  return thinksPerBeing * cohortSize * (mode === 'population' ? 2 : 1) + 8;
}

function budgetLine(chosen: Chosen): { id: string; limit: number; spent: number; remaining: number } | null {
  const budget = chosen.budget;
  return budget ? { id: budget.id, limit: budget.limit, spent: budget.spent, remaining: budget.remaining } : null;
}

function summarise(result: AbResult): string {
  const a = result.metrics.A;
  const b = result.metrics.B;
  return `plan success ${a.plans.successRate} vs ${b.plans.successRate}, dispersal ${a.dispersal.meanUnits} vs ${b.dispersal.meanUnits}, ${result.traces.length} blind traces`;
}

function trimAnswer(answer: { probeId: string; kind: string; answer: string; leaked: boolean; admittedIgnorance: boolean; grounded: boolean }): unknown {
  return {
    probeId: answer.probeId,
    kind: answer.kind,
    leaked: answer.leaked,
    admittedIgnorance: answer.admittedIgnorance,
    grounded: answer.grounded,
    answer: answer.answer.slice(0, 240),
  };
}
