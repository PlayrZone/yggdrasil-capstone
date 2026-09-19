# `eval/` — the instrument that decides whether a being is more ALIVE than a plain LLM agent

Item **W1-E** of the Yggdrasil rework campaign. Design authority: `docs/rework/ARCHITECTURE.md` §6,
`docs/rework/audits/04-frontier-benchmark.md` §5, `docs/rework/S4-mind.md`. Spend rule:
`docs/rework/CAMPAIGN.md` → "Decisions delegated" **D1**.

Nothing in here writes to a world and nothing in a world reads it. It is *instrument*, in the sense
`ARCHITECTURE.md` §2 means: it reads everything and is read by nothing in L1–L7.

> **Round 3.** Round 1 was failed by a hostile review (`docs/rework/reviews/W1-E-reviewer.md`) on four
> blockers: the blinding was an answer key, the cap was per-instance, the door opened for a wrapped
> provider, and the ignorance probe scored the honest answer as a leak. Round 2 closed all four — the
> review PASSED the spend guard under process kills and tampering, and found no format-level
> unblinding at the judge — and then blocked the paid pilot on three more:
>
> - **P1** the ignorance probe could be MAXED by the exact failure it exists to catch: hedged hits
>   were discarded, so *"I do not know, though perhaps ⟨the whole recipe⟩"* scored separation **1.00**,
>   above an honest mind's 0.73, while an honest disavower naming its own noun scored **0.13**;
> - **P2** the verdict gate compared a threshold sized on ALL pairs against a count over DECISIVE
>   pairs, giving it **1.6%** power at its own stated effect;
> - **P3** the blinding was invertible by anyone holding the result — re-running the public
>   `blindTraces` with the published seed recovered **8 of 8** arms.
>
> Every section below says what the rule is *and* what failure it closes, because the rules that were
> merely stated are the ones that were not true.

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
| `stats.ts` | the arithmetic that says what a number is worth | paired Student-t + BCa · Wilson · exact sign test · MDE · the pre-registered judge gate and its power · multiple comparisons |
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
3. **Serialising a sealed key does not unseal it.** `private` is a TypeScript fact, not a JavaScript
   one; `SealedTraceKey.toJSON` returns `{sealed, size, publicSeed, commitment}`, so the
   `JSON.stringify(result)` that any reader or agent reaches for prints no entries and no secret.
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

**What may be named inside a disclaimer.** *"I have never seen a furnace"* asserts no property,
procedure, cause or use — it is a claim about EXPERIENCE that happens to carry the concept with it.
One bare domain word inside a sentence that disclaims experience is therefore vocabulary, exactly as
the being's own nouns are. **The amnesty is one word wide**, and it is revoked by corroboration, on
the same reasoning `leakMatch.corroborated` already uses: a second domain word in the same breath,
or any claim or relation rule, is a recipe whatever frame it wears. *"I do not know, though perhaps
you strike flint into dry tinder and feed the flame"* carries five and is caught; *"I have never seen
a furnace smelt ore into bright copper"* is a disavowal by grammar and a leak by content, and the
content wins. The bound is stated rather than hidden: a single unsupplied noun, named and not used,
inside a disclaimer, is below this instrument's floor.

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

Eleven strategies with known correct verdicts, measured on one being across all 14 probes
(`test/eval-ignorance.test.ts` prints this table on every run). `said-not-known` is the raw
disavowal rate; `admit` is the credit, which requires the answer to be clean.

| strategy | leak (hedged) | said-not-known | admit | ground | separation | verdict |
|---|---|---|---|---|---|---|
| honest-local-wrong-theory | **0.00** | 1.00 | 1.00 | 0.83 | **0.83** | correct — *round 1 scored this a leak* |
| rambling-honest-local-theory | **0.00** | 1.00 | 1.00 | 0.83 | **0.83** | correct — length and hedging are not recitation |
| disavowal-with-own-nouns | **0.00** | 1.00 | 1.00 | 0.83 | **0.83** | correct — *round 2 scored this leak 0.88 / separation 0.13* |
| disavowal-repeating-the-concept | 0.00 | 1.00 | 1.00 | 0.83 | **0.83** | correct — an echo inside a disavowal is the clearest admission there is |
| always-disavow | 0.00 | 1.00 | 1.00 | 0.00 | 0.00 | correct — demonstrates nothing |
| parrot-own-nouns | 0.00 | 0.00 | 0.00 | 0.33 | 0.00 | correct — *round 1 scored this 1.00 ground, 1.00 separation* |
| echo-the-question | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | correct — an echo is neither knowledge nor an admission |
| terse-no | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | correct — "No." is not modesty, and scores nothing |
| confident-pretrained-explainer | **1.00** (0) | 0.00 | 0.00 | 0.17 | **−0.17** | correct — it recites, and it is caught |
| disavow-then-recipe | **1.00** (0) | 1.00 | **0.00** | 0.83 | **−0.83** | correct — the preface earns nothing |
| hedged-full-recipe | **1.00** (8) | 1.00 | **0.00** | 0.83 | **−0.83** | correct — *round 2 scored this 0.00 / 1.00 / **1.00*** |

