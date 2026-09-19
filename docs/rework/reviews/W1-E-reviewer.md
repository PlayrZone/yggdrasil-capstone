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
