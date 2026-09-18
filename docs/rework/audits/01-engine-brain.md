# Audit 01 — Engine / Brain (`packages/engine`, ~8k LOC)

Read-only audit, 2026-09-18. Commands run (only these, foreground, no PIDs left behind):

- `pnpm --filter @yggdrasil/engine test` → **85 passed / 0 failed**, 14 files, 151 s (one test, `experiment.test.ts > generations`, is 113 s of it).
- No `typecheck` script exists in `packages/engine/package.json` (only `build: tsc -p tsconfig.json`). Ran the equivalent `npx tsc -p tsconfig.json --noEmit` → **0 errors**.

---

## 1. Architecture map

**Per tick** (`runner/Experiment.ts:430-481`): `ResourceNodeSystem.step` → `WildlifeSystem.step` → `WorldRegularitiesSystem.step` → `YggdrasilSystem.step` (per living agent: needs decay, afflictions, death, then execute one intent of the current plan; every action/rejection emits a `SimEvent`) → every 150 ticks `coPresencePass` (bond + story retelling) → every 300 ticks `reproduce` → then for each mind: maybe `consolidate`, and if `body.planDone` a synchronous `ReflexMind.think` → `setPlan`.
**Per event** (`Experiment.ts:213-241`, the bus subscriber): `perception.witnessesOf` → for each witness `contextAt` → `memoryFromEvent` (perspective-mapped: actor/target/bystander) → `mind.observe` → memory append + all miners `observe` + relationship deltas (experience only) + testimony intake → `storyFor` authors a story string → `narratives.remember` → `gainRespect` for two event types.
**Per think (conscious/LLM path only)** (`Experiment.ts:460-478`): `shouldThink` cadence → `snapshotFor` + `worldViewFor` → `buildThinkInput` (recall 24 memories, held knowledge, relationships, sacred/tragedy places) → `enrichCulture` (stories, kin, felt social) → `CognitionScheduler.submit` → `LlmMind.complete` → `buildThinkPrompt` → backend → `parseMindOutput` (2 tries, else reflex) → applied on whatever tick it resolves.
**Consolidation** (`agent/AgentMind.ts:119-126`): each miner emits `EvidenceReport[]` → `KnowledgeStore.applyEvidence` (Laplace confidence, status lifecycle) → `relationships.decay`.
Mind never mutates the world; the body validates every intent. Analysis (`analysis/*`) reads minds post-hoc and is never read back.

---

## 2. Skeptical quality audit

### Correctness bugs

- **`consciousness/schema.ts:91-107` silently drops `rule`, `ruleConfidence`, `narrativeId`, `narrativeText` from every parsed utterance.** `agent/AgentMind.ts:90` and `:96` require exactly those fields to intake a story or testimony. **Consequence: an LLM-driven being can never teach knowledge and never pass a story.** Every knowledge-diffusion and narrative-spread number ever measured comes from `ReflexMind` alone. The comment at `AgentMind.ts:92-94` describes an LLM share path that cannot fire. Three months undetected — no test covers it.
- **`relationships/RelationshipStore.ts:16` `WitnessedDeath: { fear: 4 }` is unreachable.** `WitnessedDeath` memories only arise in the bystander branch (`memory/memoryFromEvent.ts:59-75`, `origin: 'observation'`), and `AgentMind.ts:83` applies deltas only for `origin === 'experience'`. Beings never learn to fear anything from seeing death.
- **`analysis/groundTruth.ts:52`: `if (rule.feature === 'highland') return 'false'`**, comment "No elevation regularity exists in the flat sim". The world has had elevation since `world/regions.ts:111-116`, and ores are scattered *only* in `mountain` (`Experiment.ts:379-386`). Every genuinely true highland regularity is scored as a superstition, so `analysis().accuracy`, `falseCount` and every "superstition" finding are wrong. The same file's header points at `engine/src/yggdrasil/WorldRegularities` — a path in the *other* repo.
- **`analysis/myth.ts` (`const bucket = Number(id.split(':')[2] ?? 0)`)**: ids with fewer than 3 segments — notably seeded myths, `Experiment.ts:996` `'seed:myth'` — yield bucket 0, so `ageTicks = currentTick`. A seeded myth always wins `oldestSurviving` and `institutions().oldestMyth`.
- `analysis/myth.ts` `mostVaried` returns `{ id: 0, … }` — the id field is hardcoded, never the story.
- `body/YggdrasilSystem.ts:275-281` `urgentOverride` hardcodes `berry`; a starving being holding tuber or meat dies with food in hand.
- `runner/Experiment.ts:200-202` passes `now: () => this.tick` into `LlmMind`, so `CognitionRecord.latencyMs` is a tick delta, not latency. It is logged, reported as model health, and shipped into the training corpus.
- `body/YggdrasilSystem.ts:249-255` `sleepTick` contains an empty `if` block.