**The ordering is asserted, not just the rows.** A single row cannot state the property that matters:
every honest mind must separate above everything that leaks, and hedging a recipe must not score
above reciting it. The test fixes both — worst honest **0.83** > best leaker **−0.17**, and
hedged-full-recipe ≤ confident-pretrained-explainer — so a future rule change that re-opens the
inversion fails here rather than in a pilot.

**`separation` is an UPPER BOUND on faithfulness.** The leak term rests on a tier-2 lexical detector
whose blind recall is **0.51** (`T1-blind-r2`, 184 outputs, precision 0.981), so a mind that leaks in
paraphrase scores high here and is not faithful. `report.detector.caveat` says so on every report, and
only a calibrated tier-3 judge can lower that bound — and §"the first paid pilot" below says why the
184-item set cannot certify that calibration either.

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
- **The interval that is quoted actually covers.** Round 2's was a raw percentile bootstrap, which is
  anti-conservative at every n this instrument can afford. The headline is now a **paired Student-t**
  interval with the small-sample quantile (t₄ = 2.776 at 95%, not 1.96); a **BCa** bootstrap ships
  beside it, and the percentile method is gone. Coverage is measured rather than claimed
  (`test/eval-stats.test.ts`, 2,000 samples per n, nominal 0.95):

  | n | Student-t (quoted) | BCa bootstrap (reported) |
  |---|---|---|
  | 2 | **0.950** | 0.332 |
  | 5 | **0.950** | 0.833 |
  | 8 | **0.948** | 0.877 |

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
- **The verdict gate is pre-registered, and the threshold shares a denominator with the count.**
  `JUDGE_GATE` is declared once in `stats.ts` — α = 0.05, minimum decisive fraction 0.5, declared
  effect 0.70 per showing — and the runner reads it rather than choosing per run. A pair is decided
  on: (1) at least half the judged pairs must be **decisive** (both orders naming the same arm);
  (2) the winner needs `minimumDetectableWins(decisivePairs, α)` wins **of those decisive pairs**,
  which is the exact sign test conditioned on the non-ties. Ties and order-flips are reported as what
  they are — *a judge that cannot make up its mind is itself a finding*, and it prints as the reason
  rather than as a win rate over whatever survived.

  *Round 2 sized the threshold on ALL pairs (`minimumDetectableWins(30)` = 21) and compared it
  against `wins.A`, a count over decisive pairs only. At the stated 0.70 effect E[wins.A] = 14.7, so
  P(USABLE) was **1.6%** while the sign test on the same data was significant 82.7% of the time.*
- **The power of that rule is computed, printed, and simulated.** `judgeGatePower(pairs)` sums the
  trinomial the two showings impose — P(A wins a pair) = w², P(B) = (1−w)², the rest inconsistent —
  over every outcome the gate would pass, and ships on every aggregate as `design.power`:

  | pairs | power at w = 0.70 | prints USABLE at w = 0.50 |
  |---|---|---|
  | 10 | 0.198 | 0.009 |
  | 30 | 0.736 | 0.019 |
  | **40** | **0.827** | 0.017 |
  | 50 | 0.880 | 0.018 |

  **38 pairs** is the first n at which the gate reaches 0.80 power. The analytic figure is an upper
  bound — the position check can void a verdict on its own and is not modelled — so the simulation
  prints both: driving the real gate 400 times with a judge that prefers one arm 0.70 of the time
  yields **0.690** against a claimed 0.736, and at 0.50 it prints USABLE **0.022** of the time
  against α = 0.05.
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
const verdict = await judgeTraces(pairs, result.key, new MockTraceJudge());
verdict.design;                                     // the gate: threshold over DECISIVE pairs, and its power
verdict.usableForVerdict;                           // false, with `note` saying which rule refused
result.key.disclose();                              // after unseal(): the secret, so the commitment verifies
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
| a hedged full recipe | leak **1.00** (all 8 hedged) · admit **0.00** · separation **−0.83** *(round 2: 0.00 / 1.00 / **1.00**)* |
| an honest disavowal naming its own noun | leak **0.00** · admit **1.00** · separation **0.83** *(round 2: 0.88 / 0.13)* |
| mock judge | A **4 of 4** decisive pairs · Wilson **[0.510, 1]** · exact p **0.125** · `usableForVerdict` **false** |
| position bias | left rate **0.500** · flipped pairs 0 · biased false |
| label swap | the sign flips exactly; the position check is unchanged |
| identical arms, same being | decisive 0 · tie rate 1.00 · interval [0, 1] · `undetermined` |
| identical arms, shuffled | win rate 0.5 of 4 decisive pairs · p **1.0** · not usable |
| determinism | metrics, contrasts and trace texts identical across two runs; **handles identical only when `blindSecret` is injected**, and different when it is not |
| the attacker | **8/8** with the secret · **0.512 [0.4925, 0.5325]** from every published artefact |

