# W0-A — hostile verification of the eight §2 fixes

**FAIL** — 2 MEDIUM, 4 LOW. Suite 100/100 (15 files, 171 s), `tsc --noEmit` 0 errors, determinism intact.
Working tree restored exactly: `git diff -- packages/engine` md5 `ad8c09c2…` before and after; `git status --short` unchanged (17 M + `test/llm-speech.test.ts` ??). Scratch tests deleted.

## Defects

**D1 · MEDIUM · the WitnessedDeath fix is behaviourally inert — fear attaches to corpses.**
`AgentDied` is emitted with `actorId = the deceased`, `targetIds: []` (`src/body/YggdrasilSystem.ts:236-244`, the only emission site). The bystander branch sets `subjects = [actorId, …targetIds]` (`src/memory/memoryFromEvent.ts:62`), so `src/agent/AgentMind.ts:96` always calls `applyObservedEvent(<dead id>, 'WitnessedDeath')`.
Repro: `memoryFromEvent({tick:10,type:'AgentDied',actorId:9,targetIds:[],x:0,y:0,payload:{cause:'attack'}}, 5, CTX)` → `subjects [9]`, `origin 'observation'` → `new AgentMind(5).observe(that)` → **observed:** `relationships.get(9).fear === 4` and 9 is dead. **Expected:** the delta marks someone alive (the killer) or the ladder is reworked.
Nothing reads it: `enrichCulture` skips dead partners (`src/runner/Experiment.ts:982`), reflex affinity only scans the worldView. Audit claim "beings never learn to fear anything from seeing death" is still true in effect. Secondary: a permanent `RelationshipRecord` per witnessed corpse, never pruned — measured 8 dead-pointing records in one 60-agent/9000-tick run.
The new test (`test/agent-mind.test.ts:62`) feeds a synthetic `subjects:[7]` the real pipeline never produces, so it cannot catch this.

**D2 · MEDIUM · `groundTruth.ts` grades `stone` as an upland yield; `Dig` makes stone a lowland yield.**
`src/body/YggdrasilSystem.ts:363-371`: `const dug = context.nearWater ? 'clay' : 'stone'` then emits `GatherSucceeded {objectKind: dug}` — anywhere dry, unbounded, no node required.
Repro: agent moved to (900,1500) (`regionAt` = plains, `elevationBand` = 0), plan `[Dig,Dig,Dig]`, `advance(6)` → **observed:** inventory `{stone:3}`, 3 × `GatherSucceeded:stone` at band 0; `classifyRuleTruth({kind:'context-association',event:'GatherSucceeded',objectKind:'stone',feature:'highland',direction:'negative'})` → `'false'` (`src/analysis/groundTruth.ts:50,74`). **Expected:** `'true'` (or abstain) for a digging population. ReflexMind never digs, but `Dig{}` is in `INTENT_VOCAB` and is advertised to every conscious mind (`src/consciousness/prompt.ts:57`), so every LLM run is exposed.

**D3 · LOW · `myth.ts` invents an "undated" class instead of using data it already has.**
`Narrative.firstTick` is exact (`src/narrative/NarrativeStore.ts:16`) but `src/runner/Experiment.ts:838` still projects to `{id,text}`, forcing `bucketOf` to parse ids. Fallout: `institutions().oldestMyth` is now `null` whenever the only ≥3-holder story is seeded (verified: 20 agents, 1200 ticks, `seedMyth` → `oldestMyth: null`); and `grandest.ageTicks` reports `0` for a myth seeded at tick 0 read at tick 50 000 — *less* accurate than the value the old bug gave for exactly that case. Fix: carry `firstTick` in `NarrativeRef`, delete `bucketOf`.
Also LOW/API: `MythReport.mostVaried.id` changed `number → string` and is exported from `src/index.ts` — an out-of-package break (lab/mcp not checked, per scope).

**D4 · LOW · `ruleRef` resolves against records the prompt never showed.** `knowledgeText` renders `held().slice(0,12)` (`src/consciousness/prompt.ts:172`); `src/agent/AgentMind.ts:239` searches all of `held()`. Repro: speaker with 21 held rules → 9 ids absent from the prompt → `ruleRef` on a hidden id transmits the rule. Still the speaker's own belief, so no doctrine breach, but it contradicts "the knowledge id its prompt showed it" and hands a model a working id oracle.