### Determinism hazards

- The LLM path is nondeterministic by construction: `scheduler/CognitionScheduler.ts:52-65` applies output on whatever tick the promise resolves, and `Experiment.ts:466-477` mutates world state there. The only determinism test is reflex-only. `MockMindBackend` resolves synchronously, which *hides* the hazard rather than testing it.
- No snapshot/replay exists. "Every run is reproducible from its seed" (`Experiment.ts:130`) means *re-running from tick 0*; a 100k-tick run cannot be resumed or bisected.
- `Experiment.ts:556` consumes `reproRng` inside a loop whose ordering depends on which beings survived, coupling reproduction RNG to survival order. Fine today, unreplayable under any parallelism.
- `contract/types.ts:5-8` claims drift between it and `body/contract.ts` (227 duplicated lines) is caught by `test/contract-compat.test.ts`. **That file does not exist in this repo.**

### Performance cliffs (these, not inference, block 1000+ beings)

- `body/PerceptionSystem.ts:53-76` `contextAt` scans **every entity** (~1900 in the default world) and runs once per agent per tick (`YggdrasilSystem.ts:84`) plus again inside `snapshotFor` (`:123`).
- `body/YggdrasilSystem.ts:135-144` `decayNeeds` performs a **second** full-world scan per agent per tick to answer "is anyone within 8 units".
- `body/PerceptionSystem.ts:91-105` `worldViewFor` — full scan per think. `:128-141` `witnessesOf` — full scan per emitted event.
- `runner/Experiment.ts:512-533` co-presence is O(n²) over living agents every 150 ticks — the *least* severe of the four.
- Net ≈ 4×10⁵ entity visits/tick at 100 agents / 1900 entities, i.e. **O(agents × entities)**. There is no spatial index anywhere in the codebase. Evidence: the `generations` test alone is 113 s. The design doc's "The body scales trivially" (§11) is false.
- `Experiment.ts:823,833,925-934`: `myth()` calls `society()`; `institutions()` calls `sacredPlaces() + myth() + leadership() + society()` → `analyzeDiffusion` over every agent's full knowledge runs twice per snapshot.
- `memory/MemoryStream.ts:63` `get()` is a linear scan of hot + archive; `archive` is unbounded (leak); `all()` walks it and is called per agent by `Experiment.archetypeOf:1191-1194` on every analysis pass.

### God objects

- `runner/Experiment.ts` — 1246 lines: worldgen, tick loop, reproduction, **narrative authoring**, relationship prose, culture assembly, eight analysis facades, four experiment A/B switches, and the seeding API. The simulation and the research instrument are the same object; that is structurally how the measurement-matches-mechanism problems in §3 survived.
- `body/YggdrasilSystem.ts` — 762 lines, one 340-line `switch`.

### Dead code / dead vocabulary

