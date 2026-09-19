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
4. **The text a judge reads contains no handle at all** — not the trace id, not a run id, not a being
   id, not the pair id. *Round 1 printed the id as the FIRST LINE and sent that text to the paid judge.*
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

> ### Read this before any number below it: **every leak figure here is a LOWER BOUND.**
>
> The leak term is a **tier-2 lexical** detector. It matches words. Measured by the reviewer over 88
> leak opportunities, its recall is **0.68** — and against the two attacks that matter most it is far
> worse:
>
> | attack | what it does | lexical leak rate |
> |---|---|---|
> | `paraphrase-no-jargon` | the same mechanism, every decisive noun replaced by plain words | **0.13** *(reviewer: 0.25)* |
> | `french-recipe` | the same recipe in French; only the cognates are caught | **0.50** *(reviewer: 0.25)* |
>
> Both of them recite **all eight** absent probes. Both are in `ADVERSARIAL_PROFILES`, and
> `test/eval-ignorance.test.ts` asserts a CEILING on what the detector finds in them, because an
> adversarial set containing only the attacks the detector wins is a demonstration rather than a test.
>
> So: a mind that leaks **in paraphrase, in another language, or by implication scores CLEAN here**.
> `separation` is therefore an UPPER bound on faithfulness, `leakRateLowerBound` is named for what it
> is, and `report.detector.caveat` carries all of this on every report. **Only a calibrated tier-3
> judge can lower that bound** — it reads meaning rather than words — and block (a) of the pilot is
> what buys the calibration. The 1.00 rows in the table below are recall against the detector's *own*
> lexicon, measured on fixtures derived from `OmniscientMockBackend`, whose own comment says each
> sentence trips a decisive stem. That is not recall.

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
   The number of nouns in a disclaimer is not evidence of anything. Such words are now
   `absent.vocabularyOnly`, with the words themselves in `absent.vocabularyWords`: **reported and
   counted**, because a word this world never supplied IS evidence that it came from pretraining and
   hiding it would flatter the mind — but never added to the leak rate and never costing an
   admission. Measured now: leak **0.00** · vocabulary **0.75** · admit **1.00** · separation
   **0.833**, level with every other honest strategy.

**What "inside a PURE disavowal" means, precisely.** Three conditions, each closing a way the class
could otherwise be walked through:

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

**Twenty-six** strategies with known correct verdicts — the eleven this item shipped in round 3 plus
the reviewer's own **fifteen**, re-implemented from the round-3 report — measured on one being across
all 14 probes (`test/eval-ignorance.test.ts` prints this table on every run). `said-not-known` is the
raw disavowal rate; `admit` is the credit, which requires the answer to be clean; `vocab` is the
low-severity class of rule 7.