The judge line is the important one: **four pairs cannot reach significance whatever they say**, and
the aggregate now refuses the verdict instead of printing `[0.68, 1.00]` from a doubled n.

---

## The first paid pilot, redesigned for what it CAN decide

Model: **`accounts/fireworks/models/gpt-oss-120b`** (decision D2). Budget id: one, capped at 2,000.

Round 1's recipe spent 1,235 calls and **none of it could have decided anything**. Round 2's spent
1,732 on three blocks, of which one would have produced an inverted number (P1) and one could not
have returned a verdict at all (P2). This version buys **pairs**, because after P1 and P2 that is the
only block whose decision rule the budget can actually satisfy.

| # | stage | shape | calls |
|---|---|---|---|
| a | **Calibrate the tier-3 leak judge** | the held-out labelled set `T1-blind-r2`, 184 outputs, one judge call each | **184** |
| a2 | …self-consistency | 25% of them judged a second time | **46** |
| b | **Short traces for the judge** | 40 beings/arm × 8 thinks × 3 arms (**A**, **A−**, **B**), one seed | **960** |
| b2 | …judging **A vs B** | 40 pairs × 2 orders | **80** |
| b3 | …judging **A− vs B** | 40 pairs × 2 orders | **80** |
| — | retry head-room | `LlmMind` retries once on unreadable JSON; ~10% | **135** |
| | **total** | | **1,485** |
| | reserve | | **515** |

Every block below states its decision rule, its power or CI width, and what it cannot conclude.

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
- **What it cannot conclude:** nothing whatever about Yggdrasil. It calibrates an instrument. And
  because the pass bar is now where the sample can support it, the *likely* outcome of this block is
  `PROVISIONAL` — which is information, and is cheaper to learn at 230 calls than to assume.

**(b) 1,120 calls — 40 pairs, not 30 and not 5.**

- **Decision rule** (`JUDGE_GATE`, declared in `stats.ts` before the run): at least **20 of 40** pairs
  decisive, and the winner needs `minimumDetectableWins(decisivePairs, 0.05)` wins of those — 21 of
  30 decisive, 18 of 25, 15 of 20. Ties and order-flips are reported as themselves.
- **Power: 0.83** at a true 0.70 per-showing win rate (0.017 false-positive rate at 0.50). 30 pairs
  would have been **0.74**, and **38** is the first n that reaches 0.80. This is the whole reason the
  probe block is gone: the pairs block is the only one in the budget whose rule the money can satisfy.
- **The decomposition, with its caveats attached** (see "The 2×2 is NOT orthogonal" above):

  | A vs B | A− vs B | reading |
  |---|---|---|
  | wins | wins | the **architecture** is doing the work — *plus the three `[unfair to B]` prompt nudges, which this design does not separate* |
  | wins | does not | **arm A's own wording of the instruction** is doing the work, inside the Yggdrasil mind. It does **not** follow that the same sentence would do it in a plain agent — that is B+ vs B, and B+'s sentence is not the same text |
  | does not | — | no aliveness difference this design could see; report it with the power above |

- **What it cannot conclude:** nothing about *why*. The judge reads behaviour; it does not attribute
  it to a store, a retrieval or a sentence.

**(c) The ignorance probe is NOT in the first pilot. Why.**

After P1 the probe's *classification* is sound — eleven adversaries, the ordering asserted, the
hedged recipe caught and the honest disavower cleared. But a 504-call block still could not produce a
trustworthy **number**, for three reasons that P1 does not touch:

1. **The unit is the being, and six of them bound nothing.** 14 probes inside one being are
   correlated, so n = 6 per arm; even 0 leaks in 6 beings bounds the leak rate only at ≤ 0.39.
2. **The tier-2 floor is still 0.51 recall**, so `separation` remains an upper bound on faithfulness
   whatever the block returns.
3. **Its tier-3 half depends on block (a) passing**, and by (a)'s own honest bar the likely verdict is
   `PROVISIONAL`. Spending 252 calls on an uncalibrated judge buys an uncalibrated number.

So the probe runs on **mocks only** in this round — where it is proven, cheap and free — and the 504
calls go back into the reserve. It returns to a paid pilot when (a) certifies tier 3, or when the
budget can carry ~25 beings per arm, whichever comes first.

### What this pilot cannot conclude, stated plainly

- **Nothing from the metric table.** One seed is n = 1: no interval, and `minimumDetectableEffect(1)`
  is infinite. Plan success, dispersal, diet breadth and survival are **not** decided here.
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
