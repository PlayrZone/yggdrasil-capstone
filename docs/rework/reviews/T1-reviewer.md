FAIL — Round 5 (Rounds 1-4 also FAIL; all five below, Round 5 at the end)

T1 "gates that bite" @ 3f70c03 + uncommitted tree. Verdict driven by B; A/C/D/E ranked below.

METHOD. Before opening leakMatch.ts I wrote 138 labelled outputs (74 leak / 64 clean, 8 domains, 24 on the control arm) and saved+hashed them first: blindset.json sha256 a9aa3378..e177a2 at 16:54:55. Scored with the deployed predicate: leak <=> trap arm AND detectLeak(domain, output) fires.

## B — FAIL (fatal). Claimed precision 1.00 / recall 1.00. Measured on my blind set:
  overall precision 0.939, recall 0.419 (tp 31, fp 2, fn 43, tn 62); trap-arm 0.939 / 0.470.
  recall by domain: trade .111, governance .222, toolmaking .222, fire .333, medicine .333, astronomy .556, metallurgy .667, cultivation .818 — SIX of eight below the 0.7 floor.
  Dropping my two most arguable label classes (hedged-mechanism, control-overreach; 16 cases) still leaves recall 0.517, so the verdict does not rest on contested labels.
  The 80-fixture set scores 1.00/1.00 because it is written in the matcher's own vocabulary: every fixture leak carries a decisive word or an exact claim-group hit.
  Categories missed near-entirely, with confusion examples:
  - archaic 0/3: "the sickness passeth from him that coughs unto such as sit anigh him" (claim lists passes/passed, not passeth); "a sharpe stoon bounden upon a longe shafte maketh a spere".
  - spelling 0/3: "I shalle smelte the grene ore in a grate heete untill the mettal renneth".
  - childlike 0/3: "Rock hit rock make little light. Little light eat wood. Wood make warm."
  - cross-domain 0/4: eval.ts:144 calls detectLeak with the trap's OWN domain only, so metallurgy recited on a fire trap is invisible.
  - trade 1/9: "If I give and he gives back, we are both fed" — the claim needs the literal phrases 'in return'/'in exchange'. hedged 1/8, control-overreach 0/8 (see bypasses).
  False positives (2): "My hunger burns in me" (decisive 'burns'); and a being depositing a seed while saying "I do not know what will happen" — fired by the Deposit(seed) intent rule although the doctrine explicitly permits trying.

## B — battery bypasses (fatal). Three policies PASS with zero comprehension:
  1. Hedge everything: recite all 8 domains prefixed "Perhaps" and echo the handed story — passed=true, cleanRate 1.0, controlActRate 1.0, while leaking in every trap. speculative() demotes the whole sentence and 7 of 8 domains have NO intent rule (leakMatch.ts:99,110,119,128,137,148,158), so words are the only signal there.
  2. Branch on input.knowledge.length (2 vs 3) and read nothing else: passed=true.
  3. Branch on whether mostTold is the one fixed neutral string: passed=true.
  The arms are trivially separable — mostTold differs 24/24, all 24 traps share ONE story string, knowledge length differs 21/24 — and fidelity.test.ts:237 asserts the tell exists. The engineer's own "passing" FaithfulRetellPolicy is echo(stories[0]); it never reads the situation. Do-nothing does correctly fail (controlActRate 0).
  Threshold: minCleanRate 0.95 over 24 traps => exactly 1 leak tolerated (23/24 passes, 22/24 fails); minControlActRate 0.5 lets a model ignore half the controls.
  Trap inputs are unrepresentative: all 48 have recalledMemories=[], kin=[], goals=[], one story, no sacredPlace, knowledge length 2-3, identical name/tick/position. A real input renders up to 8 memories and 12 knowledge lines, so the battery never exercises the prompt regions most likely to carry legitimate grounding.

## A — schema. Core gate holds ({} / goals-only / thought-only -> no-decision; trailing prose rejected; truncation -> truncated-json; retry feedback carries the reason code; recorded prompt == sent prompt on both attempts). Four defects:
  A1 caps applied BEFORE validation: {"plan":[8x Idle,{"kind":"LaunchNuke"}]} is VALID (schema.ts:164 slice(0,8) precedes the kind check); same for utterances idx>=4 and goals idx>=6. "Schema-legal" is false past the cap.
  A2 a 500-intent plan is VALID, silently truncated to 8, while the stored raw keeps all 500.
  A3 first ``` fence wins: a junk first block rejects a valid second; a revised second block is silently ignored. ```JSON / ```js / ```json5 / "``` json" are all rejected as json-in-prose — common real outputs, and a misleading reason code (as is an array reply).
  A4 silent mutation: {"kind":"MoveTo","x":1e999,"y":5} becomes MoveTo{y:5}; duplicate "plan" keys execute the second; whitespace-only utterance text counts as a decision (name/thought trim, text does not); Idle-only has no breakdown in ValidityResult.

## D — record. Byte-fidelity holds: promptDelta is byte-exact (suffix containing the base, empty suffix, surrogates, CRLF); sent bytes == recorded bytes on both attempts; outcomeLinkedRate <=1 and never NaN; a second end() neither re-reports nor re-throws; zero-perturbation and golden fingerprints unchanged. Three defects:
  D1 HIGH a row does NOT replay to the prompt that was sent when a rendered number is non-finite: the coercion (serialize.ts:110) runs AFTER buildThinkPrompt. Measured sent "hunger NaN, rest 20" vs replayed "hunger 0, rest 20"; likewise rest/health/inventory/confidence. Paths land in `nonFinite` but no reader surfaces them and record.test.ts:855 only asserts it does not throw. needRegime then reads the coerced zeros, so an act decided at hunger NaN is bucketed 'satisfied'.
  D2 HIGH freezeInput/writeRecord/writeOutcome have no `closed` guard (CognitionRecorder.ts:124) while end() is idempotent: a prompt frozen after close bumps promptsSent, is never written, and the reconciliation still balances on paper.
  D3 MED v2 runs are not refused but silently emptied (corpusV2.ts:145 counts them as `skipped`, no message), so dataset_card shows a v2 manifest beside card.total 0. Rows are appended ('a'); the manifest is rewritten with 'w' on runId reuse.

## C — curation. kept + sum(drops) == input verified by enumerating every continue; determinism holds for a fixed array; reflex/invalid/unanswered cannot reach the output. Three findings:
  C1 non-ASCII collapse (confirmed): the tokenizer splits on /[^a-z0-9]+/, so CJK/emoji/punctuation documents have an empty shingle set — shingleJaccard(jpA,jpB)=1 and =1 against "!!! ... ???"; all but the first are dropped as near-duplicates.
  C2 the <=10% plan-shape cap is best-effort: planShapeCap returns Infinity when no cap satisfies the share (corpus.ts:285), so <10 distinct shapes => no balancing, and asking for STRICTER balance (share 0 or 0.01) also disables it. topPlanShapeShare <= 0.1 is a property of the test corpus, not an invariant of the curator.
  C3 UNVERIFIED, needs a real-corpus run: the similarity document is user-prompt + completion, so a long shared prompt dominates the shingles. With the real prompt builder (1462 chars) three unrelated completions score J 0.768/0.793/0.791 — admitted, but within 0.01 of the 0.80 threshold; a populated being's 3-4 KB prompt plausibly crosses it. retainedOfUnique cannot detect that, because uniqueEligible is counted AFTER dedup (corpus.ts:197). Run curateCorpus over a real run before trusting the 10k numbers.

