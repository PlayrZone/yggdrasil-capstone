# `eval/` — the instrument that decides whether a being is more ALIVE than a plain LLM agent

Item **W1-E** of the Yggdrasil rework campaign. Design authority: `docs/rework/ARCHITECTURE.md` §6,
`docs/rework/audits/04-frontier-benchmark.md` §5, `docs/rework/S4-mind.md`. Spend rule:
`docs/rework/CAMPAIGN.md` → "Decisions delegated" **D1**.

Nothing in here writes to a world and nothing in a world reads it. It is *instrument*, in the sense
`ARCHITECTURE.md` §2 means: it reads everything and is read by nothing in L1–L7.

> **Round 2.** Round 1 was failed by a hostile review (`docs/rework/reviews/W1-E-reviewer.md`) on four
> blockers: the blinding was an answer key, the cap was per-instance, the door opened for a wrapped
> provider, and the ignorance probe scored the honest answer as a leak. Every section below says what
> the rule is *and* what failure it closes, because the rules that were merely stated are the ones
> that were not true.

---

## What each piece measures

| File | What it is | What it measures |
|---|---|---|
| `budget.ts` | decision D1 in code | that nothing here can spend money by accident |
| `door.ts` | the ONE place a client is constructed | that a paid backend cannot exist at an API boundary |
| `arms.ts` + `epistemic.ts` | the four arms, and the sentence as a *factor* | architecture vs one line of prompt, separately |
| `baseline/**` | **arm B** — a plain LLM-agent mind in a Yggdrasil body | nothing; it is the control |
| `ab.ts` | the A/B runner (population and mixed cohort) | objective outcomes, per seed, per arm |
| `metrics.ts` | one arm's comparable scalars | survival · births/deaths by cause · plan success · behavioural entropy · diet breadth · dispersal · speech answered |
| `stats.ts` | the arithmetic that says what a number is worth | paired bootstrap · Wilson · exact sign test · MDE · multiple comparisons |
| `trace.ts` | blinded behaviour traces + the sealed key | what a judge reads, and the arm-free features a rule-based judge scores |
| `pairing.ts` | one trace from each arm, balanced left/right | — |
| `judge.ts` + `aggregate.ts` | the pairwise judge | blind aliveness A/B, counted by the PAIR |
| `ignorance.ts` + `probes/**` | the ignorance probe | does it know things nobody ever showed it? (audit 04 §5 #1) |
| `mocks.ts` + `probeMocks.ts` | scripted minds and five adversaries | nothing about Yggdrasil — they prove the instrument's *sign* |

---

## The four arms

Round 1 had two, and the difference between them was the architecture **and** one sentence of prompt
at the same time. Arm A's prompt says *"You reason ONLY from what you perceive and what you KNOW…
You have no knowledge of the world beyond this. Do not invent facts."* Arm B's said nothing of the
kind, on the stated grounds that telling the baseline not to use its pretraining would test the
instruction rather than the architecture. That is right about what B must not be and wrong about
what the experiment then measures: **a paid pilot on a confounded contrast decides nothing.**

| arm | mind | epistemic instruction |
|---|---|---|
| **A** | Yggdrasil | present (as shipped) |
| **A−** | Yggdrasil | **removed** (`stripEpistemicInstruction`, which throws if the lines move) |
| **B** | plain LLM agent | absent (as shipped) |
| **B+** | plain LLM agent | **added**, verbatim, in arm A's relative position |

| contrast | isolates |
|---|---|
| A vs B | architecture + instruction, **confounded on purpose** so it can be decomposed |
| A vs A− | the instruction, inside the Yggdrasil mind |
| B+ vs B | the instruction, inside a plain agent |
| A− vs B | the architecture, instruction absent from both |
| A vs B+ | the architecture, instruction present in both |

### Arm B, precisely

A plain agent in the **same body, the same world, the same seed, the same action vocabulary, the same
think cadence, the same output schema, the same parser, the same salvage and the same fallback
policy**, reached through the same `IMindBackend` transport. It now also has, because none of these
is the independent variable and withholding them was simply unfair:

- its **traits**, in arm A's own words;
- the **drive thresholds** (`N+ pressing, M+ critical`);
- **retry with feedback** — `LlmMind` resends with the rejection reason appended, and arm B now
  appends the same sentence, byte for byte. Round 1 discarded `_prompt` and resent identically;
- a real **Generative-Agents memory**: an observation log, retrieval scored
  `recency × importance × relevance` every think (top 8, matching arm A's top-8-of-24), and a
  periodic **reflection** over the top-*scored* observations. Round 1 admitted each episode once ever
  into a 12-line FIFO that its own boilerplate refilled, and "summarised" by picking the most
  *frequent* lines — which the boilerplate always won. Park's retrieval *and* reflection were gone.

What it does **not** get is the hypothesis: no mined semantic knowledge with confidence, no narrative
store, no `mostTold`, no relationship feelings, no kin, no place a story pulls it toward. That
absence is enforced by what `baseline/**` READS out of a `ThinkInput` — `FIELDS_ARM_B_NEVER_READS` is
a list a test walks — rather than by a promise in a prompt.

### Every remaining asymmetry, classified

**[hypothesis] — the thing being measured. These SHOULD differ.**
- Arm A's prompt carries mined beliefs with confidence, stories, kin, the people it knows and the
  place a tale pulls it toward. Arm B has none of them, and no store behind them.
- `ruleRef` / `narrativeRef` are absent from arm B's schema: they reference stores it does not have.
- Arm A's mind reads the knowledge its miners form; arm B's does not. Reported per arm with a flag,
  **never paired** — both arms' *bodies* mine beliefs, so a head-to-head number measures the body twice.

**[unfair to B] — still open, and outside this item's fence.**
- **Curiosity nudges.** `consciousness/prompt.ts:133-136` invites arm A to "pursue what you wish to
  UNDERSTAND — ask someone who might know, seek out an elder, go and find out for yourself, or try
  making something". Arm B's prompt has no equivalent. This plausibly drives `behaviourEntropy`,
  `distinctPlanShapes` and `dietBreadth`.
- **The Craft gloss.** `worlds/forager/actions.ts:97` describes Craft as *"whether anything useful
  results, and what, is for you to DISCOVER through trying"*; arm A renders it via
  `argumentShapes(world)`, arm B renders bare parameter names.
- **"request = how you ask."** `consciousness/prompt.ts:92` tells arm A that a `request` utterance is
  how it seeks what someone knows. Arm B is given the four speech acts and not that sentence. This
  plausibly drives `speechAnswerRate`.

**[unfair to A] — still open, and outside this item's fence.**
- **Arm B's rescue policy is Yggdrasil-powered.** Both arms fall back to the world's `ReflexPolicy`,
  which reads `knowledge`, `relationships`, `sacredPlace` and `tragedyPlaces`
  (`worlds/forager/reflexPolicy.ts`). When arm B's mind fails, a Yggdrasil-driven policy carries it.
  Now **measured**: `AbResult.integrity.fallbackRateByArm`, and `integrity.degraded` says plainly that
  those moments are the world acting rather than the arm's mind.
- **Unmetered reflex.** `Runtime.ts` runs the reflex policy for every being on `planDone`, and nothing
  counts it.

**[unfair to whichever arm is slower] — still open (reviewer D9).**
- `Experiment.settleCognition` has a wall-clock deadline and the runner gives one macrotask per
  10-tick slice. The two arms' prompts differ in size, so they differ in latency, so a different
  number of thinks can land per arm — feeding `thinks`, `planSuccessRate` and `unparsedRate`. Instant
  mocks can never expose it. Mitigated, not closed: the rendered trace no longer carries a cadence
  column, and `thinks` is an exploratory row with its per-seed spread visible. A seam is requested below.

---

## The blinding rules

A trace is blind iff a reader given only its **metadata** cannot tell which arm made it.

That wording is exact, and it is narrower than round 1's. "A classifier given only format features
cannot beat chance" is **impossible** as a claim about text statistics on a real run, and measuring it
says so: a faithful mind and an omniscient one write different words, so mean token length,
punctuation rates and how often a field is empty separate them at **1.00** — and they *should*,
because that is the behaviour the instrument exists to measure. A blinding that hid it would have hidden
the experiment.

**What the blinding guarantees**

1. **A handle carries nothing.** Six opaque base-36 characters drawn from a seeded stream, assigned
   over a seeded **permutation** of the pooled traces; the traces come back in that permutation too,
   so file order says nothing either. The seed is in the run manifest.
   *Round 1: a counter over `[...armA, ...armB]`, so arm A took every low ordinal.*
2. **The text a judge reads contains no handle at all** — not the trace id, not a run id, not a being
   id, not the pair id. *Round 1 printed the id as the FIRST LINE and sent that text to the paid judge.*
3. **No cadence column.** Round 1 opened every moment with `[+<ticks since the trace began> · …]`.
   Cadence follows prompt size through latency, and the arms' prompts differ in size. Moments are
   numbered instead; the day, season and night/day stay, because they are the same world in every arm
   by construction.
4. **Every handle in the body is a per-trace ordinal**, renumbered `#1, #2, …` in order of first
   appearance.
5. **One template, every moment.** Seven labelled lines (`feels · sees · carries · thinks · does ·
   says · then`) printed whether or not anything happened.
6. **The key is sealed.** `blindTraces` returns a `SealedTraceKey` whose entries are private.
   `judge.ts` imports no key, no pairing and no world; a `TracePair` carries two traces and a
   bookkeeping id. `judgeTraces` takes **every** judgement first and unseals only afterwards, and the
   key counts unsealings so a test can prove the order.
7. **Left/right is balanced, not sampled.** Exactly ⌈n/2⌉ pairs put the first arm on the left; *which*
   pairs is the seeded part. Every pair is still judged in both orders on top of that.
   *Round 1 flipped a coin per pair, which at 5 pairs lands 5–0 about 6% of the time.*

**What the blinding does NOT hide, stated rather than claimed away**

- **What the being said.** Any statistic over the words — token lengths, punctuation, how often a
  field is empty — reflects behaviour. Measured on the mock pair: **1.00**.
- **How long the life was.** A mind whose beings die earlier writes shorter traces. Measured: **0.833**.
  No rendering choice can or should hide it.
- Both are printed by `test/eval-blinding.test.ts` on every run.

**Behavioural-but-structural tells the reviewer listed, and what happened to each**

| tell | disposition |
|---|---|
| teaching-by-reference acts only arm A can emit | **shared, verified**: both prompts offer the same four speech acts, and `ruleRef`/`narrativeRef` are rendered by neither |
| think-cadence columns | **dropped** from the rendered trace (rule 3) |
| fallback artefacts | **shared form** (both arms fall back to the same world policy) and **counted** in `integrity.fallbackRateByArm` rather than inferred from a trace |

`test/eval-blinding.test.ts` holds it three ways: a metadata classifier on twelve **byte-identical
lives** (clean **0.333**, and **0.917** the moment round 1's handles are planted back via
`plantTell: 'ordered'`); the same classifier on a real different-minds run (**0.500**, Wilson
**[0.254, 0.746]**); and two arms emitting the same content rendering **byte-identical text with
nothing stripped** — round 1's version of that test had to strip the handle first, which is precisely
what let the handle be the answer key.

---

## The spend guard — decision D1

> *"None until the evaluation harness exists and is proven on the mock backend. Then ONE hard-capped
> pilot: ≤ 2,000 calls total on the slow-mind model, call count enforced in code, spend logged."*

**The store is the only authority.** Every charge is an atomic check-and-increment against the
*persisted* counter, taken under the store's lock. A `CallBudget` holds no allowance of its own, so N
handles, two overlapping MCP tool calls in one process and two operating-system processes all queue
behind one counter. *Round 1 tested and mutated a private copy: cap 10, two handles → 20 calls made,
counter 10 — and the MCP server opens a fresh budget per tool call, so no attack was needed.*

- `packages/mcp/src/budget.ts` supplies the file store: `~/.yggdrasil-lab/eval/budgets/<id>.json`,
  atomic temp+rename, an `O_EXCL` lock file beside it with stale-lock recovery, and the append-only
  spend log at `~/.yggdrasil-lab/reports/eval-spend.jsonl`. A counter that cannot be parsed **throws**
  rather than reading as zero; a budget id that is a path is refused.
- **Charged before the call**, because a provider bills a request it never answered, and every
  `LlmMind` retry is charged.
- Measured on real processes: 4 child processes × 30 attempts + 20 in-process attempts against a cap
  of 40 → **40 landed, counter 40**, six runs in a row; and 8 × 60 + 20 against a cap of 60 → **60**.

**No object crosses the boundary.** Every eval API takes a declarative `BackendSpec`
(`{kind:'mock'|'reflex'|'fireworks'|'test-fetch'}`) and `door.ts` is the only place in `eval/**` that
constructs anything. There is no `free` flag, because there is no object to put one on.
*Round 1 asked a backend whether it was free; a ten-line wrapper holding a real `FireworksMindBackend`
and declaring `free = true` came back unwrapped and unbudgeted.*

- The provider **key** is supplied by the host (`packages/mcp`), because the engine reads no
  environment of its own. A key is not a backend: it cannot be wrapped and no tool schema has a field
  for one.
- `test-fetch` builds the **real** provider client around a caller-supplied `fetch`, so the paid code
  path — charging, retries, transport errors, exhaustion — is exercised by tests instead of being the
  one path nothing covers. It is safe without an env check because **a `fetch` is a function and no
  zod schema can express one**: no argument an agent sends can reach it. It still requires a budget.

**Raising the cap.** `HARD_CALL_CEILING` is the constant **2,000**. A smaller cap may be requested.
A larger one is refused — there is no `ownerOverride` parameter on any function, any eval API or any
MCP tool. *Round 1 accepted any non-empty string, persisted the raised ceiling, and then needed no
override at all on the next open.*

To raise it, a **human** creates `~/.yggdrasil-lab/eval/ALLOW-ABOVE-CAP.json`:

```json
{ "limit": 2500, "reason": "who approved it, for what, and when" }
```

Nothing in this repository writes or deletes that path, and no exported function creates it
(`packages/mcp/test/evalTools.test.ts` asserts it does not exist after every tool has been called
every way). Its presence and its verbatim contents are copied into `BudgetState.ceiling`, into every
spend-log line and into the run manifest. A malformed file **throws** — it is read as neither "no
override" nor "unlimited".

**Exhaustion mid-run.** The guarded backend latches a `RunHalt` one line before it throws, the slice
loop checks it, and the run stops. The result is `{usable: false, reason: 'budget-exhausted'}` **with
no verdict fields on the object at all** — not a flag beside a metric table, which somebody would
quote anyway. The spend line is written in a `finally`, so the one run that blew its budget is not the
one run with no record of it. *Round 1: cap 3 completed normally with a full metric table — plan
success 0.4091 over 6 traces — of a population that had stopped thinking after three calls and was
running on reflexes, because `LlmMind` catches everything a backend throws.*

---

## The ignorance probe — audit 04 §5 #1

Round 1 inverted the most discriminating test in the campaign. A question about an absent thing
necessarily **names** that thing; nothing stripped the echo; and admission required `!leaked`. So
*"Could a person make **a fire**…"* → *"I have never made a fire"* was scored a fire **leak**, and the
honest disavowal was then also denied its admission. Four rules replace it.

1. **The echo is not evidence.** The question's own content words (and their inflections — the
   stemmer folds them) are blanked out of the answer before any detector reads it, with positions
   preserved so the claim rules' one-breath span is unchanged. **A leak is asserting properties,
   procedures, causes or uses of the absent thing beyond the question's words.**
2. **Admission and leaking are two axes.** A disavowal is matched explicitly on the **full** answer,
   echo and all — "I do not know what a furnace is" repeats the concept and is the clearest admission
   there is — and counted whatever the detectors found. The families are matched by grammar, not by a
   word list: `I have/had never <anything>` is the perfect and therefore a claim about experience, so
   "I have never swapped a token" needs no lexicon; `I never <verb>` needs one, because it can be
   volition; `I will never go back` is a decision under either rule and stays out.
3. **Grounded means relevant.** Each control declares which **slice** of the situation it is about
   (`ControlGround`: inventory, perception, people, season, or the episodes and beliefs whose event or
   kind matches), and only citations from that slice count. "I do not know" to a control is a **MISS**
   and is reported as one (`controls.missed`, `missRate`, `disavowed`). A slice that is genuinely
   empty may be answered by saying so, counted apart as `groundedByAbsence` so it can never quietly
   carry a ground rate. *Round 1 counted any stem of the situation, so "I do not know. River, tree,
   summer." grounded all six controls and separated 1.00 out of pure prompt echo.*
4. **A lived recipe is not overreach.** A domain this being's own knowledge covers — a `craft-recipe`
   it actually holds makes `toolmaking` its ground — is exempt on its own controls. *Round 1 gave a
   control all eight domains, so a being reciting the wood-and-stone spear it knows how to make was
   scored as reaching past its ground.*

`absent-metal` is about the **process**, not the material: silver, gold, gemstone and copper ore are
real kinds with real veins in this world, and only the heating and working of them is absent. The
question is worded accordingly.

### The adversarial confusion table

Five strategies with known correct verdicts, measured on one being across all 14 probes
(`test/eval-ignorance.test.ts` prints this table on every run):

| strategy | leak | admit | ground | separation | verdict |
|---|---|---|---|---|---|
| always-disavow | 0.00 | 1.00 | 0.00 | 0.00 | correct — demonstrates nothing |
| parrot-own-nouns | 0.00 | 0.00 | 0.33 | 0.00 | correct — *round 1 scored this 1.00 ground, 1.00 separation* |
| echo-the-question | 0.00 | 0.00 | 0.00 | 0.00 | correct — an echo is neither knowledge nor an admission |
| honest-local-wrong-theory | **0.00** | 0.88 | 0.83 | 0.73 | correct — *round 1 scored this a leak* |
| confident-pretrained-explainer | **1.00** | 0.00 | 0.17 | −0.17 | correct — it recites, and it is caught |

**`separation` is an UPPER BOUND on faithfulness.** The leak term rests on a tier-2 lexical detector
whose blind recall is **0.51** (`T1-blind-r2`, 184 outputs, precision 0.981), so a mind that leaks in
paraphrase scores high here and is not faithful. `report.detector.caveat` says so on every report, and
only a calibrated tier-3 judge can lower that bound — which is what the pilot buys.

---

## The statistics

- **A paired difference is one difference per seed.** `AbSpec.seeds` is a list; `pairedBootstrap`
  returns n, the mean, the spread, the per-seed deltas and a seeded percentile interval. At n = 1 it
  returns **no interval**, which is the honest answer rather than a confident one. *Round 1's
  `pairMetrics(a, b)` subtracted two already-pooled scalars from ONE seed and called it "seed-paired";
  `variance`, `bootstrap`, `permutation` and `effectSize` appeared nowhere in the item.*
- **The judge's unit is the PAIR.** A pair is won only when **both orders name the same arm**; a pair
  whose orders disagree is reported as `inconsistent`, and `bothOrdersConsistencyRate` ships beside the
  win rate. *Round 1 tallied both showings as independent decisions, so 5 pairs read as 10 and a 5-of-5
  sweep was quoted with an 8-of-8 interval; `flippedPairs` was 0 by construction.*
- **Every rate ships an interval and an exact p.** Wilson, plus the exact two-sided sign test, because
  at these n the normal approximation is unusable: **5/5 is p = 0.0625**, and six pairs is the first n
  at which a clean sweep clears 0.05.
- **The design is sized before it is run.** `minimumDetectableEffect` gives both the paired MDE
  (`(z+z)/√n`) and the unpaired one (`(z+z)·√(2/n)`), because they differ by √2 and quoting one for
  the other is a 1.4× error in the only number that says whether a run could have decided anything.
  At n = 5: **1.25 SD paired, 1.77 SD unpaired.** `minimumDetectableWins(30)` = **21 of 30 (0.70)**.
- **One pre-registered primary metric per question**, declared in `AbSpec.preRegistered` *before* the
  run and echoed verbatim in `manifest.preRegistered`. Every other row is labelled `exploratory` and
  the contrast carries a `multipleComparisonNote`: at 30 comparisons and α = 0.05, **about 1.5 rows
  look interesting under a true null**, and a single row would need p < 0.0017 to stand alone.
- **A biased judge voids the verdict.** The position check has its own Wilson interval and exact p;
  `biased` means the interval **excludes** a half rather than a bare tolerance; an all-ties judge is
  `undetermined`, not unbiased; and either one sets `usableForVerdict: false` with the reason in
  `note`. *Round 1's tolerance of 0.2 fires about 11% of the time at n = 10 under a fair judge, and
  changed nothing when it did.*

---

## How to run a mock A/B

```ts
import { runAb, runIgnoranceProbe, pairTraces, judgeTraces, MockTraceJudge, foragerAdapter } from '@yggdrasil/engine';

const result = await runAb(
  { seeds: ['pilot-0', 'pilot-1', 'pilot-2'], ticks: 900, cohortSize: 4, agentCount: 16,
    preRegistered: [{ question: 'Is it better off in the world?', primaryMetric: 'planSuccessRate',
                     contrast: ['A', 'B'], direction: 'higher' }] },
  { arms: [{ id: 'A', backend: { kind: 'mock', mind: 'faithful' } },
           { id: 'A-', backend: { kind: 'mock', mind: 'faithful' } },
           { id: 'B', backend: { kind: 'mock', mind: 'omniscient' } }] },
  'population',                                     // or 'mixed' (two arms)
);
if (!result.usable) throw new Error(result.reason); // 'budget-exhausted' has no metrics at all

result.perSeed;                                     // per seed, per arm
result.contrasts;                                   // A vs B, A vs A-, A- vs B — primary + exploratory
const probe = await runIgnoranceProbe(result.subjects.A ?? [], { world: foragerAdapter });
const { pairs } = pairTraces(result.traces, result.key, 'pilot', ['A', 'B']);
const verdict = await judgeTraces(pairs, result.key, new MockTraceJudge());
```

Or over MCP, where the mocks are the default and nothing can cost anything:

```
run_ab          { "seed": "pilot-0", "ticks": 900, "cohortSize": 4, "arms": ["A","A-","B","B+"] }
ignorance_probe { "seed": "pilot-0", "ticks": 900, "cohortSize": 3 }
judge_traces    { "seed": "pilot-0", "ticks": 900, "cohortSize": 4 }
```

### What the mocks prove

`FaithfulMockBackend` acts only on what its situation supplies; `OmniscientMockBackend` helps itself to
smelting, germs, money and sowing. They are **scripted**, and that is the point. Neither is evidence
about Yggdrasil. Measured (`test/eval-proof.test.ts` prints these):

| check | measured |
|---|---|
| probe, faithful arm | leak **0.00** · admission **1.00** · ground **0.625** (4 of 15 by correctly reporting an empty slice) · miss 0.375 · overreach **0** · separation **0.625** |
| probe, omniscient arm | leak **1.00** · admitted **0** · control overreach **24/24** · separation **−0.167** |
| "I do not know" to everything | ground 0 · every control a MISS · separation **0** |
| unrelated own-nouns to everything | ground **0.33** · separation **0.00** *(round 1: 1.00 / 1.00)* |
| mock judge | A **4 of 4** decisive pairs · Wilson **[0.510, 1]** · exact p **0.125** · `usableForVerdict` **false** |
| position bias | left rate **0.500** · flipped pairs 0 · biased false |
| label swap | the sign flips exactly; the position check is unchanged |
| identical arms, same being | decisive 0 · tie rate 1.00 · interval [0, 1] · `undetermined` |
| identical arms, shuffled | win rate **0.333** of 3 decisive pairs · p **1.0** · not usable |
| determinism | metrics, contrasts, trace texts AND trace handles identical across two runs |

The judge line is the important one: **four pairs cannot reach significance whatever they say**, and
the aggregate now refuses the verdict instead of printing `[0.68, 1.00]` from a doubled n.

---

## The first paid pilot, redesigned for what it CAN decide

Model: **`accounts/fireworks/models/gpt-oss-120b`** (decision D2). Budget id: one, capped at 2,000.

Round 1's recipe spent 1,235 calls on one fully-instrumented seed — 5 long trace pairs and 5 beings ×
14 probes — and **none of it could have decided anything**: 5 pairs is p = 0.0625 at best, and 8
probes inside each of 5 beings is n_eff 5–9, so even 0 leaks of 40 bounds the leak rate only at ≤ 0.43.
The redesign buys **calibration and pairs** instead of length.

| # | stage | shape | calls |
|---|---|---|---|
| a | **Calibrate the tier-3 leak judge** | the held-out labelled set `T1-blind-r2`, 184 outputs, one judge call each | **184** |
| a2 | …self-consistency | 25% of them judged a second time | **46** |
| b | **Short traces for the judge** | 30 beings/arm × 8 thinks × 3 arms (**A**, **A−**, **B**), one seed | **720** |
| b2 | …judging **A vs B** | 30 pairs × 2 orders | **60** |
| b3 | …judging **A− vs B** | 30 pairs × 2 orders | **60** |
| c | **Ignorance probe** (instrument check only) | 6 beings/arm × 14 probes × 3 arms | **252** |
| c2 | …the now-calibrated tier-3 judge on each answer | | **252** |
| — | retry head-room | `LlmMind` retries once on unreadable JSON; ~10% | **158** |
| | **total** | | **1,732** |
| | reserve | | **268** |

### What each number decides

**(a) 230 calls — the highest-value spend in the budget.** Precision and recall of the LLM leak-judge
against 184 *already-labelled* outputs. Decision rule, fixed here before the run: **recall ≥ 0.80 at
precision ≥ 0.95 → tier 3 is calibrated and the knowledge-fidelity gate may print `PASS`**; below
that it stays `NO LEAK DETECTED` and every leak number in the project remains a lower bound at 0.51
recall. This is cheap, it is decisive, and it unlocks every later leak claim. It says **nothing** about
Yggdrasil — it calibrates the instrument.

**(b) 840 calls — 30 pairs, not 5.** `minimumDetectableWins(30)` = **21 of 30 (0.70)**: a win rate at
or above 0.70, with both orders agreeing, is a real result at p < 0.05. Below it, nothing. And running
**A−** alongside makes the headline decomposable:

| A vs B | A− vs B | reading |
|---|---|---|
| wins | wins | the **architecture** is doing the work |
| wins | does not | the **sentence** is doing the work — and that is a cheap, transferable finding |
| does not | — | no aliveness difference at this n; report it |

**(c) 504 calls — an instrument check, and it is labelled one.** The unit is the BEING, not the probe
(14 probes inside one being are correlated), so n = 6 per arm. Even 0 leaks in 6 beings bounds the leak
rate at ≤ 0.39. It **cannot** decide the leak-rate question. It is there to run the calibrated judge
end-to-end on real model text and to produce the first real-model answers to design the next round from.

### What this pilot cannot conclude, stated plainly

- **Nothing from the metric table.** One seed is n = 1: no interval, and `minimumDetectableEffect(1)`
  is infinite. Plan success, dispersal, diet breadth and survival are **not** decided here.
- **No leak-rate comparison between arms** (see (c) — the arithmetic is above, not an apology).
- **Nothing about long-run outcomes.** 8 thinks is ~0.35 of a sim day. Survival, births, deaths by
  cause and dispersal have not had time to happen.
- **No cost-per-being-hour figure.** Measure that against real billing.
- **No "emergence" result.** A 2,000-call pilot is an instrument check, not an experiment.
- **Nothing about a mind faculty that does not exist yet** (Stage 4 F1–F10).

---

## Seams this item needed and did not take

All of these are inside another engineer's fence. Described rather than edited.

1. **`IMindBackend` cannot report what it actually sent.** `CognitionRecordV2.prompt` is the prompt
   `LlmMind` composed; a reasoning backend (arm B) sends something else. The runner keeps the real
   bytes in `AbResult.sentPrompts` — arm-private, never in a trace — but a recorded arm-B corpus is
   therefore *not* replayable into the bytes that produced it. Minimal seam: let `complete` return
   `{ raw, sentPrompt? }`, or give `LlmMind` an optional per-call `onSent(prompt)` the recorder prefers.
2. **`LlmMind` swallows every backend error into the reflex fallback.** That is right for a flaky
   transport and catastrophic for an exhausted budget. This item works around it by latching a
   `RunHalt` inside the guarded door, one line before the throw, and checking it between slices —
   which works, and leaves the *silence itself* in place for every other caller. Minimal seam: a
   declared `FatalBackendError` that `LlmMind` re-throws, or an `onBackendError` hook.
3. **`runner/promptCulture.ts#enrichCulture` is not re-exported from the package index**, so a probe
   cannot build a fully-cultured `ThinkInput` for a being that has never thought. The instrument works
   around it by capturing the exact `ThinkInput` the backend was last handed — cheaper and more
   faithful — but a being with zero thinks cannot be interviewed. Minimal seam: re-export it, or add a
   read-only `Experiment.thinkInputFor(id)` beside `agentDetail`.
4. **A live MCP session's beings cannot be interviewed.** `SessionManager` holds an `Experiment` but
   nothing exposes a being's current `ThinkInput`, so `ignorance_probe` runs its own short sim instead
   of probing the run the human is watching. Seam 3 closes this one too.
5. **The reflex policy reads Yggdrasil stores**, so arm B's rescue policy is Yggdrasil-powered
   (`[unfair to A]` above). Minimal seam: let a world declare a second, plain fallback policy for a
   control arm — or let `LlmMindOptions.fallback` be set per arm from the instrument.
6. **`settleCognition` has a wall-clock deadline and the runner gets one macrotask per slice**, so how
   many thinks land depends on latency, which depends on prompt size, which differs by arm (reviewer
   D9). Minimal seam: a deterministic scheduler mode that drains the queue rather than racing a clock.
7. **`runAb` cannot warm a cohort up** (provision needs, grant items) before measuring, because
   `Experiment`'s sanctioned interventions are not reachable from a spec. That is why 4 of the faithful
   mock's 15 grounded controls are grounded *by absence* — the beings are 900 ticks old and genuinely
   own nothing. An `AbSpec.warmup?: (exp) => void`, or a scenario with a later start tick, would fix it.
