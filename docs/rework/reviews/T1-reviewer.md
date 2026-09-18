FAIL — Round 2 (Round 1 also FAIL; both rounds below, Round 2 at the end)

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