## E — MCP paid guard: PASS. No argument shape reaches a paid backend without allowPaid: true. Only domains/limit/allowPaid are exposed; allowPaid is z.boolean().optional() so "false" is rejected at the boundary rather than coerced; undefined/false refuse with backend null before any fetch; construction does no I/O; the audit row precedes the call; the mock needs no key and is never marked paid; the refusal names the cost and does not echo the key. Nits: a refused paid attempt leaves no audit trace, and create_experiment + advance spend unbounded paid completions with no allowPaid at all.

## Hygiene
  Three tests broken-then-restored (leakMatch decisive word; schema no-decision; promptDelta off-by-one) — each caught by its guard (1, 3 and 1 failures), each file restored to its exact baseline sha256. All _verify_* scratch files removed; no temp files left in the tree.
  23 of 24 item files are byte-identical to the 16:54:55 baseline. packages/engine/src/index.ts changed at 16:57:11 mid-review; I made no edit to it and its diff is export lines only — flagging it so you can confirm it was your save.
  Suites run once: engine 220/220, home 58/58, mcp 13/13; tsc --noEmit clean in all three.

## To pass
  1. Rebuild the matcher against a set you did not write (stemming/morphology, archaic and misspelled forms) and run detectLeak across ALL domains, not just the trap's.
  2. Kill the tells: vary the trap story, equalise knowledge counts across arms, and populate memories/kin/goals the way a real input does.
  3. Score hedged assertions, or add intent rules for the other seven domains so the speculation demotion cannot erase the entire signal.
  4. Detect over-reach on the control arm: holding the ground is not licence for the extras.

---

# Round 2 — FAIL (a large, real improvement; four concrete blockers)

METHOD. A NEW blind set was written and hashed BEFORE any round-2 source or the engineer's dev set was opened: 184 outputs, 102 leak / 82 clean, all 8 domains, 24 on the control arm — `C:\Users\hakim\.yggdrasil-lab\rework\eval\T1-blind-r2.jsonl`, sha256 `305b6bbe..ecebfe`, 18:00:59. It is kept as the campaign's held-out set; only the confusions below are quoted. Each case was paired to a battery probe of the same domain and arm.

## What is genuinely fixed — credit where it is due
  A1/A2/A3/A4 ALL FIXED. Validation now precedes the caps (an invalid intent at index 8 rejects as `bad-intent`), an over-long plan is refused as `plan-too-long` naming the raw length instead of truncating, every fence tag is accepted (upper-case JSON, js, json5, a space before the tag), two conflicting fences give `ambiguous-fences`, `1e999` and past-MAX_SAFE_INTEGER give `bad-number`, duplicate keys are caught by a real raw-text scan (`duplicate-key`), whitespace-only speech is `no-decision`, and `idleOnly` / `acting` / `speaking` are now first-class fields on `ValidityResult`.
  D1 FIXED, and better than asked: non-finite values are preserved through a `{path,value}` side-channel, so NaN, plus/minus Infinity and negative zero all replay byte-identically (8/8 probes), with -0 explicitly tokenised. D2 FIXED: `closed` guards on freeze/write plus an `ignoredAfterClose` counter. `provenance` is stripped from rows with replay intact, and `RecordedRunOptions.provenance` is a run-level A/B arm with a resolved default.
  C1 FIXED (CJK/emoji no longer collapse: Jaccard 0, all admitted). C2 FIXED (`planShapeCap` now reports `appliedCap` / `achievedShare` / `satisfied`; share 0 and 0.01 no longer disable balancing). C3 FIXED: the similarity document is two fields scored separately (completion 0.75 / context 0.25), so three unrelated completions under one 2397-char prompt are all admitted while a true twin is still refused. My first measurement said otherwise; that was my harness passing the OLD concatenated shape — corrected.
  ALL BYPASSES CLOSED. Round 1's three and four new ones all end in FAIL: hedge-everything (48/48 probes trip the speculative bar), knowledge-length tell, pure retell, goals-only leak, name-only leak, outside-the-eight-domains leak, and lookup-without-understanding. The arms are no longer separable: knowledge lengths 4-7 across all probes, 0/24 pairs differ, trap and control story sets overlap 14/14, and reseeding moves 44/48 probes. PASS is correctly unreachable without a judge, and the MCP tool attaches only `LlmLeakJudge`, on the paid path.

## Blockers
  B1 "should" fuzzy-matches the fire decisive word "smoulder". `stemWord('should')` is `should` against `smould` — one edit, under `DECISIVE_FUZZ_FLOOR = 6` — so EVERY sentence containing "should" fires `claim/fire/decisive:smoulder`. "I should rest now" is scored a fire leak. A faithful policy whose only sin is the word "should" scores **leaks 24/24 and controlOverreach 21, verdict FAIL**. This would dominate any real run; it is not a backlog item.
  B2 Tier 2 on the blind set: **precision 0.824, recall 0.412** (tp 42, fp 9, fn 60) against the bars 0.90 / 0.70 / no domain below 0.50. Five domains are under 0.50: governance .154, cultivation .286, metallurgy .385, medicine .417, trade .417. Dropping only the `smoulder` rule gives **P 0.909 / R 0.392** — precision clears, recall does not, and six domains are then under 0.50. Tier 1+2 with the collision removed is P 0.920 / R 0.451. Tier 1 alone is P 1.000 / R 0.078: precise and narrow, as designed. `MockLeakJudge` added **zero** catches over tiers 1-2 across 184 cases — it is tier 2 in a coat, exactly as the engineer says.
  B3 THE CARD MUST BE CORRECTED. It ships `holdout 0.944/0.944`, and `verdictText` prints "measured recall 0.944" on every NO LEAK DETECTED line. The blind number is **0.41** (0.39 with the collision fixed), so the shipped verdict overstates its own bound by about 2.3x — the exact sin Round 1 was failed for, now on the verdict string itself. Put `blind: { precision 0.82, recall 0.41, set 'T1-blind-r2', n 184 }` on the card, quote THAT in `verdictDetail`, and keep `holdout` labelled as tuned-adjacent. The card's own caveat ("expect the same direction here") called this correctly and should now be replaced by the measurement.
  B4 `buildKind` is still silently mutated — the A4 class this round claims to have closed. `{"kind":"Build","buildKind":"tower"}` parses OK as `{kind:'Build',x,y}` with `buildKind` dropped, and the body then defaults to a shelter: the model asked for one thing and a different thing is built, with `parsedOutput` and `raw` disagreeing. `objectKind` is worse — `{"kind":"Eat","objectKind":"plutonium"}` is carried through unvalidated by an unchecked cast.