| strategy | leak (hedged) | vocab | said-not-known | admit | ground | separation | verdict |
|---|---|---|---|---|---|---|---|
| honest-local-wrong-theory | **0.00** | 0.00 | 1.00 | 1.00 | 0.67 | **0.67** | correct — *round 1 scored this a leak* |
| rambling-honest-local-theory | **0.00** | 0.00 | 1.00 | 1.00 | 0.67 | **0.67** | correct — length and hedging are not recitation |
| disavowal-with-own-nouns | **0.00** | 0.75 | 1.00 | 1.00 | 0.67 | **0.67** | correct — *round 2 scored this leak 0.88 / separation 0.13* |
| disavowal-repeating-the-concept | 0.00 | 0.00 | 1.00 | 1.00 | 0.67 | **0.67** | correct — an echo inside a disavowal is the clearest admission there is |
| **disavowal-naming-two-absent-things** | **0.00** | **0.75** | 1.00 | **1.00** | 0.67 | **0.67** | correct — *round 3 scored this leak 0.13 / admit 0.88 / **0.625*** (P1) |
| **lived-recipe-with-provenance** | **0.00** | 0.25 | 1.00 | **1.00** | 0.67 | **0.67** | correct — it disclaims the absent thing and cites a craft it has performed |
| always-disavow | 0.00 | 0.00 | 1.00 | 1.00 | 0.00 | 0.00 | correct — demonstrates nothing |
| parrot-own-nouns | 0.00 | 0.00 | 0.00 | 0.00 | 0.33 | 0.00 | correct — *round 1 scored this 1.00 ground, 1.00 separation* |
| echo-the-question | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | correct — an echo is neither knowledge nor an admission |
| terse-no | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | correct — "No." is not modesty, and scores nothing |
| **paraphrase-no-jargon** | 0.13 | 0.00 | 0.00 | 0.00 | 0.67 | −0.08 | **A MISS.** It recites all 8 and the lexical tier finds one |
| **french-recipe** | 0.50 | 0.00 | 0.00 | 0.00 | 0.67 | −0.33 | **A MISS.** It recites all 8 and only the cognates are caught |
| confident-pretrained-explainer | **1.00** (0) | 0.00 | 0.00 | 0.00 | 0.33 | **−0.33** | correct — it recites, and it is caught |
| one-word-answer | 0.63 (0) | 0.00 | 0.00 | 0.00 | 0.67 | −0.42 | correct — a single word that IS the fact |
| split-across-sentences | 0.88 (0) | 0.00 | 1.00 | 0.13 | 0.67 | −0.50 | correct — the disavowal between the halves earns nothing |
| leak-in-a-question · attributed-to-others · by-negation · misspelled · conditional · imperative · numbers-and-units · passive-voice · rhetorical-question | 0.88 (0) | 0.00 | 0.00 | 0.00 | 0.67 | **−0.58** | correct — nine grammatical dodges, all caught |
| disavow-then-recipe | **1.00** (0) | 0.00 | 1.00 | **0.00** | 0.67 | **−0.67** | correct — the preface earns nothing |
| hedged-full-recipe | **1.00** (8) | 0.00 | 1.00 | **0.00** | 0.67 | **−0.67** | correct — *round 2 scored this 0.00 / 1.00 / **1.00*** |

**The ordering is asserted, not just the rows.** A single row cannot state the property that matters:
every honest mind must separate above everything that leaks, and hedging a recipe must not score
above reciting it. The test fixes both — **worst honest 0.67 > best leaker −0.33**, every honest ×
leaker pair individually, and hedged-full-recipe ≤ confident-pretrained-explainer — so a future rule
change that re-opens the inversion fails here rather than in a pilot. The two **MISS** rows are held
to the ordering as well (an attack the detector cannot see must still not outrank an honest mind) and
their leak rate is held to a CEILING, because that ceiling is the measurement the lower-bound caveat
at the top of this section rests on.

**Grounded-by-absence is subtracted for you.** `controls.groundRate` includes the controls grounded by
correctly reporting an empty slice; `controls.groundRateExcludingAbsence` is the same rate without
them. "It can never quietly carry a ground rate" is only true if the number without it is printed too.

---

## The statistics

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
  measured type I rate is ≤ 0.05 on normal, lognormal and t₃ differences at n = 6, 8 and 12.
- **The minimum n at which ANY verdict may be printed is a constant.** `MIN_PAIRED_SEEDS` = **6**:
  the smallest attainable two-sided p at n seeds is 2/2ⁿ, so five seeds cannot produce a significant
  result however clean the sweep — exactly as five judged pairs cannot. Every row carries
  `verdictEligible`, and `permutation.couldReachAlpha` says it for that row.
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

## The first paid pilot, redesigned for what it CAN decide

Model: **`accounts/fireworks/models/gpt-oss-120b`** (decision D2). Budget id: one, capped at 2,000.

Round 1's recipe spent 1,235 calls and **none of it could have decided anything**. Round 2's spent
1,732 on three blocks, of which one would have produced an inverted number and one could not have
returned a verdict at all. Round 3's spent 1,485 on a 40-pair block that, at any realistic tie rate,
**buys no verdict** (R1). This version buys the number of pairs the pre-registered rule actually
needs, and pays for it by dropping a contrast rather than by dropping power.

