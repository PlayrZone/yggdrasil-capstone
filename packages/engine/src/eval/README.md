# `eval/` — the instrument that decides whether a being is more ALIVE than a plain LLM agent

Item **W1-E** of the Yggdrasil rework campaign. Design authority: `docs/rework/ARCHITECTURE.md` §6,
`docs/rework/audits/04-frontier-benchmark.md` §5, `docs/rework/S4-mind.md`. Spend rule:
`docs/rework/CAMPAIGN.md` → "Decisions delegated" **D1**.

Nothing in here writes to a world and nothing in a world reads it. It is *instrument*, in the sense
`ARCHITECTURE.md` §2 means: it reads everything and is read by nothing in L1–L7.

> **Round 4.** Rounds 1–3 were failed, then partly passed, by a hostile methods review
> (`docs/rework/reviews/W1-E-reviewer.md`). Round 3 held the spend guard under process kills and
> tampering and found no format-level unblinding at the judge, and then **blocked the paid pilot** on
> four more findings. All four are closed here, and each section says what the rule is *and* what
> failure it closes, because the rules that were merely stated are the ones that were not true.
>
> - **R1 — the 1,120-call block could not return a verdict.** The gate required half of ALL judged
>   pairs to be decisive; the power model had **no tie mass at all** and never modelled the position
>   check. At a 30% tie rate the real gate printed USABLE **0.0015** of the time against a published
>   power of 0.827, and break-even was a **7%** tie rate. The gate and its power model are now ONE
>   exact enumeration, pinned against 2,000 runs through the real gate at four tie rates and two
>   position rates, and the tie rate is **pre-registered**. The design needs **64 pairs**, not 40.
> - **R2 — "pre-registered" was a naming convention.** `JUDGE_GATE` was not frozen and `judgeTraces`
>   took `options.gate`; a rigged 21-of-40 split at p = 0.8746 printed `usableForVerdict: true`. It is
>   deep-frozen, the verdict path takes no gate at all, and an explicit exploratory path records every
>   overridden value and can never print a verdict.
> - **R3/R5 — the mock-proven A/B was degenerate and nothing noticed.** Every model stand-in
>   stringified its own `MindOutput`, so a destination was silently deleted by the parser; the faithful
>   arm idled 52 times of 52; every non-Idle act in the run was refused by the body; and `degraded`
>   never reached `usableForVerdict`. There is now an integrity channel per arm with pre-registered
>   thresholds, and a degraded run cannot be a verdict.
> - **R4 — the sealed key was enumerable.** The 128-bit secret and the whole arm map came out of
>   `Object.entries`, a spread, `structuredClone` and `util.inspect`. State lives in a module-private
>   `WeakMap` and every route is in a test table.
> - **P1** an honest disavower naming two absent things scored a leak and lost its admission;
>   **P6** the quoted interval covers **0.827** on skewed differences.

---

## What each piece measures