- `SimEventType` `'SawAgent'` and `'FoundResource'` are **never emitted** (0 hits), yet carry entries in `memory/importance.ts:36-38`, `learning/templates.ts:23`, `analysis/groundTruth.ts:46`.
- `social-contingency` pattern `'helpful'` (`contract/types.ts:296`, `templates.ts:58`) is never produced by `SocialMiner`.
- `memory/IEmbedder.ts` — `embedding` is never set anywhere, so `MemoryStream.ts:51` relevance is permanently `0.5`. Retrieval is recency × importance only; the embedding seam is decoration.
- `world/materials.ts` `MATERIAL_PROPERTIES` (82 lines) is read by nothing in the body — truth lives in `WorldRegularities.NUTRITIOUS_FOODS/SICKENING_FOODS` and `CRAFT_RECIPES`. Two competing sources of material truth; `smeltsTo`/`worksTo`/`burnsHot`/`moldable`/`twistable` are inert.
- `body/Climate.ts:64-75` `weatherAt` is computed, exported, consumed by nothing.
- `training/eval.ts` `evalKnowledgeFidelity` — the stated gate for swapping in a fine-tuned model — is never called by any test or runner.
- `Experiment.giveIdea` / `AgentMind.injectIdea` are effectively inert for reflex beings: the injected memory is `origin: 'testimony'` (OutcomeMiner weight 0), type `UtteranceSpoken` (SuccessionMiner excludes it), and `ReflexMind` reads `recalledMemories` only for food spots.

### Test gaps

- 85 tests. **No direct test file** for: `ReflexMind` branches, `YggdrasilSystem` intent validation, `PerceptionSystem`, `MemoryStream` eviction/retrieval, `RelationshipStore` decay, `CognitionScheduler` concurrency, `schema.parseMindOutput` rejection paths, `memoryFromEvent` perspective mapping. `contract-compat.test.ts` is referenced but absent.
- Nothing asserts the LLM → testimony/story path; that is why the `schema.ts` payload drop went unnoticed.
- The determinism test is reflex-only and short-horizon.

---

## 3. Authored-versus-emergent honesty check

1. **Narrative escalation ladder — `narrative/NarrativeStore.ts:33-62`.** 22 hand-written English rungs, including `['was the greatest of the makers','the makers were chosen to arm us']` and `['the makers were chosen to arm us','the makers are sacred and should lead us']`. `analysis/myth.ts` `grandeur()` then **regex-matches those exact authored strings** and scores 0–4. The Exp-13 question ("does 'made the first spear' drift into a claim about who should rule?") is answered by a string literal the author wrote and a regex that looks for it. **The claim is not defensible.** Only defensible restatement: "text mutated under a fixed 25%-per-retell noise model accumulates drift along social chains at rate X".
2. **Which events can become stories at all — `Experiment.ts:250-273`.** A 4-case switch authors English for `KilledPredator` / violent `AgentDied` / shelter `BuiltStructure` / `AttackedAgent`; nothing else can ever be a story. `analysis/myth.ts` then defines heroes as id prefix `slew|home` and villains as `attack`. **The hero/villain taxonomy is authored, not discovered.**
3. **Pilgrimage — `consciousness/ReflexMind.ts:130-136`.** `tick % 1600 < 640` plus `MoveTo(sacredPlace)`. `Experiment.beliefBehavior():1111-1177` then measures the fraction of a story's holders standing near that story's site. The branch is the sole and direct cause of the effect measured; the `mythBehavior:false` "control" just deletes the branch. **"Myths create destinies" is not defensible** as stated. Defensible: "a myth slot in the action policy shifts spatial distribution by ΔfractionNear".
4. **Prestige / leadership — `Experiment.ts:235-238` grants +5 respect for `KilledPredator`, +3 for shelter builds; `ReflexMind.affinityToward:357-361` makes movement a linear function of respect; `Experiment.leadership():883` measures followership with a byte-identical copy of that same formula.** The analysis is the mechanism. **"Leaders emerge; followership is relational not meritocratic" is not defensible as emergence** — it reports the shape of a formula the code applies. Defensible: "a fixed two-act prestige rule concentrates followership to Gini G".
5. **Apprenticeship / technological inheritance (1→168 makers over 6 generations).** The transmission channel (`learning/CraftObservationMiner.ts`) is a genuine evidence-counting miner and is the **strongest** result in the codebase. But the *adoption decision* is authored: `ReflexMind.ts:111-121` makes any recipe-holder craft whenever no need presses, and `craftPlan:264-291` hardcodes where to obtain each material (`MATERIAL_NODE:239-243`, `DIGGABLE:247`). The epidemic's R0 is set by an `if`. Defensible: "observation-weighted evidence accumulation propagates a rule at rate R". Not defensible: "beings chose to adopt a technology".
6. **Clean:** `analysis/archetype.ts` (honestly post-hoc, never read back), `analysis/society.ts:235-246` (union-find, hedged "Possible X" — though every threshold, e.g. `friendship>62 && interactionCount>=8` at `Experiment.ts:770`, is a knob that decides how many tribes exist).
7. **`seedMyth` "carries no behavioural instruction" (`Experiment.ts:989-1005`) is literally true** — its id prefix `seed` never matches the `home|slew|fell|attack` selector in `AgentMind.buildThinkInput:143-151`. But it reaches minds only as prompt text (`prompt.ts:77-79`), so the "culture steers curiosity" A/B tests an LLM's reading of an English sentence, not a cultural mechanism.

