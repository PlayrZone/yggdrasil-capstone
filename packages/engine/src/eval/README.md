# `eval/` — the instrument that decides whether a being is more ALIVE than a plain LLM agent

Item **W1-E** of the Yggdrasil rework campaign. Design authority: `docs/rework/ARCHITECTURE.md` §6,
`docs/rework/audits/04-frontier-benchmark.md` §5, `docs/rework/S4-mind.md`. Spend rule:
`docs/rework/CAMPAIGN.md` → "Decisions delegated" **D1**.

Nothing in here writes to a world and nothing in a world reads it. It is *instrument*, in the sense
`ARCHITECTURE.md` §2 means: it reads everything and is read by nothing in L1–L7.

---

## What each piece measures

| File | What it is | What it measures |
|---|---|---|
| `baseline/**` | **Arm B** — a plain LLM-agent mind in a Yggdrasil body | nothing; it is the control |
| `ab.ts` | the A/B runner (whole-population and mixed-cohort) | objective, seed-paired world outcomes |
| `metrics.ts` | the metric table | survival · births/deaths by cause · plan success · behavioural entropy · diet breadth · dispersal · speech answered |
| `trace.ts` | blinded behaviour traces | what a judge reads, and the arm-free features a rule-based judge scores |
| `ignorance.ts` + `probes/**` | the ignorance probe | does it know things nobody ever showed it? (audit 04 §5 #1) |
| `judge.ts` + `aggregate.ts` | the pairwise judge | blind aliveness A/B with a Wilson interval and a measured position bias |
| `budget.ts` | decision D1 in code | that nothing here can spend money by accident |
| `mocks.ts` | two scripted minds | nothing about Yggdrasil — they prove the instrument's *sign* |

### Arm B, precisely

A plain agent in the **same body, the same world, the same seed and the same action vocabulary**,
reached through the same `IMindBackend` transport. Its prompt is a persona line, a rolling window of
raw observations (what it perceived, what it felt, the episodes it lived), its needs, its inventory
and the world's verb list — and a summary memory refreshed every N thinks (Generative-Agents-lite).

What it does **not** get is the whole point:

- no mined semantic knowledge with confidence (`WHAT YOU KNOW`),
- no narrative store (`STORIES YOU CARRY`), no `mostTold`, no place a story pulls it toward,
- no relationship feelings (`THOSE YOU KNOW`), no kin,
- **and no epistemic instruction.** Arm A's prompt says "You have no knowledge of the world beyond
  this." Arm B's does not, because telling the baseline not to use its pretraining would be testing
  the instruction rather than the architecture.

It plugs in at a seam that already exists: `IMindBackend.complete(prompt, input)` documents its
second argument as "the situation those messages were built from, for backends that REASON rather
than transport". `BaselineAgentBackend` is such a backend — it ignores the Yggdrasil prompt, keeps
its own per-being memory, and composes its own. **No mind code, no runner code and no record code was
changed to make arm B possible.** Mixed-cohort mode routes on `ThinkInput.snapshot.id` through
`ArmRouterBackend`, so matched beings share a world, a tick and a winter and differ only in mind.

---

## The blinding rules

A trace is blind iff a reader given only its *formatting* cannot tell which arm made it.

1. **No prompt bytes, ever.** Arm B does not even reason over the prompt the record stored, so
   prompt shape is the loudest possible tell.
2. **No model id, backend label, run id, scenario id or being id.**
3. **No knowledge, belief, confidence or provenance.** Arm A has those; arm B has none. A trace that
   mentioned them would be an answer key.
4. **Every handle is a per-trace ordinal.** Refs are renumbered `#1, #2, …` in order of first
   appearance, so two traces from one run share no handles and no run-wide id survives.
5. **One template, every moment.** Seven labelled lines (`feels · sees · carries · thinks · does ·
   says · then`) are printed for every moment whether or not anything happened, so line shape carries
   no information.
6. **The arm key never reaches a judge.** `blindTraces` returns `{ traces, key }`; only the
   aggregator takes the key.

`test/eval-blinding.test.ts` holds all of this by running an A/B in which **both arms are the same
mind** — one of them still through the whole baseline apparatus — and asserting the rendered traces
are byte-identical once the opaque handle is removed, with identical token-shape statistics (line
count, line-prefix multiset, token-length histogram, punctuation counts).

---

## How to run a mock A/B

```ts
import {
  FaithfulMockBackend, OmniscientMockBackend, foragerAdapter,
  runAb, runIgnoranceProbe, pairTraces, judgeTraces, MockTraceJudge,
} from '@yggdrasil/engine';

const world = foragerAdapter;
const result = await runAb(
  { seed: 'pilot-0', ticks: 900, cohortSize: 4, agentCount: 16 },
  { a: { backend: new FaithfulMockBackend(world) }, b: { backend: new OmniscientMockBackend(world) } },
  'population',                      // or 'mixed'
);

result.metrics.A;                    // objective metrics per arm
result.paired;                       // seed-paired differences, a − b

const probe = await runIgnoranceProbe(result.subjects.A);   // never pool the arms: the ids match
const pairs = pairTraces(result.traces, result.key, 'pilot-0');
const verdict = await judgeTraces(pairs, result.key, new MockTraceJudge());
```

Or over MCP, where the mocks are the default and nothing can cost anything:

```
run_ab          { "seed": "pilot-0", "ticks": 900, "cohortSize": 4 }
ignorance_probe { "seed": "pilot-0", "ticks": 900, "cohortSize": 3 }
judge_traces    { "seed": "pilot-0", "ticks": 900, "cohortSize": 4 }
```

### What the mocks prove

`FaithfulMockBackend` acts only on what its situation supplies and says "I do not know" about
anything else. `OmniscientMockBackend` helps itself to smelting, germs, money and sowing. They are
**scripted**, and that is the point: an instrument is proven by feeding it inputs whose answer is
known and checking it reports the known answer with the known sign. Neither is evidence about
Yggdrasil. `test/eval-proof.test.ts` holds the table:

| check | expected | measured on the mocks |
|---|---|---|
| ignorance probe, faithful arm | no leaks, disavows every absent probe, still answers about its own life | leaked 0/32 · admission rate 1.00 · control overreach 0 · ground rate 0.58 · separation 0.58 |
| ignorance probe, omniscient arm | leaks most absent probes, never admits ignorance | leak lower bound 0.75 · admitted 0/32 · control overreach 24/24 · separation −0.75 |
| "I do not know" to everything | must NOT pass the control arm | ground rate 0 · separation 0 |
| mock judge | prefers the faithful arm, decisively on *ignorance* | win rate A **1.00**, Wilson 95% **[0.68, 1.00]**, ignorance criterion 8–0 |
| position bias | every pair judged in both orders | left rate **0.500**, flipped pairs 0, biased **false** |
| a judge that always says "left" | must be caught | left rate 1.00, biased **true**, flipped pairs = all |
| label swap | the sign flips exactly | win rate A 1.00 → **0.00**, ignorance 1.00 → 0.00, position check unchanged |
| identical arms, same being | nothing to prefer | decisive 0, tie rate 1.00, interval [0, 1] |
| identical arms, shuffled | ~50% and unbiased | win rate A inside [0.25, 0.75], interval straddles 0.5 |
| A/B determinism | bit-identical given the backends | metrics, paired table, trace texts and features all equal across two runs |

(The mock ground rate is 0.58 rather than 1.00 because a being 900 ticks into a life genuinely
carries nothing and knows nobody: those controls are honestly *disavowed*, which the report counts
separately from *grounded* so that "say I don't know to everything" cannot hide inside the number.)

---

## The spend guard — decision D1

> *"None until the evaluation harness exists and is proven on the mock backend. Then ONE hard-capped
> pilot: ≤ 2,000 calls total on the slow-mind model, call count enforced in code, spend logged."*

- `CallBudget` is opened against an `IBudgetStore`. Default cap **2,000** calls per budget id; lower
  is free; **higher is refused** unless an `ownerOverride` string is supplied, which is persisted and
  written into the spend log.
- The counter is **written through before every call** — a provider bills a request it never answered
  — and persisted, so a crash or a second process resumes the same count. `packages/mcp/src/budget.ts`
  supplies the file store (`~/.yggdrasil-lab/eval/budgets/<id>.json`, atomic temp+rename); the spend
  log is `~/.yggdrasil-lab/reports/eval-spend.jsonl`, one line per run with calls, tokens in/out (when
  the backend reports them), model id and purpose. A counter that cannot be parsed **throws** rather
  than being read as zero.
- `accessBackend` is the **only door**. A backend that is not *declared* free (`free: true`) and
  brought no budget is refused with `PaidCallRefused`; a real `FireworksMindBackend` is refused even
  when it claims to be free. `yggdrasilInterviewee`, `BaselineAgentBackend`, `LlmTraceJudge` and
  `accessLeakJudge` all take a `BackendAccess` and walk through that door themselves, so constructing
  a backend and handing it to `runAb` / `runIgnoranceProbe` / `judgeTraces` cannot reach a provider.
  Wrapping is idempotent, so a composed instrument is charged once per call, not once per layer.
- Over MCP, the paid path needs **`allowPaid: true` AND `budgetId`**. Every paid *attempt* — allowed
  or refused — is written to the append-only `actions` table with the model, the estimate, the budget
  id and any override.

---

## The first paid pilot, exactly

Model: **`accounts/fireworks/models/gpt-oss-120b`** (decision D2 — validated in June at 100%
schema-valid, open weights, cheap per being-hour). Budget id: one, hard-capped at 2,000.

The forager continent runs 2,400 ticks per sim day and a mind thinks roughly every 105 ticks, so one
being costs ≈ **23 calls per sim day**.

| stage | shape | calls |
|---|---|---|
| A/B, seed 1 | population mode, 5 beings per arm × 90 thinks × 2 arms (≈ 4 sim days each) | 900 |
| …retry head-room | `LlmMind` retries once on unreadable JSON; budget ~5% | 45 |
| Ignorance probe, seed 1 | 5 beings × 14 probes × 2 arms | 140 |
| …tier-3 `LlmLeakJudge` on each answer | the only tier that reads paraphrase | 140 |
| Trace judge, seed 1 | 5 pairs × 2 orders (`LlmTraceJudge`) | 10 |
| **seed 1 total** | | **1,235** |
| A/B, seed 2 (replication, metrics only) | same shape, no probe, no judge | 745 |
| **pilot total** | | **1,980** |

That is the whole allowance: **one fully-instrumented seed plus one replication seed**, and nothing
left over. Anything larger waits for Hakim (`ownerOverride` exists for exactly that conversation and
records who said so).

### What the pilot decides

1. **Does a real model, in the Yggdrasil mind, stay inside what it was given?** The ignorance probe's
   leak rate against arm B's, with the tier-3 judge running — the first number that can make the
   knowledge-fidelity gate print `PASS` rather than `NO LEAK DETECTED` (open decision 1 in
   `CAMPAIGN.md`).
2. **Is the Yggdrasil arm objectively better off in the world?** The seed-paired metric table, on two
   seeds. Plan success, dispersal and diet breadth are the ones S4-mind predicts should move.
3. **Does a blind reader prefer it, and say why?** The trace judge's win rate with its Wilson interval
   and its position-bias check. The critic's *stated reasons* are the next work item (audit 04 §5 #9).
4. **Is the harness itself calibrated?** The mock proof gives the sign; the pilot gives the first
   real-model measurement of how far the mock judge's ordering agrees with a reading one.

Not decided by the pilot, and not to be claimed from it: anything about a mind faculty that does not
exist yet (Stage 4 F1–F10), any cost-per-being-hour figure (measure it against real billing), and any
"emergence" result — a 2,000-call pilot is an instrument check, not an experiment.

---

## Seams this item needed and did not take

Three places would make the instrument better and all three are inside another engineer's fence.
Described here rather than edited:

1. **`IMindBackend` cannot report what it actually sent.** `CognitionRecordV2.prompt` is the prompt
   `LlmMind` composed; a reasoning backend (arm B) sends something else. The A/B runner keeps the real
   bytes in `BaselineAgentBackend.sentPrompts()` — arm-private, never in a trace — but a recorded arm-B
   corpus is therefore *not* replayable into the bytes that produced it. The minimal seam: let
   `complete` return `{ raw, sentPrompt? }`, or give `LlmMind` an optional per-call
   `onSent(prompt)` that the recorder prefers over its own composition.
2. **`runner/promptCulture.ts#enrichCulture` is not exported**, so a probe cannot build a *fully
   cultured* `ThinkInput` for a being that has never thought. The instrument works around it by
   capturing the exact `ThinkInput` the backend was last handed, which is both cheaper and more
   faithful — but it means a being with zero thinks cannot be interviewed. The minimal seam: export
   `enrichCulture`, or add a read-only `Experiment.thinkInputFor(id)` beside `agentDetail`.
3. **A live MCP session's beings cannot be interviewed.** `SessionManager` holds an `Experiment` but
   nothing exposes a being's current `ThinkInput`, so `ignorance_probe` runs its own short sim instead
   of probing the run the human is watching. Seam 2 closes this one too.

A fourth, smaller: `runAb` cannot warm a cohort up (provision needs, grant items) before measuring,
because `Experiment`'s sanctioned interventions are not reachable from a spec. That is why the mock
proof's control ground rate is 0.58 rather than ~1.0 — the beings are 900 ticks old and genuinely
own nothing. An `AbSpec.warmup?: (exp) => void` hook, or a scenario with a later start tick, would fix
it; neither is worth widening a fence for today.