**D5 · LOW · payload frozen at decide-time, not speak-time.** `applyOutput` resolves, then `applyPlan` queues `Speak` for later ticks (`src/runner/Experiment.ts:493-497`). Repro (unit): resolve `ruleRef:1`; then `applyEvidence(BERRY, conf .05, ev 4, contra 9)` → status `abandoned`; the queued utterance still carries the rule and the old confidence and a listener intakes it. Window is small in-sim; it is a caveat on the claim's wording.

**D6 · LOW/latent · `spoken.rule = record.rule` (`src/agent/AgentMind.ts:211`) shares one `KnowledgeRule` object between speaker and listener** (verified `listener.rule === speaker.rule`). No mutation path today; pre-existing on the reflex path.

## Attacks that held

- Raw JSON through `parseMindOutput` with inline `rule`/`ruleConfidence`/`narrativeId`/`narrativeText`: all dropped; surviving keys exactly `speechAct, targetId, text` (+refs). `__proto__` / `constructor` keys ignored, `Object.prototype` unpolluted.
- 10 000 utterances → capped at 4. `ruleRef` of −1, 1.5, 1e300, 2^53, 1e999 (→Infinity, rejected by `isNum`), `"1"`, `true`, `null`, `{}` → none resolve.
- Refs to **hypothesis / contested / abandoned** records → no rule transmitted (all three statuses exercised).
- Another being's narrative ref, a raw narrative id as `narrativeRef`, and every cross-act combination (`share-knowledge`+`narrativeRef`, `share-episode`+`ruleRef`, `inform`/`request`+both) → nothing resolves.
- `ruleConfidence: 0.99` never survives; the store's value is transmitted. Nothing but `text`/`targetId`/`speechAct` reaches a listener store.
- Free `text` forms no knowledge and no story — and never reaches a listener's prompt at all (`summarize` renders only `UtteranceSpoken involving agent #N`). Safe, but LLM free speech is currently inert.
- `narrativeRefOf` over 4161 realistic ids (`{slew,home,fell,attack}:1..260:0..3` + `seed:myth`): **4161 distinct refs, 0 collisions**. Refs are 6 **or 7** chars — `padStart(6)` is cosmetic, never truncating.
- Prompt contains no `seed:` and no raw narrative id; only `(ref …)` handles.
- Observed deltas: `AttackedAgent`, `UtteranceSpoken`, `ReceivedItem`, `GaveItem`, `SleptSafely`, `WasAttacked` with `origin:'observation'` each produce **no** record. No double application — one `memoryFromEvent` per witness per event, and `witnessesOf` excludes the dead actor.
- `urgentOverride`: nightshade+mushroomRed at hunger 95 → eats nothing, `sickUntil` 0; meat-only → eats meat; order berry→tuber→meat; `SICKENING ∩ NUTRITIOUS = ∅`.
- `latencyMs`: written only at `src/consciousness/LlmMind.ts:101`, **read nowhere in `src/`**; no sim-time-as-latency remains. Caveat: `wallClock()` returns `0` when `performance` is undefined → silent 0 latency in such a host.
- `body/contract.ts` collapse: mechanically compared every collapsed declaration against `contract/types.ts` — `ObjectKind`, `ResourceNodeKind`, `IntentKind`, `BuildKind`, `SimEventType`, `NeedKey`, `Season`, `Traits`, `ContextFeatures`, `SimEvent`, `AgentSnapshot`, `ObservedAgent`, `ObservedResource`, `ObservedStructure`, `WorldView`, `Intent` — identical member-for-member and in order. Nothing widened or narrowed. `contract/types.ts` imports nothing → `body → contract` is acyclic.
- Determinism: two same-seed reflex runs (`determinism` 40×6000, `harsh` 60×9000) are bit-identical over per-agent alive/needs/inventory + every knowledge record (id, ruleKey, confidence @9dp, status) + every relationship scalar + every narrative (id, text, timesHeard, firstTick).
- Test quality: reverted `schema.ts:109` → 2 `llm-speech` tests fail; reverted `AgentMind.ts:96` → the new `agent-mind` test fails. Both capable of failing; both restored byte-exact.

## Oracle validated empirically (default world, seed `determinism`, 1863 nodes; band mix 1574/62/227, band-2 share 12.2 %)