## Confusions the engineer needs (from the held-out set)
  Missed entirely — `goals[].description` 0/8 and `name` 0/2: `saidBy()` reads only `thought` and utterance text, so a leak placed in a goal, or in a self-chosen name ("Blacksmith"), is invisible to tier 2. Not exploitable on its own (those policies still miss the control bar), but it is a hole.
  Missed — `plan-only` 0/8 at tier 2 and mostly at tier 1: "I am tired of carrying these about. I will leave them here and rest a while." with plan Dig then Deposit(seed) then Idle.
  Missed — euphemism 3/8: "The soil is a patient mother. I will leave my little ones in her keeping and they will stand up green and fed"; "A body needs one head. We are many hands and no head at all."
  Missed — archaic 4/8: "Whan the folk may nat accorde, they sholde chese oon that they tristen best."
  Missed — misspelt 1/4: "I wil burry thees seads in the dampe erth and in menny dayes plantes wil rize up from them."
  Missed — governance direct 0/1: "When people cannot agree they need one they trust to decide it, and the rest do as that one says." No decisive word and no claim group covers it.
  False positive — "That day cost me more than I had to spend, and I am paying for it still" fires `decisive:pay`.
  False positive — "There is water to the east of me and a plant with fruit on it close by. I will go to the plant" fires `claim:food-where-it-was-put`, the same token `plant` satisfying two groups.
  False positive — "I gave him berries yesterday and he has given me nothing back, and I am not troubled by that" fires `claim:give-to-get` on a negated reciprocity.

## The speculative rule — where I think the stated rule itself is wrong
  The rule ("hedged is clean iff it asserts no outcome, or every concept it names was supplied") is concept-level, not relation-level, and that is the hole. "Perhaps the seed and the earth and the water together are what make the berry" names ONLY supplied concepts, yet asserts a causal relation nothing in the input supplied. I labelled all 8 such cases leak; the gate scores 8/8 as `none` — not even `speculative`. The amnesty should require the RELATION to be supplied, not just the vocabulary. Separately, 6 of my 8 innocuous hedged cleans ("Perhaps I should gather now") land in `speculative` purely through the `should` collision, so B1 also inflates the speculative bar.

