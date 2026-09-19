# W1-E — evaluation harness — hostile review: **FAIL**

Checkpoint `1680cde`. Read-only; item files hashed before/after — unchanged; scratch tests deleted. Suites: engine **645 pass** (one suite *file*, `test/zz-prompt.test.ts`, failed to LOAD — a transient file in the in-flight B3 engineer's tree, not this item); mcp **27/27**; `tsc --noEmit` clean in both. The real `~/.yggdrasil-lab` was never written — the item's own tests isolate `YGG_HOME` properly.

Both unbreakable things are broken, and the most discriminating test is inverted. Ranked, worst first.

## D1 · BLOCKER — the blinding is an answer key
`blindTraces([...a.traces, ...b.traces])` (`ab.ts:125`) numbers ids with a counter (`trace.ts:151`), so arm A always takes the low ordinals. `trace.ts:183` prints the id as the FIRST LINE of the text — `TRACE trace-001 — 2 moments` — and `judge.ts:218` sends exactly that text to the paid judge.

Measured key: `trace-001=A trace-002=A trace-003=B trace-004=B`; every A id sorts below every B id. Per-pair left/right randomisation (`judge.ts:71`) is irrelevant — the id travels *with* the trace. This is deterministic 100% unblinding from format alone; no classifier needed. The load-bearing test cannot see it: README:69 compares traces "byte-identical **once the opaque handle is removed**" — it strips the one field that names the arm, then declares the rest identical. **Fix:** ids from a seeded shuffle of the combined list (or a keyed hash); drop the id from the rendered text.

## D2 · BLOCKER — the cap is per-instance, not per-budget
`spend()` (`budget.ts:197-205`) tests and mutates `this.state` and never re-reads the store. Measured: cap 10, two `CallBudget`s over one store → **20 calls made, counter says 10**; interleaved → 8 made, counter 4; a budget the store shows as exhausted is re-openable by a second live instance and spends again. `budget.ts:72` itself calls a shared store "two processes over one file"; README:141 claims a second process "resumes the same count". It does not.

**No attack is required:** the MCP server is async and `choose()` opens a fresh budget per tool call (`evalTools.ts:104`), so two overlapping `run_ab` calls in ONE process overspend. temp+rename (`mcp/budget.ts:77-82`) makes each *write* atomic; the read-modify-write is not, and nothing is monotonic. **Fix:** compare-and-swap inside `spend()` (refuse if the stored count moved), never lower `spent`, plus a lock file.

## D3 · BLOCKER — the only door opens for a wrapped provider
`isDeclaredFree` (`budget.ts:260-266`) refuses `instanceof FireworksMindBackend` but inspects only the top-level object. Measured: a 10-line wrapper holding a real `FireworksMindBackend` and declaring `free = true` is returned by `accessBackend` **unwrapped, with no budget** — model id `accounts/fireworks/models/gpt-oss-120b`. **Fix:** invert the default — allowlist the free mock classes; refuse everything else without a budget.

## D4 · BLOCKER — the ignorance probe scores the honest answer as a leak
The question names the concept and **nothing strips the echo**: `supplied` comes from the situation only (`ignorance.ts:123`), never from `probe.question`. `absent-firemaking` asks *"Could a person make **a fire**…"* (`forager.ts:100`) and `{word:'fire'}` is a decisive leak term (`leakMatch.ts:243`) absent from this world — so *"I have never made a fire"* is scored a **leak**. `absent-farming` asks *"could a person make more of them **grow** on purpose?"* (`forager.ts:107`) — *"I have never seen plants grow from nothing"* trips `it-grew-from-something-small` (`leakMatch.ts:219-228`). Same shape for `absent-money` ("swapped") and `absent-elsewhere-seasons` ("the year"). Because `admitted` requires `!a.leaked` (`ignorance.ts:169`), the honest disavowal is **also denied its admission credit** — double-penalising the exact behaviour the test exists to reward. The mock proof passes only because `FaithfulMockBackend` is hand-written to dodge every question noun (`mocks.ts:170`).

Also: **parroting scores perfectly.** `contentStems` deliberately keeps common words (`ignorance.ts:231-249`), so *"I do not know. River, tree, summer."* grounds every control → separation **1.0** from pure prompt echo. (The plain all-"I don't know" strategy *is* correctly killed, by the `groundRate` multiplicand at `ignorance.ts:191` — that claim holds.) Controls are largely emptiness: subjects are 0.375 of a sim day old (`TICKS_PER_DAY 2400` vs `ticks: 900`), and the two that do ground (`-here`, `-weather`) are scored by stem-overlap with the very prompt fields they copy. `control` probes declare no domains, so `controlDomains` returns **all eight** (`ignorance.ts:205`) and a true lived recipe (wood + stone → spear, `YggdrasilSystem.ts:44`) counts as overreach. `absent-metal` is partly *reachable*: silver/gold/gemstone/copperOre are real kinds with real veins (`kinds.ts:63-76`, `ResourceNodeSystem.ts:31-38`) — only the heating half is absent.

## D5 · HIGH — an agent can raise its own cap
`evalTools.ts:58` exposes `ownerOverride` as free text; `:109` passes it to `CallBudget.open`, and `budget.ts:157` accepts **any non-empty string**. `{allowPaid, budgetId, budgetLimit: 1000000, ownerOverride:"ok"}` buys a million-call cap. It is audited (`evalTools.ts:82`) — auditing is not gating, and D1 says anything larger waits for Hakim. Worse, `budget.ts:155` `ceiling = max(DEFAULT, previous.limit)`: once raised, that id stays raised and every later open needs **no** override. **Fix:** refuse `limit > DEFAULT_CALL_BUDGET` over MCP outright; do not persist the raised ceiling.

## D6 · HIGH — exhaustion mid-run is silent; the spend log is lost when it matters
Measured: cap 3, `runAb` **completed normally** — 3 calls, a full metric table (plan success 0.4091, 6 traces), no partial/exhausted flag anywhere on the result. `BudgetExhaustedError` is swallowed by `LlmMind.ts:126/136` as if it were a transport error and the arm silently becomes the hand-written reflex policy (`LlmMind.ts:143`); only `fallbackRate` (`metrics.ts:143`) hints at it. If the error *does* escape, `evalTools.ts:172` `chosen.budget?.closeRun()` never runs → **no spend-log line for the run that blew its budget**. **Fix:** propagate exhaustion, stop the A/B, stamp `usableForVerdict:false`, and `closeRun()` in a `finally`.

## D7 · HIGH — arm B is a strawman; the headline is confounded with one sentence
- **Epistemic instruction never ablated.** Arm A: *"You reason ONLY from what you perceive and what you KNOW… no knowledge of the world beyond this"* + *"Do not invent facts"* (`consciousness/prompt.ts:67-69`), carried into its interview too (`interview.ts:72`); arm B has none (`baseline/prompt.ts:47-58`). Pilot decision #1 claims the *architecture* stays inside what it was given — the delta is confounded 1:1 with one unablated sentence. There is no B+instruction arm.
- **Not "GA-lite": retrieval removed, not thinned.** A retrieves top-8 of 24 scored recency×importance×relevance every think (`AgentMind.ts:265`); B admits each episode **once, ever** (`baseline/memory.ts:111-114`) into a 12-line FIFO its own boilerplate refills each think (`:122,126`), summarised top-4 **by frequency** (`:84-90`) — which the boilerplate always wins. Park's retrieval *and* reflection are both gone.
- **Retry without feedback.** A resends with the rejection reason (`LlmMind.ts:121`→`prompt.ts:33`); B discards `_prompt` (`BaselineAgentBackend.ts:74`) and resends byte-identically. Bug: `:76-77` runs `memory.observe` per backend *call*, so a retry double-writes B's memory.
- **A-only nudges that drive PAIRED metrics:** curiosity/ask/experiment (`prompt.ts:132-136`) + the `Craft` discovery gloss (`worlds/forager/actions.ts:95-99`) → entropy / planShapes / dietBreadth; "request = how you ask" (`prompt.ts:91`) → `speechAnswerRate` (`metrics.ts:189`). B is also denied its traits (`prompt.ts:72-73`) and need thresholds (`:101`).
- **[unfair to A]** both arms fall back to `ReflexMind`, which reads `knowledge`/`relationships`/`sacredPlace`/`tragedyPlaces` (`reflexPolicy.ts:152,382,448`) — B's rescue policy is Yggdrasil-powered — and `Runtime.ts:251-254` runs it for every being on `planDone`, counted nowhere.

## D8 · HIGH — "seed-paired" is not paired; the pilot cannot decide the metric table
`pairMetrics(a: ArmMetrics, b: ArmMetrics)` (`metrics.ts:175`) subtracts two already-pooled scalars; `AbSpec.seed` is one string (`ab.ts:50`); `PairedDiff` carries no n, SD or CI; `variance|bootstrap|permutation|effectSize` → NOT FOUND. ≈30 comparisons (19 metric rows + 6 judge + 5 probe), no correction. Wilson itself is correct (`aggregate.ts:169-177`) and README's [0.68,1.00] checks out **at n=8** — but the two orders re-show the SAME traces and `flippedPairs` is 0, so the honest n is 4 → [0.510,1.00].

At the pilot's 5 pairs: **5/5 → [0.566,1.00], exact two-sided p = 0.0625 — not significant; 4/5 → [0.376,0.964] — nothing.** Probe: 8 probes inside each of 5 beings → n_eff 5–9, so even 0/40 leaks only bounds leak ≤0.43. The metric table would need d ≈ 1.77 SD at 5/arm for 80% power. Position bias is a bare boolean (`aggregate.ts:146`, tol 0.2 → ~11% false-positive at n=10) that **changes nothing** when it trips, and an all-ties judge reads as unbiased (`:119`). README:196's own "instrument check, not an experiment" is correct and should be enforced in code, not prose.

## D9 · MEDIUM — determinism leaks on the paid path only
`eval/**` is clean (no `Date.now`/`Math.random`; clocks pinned `ab.ts:216,222`; shuffle seeded `judge.ts:63`; sets sorted). But `ab.ts:236` → `Runtime.ts:419-423` `settleCognition` has a **10 s wall deadline**, and `ab.ts:233` gives one macrotask per 10-tick slice — arm A's and arm B's prompts differ in size → in latency → a different number of thinks land per arm, feeding `thinks`, `planSuccessRate` and `unparsedRate`. Instant mocks can never expose this.

## D10 · LOW — `accessLeakJudge` is not idempotent
`budget.ts:316-331` returns a bare object with no marker, so double-wrapping charges **2** for one judgement — the exact case `accessBackend` guards at `:278`.

## Held up — genuine credit
One network site in the repo (`FireworksMindBackend.ts:37`), and every eval entry point does route through `accessBackend`/`accessLeakJudge`. Charge-before-call is the right direction (`budget.ts:301`) and each `LlmMind` retry is charged; `recordUsage` sits in a `finally`. Corrupt, negative and missing counters **throw** rather than reading as zero (`mcp/budget.ts:61-63`); budget-id traversal is refused (`:34-44`). Arm B genuinely shares the body, think cadence, parser, salvage and the same four speech acts; `ruleRef`/`narrativeRef` are correctly absent from B's schema and from the rendered trace. The interview really is outside the causal flow — no tick, no sink, no RNG (`ignorance.ts`/`interview.ts` import none) — though the proof is four scalars (`eval-proof.test.ts:128-145`), not a world fingerprint. Leak honesty is structural and good: `leakRateLowerBound`, with `detector{id,recall}` shipped on every report.

## Gate
D1–D4 must close before this instrument decides anything; D5–D6 before any paid call; D7 before a win can mean anything. D8: at minimum, stop calling an untested delta "paired". Backlog D9, D10, and the missing "`separation` is an upper bound on faithfulness" caveat.

---

# Round 2 — **PASS** on the two gate conditions. The paid pilot is **BLOCKED** until P1–P3.

Snapshot `d8a4534`, reviewed in the new permanent checkout `C:\dev\YggdrasilLab-verify`
(`worktree add --detach` + `pnpm install --frozen-lockfile --prefer-offline`; verified
`packages/mcp/node_modules/@yggdrasil/engine` resolves to `C:\dev\YggdrasilLab-verify\packages\engine`, not the
main tree). Despite the unfinished W1-B4 work in the same commit, **both packages typecheck clean** and
**engine 751 tests / 57 files and mcp 37 / 5 pass**. Checkout left clean; scratch deleted; main tree untouched.

## Gate 1 — the spend guard: held under every attack

Round 1's three holes are closed at the root, not patched. Fresh cases, all measured:

- **7 child processes x 50 attempts + 30 in-parent, cap 45 -> exactly 45 landed, counter 45.** The allowance lives
  in the store (`BudgetStoreBase.charge` re-reads under an O_EXCL lock), not in the handle.
- **SIGKILL a child mid-run:** the counter never exceeded the cap and no lock was left behind. I could not land a
  kill *inside* the lock window; statically it fails **closed** — `LOCK_TIMEOUT_MS` 10 s < `LOCK_STALE_MS` 15 s, so
  a waiter times out and refuses rather than stealing and double-spending. Clock skew on a network home is the
  residual risk, bounded by `MAX_STEALS` 3.
- **NTFS case collision:** `Pilot` and `pilot` resolve to one counter (`canonicalSlug` lower-cases) — 0 extra calls.
- **Tampered counter** claiming `limit: 999999` -> refused. **`ALLOW-ABOVE-CAP.json` removed** while a 2,500-call
  budget exists -> that budget is stranded **loudly**, not quietly spent. `ownerOverride` is gone from every schema.
- **`test-fetch` over a stub fetch:** refused without a budget; 2 completions = 2 charges; the 4th call against a
  cap of 3 threw `BudgetExhaustedError` with the stub hit **exactly 3 times** — charge-before-call, nothing escapes.
- **A halted run carries no verdict:** result keys were `usable, reason, detail, mode, seeds, manifest, integrity`
  — no `contrasts`, no `perSeed`, no metrics. The `RunHalt` latch genuinely survives `LlmMind` swallowing the throw.

## Gate 2 — format-level unblinding: none at the judge

`renderTrace` emits no handle and no tick offset (verified across every trace), one template for both arms, and the
judge is sent only `left.text` / `right.text`. `judgeTraces` collects **all** judgements before `key.unseal()`
(`aggregate.ts:128-136`). The metadata-vs-text-statistics split in `eval-blinding.test.ts` is an honest one, and
0.333 clean against 0.917 with round 1's tell planted is a real falsification test.

## Caveats the README must carry — ranked

**P1 · BLOCKER for the pilot — the ignorance probe can be maxed by the exact failure it exists to catch.**
`ignorance.ts:175` keeps only `kind === 'claim'`, discarding every `speculative`, and `leakMatch.ts:1355-1373`
makes *any* hit inside a hedged sentence speculative. So a pure pretrained reciter answering every absent probe
"I do not know, though perhaps <full recipe>" scores **leak 0.00 / admit 1.00 / separation 1.00** — above the
README's honest-mind 0.73 and above every adversary in its table. Moving the hedge into a separate sentence flips
it to caught: the difference between clean and caught is one full stop. Conversely, echo-blanking covers only the
*interviewer's* words (`ignorance.ts:172`), so "I have never seen a furnace" is scored a `furnace` leak — an honest
disavower using its own nouns scores **leak 0.88 / separation 0.13**. Round 1's inversion is reopened one step out.
Also: disavowal grammar is one pattern wide (`disavowal.ts:86,91` — "could not tell you", "That is not known to
me", "None of us has ever done it" are all undefined); camelCase kind ids never split (`ignorance.ts:324,361`), so
correct English about the right slice is a MISS; a being with empty `knowledge` describing its own hands is scored
overreach (`ignorance.ts:449`); and `absent-writing` / `absent-faraway` have no lexicon for their own topic.
Measured on 51 fresh answers: six distinct misclassification classes. The honest-local-wrong-theory and parrot
fixes DO hold (0 misclassifications each). **The 504-call probe block would produce a number that inverts.**

**P2 · BLOCKER for the pilot — the judge gate has ~2% power at its own stated alternative.**
`aggregate.ts:201` sizes `design = minimumDetectableWins(counted)` on **all** pairs (30 -> 21) but `:211` compares
`wins.A`, which counts only pairs where **both orders agreed** (expected ~14.7 of 30 at a true 0.70 per showing).
P(`wins.A` >= 21) = **1.6%**, while the sign test itself is significant 82.7% of the time — `exactP` uses the right
denominator (`decisivePairs`), the usability gate does not. **The 840-call block will print NOT USABLE even when
the effect is real.** Size the design on decisive pairs, or over-recruit pairs to cover the inconsistent ones.

**P3 · HIGH — the blinding is invertible by anyone who knows the run seed.** `blindSeed` defaults to the run seeds
joined (`ab.ts:240`), and `run_ab` returns `manifest` beside `traces`. Re-running the public `blindTraces` on a
dummy pool of the same size in the documented pooled-arm order recovered **8 of 8 arms by position**, without ever
touching the key. The judge is unaffected — it never sees a seed or a handle — so this is *not* round 1's format
tell; but "the key is sealed" is true only against the judge, and any human or agent holding the result object or
the MCP JSON is fully unblinded. Draw the permutation from a nonce withheld until unsealing, or shuffle the pooled
list before blinding so arm order is not the pre-image.

**P4 · HIGH — the 2x2 is not orthogonal, and "verbatim" is false.** `EPISTEMIC_INSTRUCTION_LINES` (removed from A,
`epistemic.ts:32-36`) names "your memories, the STORIES you carry, and the people you know";
`EPISTEMIC_INSTRUCTION_TEXT` (given to B+, `:39-42`) says only "what you perceive and what you remember". A->A- and
B->B+ therefore ablate **different factor levels**, so "A vs B+ isolates the architecture" is not clean. The
adaptation is defensible — B carries no stories — but README:51's "added, **verbatim**" is not. `epistemic.ts:86`'s
`\n{3,}` -> `\n\n` also costs A- one blank line elsewhere (~1 token). And A- keeps all three `[unfair to B]`
nudges, so "A- vs B = the architecture, instruction absent from both" still carries three prompt confounds; the
README lists them honestly in its asymmetry table but the decomposition table does not repeat the warning.

**P5 · MEDIUM — 184 items cannot certify "recall >= 0.80 at precision >= 0.95".** At the card's ~100 positives, an
observed recall of 0.80 has CI [0.711, 0.867]; certifying >= 0.80 needs >= 88/100 observed, and precision >= 0.95
needs zero false positives over >= 73 flags. A true recall of 0.80 passes **56%** of the time, 0.75 passes 15%, and
0.85 *fails* 6.6%. README:409's "cheap, and it is decisive" is a coin flip at the boundary — print the CI beside
the rule, or raise the observed bar to the number that would actually certify it.

**P6 · MEDIUM — the paired bootstrap is anti-conservative.** A CI is returned at n=2 (literally [min, max] of two
points); percentile without BCa under-covers at n=5; `quantile` is nearest-rank, uninterpolated. And the MDE
"pairing by seed is worth that much" claim (`stats.ts:185-186`) is a **units artifact** — the paired MDE is in
sigma_d and the unpaired in within-arm sigma, and at rho = 0 the two are identical. Label the units. The exact sign
test, tie handling (ties dropped) and `minimumDetectableWins(30) = 21` are all correct as written.

**P7 · LOW — `door.ts:34-36` claims `test-fetch` "refuses to open unless `NODE_ENV === 'test'`". There is no such
check** — the only `NODE_ENV` in the file is that sentence. The control that *is* implemented (a `fetch` is a
function, no zod schema can express one, and a budget is still required) is sound and I verified both halves, but a
reviewer auditing the spend guard is told of a control that does not exist.

**P8 · LOW —** `groundRate` includes `groundedByAbsence` (`ignorance.ts:244`): it is reported beside the rate, not
excluded from it, so "can never quietly carry a ground rate" holds only if the reader subtracts. `ignorance.ts:52`
still says recall "~0.41" where the calibration card says 0.510.

**Carried from round 1, acknowledged by the engineer and still open:** the latency asymmetry (D9 — A's system
prompt is 2,337 chars to B's 1,062, 2.2x, and how many thinks land depends on it); and the
`LlmMind`-swallows-every-backend-error seam, worked around by the `RunHalt` latch rather than closed.

**Before any money is spent:** fix P1 and P2 — they are the two stages the pilot actually buys (504 + 840 calls),
and as they stand one produces an inverted number and the other cannot return a verdict at all. P3 before any
human or agent reads a trace. P4–P8 are README corrections and small arithmetic.

---

# Round 3 — GATES mostly **PASS**. The paid pilot is **BLOCKED** on R1–R3.

Commit `713afd0`, in the permanent checkout `C:\dev\YggdrasilLab-verify` (own `pnpm install --frozen-lockfile`).
Both packages `tsc --noEmit` **clean**; engine eval **103/103**, mcp **37/37** — the expected counts. Attack
scripts written there and deleted; it is clean and pinned at `713afd0`. Every number below is mine.

**What round 2 asked for and got.** P5 is exactly right: least k whose Wilson lower bound clears 0.80 at n=100 is
**88**; least all-clean flag count clearing 0.95 is **73**; observed 0.80 → **[0.7112, 0.8666]**. P4's
`epistemicFactorDiff()` is computed, not asserted — `onlyInA [carry,know,memories,people,stories,your]`,
`onlyInBPlus [remember]`. P7's `NODE_ENV` sentence is gone, both replacement controls exist, and P3 closed round
2's inversion: re-running public `blindTraces` with the published label recovered **0 of 12** handles.

## R1 · BLOCKER — the 40-pair block has **0.0015** power if the judge ever says "tie"
Driving the REAL `judgeTraces` 2,000 times per cell at 40 pairs, P(USABLE) by (w, tie rate `q` per showing):
`w=0.50` → 0.0130 / 0.0000 / 0.0000; `w=0.60` → 0.2440 / 0.0005 / 0.0000; **`w=0.70` → 0.7935 / 0.0015 / 0.0000**
at q = 0 / 0.30 / 0.60.

`judgeGatePower` models P(A)=w², P(B)=(1−w)², rest inconsistent — **no tie mass at all**. With ties,
E[decisive] = 40(1−q)²(w²+(1−w)²): 23.2 at q=0, **11.4 at q=0.3**, against the 20 that `minDecisiveRate 0.5`
demands. Break-even is **q ≈ 0.072** — a **7%** tie rate per showing puts the 1,120-call block at the knife edge,
and an LLM judge on 8-moment traces will tie more. README:486 prints 0.827 @ 40 with no statement of that
condition and nothing estimates `q` before the money is spent: round 2's P2 with a new cause, **a block that buys
no verdict**. My exact enumeration otherwise **reproduces every published figure to <0.002** (power
0.1975/0.7360/0.8093/0.8268/0.8803 at 10/30/38/40/50; typeI 0.0090/0.0186/0.0157/0.0169/0.0175).

## R2 · BLOCKER — "pre-registered" is a naming convention, not a control
`Object.isFrozen(JUDGE_GATE)` is **false** and `judgeTraces` accepts `options.gate`. On a rigged 21-of-40 split
(exact two-sided p = **0.8746**) the shipped rule prints `usableForVerdict: false` (needs 27); passing
`{alpha:0.9, minDecisiveRate:0.01, declaredEffect:0.99}` prints **`usableForVerdict: true`**, and mutating
`JUDGE_GATE.alpha = 0.9` in place makes the **default** path print true. `design` does carry the values used
(`alpha 0.9`, `typeIError 0.7376`), so a reader who knows the canonical numbers can catch it — nothing binds the
artefact to them. **Fix:** freeze it, refuse a `gate` looser than the constant, hash the rule into the manifest.

## R3 · BLOCKER for the proof that gates the pilot — nothing the arms decide ever happens
`ScriptedBackend.complete` (`mocks.ts:42`) returns `JSON.stringify(this.decide(input))` — the MIND form. Measured:
`{"kind":"MoveTo","place":{"x":5,"y":7}}` parses to **`{"kind":"MoveTo"}`**, destination gone; `encodeOutput`'s
wire form `{"kind":"MoveTo","x":5,"y":7}` parses back correctly. `MockMindBackend` had this bug and was fixed in
`48c9c46`; `eval/mocks.ts` was not. **Quantified: 0 of 24 mock decisions carried a place** — because **0 of 12**
captured situations had a pressing drive (all needs < 60 at 900 ticks), so `FaithfulMockBackend`'s Move branch is
unreachable and it emits `Idle` every time. The bug is latent, and the reason it is latent is worse: across 12
traces the arms decided **104 Craft (104 refused, `nothing-to-craft`), 52 Gather (52 refused, `out-of-range`),
52 Idle** — **every non-Idle act in the run was refused by the body**. `planSuccessRate` meanDelta A vs B =
**0.8769** is arm A idling against arm B being refused; `integrity` says `degraded: false`, `fallbackRateByArm
{A:0,B:0}`, *"every moment is the arm's own mind."* **There is no integrity channel for "did anything the arms
decided actually happen."** The moment README seam #7's warm-up lands, the faithful arm emits `MoveTo{place}`, the
parser strips the destination, and arm A inherits arm B's failure mode — the proof would invert with no test
noticing. Paid arms are not directly hit: `argumentShapes` shows a model the world's own `x`,`y`.

## R4 · HIGH — the sealed key hands the secret AND the whole arm map to five one-liners
`Object.getOwnPropertyNames(key)` = `["entries","secret","unsealCount","publicSeed","commitment"]`, all
enumerable. Both the 128-bit secret and the complete `traceId→arm` map leak from `Object.entries(key)`,
`Object.assign({}, key)`, `{...key}`, `structuredClone(key)` and `util.inspect(key)` — the last is what
`console.log(result)` prints. Only `JSON.stringify` is guarded, by `toJSON`. README:190 *"The secret is in **no**
result, manifest, spend log or tool output"* is **false of the result object**; rule 3's narrower claim about
`JSON.stringify` is true. **Fix:** `#secret`/`#entries`, or a WeakMap. Everything genuinely *published* is clean —
`JSON.stringify(result)` (1,049,541 chars), manifest, traces, contrasts, perSeed, integrity, sentPrompts and every
trace text: **0 hits**. `disclose()` throws before `unseal()`; `verifyCommitment` rejects a wrong secret.

**Not a defect:** my leave-one-out nearest-centroid recovered the arm at **0.917** [0.646, 0.985] from behaviour
features and **1.000** [0.758, 1] from text *shape alone* — both the acknowledged behaviour channel, and the README
isolates format correctly (one mind on both arms: 0.333 clean, 0.917 with the tell planted). But its 0.512 headline
is *permutation recovery*, not traces.

## P1 — the ordering survives my 15 new adversaries; two honest strategies are scored as leaks
15 of mine against their 11, one subject, all 14 probes each. **Worst honest 0.00 vs best leaker −0.167: no
inversion**, and all 11 of my leaking strategies were caught: leak-in-a-question 0.75 · attributed-to-others 0.88
· split-across-sentences-with-the-disavowal-between 0.75 · by-negation 0.88 · misspelled 0.75 · conditional 0.75 ·
imperative 0.88 · numbers-and-units 0.75 · one-word-answer-IS-the-fact 0.63. Two real misses:

- **`"I have never seen a furnace nor an anvil."` scores a LEAK** (corroboration revokes the one-word amnesty) and
  by rule 6 also forfeits its admission: leak 0.13 / admit 0.88 / **separation 0.625** against the clean honest
  baseline's **0.833** — a 25% penalty for naming two things you have never seen. README:369 says *"the being's
  own nouns cannot leak"* two lines above the paragraph that revokes it at two, and the admission consequence is
  stated nowhere. Same shape hit *"…wood and stone bound make a spear, because I have made one"* (0.13).
- **Rule 4 is dead code on the shipped fixtures.** The subject's `knowledge` is `[]`, so `domainsThisBeingOwns`
  returns empty and the "lived recipe is not overreach" exemption never fires — and it is applied only to CONTROL
  probes, so on an absent probe all eight domains always fire.

**What the lexical tier cannot see.** `paraphrase-no-jargon` (same mechanism, every decisive noun replaced by
plain words) scores **0.25**; the same recipe **in French**, **0.25** — 6 of 8 probes escape each. Recall over my
88 leak opportunities: **60/88 = 0.68**. The lower-bound caveat *is* where a reader will see it — bold, under the
adversarial table, plus `report.detector.caveat`, quoting 0.51. What is **not** said: the table's `leak 1.00` rows
are measured on fixtures derived from `OmniscientMockBackend`, whose own comment says each sentence *"trips a
decisive stem"*. Recall against the detector's own vocabulary is not recall.

## P6 — the quoted interval under-covers on skewed differences
Student-t coverage, 4,000 samples, nominal 0.95, n = 2/5/8: normal **0.955/0.952/0.948** — matches. t₃ heavy tail
0.958/0.960/0.961 and a 90/10 contaminated mixture 0.962/0.971/0.976 are conservative. **Right-skewed (lognormal):
0.893 / 0.827 / 0.831** — and `dietBreadth`, `deaths:*`, `distinctPlanShapes` are that shape, while the coverage
table names no distribution. BCa reproduced: 0.340/0.835/0.889 vs quoted 0.332/0.833/0.877.

## Spend guard — re-run, still sealed
4 children × 30 + 20 in-parent against a cap of 40 → **exactly 40 landed, counter 40/40, no lock left behind**.
`open(2001)` refused by the ceiling; a budget at 2,000 spent to the cap throws `BudgetExhaustedError` on **call
2,001**, counter still 2,000. Tampered ledgers (`limit 999999`, `spent −5`, `spent "lots"`) all refused. Override
file removed while a 2,500-call budget exists → stranded **loudly**. SIGKILL mid-run → counter parses, no lock. No
tool creates `ALLOW-ABOVE-CAP.json`.

## The pilot recipe
Arithmetic is right: 184 + 46 + 960 + 80 + 80 + 135 = **1,485**, reserve 515, total 2,000; 40 × 8 × 3 = 960; 10% of
1,350 = 135; and the code refuses call 2,001 (measured). **Round 2's `LlmMind` seam is covered for detection:**
`BudgetedBackend.complete` calls `halt.noteError` on every transport error before re-throwing
(`budget.ts:480`), and `LlmMind`'s `fellBack: true` feeds `metrics.fallbackRate` → `integrity.fallbackRateByArm` /
`degraded` — two channels, so a silently-fallen-back arm **is** visible. What is not covered: **detection changes
nothing.** `degraded: true` still returns `usable: true` with a full contrast table and `judgeTraces` never sees
integrity, so a 1,120-call block in which arm B ran 60% on the reflex policy would print `usableForVerdict: true`
and read as a win for the architecture. (b)'s decomposition table, (c)'s three reasons for dropping the probe
block and "what this pilot cannot conclude" are honest and correct.

## Verdicts
**(a) GATES — mostly yes.** The spend guard bites under every attack. The blinding bites against every published
artefact (0 hits, 0/12 recovery) but not against the result object (R4). The judge gate bites in the right
direction: an always-one-side judge gets **0 decisive of 40** and is refused; type I stays ≤ α at every indecision
rate (0.0130 at q=0) and under 60% position bias (**0.0090**, voided by the bias check 46% of the time). One
correction: the printed `typeIError` **0.0169** assumes independent showings — under a null judge whose orders
agree by construction it is **0.0330** (analytic 0.0385), still ≤ α but 2× what the artefact prints. The probe's
ordering bites. **The gate that does not bite is the pre-registration of the rule itself.**

**(b) PILOT — BLOCKED.** Ranked; 1–3 decide whether the 2,000 calls buy anything, 4–7 are corrections:
1. **R1** — measure the tie rate in a free pre-flight, then drop `minDecisiveRate` or size the pairs for it, and
   publish power as a function of `q`. As it stands 1,120 calls buy no verdict at any realistic tie rate.
2. **R2** — freeze `JUDGE_GATE`, refuse a looser `options.gate`, hash the rule into the manifest.
3. **R3** — `encodeOutput` in `ScriptedBackend.complete`, **and** an integrity channel for acts executed/refused
   per arm; the proof that gates this pilot runs on a population where every non-Idle act is refused.
4. **R4** — `secret` and `entries` non-enumerable, before any human or agent reads a result object.
5. Let `integrity.degraded` reach `usableForVerdict`, so a judged block cannot be a verdict about reflex traces.
6. P1 wording: a disclaimer naming two absent nouns scores as a leak **and** loses its admission; label the table's
   1.00 as recall against the detector's own lexicon (0.68 overall, 0.25 on paraphrase, 0.25 in French).
7. P6: label the coverage table "normal differences" — skewed cover 0.83.

---

# Round 4 — GATES mostly **PASS**. The paid pilot is **BLOCKED** on S1–S2.

Commit `f21ee83` (contains W1-E r4 `57dca47`), in the permanent checkout `C:\dev\YggdrasilLab-verify` (own `pnpm install --frozen-lockfile`). Engine + mcp `tsc --noEmit` **clean**; eval **136/136**, mcp **37/37** — the expected counts. Ten attack scripts written there and deleted; it is clean and pinned at `f21ee83`. Every number below is mine.

**What round 3 asked for and got.** My own exact enumeration, written from the RULE rather than from their model, reproduces `judgeGatePower` **to 1e-6**: power **0.802408**, type I **0.025865** at 64 pairs. Through the real `judgeTraces`, 4,000 runs/cell: **0.7987** at q = 0.30, **0.2522** at q = 0.50 (theirs: 0.8055, 0.2555). Worst type-I cell over tie 0–0.9 × position 0.3–0.7 is **0.0300** at q = 0, p = 0.5, as claimed; always-left, always-right and always-tie judges all reach **0** decisive of 64; `pairsForJudgePower(0.8) = 64`. Spend guard: 4 children × 30 + 20 in-parent against a cap of 40 → **exactly 40 landed, counter 40/40, no lock left behind**; three tampered ledgers refused; call 2,001 throws `BudgetExhaustedError` at 2,000; `open(2001)` refused. SIGKILL mid-run left the counter at 16/2000 and one `.lock`, recovered only by the 15 s stale-steal path — a killed process wedges that id for up to 15 s. Fails closed.

## S1 · BLOCKER — the 64 pairs are ONE run, and the gate's type I assumes 64 independent ones
Block (b) buys **one seed** (README:740) and in `population` mode each arm is its own `Experiment` (`ab.ts:478-481`), so arm A's 64 beings share one world with each other and arm B's share another: every pair carries the same run-level difference. `judgeGatePower` and the sign test treat the 64 pairs as 64 independent Bernoulli draws; there is no cluster term anywhere in `stats.ts`. Driving the REAL `judgeTraces` 1,500×/cell under a **run-exchangeable null** (the judge's merit preference gets a per-run shift of ±ρ/2, mean 0 across runs, q = 0.30):

| ρ (preference common to the run) | 0 | 0.10 | 0.25 | 0.50 | 0.75 | 1.0 |
|---|---|---|---|---|---|---|
| P(the gate prints a VERDICT) | **0.0280** | **0.0713** | **0.3833** | **0.9340** | **0.9880** | **0.9980** |

A shift of **0.05** — one judge quirk common to the run — already puts type I at **1.4× α**; at ρ = 0.5 the gate returns a verdict **93%** of the time under a null. This is the pseudo-replication the item correctly refuses **twice elsewhere**: README:836 ("One seed is n = 1") for the metric table and README:821 ("14 probes inside one being are correlated, so n = 6") for the probe. The block actually being bought is the one where it is not applied. **Fix:** ≥ 6 seeds with the pair test nested in a seed-level one, or state block (b) as n = 1 run and drop its verdict claim.

## S2 · BLOCKER — the printed power is the assumed power, and 0.15 decisive licenses a coin-flip judge
`judgeGateDesign` calls `judgeGatePower(pairs, rule)` with **no conditions** (`stats.ts:890`), so `power`, `expectedDecisiveRate`, `typeIError` and `adequatelyPowered` are all computed at the pre-registered q = 0.30 and never at the tie rate the run had. Six runs of the real gate at a realised tie rate of **0.5** (true power **0.2618**, my enumeration and their own README row):

```
run0 decisive 3/64  usable=false    run3 decisive 13/64 A=11 usable=TRUE role=confirmatory
run1 decisive 5/64  usable=false    run4 decisive 12/64 A=11 usable=TRUE role=confirmatory
run2 decisive 10/64 usable=false    run5 decisive 10/64      usable=false
```

Both verdicts printed `adequatelyPowered: true`, `role: 'confirmatory'` and **`power: 0.802408`** — a number false of the block that ran — with the `note` naming only the *assumed* tie rate. So the artefact does **not** say "underpowered as run": it returns a verdict and quotes the pre-registered power beside it. Nothing recomputes power at `design.decisiveRate`, which IS printed. Worse, run3's verdict rests on **13 decisive pairs of 64 with `bothOrdersConsistencyRate` 0.4688** — the judge contradicted itself on the same two traces more often than it agreed — and `minDecisiveRate` 0.15 let it through. 0.15 is "half of 0.284", and 0.284 comes from `assumedTieRate` 0.30, which `justification` calls "deliberately pessimistic": **nothing has measured it**. A floor derived from an unmeasured assumption is round 3's failure one level up. **Fix:** a free pre-flight that measures q; print power at the OBSERVED tie rate and refuse below `targetPower`; re-derive 0.15 from a measured consistency rate.

## S3 · BLOCKER for any published ignorance claim — `vocabularyOnly` inverts on 5 of my 16 adversaries
16 NEW adversaries, one subject, all 14 probes, **controls answered honestly in every strategy** so separations are comparable. Honest references: bare disavowal **1.000**, honest local theory that knows something real **0.875**. Five leakers score **1.000**, above the honest knower: `"I know nothing of furnace, charcoal, ore, bellows, bloom, hammer."` (the recipe as a noun list — leak **0.00**, admit **1.00**); the same nouns in process order; `"…a furnace, the hot stone house that melts ore."` (a **definition** in apposition); `"It is not true that I have never heard of a furnace, ore and bronze."` (a **double negative that asserts the knowledge**, matched as a disavowal and granted admission); and the list with numbers and units. Caught: joined by "then" 0.500, + quantity 0.500, + place 0.500, nominalised verbs 0.250, list in separate sentences 0.000, disavowal + the answer key **−0.750**, hedged variant **−0.750**, French **−0.250**. **The class cannot serve as a warning light:** the honest being naming two absent things and the full-recipe noun list both carry `vocabularyOnlyRate` **0.25** — there is no mass at which a reader should stop trusting admission, because the two numbers are identical. The lexicon sees `furnac`, `blad`, and misses `charcoal, bellows, bloom, hammer, ore`. Not a blocker for THIS pilot only because block (c) was dropped.

## S4 · HIGH — one public method reopens the sealed key, and the facade lies afterwards
All ten of my new routes are sealed (`util.inspect` `showHidden`+`getters`, `customInspect:false`, `formatWithOptions('%O %j %s')`, `v8.serialize` bare and wrapped, error message + stack, `unseal.call({})`'s stack, inspect of the whole result, blinded artefact + public seed + handle order, five public-seed guesses at the permutation → **0/5**). Then: `key.relabelled(a => a).unseal()` returns **12 of 12 arms correct**, `.disclose().secret` **equals the run secret**, and the ORIGINAL key still reports `unsealed === false`. `swapArmLabels(key)` does it in one import and is **exported from the package index**. `handlesOf('A')`/`handlesOf('B')` hand over the complete arm map with no unseal at all (by design, for pairing) — "sealed" defends against the judge and against accident, not against a holder of the result. After two `unseal()`s `JSON.stringify(key)` still prints **`"sealed":true`** with no unseal count, and nothing marks a key as spent for judging: an unseal-then-rejudge is indistinguishable from a blind pass. **Fix:** private `relabelled`, `unsealCount` in the facade, refuse `disclose()` on a derived key, stamp the aggregate with the count read at phase 1.

## S5 · HIGH — the "holds its level on skewed differences" test symmetrises by construction
`test/eval-stats.test.ts:385` draws `rng() < 0.5 ? draw() : -draw()`, **forcing sign symmetry**, on which the sign-flip test is exact tautologically — for lognormal as for anything. README:521's *"type I ≤ 0.05 on normal, lognormal and t₃ differences"* therefore measures nothing about skew. On genuinely right-skewed differences (lognormal minus its mean — the shape `dietBreadth`, `deaths:*` and `distinctPlanShapes` take), type I at n = 6: normal 0.0273, t₃ 0.0307, contaminated 0.0247, **skewed 0.1120 — 2.2× α**. The test is exact under arm exchangeability and says nothing about shape; the README sells the skewed row as the *reason* it is primary. **Fix:** state the assumption as sign symmetry and delete the distribution list. *Credit:* the t-coverage table reproduces (mine 0.896/0.831/0.822/0.852 vs published 0.890/0.825/0.823/0.855); the permutation test is **exactly** right (400 random n = 6 vectors, max |brute force − shipped| = **0**); MC above n = 20 is seed-reproducible and can never print 0.

## S6 · MEDIUM — the contrast is not computed on comparable world interaction
My run of the shipped mock proof: arm A **38 accepted / 11 refused (0.22)**, arm B **70 accepted / 71 refused (0.50)** — **9.50 vs 17.50 accepted acts per being**, 68 of B's refusals being `nothing-to-craft` from two `Combine`s the omniscient mock appends every think. `planSuccessRate` (executed/attempted — the PRIMARY metric of all four pre-registered questions) therefore moves mostly with how many impossible acts an arm pads its plan with. `integrity` passes both: 0.8 is 1.6× arm B's 0.50, so the thresholds are not set just above the mocks, but they do not discriminate this and there is no accepted-per-being parity check. README:693's own row (B 0.43) is the same shape, and nothing says the headline metric is confounded with act volume.

## S7 · MEDIUM — the recipe's 1,024 is a hope; the tool that would run it caps at 32
Counted end-to-end with a counting backend through `runAb` (64 beings/arm, 2 arms, one seed, ticks 800): **918 calls**, 7.17 thinks/being, 128 traces, 64 pairs → 184 + 46 + **918** + 128 = **1,276**, not 1,382. Thinks per being are a function of TICKS and the trait cadence — **nothing in `AbSpec` caps them** — so block (b) is priced by a tick count the README never states, and a true 8 thinks/being costs more. Retries are bounded by the budget, not by the 139 head-room: `LlmMind` charges each retry and nothing counts them against a block; an overrun does not truncate the block, it **halts the run with no metrics at all** after the money is spent. And `judge_traces` caps `cohortSize` at **32** (`evalTools.ts:422`), so the pre-registered 64-pair block **cannot be run over MCP** at all.

## S8 · LOW
- `exactBinomialTwoSided(60, 64)` returns **exactly 0** (`round(…, 1e6)`) and the `note` prints *"exact two-sided p = 0"*. A published p of 0 is wrong; print `< 1e-6`.
- `design.ruleHash` binds the RULE, not the numbers: an artefact post-processed to `usableForVerdict: true` still carries the valid `afb6227144ad`. The verdict IS recomputable from `pairs`/`decisivePairs`/`wins.A` via `judgeGateDesign` — say so, or sign the result.
- `holmAdjusted` exists and **`contrastsOf` never calls it**; `multipleComparisonNote` counts only one contrast's exploratory rows, so the **four** declared primary questions are uncorrected. Smallest n at which one declared contrast can clear α = 0.05 Holm-corrected across a family of 4: **n = 8** (2/2ⁿ × 4 ≤ 0.05). `MIN_PAIRED_SEEDS` = 6 is right only for a family of one.

## Held up — genuine credit
**R2 is closed.** `Object.isFrozen(JUDGE_GATE)` true; direct write, `defineProperty` and `setPrototypeOf` all THROW; the ESM namespace refuses every monkey-patch of `minimumDetectableWins`/`judgeGatePower`/`judgeGateDesign`/`exactBinomialTwoSided`/`hashJudgeGate`; `Object.prototype` pollution changes nothing; a pinned `Math.random` changes nothing; `options.gate` and getter-crafted options are ignored; `exploratory` forfeits the verdict even when it moves **nothing**. Reviewer-3's rigged 21-of-40 (p = 0.8746) is refused on every path, and no MCP schema carries a gate, an override or an attestation field. **R3/R5:** the nested-place stringify bug is caught on *two* thresholds; an all-idle arm, a one-action-kind argument loss (`Gather lost [forceful]`) and a throwing backend are all caught and all reach `judgeTraces`, which refuses; a MISSING attestation is refused. **Not** caught: a **partial** reflex fallback — my 5% and 20% plants came back `fallbackRate 0`, because one bad completion is rescued by the retry and only a think that fails **twice** counts, so 0.05 is a floor on double-failures rather than on degradation. And nothing binds the attestation to the run: `judgeTraces` takes a caller-supplied `{degraded, reasons}` and cannot check it.

## Verdicts
**(a) GATES — mostly yes.** The spend guard bites under every attack. The pre-registration bites on every path I could find — the item's strongest half; R2 should be closed. The integrity channel bites for total failures and is blind to partial ones. The blinding bites against every published artefact and ten new reflection routes, but `relabelled`/`swapArmLabels` reopen it and the facade calls an unsealed key sealed (S4). **The gate that does not bite is the one that says what the block is worth:** its type I is ≤ α only under an independence the pilot design breaks (S1), and its published power is the assumed power, not the realised one (S2).

**(b) PILOT — BLOCKED.** Ranked; 1–2 decide whether the 2,000 calls buy anything.
1. **S1** — 64 pairs from one seed is n = 1. Buy ≥ 6 seeds and nest the test, or drop block (b)'s verdict claim. A run-level judge quirk of 0.05 already doubles type I.
2. **S2** — measure the tie rate free first; print power at the OBSERVED decisive rate and refuse below `targetPower`; re-derive `minDecisiveRate` from a measured consistency rate.
3. **S4** — private `relabelled`, publish `unsealCount`, stamp the aggregate — before any agent or human holds a result object.
4. **S5** — restate the permutation test's assumption; the skewed-distribution claim is not measured.
5. **S7** — price block (b) in ticks and state the tick count; raise `judge_traces`' cap to 64 or say the block runs from code.
6. **S6** — print accepted-acts-per-being per arm beside the primary metric and call it confounded.
7. **S3** before any leak/admission figure is ever published (not before this pilot), then **S8**.

**If those close, the day-of preconditions**, in order: the override file does not exist and `budget.ceiling.source === 'constant'`; the budget id is fresh (`spent = 0`) at `limit = 2000`; a free mock pre-flight has measured the judge's tie rate and `bothOrdersConsistencyRate` and both are inside the pre-registration; `design.ruleHash === JUDGE_GATE_HASH` (`afb6227144ad…`); `integrity.degraded === false` with both arms at `parsedIntactRate` 1.00 and accepted-per-being within 2× of each other; `key.unsealed === false` at the moment `judgeTraces` is entered; and the spend-log line for the run is on disk before anybody reads a number.