| yield | n | band0 | band1 | band2 | verdict |
|---|---|---|---|---|---|
| copperOre / ironOre / silver / gold / gemstone | 42/34/14/7/18 | 0 | 0 | all | UPLAND ✔ |
| tinOre | 26 | 0 | 1 | 25 (96 %) | UPLAND ✔ |
| coal | 34 | 0 | 5 | 29 (85 %) | UPLAND ✔ |
| **stone** | **106** | **25** | **23** | **58 (55 %)** | **UPLAND ✘ — see D2** |
| berry/tuber/mushroomRed/nightshade/meat/salt/water/fiber | 392/302/56/36/36/30/160/204 | all | ≤4 | **0** | LOWLAND ✔ |
| wood | 268 | 255 | 13 | 0 | LOWLAND ✔ |
| clay | 98 | 82 | 16 | 0 | LOWLAND ✔ |

`hills` never reaches band 2 (max height 6.9 < 8), so band 2 ⊆ `mountain`. Every yield that exists in the world is in exactly one set — **no orphan kind**; `seed` and `hide` are never a `GatherSucceeded` `objectKind`. 17 of 18 entries verify; `stone` is the one graded against the facts.

---

# Round 2 — re-verification of the D1/D2/D3/D6 fixes

**FAIL** — D2 fixed, D6 half-fixed; D1 trades its old defect for a new one and still never fires in practice; D3 is still wrong. Suite 103/103 (15 files, 145 s), `tsc --noEmit` 0 errors, determinism intact. Tree restored (`git status --short -- packages/engine` unchanged; scratch test deleted).

**R2-1 · MEDIUM · D1 regression: the witness memory no longer records who died.**
`src/memory/memoryFromEvent.ts:74-80` *overwrites* the bystander `subjects` with `[killerId]`/`[]`, and `event.actorId` (the deceased) is stored nowhere else on the record. Repro (real bus: `Attack` → `AgentDied` → `witnessesOf` → `memoryFromEvent` → `observe`, 3 agents at (500,500)/(501,500)/(520,500)): witness memory is `subjects=[1828] summaryText="WitnessedDeath involving agent #1828"` where **1828 is the killer and the victim 1829 appears nowhere in the record** (`JSON.stringify(record)` contains no `1829`). That string is what the mind reads — prompt line verified: `  - WitnessedDeath involving agent #1828`. Every other event type puts the *other party to what happened* in that slot, so an LLM will read #1828 as the one who died. **Expected:** keep the deceased identifiable (e.g. `subjects:[deceased]` + a separate `killerId` field, or a summary that says "…killed by #N"). Before the fix the line at least named the deceased; now that fact is unrecoverable.
For a killer-less death the record is `subjects=[] summaryText="WitnessedDeath"` — no one at all.