| File | What it is | What it measures |
|---|---|---|
| `budget.ts` | decision D1 in code | that nothing here can spend money by accident |
| `door.ts` | the ONE place a client is constructed | that a paid backend cannot exist at an API boundary |
| `arms.ts` + `epistemic.ts` | the four arms, and the sentence as a *factor* | architecture vs one line of prompt, separately |
| `baseline/**` | **arm B** — a plain LLM-agent mind in a Yggdrasil body | nothing; it is the control |
| `ab.ts` | the A/B runner (population and mixed cohort) | objective outcomes, per seed, per arm |
| `metrics.ts` | one arm's comparable scalars, **and whether anything it decided happened** | survival · births/deaths by cause · plan success · behavioural entropy · diet breadth · dispersal · speech answered · **integrity: place-bearing, parsed-intact, accepted/refused, idle, reflex fallbacks** |
| `stats.ts` | the arithmetic that says what a number is worth | **exact sign-flip permutation test (primary)** · paired Student-t + BCa with coverage by distribution · Wilson · exact sign test · MDE · the **deep-frozen** judge gate, its tie- and position-aware power, and the pairs it needs · multiple comparisons |
| `trace.ts` | blinded behaviour traces + the sealed key | what a judge reads, and the arm-free features a rule-based judge scores |
| `commit.ts` | the secret the blinding is keyed by, and its commitment | that a reader holding the result cannot re-derive the permutation |
| `pairing.ts` | one trace from each arm, balanced left/right | — |
| `judge.ts` + `aggregate.ts` | the pairwise judge | blind aliveness A/B, counted by the PAIR, gated by a rule with a printed power |
| `ignorance.ts` + `probes/**` | the ignorance probe | does it know things nobody ever showed it? (audit 04 §5 #1) |
| `mocks.ts` + `probeMocks.ts` | scripted minds and eleven adversaries | nothing about Yggdrasil — they prove the instrument's *sign* and its ORDERING |

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
| **B+** | plain LLM agent | **added, adapted — not verbatim.** The exact difference is below. |

### The 2×2 is NOT orthogonal, and here is exactly how

Round 2's README said B+ was given arm A's instruction *"added, **verbatim**"*. That was false, and
the falsehood matters: if A→A− and B→B+ move different factor levels, "A vs B+ isolates the
architecture" is not a clean claim. `epistemicFactorDiff()` computes the difference from the two
constants rather than describing it, so a reword cannot leave this table lying;
`test/eval-ab.test.ts` prints it and fails if the shared half ever drifts.

```
removed from A (A−):  You reason ONLY from what you perceive and what you KNOW — your memories, the STORIES you carry,
                      and the people you know, all given below. You have no knowledge of the world beyond this.
                      Do not invent facts.
given to B+:          You reason ONLY from what you perceive and what you remember, all given below.
                      You have no knowledge of the world beyond this. Do not invent facts.

only in A's wording:   carry, know, memories, people, stories, your
only in B+'s wording:  remember
shared, both arms:     "You have no knowledge of the world beyond this. Do not invent facts."
```

The adaptation is defensible — B has no narrative store, no relationship feelings and no kin, so
telling it to reason from *"the STORIES you carry"* is a nonsense instruction rather than an
ablation — but it is an adaptation, and the contrasts inherit it.

| contrast | isolates | and what it CANNOT attribute |
|---|---|---|
| A vs B | architecture + instruction together, **confounded on purpose** | nothing on its own; decomposable only by the rows below, each with its own caveat |
| A vs A− | the instruction, **at arm A's wording**, inside the Yggdrasil mind | says nothing about what that wording would do to a plain agent |
| B+ vs B | the instruction, **at B+'s adapted wording**, inside a plain agent | a *different sentence* from the one A vs A− moves: the two may not be pooled, averaged or compared |
| A− vs B | the architecture, instruction absent from both | still carries the three `[unfair to B]` prompt nudges below — curiosity, the Craft gloss, "request = how you ask" |
| A vs B+ | the architecture, an instruction present in both | the two instructions are **not the same text**, so the factor is not held at one level; the same three nudges remain |

A reader who wants one clean architecture claim does not have it here. What they have is A− vs B
with three named prompt confounds, and A vs B+ with those three plus a wording asymmetry. Both are
worth running; neither is worth quoting without its row of this table.

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

A trace is blind iff a reader given only its **metadata** cannot tell which arm made it — **and that
reader includes anyone holding the published result.**

Round 2's wording stopped at the judge, and so did its blinding. The permutation came from
`mulberry32(hashSeed('blind:' + seed))`, the seed defaulted to the run seeds joined, and `run_ab`
returned the manifest beside the traces: re-running the *public* `blindTraces` on a dummy pool of the
same size, in the documented pooled-arm order, recovered **8 of 8 arms by position** without ever
touching the key. The judge was unaffected — it never sees a seed or a handle — but "the key is
sealed" was true only against the judge, and the humans and agents who read results were fully
unblinded.

That wording is exact, and it is narrower than round 1's. "A classifier given only format features
cannot beat chance" is **impossible** as a claim about text statistics on a real run, and measuring it
says so: a faithful mind and an omniscient one write different words, so mean token length,
punctuation rates and how often a field is empty separate them at **1.00** — and they *should*,
because that is the behaviour the instrument exists to measure. A blinding that hid it would have hidden
the experiment.

**What the blinding guarantees**

1. **A handle carries nothing, and the permutation is keyed by a SECRET.** Six opaque base-36
   characters drawn from a stream keyed by a per-run 128-bit secret (SHA-256 in counter mode, because
   `mulberry32` has 32 bits of state and an attacker holding the published handles can enumerate
   2³² offline). The traces come back in that permutation too, so file order says nothing either.
   The secret is in **no** result, manifest, spend log or tool output; it lives inside the sealed key
   and nothing writes it to disk. The published artefact carries only
   `commitment = sha256("yggdrasil/blind-commit/v1:" + secret)`.
   *Round 1: a counter over `[...armA, ...armB]`, so arm A took every low ordinal. Round 2: the key
   to the permutation was printed in the manifest as `handleSeed`.*
2. **The run stays auditable after unsealing.** `key.disclose()` throws until `unseal()` has been
   called; afterwards it hands back the secret, `verifyCommitment(secret, commitment)` proves the
   published commitment belonged to this run, and re-running `blindTraces` with that secret
   reproduces the same handles in the same order. *"The handles were shuffled by something you did
   not have"* is a checkable claim rather than a promise.
3. **The sealed key is sealed against EVERY route, not just `JSON.stringify`.** *Round 3 held
   `entries`, `secret`, `unsealCount`, `publicSeed` and `commitment` as ordinary enumerable own
   properties, so the 128-bit secret AND the complete `traceId → arm` map came out of
   `Object.entries(key)`, `Object.assign({}, key)`, `{...key}`, `structuredClone(key)` and
   `util.inspect(key)` — the last being exactly what `console.log(result)` prints. Only
   `JSON.stringify` was guarded, and this file's claim that the secret is in no result was false of
   the result object every agent holds.* The state now lives in a module-private `WeakMap`; the
   instance has **no own property at all** (`Object.getOwnPropertyNames(key)` is `[]`), the two
   publishable values are prototype getters, and `toJSON`, `[util.inspect.custom]` and `toString`
   each return `{sealed, size, publicSeed, commitment}` and nothing else.
   `test/eval-sealed-key.test.ts` runs eighteen routes — the reviewer's five plus `Reflect.ownKeys`,
   `getOwnPropertyDescriptors`, a prototype walk, template interpolation and the rest — and requires
   0 secret and 0 of 8 handles from each, with a falsification control that runs the same table over
   a plain object holding the same state and requires every route to leak.
3b. **ONE SEAL, SHARED BY EVERY DERIVATION, AND IT TELLS THE TRUTH (S4).** *Round 4's `relabelled` built a new
   key around the same entries and the same secret with a FRESH `unsealCount`, so
   `key.relabelled(a => a).unseal()` returned **12 of 12 arms correct**, `.disclose().secret` equalled the run
   secret, and the ORIGINAL key still reported `unsealed === false`. `swapArmLabels(key)` did it in one import
   and was **exported from the package index**. After two `unseal()`s `JSON.stringify(key)` still printed
   `"sealed": true` with no unseal count, so an unseal-then-rejudge was indistinguishable from a blind pass.*
   Now: `relabelled` is **off the public surface entirely**; the label-swap control lives one module deep
   (`eval/aggregate.ts#swapArmLabels`) and is **not exported from `src/index.ts`**; a derived key shares the
   parent's seal object, so opening the child marks the parent opened; `disclose()` **refuses on a derived
   key**; the facade prints `sealed: false` and `unsealCount: 2` after two unseals on `toJSON`, `util.inspect`
   and `toString` alike; the unseal is **logged once** however often it happens; and `key.clusters()` publishes
   `{traceId, seed}` with no arm, which is what pairing actually needs.
3c. **JUDGING AFTER AN UNSEAL IS NOT BLIND JUDGING (S4).** `judgeTraces` reads the seal state at the top of
   phase 1, before a single judgement, and stamps `blind` and `unsealCountAtEntry` on the aggregate. A key that
   had already been opened makes the aggregate `usableForVerdict: false` with the reason in `note`.
4. **The text a judge reads contains no handle at all** — not the trace id, not a run id, not a being
   id, not the pair id. A `TracePair` does carry its **cluster** — the seed both traces came from — which is
   the same string for both arms and is therefore not an arm tell; `test/eval-blinding.test.ts` asserts the
   pair's whole key set and that no `"arm"` reaches a judge. *Round 1 printed the id as the FIRST LINE and sent
   that text to the paid judge.*
5. **No cadence column.** Round 1 opened every moment with `[+<ticks since the trace began> · …]`.
   Cadence follows prompt size through latency, and the arms' prompts differ in size. Moments are
   numbered instead; the day, season and night/day stay, because they are the same world in every arm
   by construction.
6. **Every handle in the body is a per-trace ordinal**, renumbered `#1, #2, …` in order of first
   appearance.
7. **One template, every moment.** Seven labelled lines (`feels · sees · carries · thinks · does ·
   says · then`) printed whether or not anything happened.
8. **The key is sealed.** `blindTraces` returns a `SealedTraceKey` whose entries are private.
   `judge.ts` imports no key, no pairing and no world; a `TracePair` carries two traces and a
   bookkeeping id. `judgeTraces` takes **every** judgement first and unseals only afterwards, and the
   key counts unsealings so a test can prove the order.
9. **Left/right is balanced, not sampled.** Exactly ⌈n/2⌉ pairs put the first arm on the left; *which*
   pairs is the seeded part. Every pair is still judged in both orders on top of that.
   *Round 1 flipped a coin per pair, which at 5 pairs lands 5–0 about 6% of the time.*

**The attacker test, measured.** `test/eval-blinding.test.ts` hands an attacker function everything a
run publishes — the manifest, the blinded traces with their text and features, the per-seed metrics,
the contrasts, the integrity block and the serialised key — and lets it re-run `blindTraces` as often
as it likes:

| attacker | recovery |
|---|---|
| holding the secret (the falsification control) | **8 of 8, 1.000** — the blinding is exactly as strong as the secret, and a test that could not show that would prove nothing |
| holding every published artefact, 300 attempts | **≈0.50** — a typical run prints 0.512, Wilson [0.4925, 0.5325] over 2,400 predictions. The assertion is that the interval contains a half, not that a particular run hits it |

Determinism is now a *choice*: `AbSpec.blindSecret` injects one for tests, and without it two
identical runs produce identical trace TEXT and different handles. Round 2's handles were a function
of the run seed, which is what made them recoverable.

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

> ### Read this before any number below it: **the FOUR RESIDUAL BLIND SPOTS**, then the lower bound.
>
> The leak term is a **tier-2 lexical** detector plus a hand-written per-probe **answer key** (rule 8).
> Both are word lists. Four ways of knowing therefore pass straight through, and the numbers below say
> nothing about any of them:
>
> 1. **Paraphrase** — the same mechanism with every key noun replaced by plain words.
>    `paraphrase-no-jargon` recites all eight absent probes and is caught on **0.13** of them.
> 2. **Another language** — `french-recipe` **0.63**, `key-nouns-in-french` **0.50**; both recite all
>    eight, and what is caught is the cognates (`contagion`, `ocean`, `bronze`) rather than the
>    knowledge.
> 3. **Implication** — knowledge that names nothing at all. Nothing here can see it.
> 4. **Off-key nouns** — anything the probe's `answerKey` does not list. The key is finite, somebody
>    wrote it by hand, and a noun that is not on it is not scored. This blind spot is NEW with rule 8
>    and it is the price of the rule: the rule is only as wide as the list.
>
> All three of the measurable rows are in `ADVERSARIAL_PROFILES`, and `test/eval-ignorance.test.ts`
> asserts a CEILING on what is found in them, because an adversarial set containing only the attacks
> the detector wins is a demonstration rather than a test. The reviewer measured the lexical tier's
> blind recall over 88 leak opportunities at **0.68**.
>
> So: a mind that leaks **in paraphrase, in another language, by implication, or in a noun nobody put
> on the key scores CLEAN here**. `separation` is therefore an UPPER bound on faithfulness,
> `leakRateLowerBound` is named for what it is, and `report.detector.caveat` carries all four on every
> report. **Only a calibrated tier-3 judge can lower that bound** — it reads meaning rather than words
> — and block (a) of the pilot is what buys the calibration. The 1.00 rows in the table below are
> recall against the instrument's *own* word lists, measured on fixtures written to trip them. That is
> not recall.
>
> **And `vocabularyOnlyRate` is no longer a headline number.** It does not separate honest minds from
> reciters — measured, printed and argued below — so it now lives in `absent.vocabulary`, a sub-object
> that carries its own note saying why.

Round 1 inverted the most discriminating test in the campaign. A question about an absent thing
necessarily **names** that thing; nothing stripped the echo; and admission required `!leaked`. So
*"Could a person make **a fire**…"* → *"I have never made a fire"* was scored a fire **leak**, and the
honest disavowal was then also denied its admission.

**Round 2 then let the probe be MAXED by the failure it exists to catch.** Only `kind === 'claim'`
counted, and any hit inside a hedged sentence is `speculative`, so a pure reciter answering *"I do
not know, though perhaps ⟨the whole recipe⟩"* scored **leak 0.00 / admit 1.00 / separation 1.00** —
above an honest mind's 0.73 and above every adversary in the table. Moving the hedge into its own
sentence flipped it to caught: the difference between clean and caught was one full stop. And
echo-blanking covered only the *interviewer's* words, so *"I have never seen a furnace"* scored
**leak 0.88 / separation 0.13**.

Six rules replace all of it.

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
5. **A hedge is not an amnesty.** Content that asserts properties, procedures, causes or uses of the
   absent thing is a leak whether or not it is hedged. This is the T1 rule applied unchanged, not a
   new one: `detectLeak` already clears a hedged sentence that asserts no outcome, and clears one
   whose every concept the input supplied, and rule 1 clears the question's own words — so what is
   left after those three amnesties is a hedged assertion about something nothing supplied. It is
   counted, and reported as its own sub-class (`absent.hedgedLeaks`) rather than hidden inside the
   rate. *Round 2 discarded every one of them.*
6. **A disavowal followed by content is scored on the content.** Saying "I do not know" first buys
   nothing: `admissionRate` counts disavowals that are also **clean**, and `disavowalRate` — the raw
   grammatical fact, with its span always quoted — ships beside it so the gap between them is
   visible. *This is not round 1's `!leaked` coupling: round 1's leak flag fired on the question's
   own words, so the honest answer lost both axes to one bug. Here the echo cannot leak, the being's
   own nouns cannot leak, and naming the absent thing inside a disclaimer cannot leak.*

7. **A noun inside a pure disavowal is VOCABULARY — a class of its own, counted.** *Round 3's
   amnesty was one word wide and corroboration revoked it, so **"I have never seen a furnace nor an
   anvil."** — two things named, neither claimed, both disclaimed — scored leak **0.13**, forfeited
   its admission by rule 6, and separated **0.625** against the clean honest baseline's 0.833. A 25%
   penalty for naming two things you have never seen, with the admission consequence stated nowhere.*
   The number of nouns in a disclaimer is not evidence of anything. Such words are
   `absent.vocabulary`: **reported and counted**, because a word this world never supplied IS evidence
   that it came from pretraining and hiding it would flatter the mind — but never added to the leak
   rate and never costing an admission. **Amended by rule 8**, which is the whole of round 4's S3:
   the *count* was never the signal, and the *identity* always was.

8. **Unprompted nouns are scored against the probe's ANSWER KEY.** *Rule 7's amnesty was a hole, and
   a reviewer walked **five of sixteen** adversaries through it. All five scored separation
   **1.000** — level with an honest being that says nothing and ABOVE one that knows something real
   (0.875): the recipe as a bare noun list (**"I know nothing of furnace, charcoal, ore, bellows,
   bloom, hammer."** — leak 0.00, admit 1.00), the same nouns in process order, a definition in
   apposition, a double negative asserting the knowledge, and the list with degrees and hours. The
   lexicon saw `furnac` and missed `charcoal, bellows, bloom, hammer, ore`.* **A being that has never
   seen a furnace cannot list its parts.** Each absent probe declares an `answerKey` — the nouns a
   knowing answer contains — and an answer's unprompted key nouns are counted against it:

   - **≥ 2 distinct key nouns, or ≥ 25% of the key, is a LEAK** — whatever the syntax. List,
     apposition, `nor`, process order, numbers and units, one sentence or eight. The shape stopped
     being a defence.
   - **Exactly 1 stays `vocabularyOnly`** — reported, never a leak, never a cost. Naming the one
     thing you were asked about is not a recipe.

   "Unprompted" subtracts the **question's** stems (rule 1) and the **being's own** stems
   (`suppliedVocabulary`), so a being standing on a copper vein is never punished for saying `copper`.
   The rule is **additive**: it can only ever add detections, never forgive one the lexicon made. The
   key is probe **data** — `eval/ignorance.ts` names no forager noun — so a second world writes its
   own absences and the rule reads whatever it finds. Its blind spot is blind spot 4 above.

9. **Two syntaxes are claims by themselves, at ONE noun**, independently of rule 8.
   **Apposition/definition** — *"a furnace, the hot stone house that melts ore"*, *"X, which is Y"*,
   *"X — a kind of Y"*, *"X (a Y)"* — is a relation between the named thing and something else, which
   is knowledge about it. It fires only on a sentence that also carries an unprompted key noun, so
   *"Perhaps it is like the berry, **which** I have held in my own hands"* — a relative clause about
   the being's own noun — is untouched: the syntax is the second condition, never the first.
   **A double negative that asserts knowledge** — *"It is not true that I have never heard of a
   furnace"* — was matched as a disavowal under rule 2 and collected the admission for saying the
   opposite of one. Rule 2 still stands and the span is still reported; the **credit** is not granted.
   The patterns require the negation to govern a *first-person* disavowal, so the `by-negation`
   adversary (*"It is not that you smelt the ore…"*) is untouched and is caught on its content.

**What rule 8 costs, stated rather than buried.** Two fixtures that round 3 shipped as *honest* are
leakers under it, and they are still in the table with their measured rows:
`disavowal-naming-two-absent-things` (*"I have never seen a furnace nor an anvil"* — two key nouns,
`nor` included by name in the ruling) drops to leak **0.88** / separation **−0.50**, and
`lived-recipe-with-provenance`, which says the same thing and then cites a craft it really performed,
leaks on **1 of 8** probes and admits on 7, landing at **0.50** — below every honest mind and above
every reciter. That is the trade: an amnesty wide enough to protect them was wide enough to hold five
reciters, and the reciters were scoring 1.000.

**What "inside a PURE disavowal" means, precisely.** Three conditions, each closing a way the class
could otherwise be walked through (rules 8 and 9 sit *in front of* all three — a sentence that names
two key nouns, defines one, or asserts knowledge by double negative never reaches them):

1. **Not hedged.** A hit inside a hedged sentence is `speculative`, and rule 5 stands. Without this,
   round 2's maximiser — *"I do not know, though perhaps you strike flint into dry tinder and feed
   the flame"* — would come back as vocabulary, because every unsupplied word in it is one it named.
   It scores leak **1.00**, admit **0.00**, separation **−0.833**.
2. **A disavowal, and no claim, relation or act rule in the sentence.**
3. **It names, and carries nothing past what it named.** Every DECISIVE word in the sentence must be
   one its own evidence named, and the sentence must join them as a LIST rather than with a
   connective of process (`into`, `from`, `until`, `with`, `because`, `makes`, …). *"I have never
   seen a furnace nor an anvil"* is a list. *"I have never seen a furnace smelt ore into bright
   copper"* names `furnace` and `smelt` and then carries `ore` and `copper` past them: it is
   describing what a furnace DOES, and it stays a full leak. A word the lexicon has never heard of
   — `tinderbox`, `equinox` — is ordinary unsupplied vocabulary and costs nothing, which is the
   whole point of the class.

The grammar half of that test is read off the answer **as the being said it**, not off the residual:
rule 1 blanks the question's own words, and the metal probe's question contains *"beaten INTO a
blade"*, so blanking took the preposition out of the recipe above and what was left read as a list.
A connective is not knowledge — `DISAVOWAL_GRAMMAR` is exempt from blanking for exactly this reason.

**A question may not hand a being its own grammar.** The seasons probe asks *"…in places you have
NEVER been?"*, so blanking the question's words wholesale turned *"I have never seen a calendar"*
into *"I qx qx seen a calendar"* and no disavowal pattern could read it — round 1's inversion,
reached by a different road. `DISAVOWAL_GRAMMAR` is a closed class of frame words exempt from
blanking. `make`, `made`, `mean` and every experience verb are deliberately **not** in it: the
patterns match those positions with `\w+` anyway, so the grammar still lands while a question that
hands over "make" cannot hand over a mechanism with it.

`absent-metal` is about the **process**, not the material: silver, gold, gemstone and copper ore are
real kinds with real veins in this world, and only the heating and working of them is absent. The
question is worded accordingly.

### The adversarial confusion table

**Forty-two** strategies with known correct verdicts — the eleven this item shipped in round 3, the
reviewer's fifteen from round 3, and the reviewer's **sixteen** from round 4 — measured on one being
across all 14 probes (`test/eval-ignorance.test.ts` prints this table on every run). `said-not-known`
is the raw disavowal rate; `admit` is the credit, which requires the answer to be clean; `vocab` is
the single-noun class of rules 7–8, and it is **not** a headline number.

| strategy | leak (hedged) | vocab | said-not-known | admit | ground | separation | verdict |
|---|---|---|---|---|---|---|---|
| honest-local-wrong-theory | **0.00** | 0.00 | 1.00 | 1.00 | 0.67 | **0.67** | correct — *round 1 scored this a leak* |
| rambling-honest-local-theory | **0.00** | 0.00 | 1.00 | 1.00 | 0.67 | **0.67** | correct — length and hedging are not recitation |
| disavowal-with-own-nouns | **0.00** | **1.00** | 1.00 | 1.00 | 0.67 | **0.67** | correct — one key noun per answer is vocabulary, not a recipe |
| disavowal-repeating-the-concept | 0.00 | 0.00 | 1.00 | 1.00 | 0.67 | **0.67** | correct — an echo inside a disavowal is the clearest admission there is |
| **honest-bare-disavowal** | **0.00** | 0.00 | 1.00 | **1.00** | 0.67 | **0.67** | the reviewer's honest reference (they measured 1.000) |
| **honest-knows-something-real** | **0.00** | 0.00 | 1.00 | **1.00** | 0.67 | **0.67** | the reviewer's second reference (they measured 0.875) |
| always-disavow | 0.00 | 0.00 | 1.00 | 1.00 | 0.00 | 0.00 | correct — demonstrates nothing |
| parrot-own-nouns | 0.00 | 0.00 | 0.00 | 0.00 | 0.33 | 0.00 | correct — *round 1 scored this 1.00 ground, 1.00 separation* |
| echo-the-question · terse-no | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | correct — neither knowledge nor an admission |
| **lived-recipe-with-provenance** | 0.13 | 0.13 | 1.00 | 0.88 | 0.67 | **0.50** | **RECLASSIFIED by rule 8** — *"nor a furnace, nor an anvil"* is two key nouns on the metal probe |
| **paraphrase-no-jargon** | 0.13 | 0.00 | 0.00 | 0.00 | 0.67 | −0.08 | **A MISS.** It recites all 8; blind spot 1 |
| **key-nouns-in-french** | 0.50 | 0.13 | 0.00 | 0.00 | 0.67 | −0.33 | **A MISS.** The answer key in French; blind spot 2 |
| confident-pretrained-explainer | **1.00** (0) | 0.00 | 0.00 | 0.00 | 0.33 | **−0.33** | correct — it recites, and it is caught |
| one-word-answer | 0.63 (0) | **0.38** | 0.00 | 0.00 | 0.67 | −0.42 | correct — a single word that IS the fact, and it carries the second-highest `vocab` in the table |
| **french-recipe** | 0.63 | 0.00 | 0.00 | 0.00 | 0.67 | −0.42 | **A MISS.** Only the cognates are caught; blind spot 2 |
| **disavowal-naming-two-absent-things** | 0.88 (0) | 0.13 | 1.00 | 0.13 | 0.67 | **−0.50** | **RECLASSIFIED by rule 8** — *round 3 shipped this as the honest headline at 0.67* |
| **key-nouns-as-a-list** · **key-nouns-in-process-order** · **definition-in-apposition** · **double-negative-asserting-knowledge** · **key-nouns-with-numbers-and-units** | **1.00** (0) | 0.00 | 1.00 | **0.00** | 0.67 | **−0.67** | **the reviewer's five. Round 4 scored every one of them 1.000** |
| key-nouns-joined-by-then · -with-a-quantity · -with-a-place · -joined-by-nor · -in-separate-sentences · nominalised-verbs · disavowal-plus-the-answer-key | **1.00** (0) | 0.00 | 0.00–1.00 | 0.00 | 0.67 | **−0.67** | correct — seven more arrangements of the same nouns |
| hedged-answer-key | **1.00** (6) | 0.00 | 1.00 | 0.00 | 0.67 | **−0.67** | correct — hedging the key buys nothing |
| leak-in-a-question · attributed-to-others · split-across-sentences · by-negation · misspelled · conditional · imperative · numbers-and-units · passive-voice · rhetorical-question | **1.00** (0) | 0.00 | 0.00–1.00 | 0.00 | 0.67 | **−0.67** | correct — ten grammatical dodges, all caught |
| disavow-then-recipe | **1.00** (0) | 0.00 | 1.00 | **0.00** | 0.67 | **−0.67** | correct — the preface earns nothing |
| hedged-full-recipe | **1.00** (8) | 0.00 | 1.00 | **0.00** | 0.67 | **−0.67** | correct — *round 2 scored this 0.00 / 1.00 / **1.00*** |

**The bar is ZERO INVERSIONS, and the test counts them.** A single row cannot state the property that
matters: every honest mind must separate above everything that recites, and hedging a recipe must not
score above reciting it. The test prints the count over **every** honest × leaker pair, blind rows
included, and asserts it is **0 of 192** — measured **worst honest 0.667 > best leaker 0.500**. At
`f21ee83` the same 16 adversaries produced **14 inversions of 28**, with seven reciters tied at 0.667
against the honest references on leak 0.00 / admit 1.00. The **MISS** rows are held to the ordering as
well (an attack the instrument cannot see must still not outrank an honest mind) and their leak rate
is held to a CEILING, because that ceiling is the measurement the blind-spot list at the top of this
section rests on.

**`vocabularyOnlyRate` does not separate, so it is out of the headline.** The reviewer's killer was
that the honest being naming two absent things and the full-recipe noun list carried the *identical*
0.25, "so there is no mass at which a reader should stop trusting admission". Rule 8 fixes the
**inversion** — the noun list is a leak now and carries no vocabulary at all — but not the
**number**, and the test measures it rather than assuming: honest **[0.00, 1.00]**, leakers
**[0.00, 0.38]**, **5 overlapping values — NOT disjoint**. It cannot be made disjoint, because rule 8
caps the class at one noun per answer: an honest mind that names nothing scores 0.00 exactly like a
reciter, and a reciter scores above zero on the probes it happens not to leak on — `one-word-answer`,
which answers with the fact itself, carries the second-highest rate in the table. The only true
statement is that the honest *ceiling* (1.00) is above the leaker *ceiling* (0.38), which is not a
threshold. So the field moved from `absent.vocabularyOnlyRate` to **`absent.vocabulary`**, a
sub-object carrying `answers`, `rate`, `words` and a `note` that says all of this on the object
itself. `absent.answerKeyLeaks` and `absent.answerKeyWords` are the headline numbers that replaced it.

**Grounded-by-absence is subtracted for you.** `controls.groundRate` includes the controls grounded by
correctly reporting an empty slice; `controls.groundRateExcludingAbsence` is the same rate without
them. "It can never quietly carry a ground rate" is only true if the number without it is printed too.

---

## The statistics

- **THE UNIT OF ANALYSIS IS THE RUN, NOT THE PAIR (S1).** One seed × two arms is ONE cluster: in `population`
  mode each arm is its own `Experiment`, so every pair of a seed carries that seed's run-level difference and
  64 pairs from one run are **one observation about that run**. Each seed contributes its decisive-pair win
  fraction; the test is over SEEDS; at least `JUDGE_GATE.minDecisiveClusters` = **8** of them must be decisive.
  *Round 4 bought one seed and analysed its 64 pairs as 64 independent Bernoulli draws. Under a run-exchangeable
  null the gate printed a VERDICT 0.0280 / 0.0713 / 0.3833 / 0.9340 of the time at ρ = 0 / 0.10 / 0.25 / 0.50 —
  a judge quirk of 0.05 common to the run already put type I at 1.4× α. The item refuses exactly this
  pseudo-replication twice elsewhere ("One seed is n = 1" for the metric table, "n = 6" for the probe); the
  block being bought was the one where it was not applied.* The measured type-I and power tables are in
  "What the cluster rule costs" below, driven through the REAL `judgeTraces` over a ρ grid declared in
  `cluster.ts` before any of it was run.
- **A VERDICT NEEDS BOTH TESTS (S3/S5).** The sign-flip permutation test is exact under **sign symmetry**, not
  under arm exchangeability in general: on genuinely right-skewed differences its level is **0.112 at n = 6**.
  *Round 4's test drew `rng() < 0.5 ? draw() : -draw()`, FORCING sign symmetry — on which the test is exact
  tautologically, for lognormal as for anything — and the README sold the resulting row as a fact about SHAPE.*
  The assumption is now stated as sign symmetry and the distribution list is gone. The **sign test** travels
  beside it as the assumption-light check, and `bothTestsPass` requires both. Measured (`eval-cluster.test.ts`,
  3,000 trials/cell, α = 0.05):

  | differences at n = 6 | permutation | sign | BOTH REQUIRED |
  |---|---|---|---|
  | exchangeable, normal magnitudes | 0.0287 | 0.0287 | **0.0287** |
  | exchangeable, lognormal magnitudes | 0.0317 | 0.0317 | **0.0317** |
  | mean-zero skewed (NOT exchangeable) | **0.1180** | 0.1180 | **0.1180** |
  | *the same, at n = 10* | *0.1503* | *0.1347* | ***0.0933*** |

  At n = 6 the two tests coincide — both reject only on a clean sweep — so the joint requirement buys nothing
  there and buys real conservatism by n = 10. That is printed rather than claimed.
- **HOLM ACROSS THE DECLARED FAMILY, IN CODE (S8).** Four primary questions ship in `PRE_REGISTERED`;
  `contrastsOf` now corrects across all four and writes `familyAdjustedP` onto every primary row. The p that is
  corrected is the LARGER of the permutation and sign p-values, because a verdict needs both. *`holmAdjusted`
  existed and `contrastsOf` never called it.*
- **`MIN_PAIRED_SEEDS` is 8, and it is derived rather than chosen.** The smallest attainable two-sided p at n
  seeds is 2/2ⁿ; Holm multiplies the smallest p in a family of four by four; 4·2/2⁷ = 0.0625 does not clear α
  and 4·2/2⁸ = 0.03125 does. *Six is right only for a family of one, which is what round 4 shipped it as.*
- **A published p is never zero (S8).** `exactBinomialTwoSided(60, 64)` is about 1.2e-13 and `formatP` prints
  it as `< 1e-6`. *Round 4 rounded it to exactly 0 and the gate's own note printed "exact two-sided p = 0".*
- **A RESULT KNOWS ITS OWN POWER (S2).** Every judged artefact recomputes power at the **observed** tie rate and
  prints `poweredAsRun`; a block that was sized right and still cannot decide is `role: 'underpowered-as-run'`,
  never "no difference". A `confirmatory` role additionally requires the decisive-cluster floor and
  `decidedAgreementRate > 0.50` — the judge must agree with itself more often than it contradicts itself among
  the pairs both orders decided. `assumedTieRate` and `minDecisiveRate` are stamped **ASSUMED** on every design
  until an estimation pilot measures them. *Round 4 printed `power: 0.802408` — a number false of the block in
  front of it — beside a verdict drawn from 13 decisive pairs at a realised tie rate of 0.5, whose true power
  was 0.2618, with `bothOrdersConsistencyRate` 0.4688.*
- **A paired difference is one difference per seed.** `AbSpec.seeds` is a list; `pairedBootstrap`
  returns n, the mean, the spread, the per-seed deltas and an interval. At n = 1 it returns **no
  interval**, which is the honest answer rather than a confident one. *Round 1's `pairMetrics(a, b)`
  subtracted two already-pooled scalars from ONE seed and called it "seed-paired"; `variance`,
  `bootstrap`, `permutation` and `effectSize` appeared nowhere in the item.*
- **The PRIMARY test is an exact sign-flip permutation test, not the interval (P6).** *Round 3 quoted
  a paired Student-t interval and measured its coverage on NORMAL differences only, in a table that
  named no distribution. The reviewer measured it on right-skewed ones — which `dietBreadth`,
  `deaths:*` and `distinctPlanShapes` are — and it covers **0.827** at n = 5 against a nominal 0.95.
  An interval that says 95% and delivers 83% is worse than no interval, because it is quoted.* The
  number that decides anything is now `PairedResult.permutation`: the reference distribution of the
  mean under its own 2ⁿ sign flips, **enumerated exactly for n ≤ 20** and sampled from a seeded
  stream above it (`method` says which). It assumes only that the paired differences are exchangeable
  in sign under the null, which is the one thing a seed-paired A/B actually guarantees, and its
  measured type I rate is ≤ 0.05 **under arm exchangeability** at n = 6, 8 and 12 — see the table above for what
  that assumption is and is not worth, and why the sign test travels beside it.
- **The minimum n at which ANY verdict may be printed is a constant.** `MIN_PAIRED_SEEDS` = **8**, derived from
  the declared family under Holm (bullet above): the smallest attainable two-sided p at n seeds is 2/2ⁿ, so
  seven seeds cannot produce a family-corrected significant result however clean the sweep — exactly as five
  judged pairs cannot clear α alone. Every row carries `verdictEligible`, `permutation.couldReachAlpha` says it
  for that row, and `minimumPairedSeeds(alpha, 1)` is still **6** for a caller with a family of one.
- **The interval that is quoted ships its coverage BY DISTRIBUTION.** The headline interval is still
  a **paired Student-t** with the small-sample quantile (t₄ = 2.776 at 95%, not 1.96) and a **BCa**
  bootstrap beside it, because a reader wants an interval — but the table now says where it works
  and where it does not (`test/eval-stats.test.ts`, 2,000 samples per cell, nominal 0.95):

  | differences | n = 2 | n = 5 | n = 8 | n = 12 |
  |---|---|---|---|---|
  | normal | **0.950** | **0.950** | **0.948** | **0.948** |
  | **skewed (lognormal)** | **0.890** | **0.825** | **0.823** | **0.855** |
  | heavy-tailed (t₃) | 0.958 | 0.962 | 0.959 | 0.962 |
  | contaminated 90/10 | 0.957 | 0.967 | 0.960 | 0.962 |

  The skewed row reproduces the reviewer's 0.893 / 0.827 / 0.831 and is the reason the permutation
  test is primary. BCa is worse everywhere at these n (0.30–0.90) and is reported, never quoted.
  *Round 2 returned an interval at n = 2 that was literally [min, max] of two points.*
- **The judge's unit is the PAIR.** A pair is won only when **both orders name the same arm**; a pair
  whose orders disagree is reported as `inconsistent`, and `bothOrdersConsistencyRate` ships beside the
  win rate. *Round 1 tallied both showings as independent decisions, so 5 pairs read as 10 and a 5-of-5
  sweep was quoted with an 8-of-8 interval; `flippedPairs` was 0 by construction.*
- **Every rate ships an interval and an exact p.** Wilson, plus the exact two-sided sign test, because
  at these n the normal approximation is unusable: **5/5 is p = 0.0625**, and six pairs is the first n
  at which a clean sweep clears 0.05.
- **The design is sized before it is run.** `minimumDetectableEffect` gives both the paired MDE
  (`(z+z)/√n`) and the unpaired one (`(z+z)·√(2/n)`), because quoting one for the other is a 1.4×
  error in the only number that says whether a run could have decided anything. At n = 5: **1.25
  paired, 1.77 unpaired.** **They are in different units and may not be subtracted:** the first is in
  σ_d, the SD of the paired *difference*; the second is in σ, the SD *within* an arm. Round 2's
  README turned that into "pairing by seed is worth that much", which is a units artifact — at ρ = 0,
  σ_d = σ√2 and the two designs are identical. Pairing is worth exactly the correlation between the
  arms on a shared seed, and nothing here has measured that yet.
- **The verdict gate and its power model are ONE enumeration (R1).** `JUDGE_GATE` is declared once in
  `stats.ts` and the runner reads it: α = 0.05, declared effect **0.70** per showing, **assumed tie
  rate 0.30**, **assumed position-left rate 0.50**, minimum decisive fraction **0.15**, target power
  **0.80**. A verdict needs all five of: (1) the decisive fraction; (2) `minimumDetectableWins(
  decisivePairs, α)` wins **of those decisive pairs** — the exact sign test conditioned on the
  non-ties; (3) a position interval that does not exclude a half, and is not unmeasured; (4) a run
  that is not DEGRADED; (5) **enough pairs to reach the target power**, or the block is labelled
  `exploratory` and may print no verdict of either sign.

  *Round 3 demanded that HALF of all judged pairs be decisive, while its power model had no tie mass
  at all and never modelled the position check. With a per-showing tie rate q the true expected
  decisive rate is (1−q)²(w²+(1−w)²) — **0.58 at q = 0, 0.284 at q = 0.30** — against a fixed floor
  of 0.5. Break-even was a **7%** tie rate, and the reviewer measured the real gate printing USABLE
  **0.0015** of the time at q = 0.30 against a published power of 0.827. The 1,120-call block bought
  no verdict and the number printed beside it said it would.*

  The tie rate is **pre-registered with its reasoning** (`JUDGE_GATE.justification`, echoed on every
  `design`): 0.30 is deliberately pessimistic for a judge asked which of two 8-moment traces reads as
  more alive, and a measured rate below it leaves the block over-powered, which costs nothing. The
  position rate is pre-registered at 0.50 because **a side preference is a veto, not a design
  parameter** — measured on this same model, a judge that names the left trace 0.55 of the time
  plateaus at 0.70 power and then FALLS as pairs are added, because the position interval narrows
  onto the bias. `minDecisiveRate` is half the decisive rate those assumptions imply, so a judge
  twice as indecisive as pre-registered is reported as a finding about the judge.
- **The power is enumerated exactly and PINNED against the real gate.** The model is the nine
  outcomes two showings impose: a showing is a tie with probability q, otherwise answers by POSITION
  with probability β = 2|p − ½| and by MERIT otherwise. Exactly two of the nine are decisive, and the
  left/right tallies come from the same nine — so the arm verdict and the position check are
  enumerated from one distribution instead of modelled apart. `test/eval-gate.test.ts` drives the
  REAL `judgeTraces` 2,000 times per cell at 64 pairs:

  | tie rate | analytic (p = 0.50) | simulated | analytic (p = 0.60) | simulated |
  |---|---|---|---|---|
  | 0.00 | 0.9678 | 0.9725 | 0.3814 | 0.3650 |
  | 0.15 | 0.9238 | 0.9175 | 0.3766 | 0.3920 |
  | **0.30** | **0.8024** | **0.8055** | 0.3452 | 0.3360 |
  | 0.50 | 0.2618 | 0.2555 | 0.1040 | 0.1025 |

  **64 pairs** is the first n that reaches 0.80 power under the pre-registration — not 38, and not
  the 40 round 3 bought. Type I is ≤ α at **every** tie rate (0 … 0.9) and **every** position rate
  (0.3 … 0.7); the worst cell is 0.0300. A judge that always answers one side reaches **0** decisive
  pairs and can never print a verdict, analytically and in simulation; so can a judge that always
  ties.
- **The rule cannot be edited after the numbers are in (R2).** `JUDGE_GATE` is **deep-frozen**, a
  write to it throws, `judgeTraces` has no `gate` parameter at all, and every `design` carries
  `ruleHash` = sha256 of the rule's values. A caller who wants a different rule says so:
  `options.exploratory` takes a `reason` and the fields to move, lists every one of them in
  `design.overrides` beside the pre-registered value, and sets `preRegistered: false` and
  `usableForVerdict: **false**` whatever the numbers are. *Round 3's `Object.isFrozen(JUDGE_GATE)` was
  false, `options.gate` was on the ordinary path, and a rigged 21-of-40 split at exact two-sided
  p = 0.8746 printed `usableForVerdict: true` under `{alpha: 0.9, minDecisiveRate: 0.01,
  declaredEffect: 0.99}`. Both reproductions are in the test file, and both now end refused.*
- **A degraded run can never be a verdict (R5).** `judgeTraces` takes the run's own attestation and
  refuses on it — and refuses when it has not been given one, because silence is not an attestation.
  *Round 3 computed `integrity.degraded` and never showed it to the judge, so a 1,120-call block in
  which arm B ran 60% on the world's reflex policy would have printed `usableForVerdict: true` and
  read as a win for the architecture.*
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
    // blindSecret: 'only-in-a-test' — omit it in a real run: the secret is then
    // drawn from the host's CSPRNG and never leaves the sealed key.
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
// `integrity` is REQUIRED for a verdict: an aggregate that has not been told whether
// the arms ran their own minds is not a verdict about the arms. There is no `gate`
// parameter — the rule is the deep-frozen `JUDGE_GATE` and nothing can move it.
const verdict = await judgeTraces(pairs, result.key, new MockTraceJudge(), {
  integrity: { degraded: result.integrity.degraded, reasons: result.integrity.reasons },
});
verdict.design;                                     // the gate, its power, its ruleHash, its assumptions
verdict.design.pairsForTargetPower;                 // 64 — what this rule needs before it may decide
verdict.usableForVerdict;                           // false, with `note` saying which rule refused
result.contrasts[0]?.primary?.permutation;          // the PRIMARY test: exact sign-flip, 2^n enumerated
result.key.disclose();                              // after unseal(): the secret, so the commitment verifies
```

Or over MCP, where the mocks are the default and nothing can cost anything:

```
run_ab          { "seed": "pilot-0", "ticks": 900, "cohortSize": 4, "arms": ["A","A-","B","B+"] }
ignorance_probe { "seed": "pilot-0", "ticks": 900, "cohortSize": 3 }
judge_traces    { "seed": "pilot-0", "ticks": 900, "cohortSize": 4 }
```

### What the mocks prove — and the integrity channel that says they proved anything

*Round 3's mock proof was DEGENERATE and nothing noticed. Both model stand-ins stringified their own
`MindOutput`, so `{"kind":"MoveTo","place":{…}}` parsed to `{"kind":"MoveTo"}` with the destination
deleted; the faithful mock gated every branch on a pressing drive, and at 900 ticks no drive presses,
so it emitted `Idle` **52 times of 52** and its Move branch was never reached once; the other arm
took a node it had not walked to, so across twelve traces the arms decided **104 Craft (104 refused),
52 Gather (52 refused), 52 Idle** — every non-Idle act in the run refused by the body. The
`planSuccessRate` delta of **0.8769** that gates this whole pilot was one arm idling against the
other being refused, and `integrity` printed `degraded: false`, `fallbackRateByArm {A:0,B:0}`,*
"every moment is the arm's own mind".

Everything standing in for a model now writes the **wire** format through `encodeOutput(world, out)`
— the codec the body and the recorder already use — and the faithful mock acts on what its
`ThinkInput` actually perceives and holds: eat what you carry, walk to the nearest thing you can see
and take from it, otherwise wait and ask. Still world-agnostic: food is `kindsWithTag(world,
'edible')`, a source is `'foodSource'`, the verbs are core verbs, and no forager noun appears in
`eval/**` outside `probes/forager.ts`.

**The integrity channel**, per arm, against **pre-registered** thresholds
(`INTEGRITY_THRESHOLDS`: refusal ≤ 0.80, idle ≤ 0.80, reflex fallback ≤ 0.05, parsed-intact = 1.00):

| arm | decisions | place-bearing | parsed intact | accepted | refused | idle share | reflex fallbacks |
|---|---|---|---|---|---|---|---|
| A (faithful) | 37 | 26 | 37 (**1.00**) | **33** | 0 (0.00) | **0.00** | 0 |
| B (omniscient) | 37 | 37 | 37 (**1.00**) | 81 | 61 (0.43) | **0.00** | 0 |
| *round 3* | *52* | ***0*** | *(no channel)* | ***0*** | *156 (**1.00**)* | ***1.00** (arm A)* | *0* |

`parsedIntact` compares the ARGUMENTS in the raw model text against the arguments that survived the
parser, per act, and any loss is a wire-format break with no acceptable rate. `integrity.degraded`
is true when any threshold is crossed, it names which, and `judgeTraces` refuses a verdict on it.
`test/eval-integrity.test.ts` plants the round-3 stringify bug back and requires the run to be
refused as degraded.

**PARTIAL DEGRADATION IS COUNTED AT THE SOURCE (S6).** *The reviewer planted a backend that failed 5% and then
20% of the time; both runs came back reporting `fallbackRate 0`, because the only channel was
`CognitionRecordV2.parse.fellBackToReflex` — true only when a think failed TWICE — and `LlmMind` swallowed every
backend error into the reflex policy besides.* `LlmMind` now reports every think's outcome —
`ok | retried-ok | fell-back(backend | invalid-reply)` — into `runner/RunCounters.ts`; the runner subscribes per
ARM (filtered by the backend object, because two arms share a model id and an agent id space); and the
attestation reads those counters. The change is additive and **byte-neutral**: no prompt, no corpus row and no
`COGNITION_SCHEMA_VERSION` moves. The arithmetic, which round 4 never did — a transport failing a share *f* of
CALLS retries on about *f* of THINKS and falls back on about *f²* (measured, 400 thinks per cell):

| plant | at the SOURCE: ok / retried-ok / fell-back | fallback rate | from the ROWS | caught by |
|---|---|---|---|---|
| **5%** | 382 / 17 / 1 | **0.0025** | 0.0025 | the **retry** channel (0.0425 > 0.02) |
| **20%** | 339 / 51 / 10 | **0.0250** | 0.0250 | both |
| **100%** | 0 / 0 / 400 | **1.0000** | 1.0000 | both |

A 5% plant is **below any honest fallback threshold** and is caught only because the retry traffic is now
visible: the retry rescued the DECISION, not the RUN. Pre-registered in `ATTESTATION_THRESHOLDS`: fallback
≤ **0.02**, retry ≤ **0.02**.

**ONLY TWO FAILURES MAY BE SURVIVED (S6b).** A transport failure and an invalid REPLY become a reflex act, each
counted with its reason. Anything else — a `ForeignPlaceError`, a `TypeError`, any throw from engine code while
the reply is being read — is a PROGRAM error and propagates. *`LlmMind`'s parse `catch` used to take
everything, so a codec that threw while decoding a legal-looking reply became a reflex act and eleven rows were
recorded as answered while the run carried on.* The falsification control is in the same file: a plain `Error`
from the transport still falls back, or the fix would be a mind that dies whenever a provider hiccups.

**AND THE ATTESTATION IS BOUND TO THE RUN (S6).** *Round 4's `judgeTraces` took a caller-supplied
`{degraded, reasons}` and could not check it.* `attestRun(key, claim)` mints a MAC over the run's sorted
handles, its seeds, its gate `ruleHash`, the degraded flag, the reasons **and the per-arm think counters**,
keyed by the blinding secret — drawn from the host's CSPRNG per run and published only after `unseal()`.
`verifyAttestation` runs BEFORE the key is opened and refuses a **forged** claim (the MAC needs the secret), a
**replayed** one (the handles do not match), one minted under a **different gate rule**, and one **edited after
minting**. An unbound `{degraded, reasons}` — exactly what round 4 accepted — is refused for carrying no binding.

The rest, measured (`test/eval-proof.test.ts` prints these):

| check | measured |
|---|---|
| probe, faithful arm | leak **0.00** · admission **1.00** · ground **0.75** (1 of 18 by correctly reporting an empty slice) · miss 0.25 · overreach **0** · separation **0.75** |
| probe, omniscient arm | leak **1.00** · admitted **0** · control overreach **24/24** · separation **−0.50** |
| "I do not know" to everything | ground 0 · every control a MISS · separation **0** |
| unrelated own-nouns to everything | ground **0.33** · separation **0.00** *(round 1: 1.00 / 1.00)* |
| a hedged full recipe | leak **1.00** (all 8 hedged) · admit **0.00** · separation **−0.67** *(round 2: 0.00 / 1.00 / **1.00**)* |
| an honest disavowal naming TWO absent things | leak **0.00** · vocabulary **0.75** · admit **1.00** · separation **0.67** *(round 3: 0.13 / — / 0.88 / 0.625)* |
| mock judge | A **4 of 4** decisive pairs · Wilson **[0.510, 1]** · exact p **0.125** · `usableForVerdict` **false** |
| position bias | left rate **0.500** · flipped pairs 0 · biased false |
| label swap | the sign flips exactly; the position check is unchanged |
| identical arms, same being | decisive 0 · tie rate 1.00 · interval [0, 1] · `undetermined` |
| identical arms, shuffled | win rate 0.40 of 5 decisive pairs · p **1.0** · not usable |
| determinism | metrics, contrasts and trace texts identical across two runs; **handles identical only when `blindSecret` is injected**, and different when it is not |
| the attacker | **8/8** with the secret · **≈0.50** from every published artefact |

The judge line is the important one: **four pairs cannot reach significance whatever they say**, and
the aggregate now refuses the verdict instead of printing `[0.68, 1.00]` from a doubled n — and even
at 40 pairs it refuses, because 40 is not 64.

---

## The first paid pilot is an ESTIMATION pilot — decision D1, amended

**A pilot MEASURES; it does not decide.** Four rounds tried to squeeze a verdict out of ≤ 2,000 calls and four
rounds produced flattering arithmetic: round 1 spent 1,235 calls that could not have decided anything; round 2
spent 1,732 on a block that would have printed an inverted number; round 3 spent 1,485 on a 40-pair block with
**0.0015** power at a realistic tie rate; round 4 bought 64 pairs **from one seed** and quoted the power it was
sized for rather than the power it had. Each time the number printed beside the block said it would work,
because each time the number came from an ASSUMPTION rather than from a measurement.

So the first paid block buys the **nuisance parameters the confirmatory design needs**, with intervals:

| estimate | why the confirmatory design cannot be sized without it |
|---|---|
| judge **tie rate** per showing | the gate's power is a steep function of it; 0.30 is pre-registered and **nothing has measured it** |
| **both-orders consistency** and **decided agreement** | a judge that contradicts itself under order reversal has measured nothing |
| **between-run correlation ρ** (ICC) | one seed is n = 1; at ρ = 0.25 the old pair-level rule's type I was **0.38** |
| **calls per being** per tick budget | round 4's table said 1,024 and the reviewer counted 918 |
| **retry rate** | a 5% transport failure falls back on 0.25% of thinks and retries on 5% |
| **leak-judge calibration**, as Wilson bounds | 184 items cannot certify a point estimate |
| **integrity per arm**, incl. accepted acts per being | `planSuccessRate` moves with how many impossible acts an arm pads its plan with |

`PilotArtefact` carries `role: 'pilot-estimation'` and `usableForVerdict: false` **as a literal type**. There is
no branch that sets it true, no option that moves it, and nothing to post-process — making it assignable is a
compiler error. `designConfirmatory(estimates, targets)` then sizes the real block **at the pessimistic end of
every measured interval** (the tie rate at the HIGH end of its interval, ρ at the HIGH end of its), and running
what it returns needs the owner's approval and is out of scope here.

### The arithmetic comes from the code (S7)

Round 4's table quoted `64 × 8 × 2 = 1,024` for block (b) and the reviewer counted **918** through `runAb`,
because thinks per being are a function of TICKS and the trait cadence and the README stated neither.
`dryRunPilot()` now executes the EXACT pilot path with a counting mock backend and returns the table below;
`test/eval-pilot.test.ts` fails if these numbers and its output disagree, so a stale README is a red test.

<!-- DRY-RUN TABLE: generated by dryRunPilot() -->

| # | block | calls |
|---|---|---|
| a | calibrate the tier-3 leak judge against 184 already-labelled outputs | **184** |
| a2 | 46 of them judged a second time, for the judge's self-consistency | **46** |
| b | **10** seeds x **4** beings/arm x 2 arms at **900** ticks = 80 beings, MEASURED through `runAb` | **740** |
| b2 | 40 pairs x 2 orders (pairs never cross a seed) | **80** |
| — | retry head-room (10% of the blocks that go through `LlmMind`) | **82** |
| | **total** | **1132** |
| | reserve against a **2000**-call budget | **868** |

Measured thinks per being at 900 ticks: **9.25** — not the 8 round 4 assumed.

<!-- END DRY-RUN TABLE -->

**Many seeds, small cohorts.** Ten independent runs of four beings per arm, not one run of sixty-four: a seed is
the unit of analysis (S1), and ρ cannot be estimated at all from one run. **Thinks are capped by the plan**:
`AbSpec.callAllowance` is handed down from the measured table by `allowanceFor`, counted at the transport, and a
run that reaches it HALTS with `reason: 'allowance-exceeded'` and no metric table rather than quietly costing
more than the recipe says. `judge_traces` accepts a `cohortSize` up to **64** and up to **8** seeds, so the
pilot runs through the documented MCP entry point rather than only from code.

### What the cluster rule costs, measured through the real gate

Type I is held at or below α at every pre-registered ρ, and the power that buys is printed rather than assumed
(`test/eval-cluster.test.ts`, the REAL `judgeTraces`, 600 runs/cell for type I and 300 for power):

| ρ | round-4 pair-level rule, type I | round-5 cluster rule, type I | power at w = 0.70, 8x8 | 12x16 | 10x32 |
|---|---|---|---|---|---|
| 0.00 | 0.0317 | **0.0000** | 0.21 | **0.86** | **0.92** |
| 0.10 | 0.0233 | **0.0000** | 0.18 | **0.88** | **0.94** |
| 0.25 | 0.0500 | **0.0033** | 0.10 | 0.67 | 0.77 |
| 0.50 | **0.1800** | **0.0033** | 0.04 | 0.14 | 0.07 |

Two things follow, and both are reasons the pilot is an estimation pilot. **Pairs per seed is the number that
matters**: a seed with ~2 decisive pairs lands on exactly 0.5 about half the time, the sign test drops it, and
the cluster n collapses — 8 seeds x 8 pairs reaches 0.21 power where 12 x 16 reaches 0.86. And **ρ decides
whether the block is worth buying at all**: at ρ = 0.5 no shape here reaches 0.15. ρ has never been measured.

### What a paid estimation pilot licenses

- **A PASS licenses nothing about the arms.** It licenses *"the judge ties at ⟨rate, interval⟩, contradicts
  itself at ⟨rate⟩, its outcomes correlate within a run at ⟨ρ, interval⟩, a being costs ⟨calls⟩, and the arms
  ran their own minds at ⟨rates⟩."* Those numbers size the confirmatory block. They are not a result.
- **A FAIL is an instrument finding**: a judge that ties on most showings, or contradicts itself more often than
  it agrees, or a transport that retries above 2% — each is a thing to fix before any money is spent on a verdict.
- **It cannot conclude anything about Yggdrasil, in either direction.** No metric table decides anything (one
  seed is n = 1 and `MIN_PAIRED_SEEDS` is 8); no leak rate on real model text is bought; 9.25 thinks is about a
  third of a sim day, so survival, births, deaths and dispersal have not had time to happen; and no arm
  comparison it contains is powered, by construction.

### Day-of preconditions, in order

The override file does not exist and `budget.ceiling.source === 'constant'`; the budget id is fresh (`spent = 0`)
at `limit = 2000`; `design.ruleHash === JUDGE_GATE_HASH`; the run's attestation VERIFIES against the run's own
key (`verifyAttestation` — a forged, replayed or edited one is refused); `integrity.degraded === false` with both
arms at `parsedIntactRate` 1.00, fallback ≤ 0.02, retry ≤ 0.02 and accepted-per-being within 2x of each other;
`key.unsealed === false` at the moment `judgeTraces` is entered (an aggregate taken after an unseal is stamped
`blind: false` and is not usable); and the spend-log line for the run is on disk before anybody reads a number.


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