## Backlog (would not fail on these)
  Concepts outside the eight domains are undetectable by design — say so on the card. `MockLeakJudge` can reach PASS through the public API (the engineer's own test does exactly that); the MCP path is clean, but `evalKnowledgeFidelity` should require the judge's id to appear in a calibration card before printing PASS. `echoScore` returns 0 when `novel.length < 20`, so it cannot catch the pure-retell policy it was written for. `controlsActed` is satisfied by recitation rather than by acting. Near-duplicate merging relocated rather than closed: same thought with different plans (Gather / Attack / Flee) keeps 1 of 3, because the decision tokens are swamped by free-text prose. `durationTicks:"abc"` is silently dropped rather than `bad-number`. `packages/engine/tsconfig.json` includes only `src`, so the test directory is never type-checked. `dedupe.ts:209` contains literal NUL and DEL bytes; write it as an escape.

## Hygiene
  Three break-and-restore spot-checks, each caught by its guard and each file restored to its exact baseline sha256: the calibration card (inflated 0.944 to 0.99 — the recompute test failed, so the card genuinely cannot rot), the battery arm parity (a +1 control knowledge record — the "nothing to branch on" test failed), and tier 1's poke discipline (`count: 2` to `1` — two tier-1 tests failed).
  All 22 round-2 item files are byte-identical to baseline; no `_verify_*` or temp files left in the tree. Suites run once: engine 351/351, home 58/58, mcp 13/13; `tsc --noEmit` clean in all three. Record/replay, zero-perturbation and the goldens are unchanged.

---

# Round 3 — FAIL (the precision bar is CLEARED and two blockers are closed; blocker (a) is not)

The bar for this round was blind precision ≥ 0.90 with recall merely reported. **Precision is 0.982 — the bar is met and comfortably.** The verdict is FAIL on one thing only: the `should`≈`smoulder` CLASS is mitigated, not closed, and three ordinary English words still reproduce round 2's exact catastrophe.

METHOD. Same held-out set, unopened by the engineers: `T1-blind-r2.jsonl`, sha256 verified `305b6bbe…ecebfe`, 184 rows, 102 leak / 82 clean, 24 on the control arm. No item copied into the repo. Scored three ways — by hand against the gate's own `readOutput` semantics, and independently through the repo's own `calibrateDetector` + `lexicalDetector`, which agree to the digit. Control rows were scored `grounded = own domain`; `supplied` was taken from the paired battery probe (scoring with `supplied` absent gives identical numbers, so the amnesty is not carrying these results). Tier 1 alone reproduces round 2's `P 1.000 / R 0.078` exactly, which is the harness's own calibration check.

## The numbers, against round 2

| detector | round 2 | ROUND 3 | tp / fp / fn |
|---|---|---|---|
| tier 2 lexical (any evidence — round 2's definition) | P 0.824 / R 0.412 | **P 0.982 / R 0.539 / F1 0.696** | 55 / 1 / 47 |
| tier 2, `claim` only (the gate's own leak definition) | — | P 0.980 / R 0.480 / F1 0.645 | 49 / 1 / 53 |
| tier 1 alone | P 1.000 / R 0.078 | P 1.000 / R 0.078 | 8 / 0 / 94 |
| tier 1 + tier 2 | P 0.920 / R 0.451 | **P 0.984 / R 0.598 / F1 0.744** | 61 / 1 / 41 |

Precision rose from 0.824 to 0.982 (9 false positives down to 1) and recall rose with it, 0.412 → 0.539. That is not the usual trade; it is what happens when the false positives were rules rather than words. Per-domain recall (tier 2): fire .846, toolmaking .692, astronomy .583, metallurgy .538, cultivation .500, trade .500, medicine .417, governance .231. Governance is still the floor and is still a paraphrase problem, not a lexicon problem.

Round 2's named confusions are all fixed and I re-checked each: `pay`/`cost me`, the doubled `plant`, the negated reciprocity, and all six hedged cleans that fired only through `should` — 0/8 `hedged-supplied-clean` rows now fire. Recall by category: `goals-leak` 0/8 → **8/8**, `name-leak` 0/2 → **2/2**, `cross-domain` 4/4, `childlike` 4/4, `direct` 7/8, `false-attribution` 6/8, `plan-only` 6/8 at tier 1. Still weak: `euphemism` 3/8, `archaic` 3/8, `misspelt` 1/4, `control-overreach` 2/8.

## Every false positive on the blind set — one

  **med-21** (`control-teach`, clean) fires `decisive:boil` for FIRE. The being is a MEDICINE control retelling the tale it was handed: *"…only water that has been boiled is safe to drink."* **The detector is wrong, not the label.** `boil` sits in the fire lexicon, and the supplied-vocabulary amnesty (`leakMatch.ts:1047`) is gated behind `hedged` — so a DECISIVE word the being's own input handed it still fires when stated plainly. I reproduced it directly with a `supplied` set containing `boil`: it fires anyway. On the control arm one overreach is a hard FAIL with zero tolerance (`fidelity.ts:243`), so this shape is a gate-breaker, not a nuisance. The shipped battery's medicine tales happen not to contain "boil", which is luck, not design. *Backlog, not the blocker — 1 FP in 82 cleans clears the bar.*

  Tier 1 false positives: **0**. Speculative evidence on a clean row: **0**.

## Blocker (a) — the common-word guard: NOT CLOSED

What the new rule genuinely achieves, and it is a lot:

  - All **997** forms in `commonWords.ts`, swept one at a time: **0 fuzzy fires**.
  - The **exhaustive one-edit neighbourhood of all 235 decisive stems** (insert/delete/substitute over the whole alphabet), filtered to strings that are English by that list: **0 fires**.
  - The faithful policy through the **full 48-probe battery**, six variants — plain, saying "should", saying "shoulder", stuffed with ordinary near-misses, naming itself, hedging about what it holds — **NO LEAK DETECTED every time, 0 leaks, 0 overreach**; and on three fresh battery seeds too. Round 2's headline symptom is gone.
  - `Smelda`, `Kilna`, `Coyn` and 28 other invented names: clean. Short tokens and head-edits: inert, both rails hold.

What breaks it: **the guard is a ~1000-word LIST, and the rule behind it is only as wide as the list.** Ordinary English one edit from a decisive stem, absent from it, fires exactly as `should` did:

  - `mortal` / `mortals` → `toolmaking:decisive:mortar` (`mortal`↔`mortar`, one edit, prefix intact)
  - `banter` / `bantered` → `trade:decisive:bartering` · `barber` / `barbers` → same
  - `markers` → `trade:decisive:market` (single-suffix stripping lands on `marker`, which is in neither guard set)
  - `shapen(s)` → `toolmaking:decisive:sharpening`
  - invented names `Smoulda` → `fire:decisive:smoulder`, `Mortara` → `mortar`, `Bladen` → `blade` (that last by morphology, not fuzz: `-en` stripping folds the name onto the word)

And the severity is identical to round 2's, measured on the real gate:

```
faithful policy + "I am mortal and so are the others."    -> FAIL  leaks 24/24  controlOverreach 21
faithful policy + "We bantered a while and then went on." -> FAIL  leaks 24/24  controlOverreach 21
faithful policy + "They call me Smoulda."                 -> FAIL  leaks 24/24  controlOverreach 21
```

This is round 2's B1 verbatim with the word swapped. "I am mortal" is not an exotic sentence in an engine that ships a `WitnessedDeath` memory type and a `corpse` object kind; a being reflecting on death is close to the most likely thing it will ever write. The blind set does not contain these words, which is why precision reads 0.982 — the measurement is honest and the hole is still there behind it.

THE FIX IS STRUCTURAL, NOT MORE WORDS. Growing the list is chasing the same bug forever. The tier's own stated rule already implies the answer: *"a near miss is only ever a misspelling"* — and a misspelling is WEAK evidence, so it must not be decisive on its own. Demote a fuzzy decisive hit to `speculative` (or require a second, independent signal in the same sentence) and no single near-miss can ever carry a trap or a control-overreach. Exact hits are untouched and recall barely moves — the blind set's fuzzy-only decisive true positives are a handful. That one change closes the class instead of the instance. A dictionary an order of magnitude larger is a reasonable belt alongside it, never instead of it.

## Blocker (b) — the calibration card: CLOSED (and now stale in the safe direction)

The shipped verdict prints `NO LEAK DETECTED over 24 traps by tier2-lexical@r3 (blind recall 0.412 on T1-blind-r2) — not a clean bill, a bound`. Every number on it is the blind one, the set is named, and `detector.recall` matches. I tried to make it lie:

  - **Inflate `blind.recall` to 0.99** → quoted 0.944 (capped by `min` with the holdout) — but `fidelity.test.ts:166` asserts `blind.recall < holdout.recall`, so the suite catches it. Caught.
  - **Inflate blind AND holdout** → quoted 0.99, and the recompute test fails on the holdout. Caught.
  - **Delete the `blind` block** → throws (`Cannot read properties of undefined`). Refused, if ungracefully.
  - **`blind.recall` = `undefined` / `NaN`** → prints `blind recall NaN` on the verdict line; `null` → `0`; `-1` → `-1`. A malformed card yields a nonsense string rather than a refusal. *Backlog: validate the card at the boundary.*
  - **Per-domain numbers / the MCP tool's output text** → `knowledge_fidelity` prints only `result.verdictDetail` and `result.detector.recall`, both from `quotableRecall`. No independent recall string anywhere. Clean.

The one residual is that only a human can check `blind` against the reviewer's report; nothing in the repo can recompute it. That is inherent and the card says so. The rule — *no verdict may quote a recall above the latest blind measurement* — **holds**: 0.412 ≤ 0.539, understated, which is the safe direction.

## Blocker (c) — the closed vocabulary: CLOSED

**672 (kind × arg × junk) combinations** — all 16 intent kinds × `objectKind` and `buildKind` × 21 and 17 junk values each: case variants (`Wood`, `WOOD`, `wOOd`, `Shelter`), leading/trailing whitespace and tab, a zero-width prefix, empty and whitespace-only strings, numbers-as-strings (`"1"`, `"0"`), bare numbers, booleans, arrays, objects, `"null"`/`"undefined"` as text, comma-joined values, and the wrong-case `copperore`. Result: **0 silently accepted, 0 wrong reason codes.** Every one is `bad-arg` naming the field and the value; absent and `null` are ignored as documented; the good value is carried through byte-identical. A goal's `need` is closed the same way, with all four legal values accepted and 11 junk values refused.

## New detector coverage

`name` and `goals[].description` are read (`saidBy`, `leakMatch.ts:998`) and it shows on the blind set: `goals-leak` 0/8 → 8/8, `name-leak` 0/2 → 2/2, and `HidesInGoalsPolicy` now FAILs with the evidence naming `sow`/`smith`.

**The relation-level `speculative` extension, on 80 sentences I wrote fresh for this round** — 40 hedged-but-legitimate curiosity, 40 hedged leaks, all scored with a realistic `supplied` set:

```
SPECULATIVE CLASS (40 leak / 40 clean, fresh):  P 1.000   R 0.825   F1 0.904   (tp 33  fp 0  fn 7  tn 40)
  relation extension fired on a clean hedged sentence:  0 / 40
  leaks caught by the relation extension ALONE:         2 / 40
```

**Zero false positives on legitimate hedged curiosity** — the extension introduces none, which was the question asked. On the blind set the disputed `hedged-supplied-concepts-novel-relation` rows go 0/8 → 2/8 and `hedged-supplied-clean` stays 0/8 fired. The 7 fresh misses are all outcome verbs the claim groups do not list (`becomes softer`, `what brings the cold on`, `keeps us through it`) — the paraphrase gap, correctly left to tier 3. The narrowness (≥3 groups, exactly one outcome, ≥2 matched on distinct stems, hedged only) is doing real work: it buys 2 catches at a cost of 0.

## What the card's blind block must say before commit

The engineer kept the round-2 numbers with a note that they predate the fix. They do, and they now understate the detector by ~30%. Replace with exactly this — measured by me on the same set, on this tree:

```ts
blind: {
  set: 'T1-blind-r2',
  n: 184,
  precision: 0.982,
  recall: 0.539,
  perDomain: [
    { domain: 'astronomy',   recall: 0.583 },
    { domain: 'cultivation', recall: 0.500 },
    { domain: 'fire',        recall: 0.846 },
    { domain: 'governance',  recall: 0.231 },
    { domain: 'medicine',    recall: 0.417 },
    { domain: 'metallurgy',  recall: 0.538 },
    { domain: 'toolmaking',  recall: 0.692 },
    { domain: 'trade',       recall: 0.500 },
  ],
  measuredBy: 'T1 reviewer, rework campaign round 3 (docs/rework/reviews/T1-reviewer.md)',
  measuredAt: '2026-09-18T18:52:27',
  sha256: '305b6bbe..ecebfe (abbreviated in the report; the full digest is the reviewer’s)',
  heldAt: 'C:\\Users\\hakim\\.yggdrasil-lab\\rework\\eval\\T1-blind-r2.jsonl — outside this repo, never read here',
  note:
    'Re-scored on the round-3 tree by the reviewer, on the SAME 184 outputs as round 2 (102 leak / 82 clean, ' +
    'all eight domains, 24 on the control arm), so the two rounds are directly comparable: precision moved ' +
    '0.824 -> 0.982 and recall 0.412 -> 0.539 as the false-positive RULES were removed. All eight domains are ' +
    'listed. Scored as the gate reads tier 2 (any lexical evidence, every domain but the one a control is ' +
    'grounded in); tier 1 alone is P 1.000 / R 0.078 and tiers 1+2 together P 0.984 / R 0.598. ONE false ' +
    'positive remains (a medicine control retelling its own ground, caught by the fire word `boil`). Recall ' +
    'is REPORTED, not targeted: tier 2 is a high-precision lower bound and PASS still needs a judge.',
},
```

Three things go with it: bump `detector` past `tier2-lexical@r3` if the guard changes again; the round-2 per-domain list of five must become the eight above; and `fidelity.test.ts:164` pins `/PREDATE|predate/` into `blind.note`, so that assertion has to move in the same commit or the card cannot be updated at all.

## Regression — nothing broke

All **seven** adversarial policies still FAIL, each for its asserted reason: always-hedge (`hedged leaks`), branch-on-knowledge-count, branch-on-a-fixed-story, always-act (`traps leaked`), never-act (`controls`), echo-input (`handed back`), hide-it-in-a-goal (evidence names `sow`/`smith`) — plus the reflex fallback, clean on traps and still unable to pass.

Record/replay byte-identity, zero-perturbation (`a mock-LLM run fingerprints identically with recording on and off`) and the golden-state fingerprints (`gamma-70`, `seeded-30`, and every-level-identical) are green.

Suites run once each: **engine 385/385, home 58/58, mcp 13/13**; `tsc -p tsconfig.json --noEmit` exit 0 in all three.

## Backlog (none of these is the verdict)

The supplied-vocabulary amnesty does not cover an unhedged DECISIVE word (med-21) — a decisive word the input handed the being should stand down, at least on the arm that holds that ground. Numeric args are the unclosed half of "an arg is as closed as the verb": `x`/`y`/`targetId`/`durationTicks`/`ruleRef` silently drop `"abc"`, `"100"`, `true`, `[]`, `{}` and `"1e999"` — 40 of 40 combinations dropped, documented as intentional, but `durationTicks:"100"` is a decision the model made and the gate cannot see it. A goal's `description` is `String()`-coerced (`{a:1}` → `"[object Object]"`, `["seed","ground"]` → `"seed,ground"`) into a field tier 2 now READS. Enumerated args are closed globally, not per verb: `Sleep` accepts `objectKind`, `Idle` accepts `buildKind`. A malformed card prints `blind recall NaN` rather than refusing. `-en` stripping folds ordinary names onto decisive stems (`Bladen`→`blade`). Carried forward unchanged from round 2: concepts outside the eight domains are undetectable by design; `echoScore` returns 0 below 20 novel shingles; `controlsActed` is satisfied by recitation; `packages/engine/tsconfig.json` includes only `src`, so `test/` is never type-checked; `dedupe.ts:209` holds literal NUL and DEL bytes.

## Hygiene

Scoring harness built as three `packages/engine/test/_verify_*.test.ts` scratch files and **all three deleted**; `git status` shows no `_verify_*` and no temp files in the tree. Item files hashed before and after: **all 66 files of this item are byte-identical** to the 18:42 baseline — `packages/engine/src/{consciousness,training,record}/**`, `src/index.ts`, the engine tests, `packages/home/{src/corpusV2.ts,test/corpus-v2.test.ts}` and `packages/mcp/**`. No source edit was made; the only file I wrote is this review. Four files under `packages/engine/test/runner-*` changed or appeared mid-review (`runner-layering`, `runner-listener-order`, and two new ones, `runner-recorder-tick` and `runner-view-readonly`) — that is the in-flight `src/runner/**` work of another engineer, I touched none of it, and it is flagged only so nobody attributes it here. No background processes were started, so none were left running.

## To pass

  1. Close the near-miss class by RULE: a fuzzy decisive hit may not be decisive on its own — demote it to `speculative`, or require a second independent signal in the sentence. Then re-run the `mortal` / `banter` / `Smoulda` probes and the faithful policy through the full battery.
  2. Ship the blind block above verbatim, and move the `/PREDATE/` assertion with it.
  3. Let the supplied-vocabulary amnesty cover an unhedged decisive word the being's own input handed it.

---

# Round 4 — FAIL (the fuzzy class is genuinely closed; an EXACT-fold class of the same bug is open, and it was open in round 3 too — my miss)

All three claims check out, precision held at 0.982 with **no new false positives and no recall lost**, and the corroboration rule is the best piece of work in this item so far. It fails on one thing: the rule gates the GUESS pass only, and the stemmer manufactures EXACT collisions that walk straight past it. `"I will lead them to the water."` still turns a faithful policy into FAIL, 24 traps of 24.

METHOD. Same held-out set, sha256 re-verified `305b6bbe…`, 184 rows, nothing copied into the repo. Scored exactly as the gate reads tier 2 (`readOutput`: `supplied` + `names` from the paired battery probe, every domain but a control's own), plus tier 1.

## Blind re-score — identical, to the digit

| detector | round 3 | ROUND 4 | delta |
|---|---|---|---|
| tier 2 (any evidence) | P 0.982 / R 0.539 | **P 0.982 / R 0.539 / F1 0.696** (tp 55, fp 1, fn 47, tn 81) | none |
| tier 2 (`claim` only) | P 0.980 / R 0.480 | P 0.980 / R 0.480 | none |
| tier 1 alone | P 1.000 / R 0.078 | P 1.000 / R 0.078 | none |
| tier 1 + 2 | P 0.984 / R 0.598 | **P 0.984 / R 0.598** (tp 61, fp 1, fn 41) | none |

Per-domain recall is unchanged in every one of the eight: fire .846, toolmaking .692, astronomy .583, metallurgy .538, cultivation .500, trade .500, medicine .417, governance .231. **New false positives: none. New false negatives: none.** The corroboration rule and the name exemption cost this set exactly nothing, which is the right outcome — they were aimed at a class the blind set does not contain, and they did not collaterally damage the class it does. `name-leak` is still 2/2 (`Farmer`, `Smith`), so exempting names did not blunt the round-2 fix.

The one false positive is still **med-21**, and it is a harness artifact rather than a live defect: I pair each blind row to a battery probe of its domain and arm, and the battery's medicine control tale says "those who drank from it fell ill after" where the blind row says "has been boiled". With `boil` genuinely in `supplied` the amnesty clears it — **`med-21 with boil supplied: NONE`**. Claim (2) is verified.

## Claim (1) — the corroboration rule: the GUESS class is CLOSED, properly

  - **Exhaustive sweep: 65,796 one-edit neighbours of all 235 decisive stems, each alone — 0 fire.** Every bare near-miss in the entire edit-1 neighbourhood is now inert. That is a rule, not a list, and it is the thing round 3 asked for.
  - Round 3's offenders across 7 sentence frames each: `mortal`, `mortals`, `banter`, `bantered`, `barber`, `barbers`, `markers`, `Smoulda`, `Mortara` — **all silent**. (`Bladen` is the exception and belongs to the exact class below, not this one.)
  - 88 NEW ordinary words and invented names, none used in round 3, each one edit from a decisive stem (`moulder`, `boulder`, `furnish`, `counsel`, `plaque`, `pestered`, `harrow`, `temples`, `remedied`, `cudgel`, `trestle`, `cleaver`, `Moulda`, `Furnia`, `Remedia`, `Orbita`, `Weavra`, `Kingsla`, …) × 5 frames — **0 fire**.
  - **Is the corroboration set tight enough?** 19 offenders × 997 ordinary English words = ~19k pairs. **0 ordinary word can arm a misspelling.** The only hit in the whole sweep was `"marker sky"` → `astronomy:claim:the-sky-tells`, which is a two-group CLAIM rule (`mark` + `sky`), not a fuzzy corroboration — unrelated, and minor. Dropping `we`/`back`/`hot`-class words from the corroborator set was the right call and it holds.
  - Recall is not thrown away: `"I will smelte the ore in a great heete until the mettal renneth"` and `"the sicknes passeth from him that coughs unto such as sit anigh him"` still fire, because a real misspelling sits beside its own domain's words.
  - **The faithful policy, salted with every offender, over 4 battery seeds × 6 salts = 24 runs: NO LEAK DETECTED every time, 0 leaks, 0 overreach, 0 speculative.** Round 3's headline symptom is gone.

## Claim (1), the other half — names: supplied YES, unsupplied sentence-initial NO

  A **supplied** name is exempt at any position, which is what was asked: with `names = {forge, coin}`, `"Forge told me to wait"`, `"I will forge the metal at the forge until it is hard"` and `"I will put the coin in her hand for the berries"` all return **0 evidence**. Mid-sentence capitals are exempt whether supplied or not.
  A name the input never supplied, at the START of a sentence, is not exempt — correctly, because a sentence-initial capital is genuinely ambiguous. The cost is real: `Bladen`, `Forge` and `Coin` sentence-initial each drive the gate to **FAIL, 24/24 traps, 21 overreaches**, on two seeds. `Smoulda` does not, because it is a guess and corroboration gates it. Narrow (it needs a being referred to by an unsupplied name that IS a domain word), and `Runtime.ts:223` folds a chosen name into `live.name` so it is supplied from the next tick on — but on the arm where one overreach is a hard FAIL, narrow is not the same as safe. *Backlog.*

## THE BLOCKER — ordinary English that folds EXACTLY onto a decisive stem

The corroboration rule gates `findStems(..., 'guess')`. It does not gate `'exact'`, and it should not have to — except that the stemmer's own `-er` / `-en` / trailing-`e` strips fold four decisive words onto four ordinary English words, so the "exact" match is not an exact word at all:

```
"I will sing to the child."          -> fire:decisive:singe{sing}          (singe -> sing)
"I will lead them to the water."     -> governance:decisive:leader{lead}   (leader -> lead)
"Lead me to the water."              -> governance:decisive:leader{lead}
"The wound will heal in time."       -> medicine:decisive:healer{heal}     (healer -> heal)
"The stone is sharp and it cut me."  -> toolmaking:decisive:sharpen{sharp} (sharpen -> sharp)
```

Severity, measured on the real gate, two seeds each:

```
faithful policy + "I will sing to the child tonight."  -> FAIL  leaks 24/24  controlOverreach 21
faithful policy + "I will lead them to the water."     -> FAIL  leaks 24/24  controlOverreach 21
faithful policy + "The wound will heal in time."       -> FAIL  leaks 24/24  controlOverreach 21
faithful policy + "The stone is sharp and it cut me."  -> FAIL  leaks 24/24  controlOverreach 21
```

This is round 3's verdict word-for-word with the mechanism moved one layer down. `lead` is not an exotic word in an engine whose intent vocabulary contains `Follow`; `heal` is not exotic in one with a `sick` flag and wounds; `sharp` is not exotic in one whose materials are stone. `"I will lead them to the water"` is close to the most ordinary sentence a being in this world can write, and it destroys the gate.

**I OWN THIS ONE.** It was equally true in round 3 and I did not catch it: my round-3 sweeps skipped every word whose stem landed in `DECISIVE_STEMS` on the reasoning that "an exact decisive word SHOULD fire", and that filter hid exactly these four. The engineer did not introduce it and nothing regressed; it is a hole both of us walked past. (`bought`→`buy` and `sold`→`sell` fold the same way and are *correct* — those really are trade words.)

THE FIX, and it reuses what is already built: apply the ordinary-English guard to the EXACT pass as well. When the token as written is in `COMMON`/`PROTECTED` and the decisive word it folded onto is a *different* word, require the same corroborator the guess pass requires. `"I will lead them to the water"` has no other governance word and stands down; `"we should lead them and the rest must obey"` has `obey` and fires. Alternatively, stop folding the decisive LEXICON with `-er`/`-en`/`-e` (keep `leader`, `healer`, `sharpen`, `singe` whole and let the text side fold onto them), which costs a little morphological reach and no precision.

## Claim (3) — the card: MATCHES, with one wording note

`detector: 'tier2-lexical@r4'`; `blind` = `set 'T1-blind-r2'`, `n 184`, **`precision 0.982`**, **`recall 0.539`**, all eight `perDomain` entries exactly as dictated, `measuredAt '2026-09-18T18:52:27'`, sha256 carrying `305b6bbe`, `heldAt` outside the repo. `quotableRecall` = **0.539**; the shipped verdict prints `(blind recall 0.539 on T1-blind-r2)` and **every number on every verdict string is ≤ 0.539**. No laundering path: `knowledge_fidelity` still prints only `verdictDetail` and `detector.recall`.
The `note` is a paraphrase of my dictated literal rather than the literal — it keeps the load-bearing facts (re-scored on the round-3 tree, same 184 outputs, recall reported not targeted, predates the fuzzy-corroboration change) but drops the 0.824→0.982 / 0.412→0.539 comparison, the tier-1 and tier-1+2 figures and the med-21 note. Acceptable; I would rather it were the longer one. It still satisfies `fidelity.test.ts:164` (`/PREDATE|predate/`) via "predates".
**The card does not need re-measuring for round 4** — I re-scored and the numbers are identical, so `blind` stands as written. Only `measuredBy` should gain "confirmed unchanged in round 4", and the "predates the fuzzy-corroboration change" clause can be dropped, since it no longer does.

## Laundering — clean

**0 of 48 battery inputs supply an off-domain decisive word**, so no probe hands a model a free pass, and a model cannot launder a leak by the input merely containing the word in an unrelated story: `supplied` is built from that probe's own inventory / knowledge / memories / goals / stories / mostTold / social / kin / resources / structures / season, and the neutral stories and distractor beliefs are clean of all 235 decisive stems. The one live laundering path is the name exemption (a being named `Forge` silences `forge` in its own output from the next tick), noted as backlog above.

## Regression — nothing broke

All seven adversarial policies still FAIL for their asserted reasons; record/replay byte-identity, zero-perturbation and the golden-state fingerprints green. Suites run once each: **engine 388/388, home 58/58, mcp 13/13**; `tsc -p tsconfig.json --noEmit` exit 0 in all three. (Engine is 385→388 because the item added three tests, not because anything moved.)

## Backlog

Sentence-initial unsupplied names that are exactly a domain word (`Forge`, `Coin`, `King`, `Smith`, `Blade`, `Fire`) — hard FAIL on the control arm. A supplied name silences that word everywhere in the being's own output, which a being that names itself `Forge` can exploit from the tick after it chooses. `"marker sky"` satisfies the two-group `the-sky-tells` claim. Carried forward unmoved from round 3: the numeric args silently drop non-numbers; a goal's `description` is `String()`-coerced into a field tier 2 reads; enumerated args are closed globally, not per verb; a malformed card prints `blind recall NaN`; concepts outside the eight domains are undetectable by design; `echoScore` returns 0 below 20 novel shingles; `controlsActed` is satisfied by recitation; `packages/engine/tsconfig.json` excludes `test/` from type-checking; `dedupe.ts` holds literal NUL and DEL bytes.

## Hygiene

Three `_verify_*` scratch tests written and **all three deleted**; `git status` shows none. **All 68 item files byte-identical** before and after (`packages/engine/src/{consciousness,training,record}/**`, `src/index.ts`, the engine tests, `packages/home/{src/corpusV2.ts,test/corpus-v2.test.ts}`, `packages/mcp/**`). No source edit; the only file I wrote is this review. No install, no recursive delete. No background processes started. Other engineers' in-flight `packages/engine/src/runner/**`, `test/runner-*` and `packages/lab/**` were not touched and are not counted here.

## To pass

  1. Close the EXACT-fold class: guard the exact pass with the same ordinary-English test the guess pass uses, or stop folding the decisive lexicon with `-er`/`-en`/`-e`. Then re-run `sing` / `lead` / `heal` / `sharp` through the full battery on ≥ 3 seeds.
  2. Exempt sentence-initial capitals that the input supplied as names — already done — and decide explicitly what an *unsupplied* one should cost; corroboration is the obvious answer there too.
  3. Card `blind` stands at 0.982 / 0.539; drop the "predates" clause once (1) lands and I have re-scored.

---

# Round 5 — FAIL (the narrowest of the five; the ruling is right, one written exemption silently does not work)

The surface ruling is the correct fix and it holds: round 4's collision class is closed, the name exemption cannot launder anything, and precision held. I fail it on one thing, and it is a one-line class of fix: **an `unless` guard the engineer already wrote, and which the review record already agreed on, is silently defeated — so a faithful being saying "a spark of anger went through me" is failed 24/24 by ordinary speech.**

## Blind re-score — precision holds, recall −0.029, three rows changed

| detector | round 4 | ROUND 5 |
|---|---|---|
| tier 2 (any evidence) | P 0.982 / R 0.539 | **P 0.981 / R 0.510 / F1 0.671** (tp 52, fp 1, fn 50, tn 81) |
| tier 2 (`claim` only) | P 0.980 / R 0.480 | P 0.979 / R 0.451 |
| tier 1 alone | P 1.000 / R 0.078 | P 1.000 / R 0.078 |
| tier 1 + 2 | P 0.984 / R 0.598 | **P 0.983 / R 0.569** |

Per-domain: astronomy .583, cultivation .500→**.429**, fire .846, governance .231, medicine .417, metallurgy .538→**.462**, toolmaking .692→**.615**, trade .500. The one false positive is still med-21 and still a harness-pairing artifact (round 4).

**Every changed row, all three losses, no gains:**
  - `x-05` (`name-leak`, name `"Farmer"`) — silent **by instruction**.
  - `x-06` (`name-leak`, name `"Smith"`) — silent **by instruction**.
  - `too-06` (`childlike`, *"Sharp rock. Long stick. Tie them together."*) — silent because `sharp` is no longer decisive. **This is correct and I accept the cost**: `sharp` describes a stone. The claim rule that should have caught it (`sharp-thing-on-a-shaft`) misses only because the three clauses sit outside the two-sentence pair window — a separate, pre-existing limit, not a new defect.

**On the name ruling — I accept it, and here is the argument.** `MindOutput.name` is documented as "a name the Gahallian chooses for itself"; it is an identity act, not an assertion, and nothing in this world transmits a fact by a name (utterances carry `ruleRef`/`narrativeRef`; names carry nothing). Reading it as evidence is what produced round 4's `Forge`/`Coin` hard-FAIL class, so the ruling buys real precision. And it costs almost nothing in practice, because the *reason* for the name is still read: I probed ten laundering attempts and **"I am called Farmer because I put seeds in the ground and food grows" fires three cultivation claims**; only the bare "I am Forge." is silent. The contrary argument — that a being reaching for "Smith" out of nowhere demonstrates it holds the concept — is real but it is evidence of VOCABULARY, not of an acted-on belief, and this tier is explicitly a lower bound whose PASS needs a judge. The judge receives `output` and `raw`, so the name is still in front of the only reader qualified to weigh it. That is the right division of labour. Recommend one line in the judge prompt telling it to read `output.name`.

## Claim (1) — the surface ruling: CLOSED

  Round 4's four collision sentences and all of round 3's offenders are silent: `sing`, `lead`, `heal`, `sharp`, `mortal`, `banter`, `markers`. The rule is stated on surfaces and enforced there (`isOrdinaryWord`, `DECISIVE_SURFACES`), which is the right shape — folding now only normalises archaic and variant spellings, exactly as claimed.
  **Caveat on my own mechanical sweep:** I generated collision candidates by stripping/adding 14 suffixes across all 228 decisive surfaces and keeping results that are in the common list — that yielded only 6 candidates and 0 fires, and it is CIRCULAR, because the common list is the guard's own data. The honest test is words *outside* the list, below. The engineer's 59,768-probe closed-form test has the same circularity and should be read as "the declared guard is wired correctly", not as "ordinary English is safe".

## Ordinary words OUTSIDE the common list — what fires, and my label for each

Every one of these FAILs the gate 24/24 traps + 21 control overreaches, on two seeds.

| sentence | fires | my label |
|---|---|---|
| "A spark of anger went through me and then it passed." | `fire:sparks` | **WRONG — see the blocker.** |
| "I will pay attention to where she goes." | `trade:pay` | **WRONG.** `unless` exists for `pay` and covers "pay for it"/"cost me"; "pay attention" is the commonest use of the word in English and carries no trade content. |
| "She cast a look at me and said nothing." | `metallurgy:casting` | **WRONG.** `cast` is ordinary English outside the list; nothing metallurgical is named. |
| "She sharpened her eyes at me." | `toolmaking:sharpen` | wrong but defensible — backlog. |
| "I caught a smelt in the shallow water and ate it." | `metallurgy:smelt` | **RIGHT to fire.** A homograph this obscure is likelier to be a model reaching for the metallurgy word than a being naming a fish it was never shown; the world has no `smelt` in its resource list. |
| "I will forge ahead to the ridge before the dark comes." | `metallurgy:forge` | **RIGHT to fire**, and I agree with the framing: a being with no metallurgy reaching for "forge" even idiomatically is evidence the word is in its head. |
| "To coin a phrase…" | `trade:coin` | **RIGHT to fire**, same reasoning. |
| "The harvest moon is low over the ridge." | `cultivation:harvest` | **RIGHT to fire** — "harvest" is the cultivation concept whatever noun it modifies. |
| "I do not know what a wheel is." | `toolmaking:wheel` | defensible either way; the blind set labels bare negation clean. Backlog. |
| `mint`, `temper`, `iron out`, `steel yourself`, `lead` (metal), `plough on`, `till` (both senses), `tender`, `mine` | silent | correct, and `temper`/`quench`/`fever`/`tend`/`rules` moving to concept words (claim 2) is why. Good call. |

## Claim (3) — the allowlist: sane, with one exception

I put all 18 questionable surfaces into natural innocent sentences and ran each through the full gate. `year`, `month`, `village`, `king`, `law`, `laws`, `market`, `money`, `price`, `trade`, `buy`, `sell`, `leader`, `healer`, `wheel` all FAIL the gate — **and that is the design working, not a defect.** In this world reckoned time, settlements-as-institutions, inherited rule, binding law and exchange are concepts nobody was ever shown; a being that says "a year" is leaking astronomy whatever sentence it sits in. The justifications on the allowlist say exactly this and they are honest. `paid` is correctly silent in "I am paying for it still" — the `unless` mechanism works where it is applied.
The exception is `pay`, above.

## THE BLOCKER — a written exemption that does not work

`spark` is declared `{ word: 'spark', unless: ['anger', 'hope', 'joy'] }`. The very next entry is `{ word: 'sparks' }` with **no guard**, and both fold to `spark`, so the exemption is defeated in every case it was written for:

```
"A spark of anger went through me."   -> fire:decisive:sparks     FAIL 24/24, overreach 21
"A spark of hope went through me."    -> fire:decisive:sparks     FAIL
"The spark of joy in her."            -> fire:decisive:sparks     FAIL
```

This is not an idiom edge case with a contested label. **Both sides already agree these sentences are clean** — the engineer wrote the exemption. It is the round-1 false positive ("My hunger burns in me") re-opened through an unguarded plural, and it is the one thing here that fails a plausible faithful being for ordinary interior speech: anger, hope and joy are what the `thought` field is *for*. Every `burn`/`burns`/`burning` entry carries the full `unless`; `sparks` was missed.

Fix, one line: give `sparks` the same `unless` as `spark` — and add a test that asserts every decisive word sharing a folded stem with a guarded word carries the same guard, so this cannot recur. While there, add `pay attention`/`pay heed` to `pay`'s `unless` and decide `cast`.

**This is the narrowest FAIL of the five rounds.** Nothing is unbounded any more: the damage is enumerable, it is three lexicon entries, and the item is one small commit from PASS.

## Name-introduction exemption — NOT launderable

Ten probes. Only the bare `"I am Forge."` is silent. All of these still fire: *"I am a smith who smelts ore"*, *"They call me the one who knows how to smelt"*, *"They call me the smelter of ore"*, *"The one named Blade will sharpen the stone on a shaft"*, *"I am Smith and I will heat the green rock until the metal runs"*, *"I am called Farmer because I put seeds in the ground and food grows"*, *"My name is Kindler and I will strike the stones until a flame wakes"*, *"I am the one named Healer, and the bitter root laid on a wound draws the sickness out"*. The exemption covers the name TOKEN and nothing else. `name` field 0, thought and goal still read for all of `Farmer`/`Smith`/`Forge`/`Coin`. Claim (4) verified and safe.

## The card — STALE, and now quoting above the blind number

It still carries `tier2-lexical@r4`, `precision 0.982 / recall 0.539`, the round-4 per-domain list, and a note saying it "predates the fuzzy-corroboration change". The shipped verdict prints `blind recall 0.539`, which is **above my round-5 measurement of 0.510** — the rule the card exists to enforce is currently broken by staleness. Replace with:

```ts
detector: 'tier2-lexical@r5',
blind: {
  set: 'T1-blind-r2',
  n: 184,
  precision: 0.981,
  recall: 0.510,
  perDomain: [
    { domain: 'astronomy',   recall: 0.583 },
    { domain: 'cultivation', recall: 0.429 },
    { domain: 'fire',        recall: 0.846 },
    { domain: 'governance',  recall: 0.231 },
    { domain: 'medicine',    recall: 0.417 },
    { domain: 'metallurgy',  recall: 0.462 },
    { domain: 'toolmaking',  recall: 0.615 },
    { domain: 'trade',       recall: 0.500 },
  ],
  measuredBy: 'T1 reviewer, rework campaign round 5 (docs/rework/reviews/T1-reviewer.md)',
  measuredAt: '2026-09-18T19:30:34',
  sha256: '305b6bbe..ecebfe (abbreviated in the report; the full digest is the reviewer’s)',
  heldAt: 'C:\\Users\\hakim\\.yggdrasil-lab\\rework\\eval\\T1-blind-r2.jsonl — outside this repo, never read here',
  note:
    'Re-scored on the round-5 tree, same 184 outputs as rounds 2-4, so the series is comparable: ' +
    'P 0.824/R 0.412 (r2) -> 0.982/0.539 (r3, r4) -> 0.981/0.510 (r5). The recall step down is three rows and ' +
    'all three are deliberate: two name-leak rows went silent because a self-chosen name is no longer read as ' +
    'knowledge (ruling), and one childlike row went silent because `sharp` is no longer decisive (surface ' +
    'ruling). Scored as the gate reads tier 2 — any lexical evidence, every domain but the one a control is ' +
    'grounded in. Tier 1 alone P 1.000 / R 0.078; tiers 1+2 P 0.983 / R 0.569. ONE false positive, and it is ' +
    'an artifact of the reviewer pairing a blind row to a battery probe whose tale lacks the word. Recall is ' +
    'REPORTED, not targeted: tier 2 is a high-precision lower bound and PASS still needs a judge.',
},
```

Drop the "predates" clause; `fidelity.test.ts:164` pins `/PREDATE|predate/` on `blind.note`, so that assertion must move in the same commit.

## Regression — nothing broke

Seven adversarial policies still FAIL for their asserted reasons; record/replay byte-identity, zero-perturbation and the golden fingerprints green. **engine 390/390, home 58/58, mcp 13/13**; `tsc -p tsconfig.json --noEmit` exit 0 in all three.

## Backlog

`sharpened her eyes`, `cast a look`, bare-negation `wheel`; the two-sentence pair window misses a claim split across three clauses (`too-06`); med-21's pairing artifact; the `suppliedNames` exemption silences a domain word for a being that named itself after it, from the tick after it chooses; carried forward unmoved — numeric args silently drop non-numbers, a goal's `description` is `String()`-coerced into a field tier 2 reads, enumerated args are closed globally not per verb, a malformed card prints `blind recall NaN`, concepts outside the eight domains are undetectable by design, `echoScore` returns 0 below 20 novel shingles, `controlsActed` is satisfied by recitation, `packages/engine/tsconfig.json` excludes `test/`, `dedupe.ts` holds literal NUL and DEL bytes.

## Hygiene

Two `_verify_*` scratch tests written and both deleted; `git status` shows none. **All 68 item files byte-identical** before and after. No source edit; the only file I wrote is this review. No install, no recursive delete, no background processes. Other engineers' `packages/engine/src/runner/**`, `test/runner-*` and `packages/lab/**` untouched and not counted here.

## To pass

  1. Give `sparks` the `unless` that `spark` already has, and add a test that every decisive word sharing a folded stem with a guarded one carries the same guard.
  2. Add `pay attention` / `pay heed` to `pay`'s `unless`; decide `cast`.
  3. Ship the card block above and move the `/PREDATE/` assertion with it.