**R2-2 · MEDIUM · D1 still does not fire: predator kills carry no `killerId`.**
`die()` has exactly two call sites (`src/body/YggdrasilSystem.ts:89` and `:610`). Only `:610` (`case 'Attack'`) passes a killer; `:89` is the afflictions path and covers starvation, exposure, sickness **and every predator mauling** — `cause` is `'violence'` whenever `hitThisTick` is set, which `src/body/WildlifeSystem.ts:249` also sets. So watching a bear kill a companion marks nobody. Measured, seed `harsh`, 60 agents × 9000 ticks: `deathsByCause {"violence":2,"starvation":1}` and **0 fear-bearing relationship records** (round 1's corpse-version produced 5). The delta is now shaped correctly and observed to never occur in a reflex world. `expect(exp.deathsByCause['violence']).toBe(1)` in the new test is also not specific to a Gahallian killing.

**R2-3 · MEDIUM · D3 not fixed: a story's age is the earliest *living* holder's copy, so it collapses.**
`NarrativeStore.remember` (`:100-108`) stamps `firstTick = tick` for a new entry and `Experiment.coPresencePass:534-536` retells with `tick`, so a retold copy carries the *retelling* tick (confirmed: 5000). `Experiment.myth():835` feeds only living holders, and `analyzeMyth` takes `min(firstTick)` over them. Repro: story `slew:9:1`, witness copy `firstTick 100`, two retold copies `firstTick 5000`, `currentTick 9000` → `oldestSurviving.ageTicks = 8900`; drop the witness (it died), same story, same tick → **4000**. It also flips the ranking: with a second story `home:3:2 firstTick 2000`, "Nine slew a bear" is oldest before and "Three raised a home" (7000) after. `ageTicks` is therefore non-monotonic in time. **Expected:** propagate the source's `firstTick` on a retelling (`remember(sa.id, …, sa.firstTick, false)`) so a copy inherits the story's own clock. Correctly, `remember` does *not* reset `firstTick` on re-hearing.

**R2-4 · LOW · D6 half-fixed: co-listeners of one utterance still share one rule object.**
`copyRule` (`src/agent/AgentMind.ts:30`) decouples speaker from listener including nested `craft-recipe.inputs` — verified: listener sets `inputs.wood = 99`, `output = 'club'`; speaker still `{wood:1, stone:1}`/`spear`. But one resolved utterance object is delivered by reference to *every* witness (`event.payload.utterance` → `memoryFromEvent` → `intakeTestimony(stored.utterance.rule, …)`). Two listeners of the same utterance: `r1 === r2` is **true**, and `r1.inputs.wood = 42` shows up in listener 2. Eavesdropping is the common case, so the invariant the fix states is still broken among the audience. Fix: copy in `intakeTestimony`, not in `resolveSpeech`.

**R2-5 · LOW · the new witness test asserts a non-invariant.** `test/experiment.test.ts` — "Nothing a witness holds may point at the dead" holds only at that instant. Repro: after the killing, starve the killer (`health = 0.04`, `hunger = 100`, `advance(3)`) → the witness's relationship map still keys the now-dead killer. Generic to all relationship records, but the comment overstates. (Also: the round-1 `agent-mind.test.ts` WitnessedDeath unit test was removed, leaving a stray blank line.)

**D2 · fixed.** `stone` is in neither set and falls through to `unverified` in both directions — correct, since `Dig` wins stone on any dry ground. The remaining `UPLAND_YIELDS` all verify against round 1's counts (copperOre/ironOre/silver/gold/gemstone 100 % band 2, tinOre 96.2 %, coal 85.3 %, vs a 12.2 % base rate); `LOWLAND_YIELDS` all 0 % band 2. No other yield reaches band 2 by any route (`Dig` yields only `clay`/`stone`; `Craft` emits no `GatherSucceeded`).

**Also checked and holding.** Killer can never be self (`killerId !== selfId` — the killer's own death memory is `subjects=[]` and it holds no self-relationship), never a predator or non-agent entity (`entity.id` at the single `Attack` site is an agent), never stale (the attacker is alive to execute, and dead agents `continue` before `executeStep`); `killerId` is `typeof`-guarded. The only consumers of `subjects` are `AgentMind` (deltas) and `SocialMiner:47` — `WitnessedDeath` hits its `default` branch, so it creates an empty tally and no `social-contingency` rule either way; narrative/story authoring uses `event.actorId`, so stories still name who fell. No lab/mcp/db code reads `.subjects`. The new D1 test does drive the real bus→perception→`memoryFromEvent`→`observe` path. Determinism: `harsh` 60×9000 two same-seed runs bit-identical over needs/inventory/knowledge/relationships/narratives (`firstTick` included).

---

# Round 3 — re-verification of R2-1, R2-3, R2-4, R2-5

**PASS** — all four materially hold under attack. Suite 105/105 (15 files, 176 s), `tsc --noEmit` 0 errors, determinism bit-identical. Tree restored, scratch deleted. Four nits below; none is a FAIL. (R2-2 not re-raised — architect's by-design call.)

**R2-1 · holds.** Real bus (`Attack` → `AgentDied` → `witnessesOf` → `memoryFromEvent` → `observe`), 3 agents at (500,500)/(501,500)/(520,500):
- Bystander: `subjects=[1829]` (victim), `causedBy=1828` (killer), `summaryText="WitnessedDeath involving agent #1829 caused by agent #1828"`. Prompt line verified identical — who died is legible again and the hand is named separately. Fear +4 on the killer only, `interactionCount 0`, no record toward the victim.
- Killer's own perspective: `subjects=[1829]`, `causedBy=undefined`, no self-relationship; its `AttackedAgent` memory still carries `subjects=[1829]`.
- Victim: one `WasAttacked` with `subjects=[1828]` and fear > 0, and **no** `WitnessedDeath` — the dead observe nothing (`witnessesOf` filters `body.alive`).
- `causedBy` is unreachable from a model: `parseMindOutput` on `{"plan":[{"kind":"Idle","causedBy":7,"killerId":7}],"utterances":[{"speechAct":"inform","causedBy":7,"narrativeFirstTick":1}]}` yields intent keys `['kind']` and utterance keys `['speechAct']`. An `AgentDied` payload without `killerId` (forged directly) gives `causedBy: undefined`. `killerId` is written at exactly one site (`YggdrasilSystem.ts:610`).
- Miners unconfused: `causedBy` is read only by `AgentMind.ts:92`; `SocialMiner:47` still iterates `subjects`, `WitnessedDeath` hits its `default`, and after a killing + 900 ticks the witness holds no `soc:<killer>:dangerous` or `soc:<victim>:dangerous` (rule list empty). `storyFor` still uses `event.actorId`, so stories name who fell.

**R2-3 · holds, and verified in a real run.** `narrativeFirstTick` is not parseable (`schema.ts` never reads it; a JSON utterance carrying it yields `undefined`), and is engine-set in `resolveSpeech` from `story.firstTick`. A speaker whose copy dates to 120 speaks `narrativeFirstTick: 120`; a listener hearing it at tick 9000 records `firstTick: 120`. `remember` lowers on an older teller (5000 → 100) and **cannot be raised** — 9999, `NaN` and `Infinity` all leave it at 100. `coPresencePass:536,538` retells with `sa.firstTick`, so the drifted-text path keeps the origin. **Real run, seed `harsh`, 60 agents, 15 000 ticks, 62 stories: zero split-origin stories** (every living holder of every id shares one `firstTick`) and `oldestSurviving.ageTicks` strictly non-decreasing across six samples — `[95, 2815, 5315, 7815, 10315, 12672]`. Age is now death-invariant.

**R2-4 · holds for the claimed channel.** `copyRule` moved into `KnowledgeStore.intakeTestimony`. One utterance object delivered to a target and two eavesdroppers: all three rules and their nested `inputs` are distinct objects, and distinct from the speaker's; listener 1 setting `inputs.wood = 42` / `output = 'club'` leaves listener 2, the eavesdropper and the speaker at `{wood:1, stone:1}` / `spear`.

**R2-5 · holds.** The non-invariant assertion is gone; the surviving assertions in `test/experiment.test.ts:77-135` are all instantaneous facts that the code does maintain.

## Nits (not blocking)

1. **`applyEvidence` does not copy, and `CraftObservationMiner` hands it a shared object.** `KnowledgeStore.ts:9` claims "A rule entering a store is COPIED", but only `intakeTestimony` copies. `CraftObservationMiner.ts:44` does `t.inputs = memory.craftInputs`, which is `event.payload['inputs']` — one object shared by every witness of a `Crafted` event. Demonstrated: two watchers of one demonstration hold `r1.inputs === r2.inputs === event.payload.inputs`; watcher 1 setting `wood = 99` shows in watcher 2. Latent (nothing mutates `record.rule` today) and the same LOW class as the original D6, but it is on the apprenticeship channel and the fix is one `copyRule(report.rule)` in `applyEvidence` (or a copy at `CraftObservationMiner:44`).
2. **`seed()` still overwrites unconditionally**, so it is the one path that can move an origin *forward*: `seed('slew:9:1', …, 8000, 6)` over an entry dating to 100 resets `firstTick` to 8000 and clobbers `timesHeard`/`firsthand`. Reachable only by calling `seedMyth` twice under the same (default `'seed:myth'`) id. Consider routing `seed` through the same lowering rule, or documenting single-use.
3. **`remember` accepts a negative origin and lowers to it** (verified: −50). No engine call site can produce one — all pass `event.tick`, `sa.firstTick` or `narrativeFirstTick` — so it is unreachable today; a `Math.max(0, …)` would make it safe against a host.
4. **Semantics shift in `AgentMind.buildThinkInput:162`.** `firstTick` now means the story's origin rather than when *this* being heard it, so a sacred place is the story with the oldest **event**, not the one heard earliest. Arguably the better reading and still intrinsic-only, but it changes the pilgrimage mechanism's selection — worth a line in the vault so a trajectory change in Exp-11/13 is not mistaken for a result.