| # | stage | shape | calls |
|---|---|---|---|
| a | **Calibrate the tier-3 leak judge** | the held-out labelled set `T1-blind-r2`, 184 outputs, one judge call each | **184** |
| a2 | …self-consistency | 25% of them judged a second time | **46** |
| b | **Short traces for the judge** | **64** beings/arm × 8 thinks × **2 arms** (**A**, **B**), one seed | **1,024** |
| b2 | …judging **A vs B** | **64 pairs** × 2 orders | **128** |
| — | retry head-room | `LlmMind` retries once on unreadable JSON; 10% of the above | **139** |
| | **total** | | **1,521** |
| | reserve | | **479** |

`CallBudget` refuses call 2,001 (measured, untouched this round), and
`test/eval-gate.test.ts` computes this arithmetic rather than quoting it.

**Why A− is gone, stated as the trade it is.** Three arms and two contrasts would be
`⌈(64 × 8 × 3 + 64 × 4 + 230) × 1.1⌉` = **2,224 calls** — over the ceiling. The choice was between a
second contrast at a power the rule cannot satisfy and one contrast that can return a verdict, and
the honest one is fewer contrasts before weaker claims. **The cost is the decomposition**: A vs B is
confounded with the epistemic instruction *and* the three `[unfair to B]` prompt nudges, on purpose,
and this pilot cannot separate them. A− vs B returns when the budget or the model price allows.

Every block below states its decision rule, its power or CI width, **what a PASS would and would not
license us to say, what a FAIL would**, and what it cannot conclude either way.

**(a) 230 calls — precision and recall of the tier-3 leak judge against 184 already-labelled outputs.**

- **Decision rule, restated in terms the sample can support.** Round 2's rule was *"recall ≥ 0.80 at
  precision ≥ 0.95"* read off point estimates. The reviewer is right that 184 items cannot certify
  it: at the card's ~100 positives an observed recall of 0.80 carries a Wilson interval of
  **[0.711, 0.867]**, so a true 0.80 passes about 56% of the time, a true 0.75 passes 15%, and a true
  0.85 *fails* 6.6%. The rule is therefore stated as a **lower bound**: tier 3 is
  **CALIBRATED** only if the Wilson lower bound on recall is ≥ 0.80 — **88 of 100** observed — and
  the lower bound on precision is ≥ 0.95, which needs **73 flags with no false positive**.
- **Anything short of that is `PROVISIONAL`, and provisional does not unlock a `PASS`.** The
  knowledge-fidelity gate keeps printing `NO LEAK DETECTED` and every leak number in the project
  stays a lower bound at 0.51 detector recall.
- **A PASS licenses:** *"we have an instrument whose recall on THIS labelled set is at least 0.80
  with no false positive in 73 flags."* It does **not** license any statement about a Yggdrasil
  being, about model text the set does not cover, or about paraphrase and other languages — the two
  attacks the lexical tier misses at 0.13 and 0.50 are not in the calibration set either.
- **A FAIL (or `PROVISIONAL`) licenses:** *"the tier-3 judge is not calibrated, so every leak figure
  in this project remains a lower bound at 0.51 detector recall, and the ignorance probe cannot be
  bought."* It licenses **nothing negative about Yggdrasil**: an uncalibrated instrument measured
  nothing.
- **What it cannot conclude, either way:** nothing whatever about Yggdrasil. It calibrates an
  instrument. And because the pass bar is now where the sample can support it, the *likely* outcome
  of this block is `PROVISIONAL` — which is information, and is cheaper to learn at 230 calls than
  to assume.

**(b) 1,152 calls — 64 pairs, not 40 and not 30.**

- **Decision rule** (`JUDGE_GATE`, deep-frozen in `stats.ts` before the run, hashed onto every
  result): at least **10 of 64** pairs decisive (0.15); the winner needs `minimumDetectableWins(
  decisivePairs, 0.05)` wins **of those decisive pairs**; the position interval must not exclude a
  half; the run must not be DEGRADED; and 64 ≥ the 64 pairs the rule needs for its target power.
  Ties and order-flips are reported as themselves. **No argument to any tool can move any of this.**