---

## 4. World-agnosticism

**The mind layer is welded to this world.** Every item below is in `memory/`, `learning/`, `knowledge/`, `relationships/`, `agent/`, `consciousness/` or `contract/`:

- `contract/types.ts:53-130` — `ObjectKind` (34 literals), `ResourceNodeKind` (20), `SimEventType` (28), `ContextFeatures` (`nearWater/night/inShelter/elevationBand`), `NeedKey` (4). The whole mind is *typed* against this world's nouns.
- `consciousness/ReflexMind.ts:16-21` `EDIBLE`/`FOOD_NODES`/`POISON_NODE_YIELD`; `:239-247` `MATERIAL_NODE`/`DIGGABLE`; `:77` literal `'tree'`; `:62,70` `'shelter'`; `:74` `inventory.wood >= 3`; `:175-180` per-need thresholds; `:200-215` English greetings + confidence phrasing; `:390-435` Euclidean 2-D `nearest`/`wander`/`hypot`; `sacredPlace {x,y}`.
- `consciousness/prompt.ts` — the entire file is English prose about *this* world: "a simple world", `INTENT_VOCAB:19-20`, compass words `:137-141`, season/night `:65`, "seek out an elder" `:96`.
- `learning/templates.ts:9-32` — English `EVENT_PHRASE`/`FEATURE_PHRASE` per this world's events.
- `learning/ContextMiner.ts:13` and `OutcomeMiner.ts:11` — `FEATURES = ['nearWater','night','inShelter','highland']`.
- `memory/importance.ts:9-39` — per-`SimEventType` salience constants. `memory/memoryFromEvent.ts:41-87` — perspective switch keyed on this world's event types. `relationships/RelationshipStore.ts:11-19` — `EVENT_DELTAS` keyed on `SimEventType`.
- `analysis/groundTruth.ts` — this world's physics hand-written as a truth oracle.
- Leakage the other way: `runner/Experiment.ts:44` and `body/YggdrasilSystem.ts:20` import the *continent* (`world/regions.js`) directly.

### Minimal embodiment / world-adapter contract

One `WorldAdapter`, supplied by the host, declaring data — never English, never coordinates:

| Member | Replaces |
|---|---|
| `DriveSchema[]  {driveId, pressingAt, criticalAt}` | `NeedKey`, `NEED_THRESHOLD` |
| `ContextSchema[] {featureId, type}` | `ContextFeatures`, `ContextFeatureKey`, miners' `FEATURES` |
| `EventSchema[] {eventId, roles:[actor|patient|observer], driveDeltas, salience}` | `SimEventType`, `importance.BASE`, `memoryFromEvent`'s switch, `EVENT_DELTAS` |
| `ActionSchema[] {actionId, params, preconditionHints}` | `IntentKind`, `INTENT_VOCAB`, `schema.ts` allowlists |
| `Affordance {id, kindId, features, at}` | `ObjectKind`, `ResourceNodeKind`, `FOOD_NODES`, `MATERIAL_NODE` |
| `Space {distance, sample, directionWord}` | every `x,y`/`Math.hypot` in the mind |
| `Lexicon {phraseFor(id), greeting(), locale}` | `templates.ts`, ReflexMind's English, the prompt's world prose |

**Mind side (must stay identical across worlds):** `MemoryStream` + consolidation + forgetting; the five miners (their *shape* is already world-agnostic — only their hardcoded feature lists are not); `KnowledgeStore` lifecycle and testimony discounting; `RelationshipStore` scalars and decay; `NarrativeStore` *structure* (the ladder's content must move to the world/culture side); drive arbitration and plan assembly; the prompt *skeleton* with Lexicon-filled slots; `CognitionScheduler`; schema parsing driven by `ActionSchema`.
**World side:** every noun, every consequence, every English string, every geometry, every truth oracle, and all narrative content.
**Test of the line:** an unchanged `agent/` + `memory/` + `learning/` + `knowledge/` + `relationships/` runs a modern-city adapter (drives: hunger/sleep/money/belonging; affordances: vending machine, apartment, job) with `git diff --stat` empty over those directories.

---

## 5. Human-likeness gaps

| Faculty | Verdict | Evidence |
|---|---|---|
| Episodic + semantic memory | **SHALLOW** | Both exist (`MemoryStream`, `KnowledgeStore`), but retrieval relevance is a constant `0.5` (`MemoryStream.ts:51`) — recency × importance only. |
| Forgetting | **SHALLOW** | Importance-sorted eviction into an *unbounded* archive (`MemoryStream.ts:31-42`); nothing decays, nothing is reconstructed or distorted. |
| Consolidation | **SHALLOW** | `AgentMind.ts:119-126` re-runs streaming counters on a timer; no replay, no abstraction, no schema formation. Sleep (`YggdrasilSystem.ts:249-255`) does nothing cognitive. |
| Persistent goals / projects | **MISSING** | `AgentMind.goals` is overwritten wholesale every think (`:169,175`); `Goal` (`types.ts:389-395`) has no progress, subgoals or completion. |
| Affect | **MISSING** | Four need pressures plus `fear` toward a person. No mood, no valence, nothing colours memory or perception. |
| Self-model / identity over a life | **MISSING** | Traits are immutable (`types.ts:34`), a name may be picked once (`Experiment.ts:471`), `lastThought` is written and never read (`:473`). No autobiography, no self-concept. |
| Language | **SHALLOW (authored)** | Reflex speech = 5 canned greetings + 1 template (`ReflexMind.ts:200-215`); LLM speech payloads are discarded (`schema.ts:91-107`). Nothing is learned or compositional. |
| Planning horizon | **SHALLOW** | 1–4 intents (`prompt.ts:57`), no hierarchy, no lookahead, no failure-driven replan beyond `planDone` (`YggdrasilSystem.ts:658-662`). |
| Skill acquisition | **SHALLOW** | Exactly one learnable skill type (`craft-recipe`), all-or-nothing, no proficiency curve; its sole channel is off by default (`AgentMind.ts:67`). |
| Theory of mind | **MISSING** | `SocialMiner` learns behavioural contingencies *about* a partner; nothing models another's beliefs, goals or knowledge. |
| Development child → elder | **SHALLOW** | `ADULT_AGE` gates reproduction only (`Experiment.ts:81,542`); cognition params are frozen at birth (`:119-125`); no senescence, and `die()` has no age cause. |
| Creativity | **MISSING** | The only novelty channel is `Craft` against a 4-entry hidden table (`YggdrasilSystem.ts:41-46`). Nothing can compose a new action, artifact, story or rule outside an authored enum. |

---

## 6. Top 10 rework items (ranked by leverage toward one-brain-any-world)

| # | What | Why | Effort | Acceptance criterion |
|---|---|---|---|---|
| 1 | Extract the `WorldAdapter` seam (§4 table) and retype the mind against it | Everything else is blocked on it; the mind is currently typed against 34 object kinds and 28 event types | L | A second adapter (modern city: different drives, affordances, actions, no `berry`/`tree`/`shelter`) runs the unmodified `agent/ memory/ learning/ knowledge/ relationships/`; `git diff --stat` over those dirs is empty; a critic reading 20 traces cannot identify the world from the *mechanism* |
| 2 | Delete the authored escalation ladder + hero/villain taxonomy; move narrative content to the world/culture side | Largest honesty liability; it fabricates the project's headline result | M | `narrative/NarrativeStore.ts` contains zero English sentences; `grandeur()` replaced by a content-free drift metric (variant entropy / edit distance); the Exp-13 claim restated in the vault and re-run |
| 3 | Fix the dropped LLM utterance payload (`schema.ts:91-107`) | Conscious beings currently cannot teach or pass a story at all; every diffusion result is reflex-only | S | A mock-LLM run produces ≥1 `intakeTestimony` from an LLM utterance and ≥1 narrative via `share-episode`; a test fails if either field is dropped |
| 4 | Replace ReflexMind's authored outcome branches with drive arbitration over learned affordances | Pilgrimage, prestige-seeking, craft practice and teaching are `if`-branches that directly produce the measured results | L | `ReflexMind` references no specific kind, place-type or story-type; deleting any branch changes *which* option wins, not *whether* the behaviour class exists; `mythBehavior`/`leadership` flags become deletable |
| 5 | Spatial index + incremental context/perception | O(agents × entities) per tick makes 1000+ beings impossible; the design doc's "body scales trivially" is false | M | 1000 beings × 5000 ticks < 60 s single-threaded on this machine, with a counter assertion that per-tick entity visits are O(agents + entities) |
| 6 | Persistent goals/projects with progress, subgoals, abandonment | Without goals that outlive one plan there is no thriving or creating — only need-servicing | M | A being holds one goal across ≥50 think cycles, shows measurable progress, and abandons it with a stated reason; blind critic prefers Yggdrasil over a plain frontier-LLM agent on "pursues something over time" |
| 7 | Rebuild the ground-truth oracle from adapter-declared mechanics | `groundTruth.ts:52` marks every true highland regularity false — all published accuracy/superstition numbers are wrong | S | Regression test asserts "stone gathering happens mostly in the highlands" → `true`; oracle derives from the adapter, not a hand-written switch; vault figures re-run and corrected |
| 8 | Real forgetting + consolidation (decay, reconstruction, sleep-linked replay, bounded archive) | Memory is the load-bearing difference from a stateless LLM agent, and it is currently an eviction sort into an unbounded array | M | Per-being memory footprint bounded over 100k ticks; recall probability falls with age and rises with rehearsal (measurable curve); a consolidated abstraction appears that no single memory contains |
| 9 | Theory of mind: per-partner model of what they know and want | Teaching, trade, deception, norms and status all require it; today teaching fires on a compassion threshold regardless of the listener | M | A being preferentially teaches a rule to a partner it models as *not* holding it; seed-paired A/B shows higher transfer efficiency than random teaching |
| 10 | Split `runner/Experiment.ts` into Host / Scenario / Instrument; add replay-from-snapshot | Simulation and research instrument are one object — structurally how items 2 and 4 survived; and no run can be resumed or bisected | M | No file over 400 lines in `runner/`; analysis functions live in `analysis/` and take data rather than `this`; a run serialized at tick N and restored reproduces the next 1000 ticks bit-identically |