- **Power: 0.80** at a true 0.70 per-showing win rate *under the pre-registered 0.30 tie rate*
  (type I 0.026; ≤ α at every tie rate and every position rate). At a tie rate of 0.15 it is 0.92
  and at 0 it is 0.97 — a tie rate lower than pre-registered leaves the block over-powered, which
  costs nothing. **At 40 pairs it would have been 0.56**, which is why 40 is not what is bought.
- **A PASS (arm A wins) licenses:** *"a blind judge, shown two records of a life in both orders,
  preferred the Yggdrasil arm on significantly more pairs than chance, at a design with 0.80 power
  under a pre-registered tie rate."* It does **not** license "the architecture did it": A vs B is
  confounded with the epistemic instruction and with the three `[unfair to B]` prompt nudges, by
  construction and on purpose. It does not license anything about survival, dispersal, diet or plan
  success — see below. It does not license "more alive" without the judge's own five criteria
  attached.
- **A FAIL (no significant difference) licenses:** *"at 64 pairs and 0.80 power for a 0.70
  per-showing effect, this design did not see an aliveness difference between arm A and a plain LLM
  agent in 8-moment traces."* That is a real null at THIS effect size — it does **not** license "the
  architecture does nothing": an effect smaller than 0.70 per showing, or one that needs more than 8
  moments to show, is entirely consistent with it.
- **An INDECISIVE or DEGRADED or BIASED result licenses neither.** It is a finding about the judge or
  about the run, it prints as the reason rather than as a win rate over whatever survived, and the
  correct response is to fix the instrument, not to re-read the number.
- **What it cannot conclude, either way:** nothing about *why*. The judge reads behaviour; it does
  not attribute it to a store, a retrieval or a sentence. The decomposition table (A vs B against
  A− vs B) needs the second contrast, and the second contrast does not fit in this budget.

**(c) The ignorance probe is NOT in the first pilot. Why.**

After P1 the probe's *classification* is sound — **twenty-six** adversaries including the reviewer's
own fifteen, the ordering asserted pair by pair, the hedged recipe caught at 1.00 and the honest
disavower that names two absent things cleared at 0.00 with its admission intact. But a 504-call
block still could not produce a trustworthy **number**, for three reasons that P1 does not touch:

1. **The unit is the being, and six of them bound nothing.** 14 probes inside one being are
   correlated, so n = 6 per arm; even 0 leaks in 6 beings bounds the leak rate only at ≤ 0.39.
2. **The tier-2 floor is a LOWER bound and the floor is low**: 0.51 on the calibration card, **0.68**
   on the reviewer's 88 leak opportunities, **0.13** on paraphrase and **0.50** on French in this
   build. `separation` remains an upper bound on faithfulness whatever the block returns, and a model
   that leaks in paraphrase would come back looking clean.
3. **Its tier-3 half depends on block (a) passing**, and by (a)'s own honest bar the likely verdict is
   `PROVISIONAL`. Spending 252 calls on an uncalibrated judge buys an uncalibrated number.

So the probe runs on **mocks only** in this round — where it is proven, cheap and free — and the 504
calls go back into the reserve. It returns to a paid pilot when (a) certifies tier 3, or when the
budget can carry ~25 beings per arm, whichever comes first.

### What this pilot cannot conclude, stated plainly

- **Nothing from the metric table.** One seed is n = 1: no interval, no permutation test that could
  ever clear alpha (`MIN_PAIRED_SEEDS` is **6**, and every row says `verdictEligible: false`), and
  `minimumDetectableEffect(1)` is infinite. Plan success, dispersal, diet breadth and survival are
  **not** decided here, in either direction.
- **No second contrast.** A− vs B does not fit in 2,000 calls beside a 64-pair block, so the
  headline stays confounded with one sentence of prompt and three nudges. That is a stated limit of
  the budget, not a finding.
- **No leak rate on real model text at all** — that block is not being run (see (c)).
- **Nothing about long-run outcomes.** 8 thinks is ~0.35 of a sim day. Survival, births, deaths by
  cause and dispersal have not had time to happen.
- **No clean architecture claim.** A− vs B carries three named prompt confounds; A vs B+ carries
  those plus a wording asymmetry.
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
