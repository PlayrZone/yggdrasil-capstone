# Audit 03 — Training Data

**Scope:** `~/.yggdrasil-lab/corpus/civilization.jsonl`, `packages/engine/src/training/{corpus,eval}.ts`,
`packages/mcp/{src/corpus.ts,_p2lib.mjs,_phase*_exp*.mjs}`, `docs/yggdrasil_{training_strategy,fireworks_training}.md`,
`~/.yggdrasil-lab/reports/*`. Read-only. All numbers computed by throwaway scripts over the full file.

## Verdict

**The "Civilization Corpus" is not a training dataset. It cannot be trained on at all in its current form,
and should not be even if it could.** It has no prompts, no raw model outputs, no model id, no seed, no
world state — only the parsed *fields* of 2,119 outputs. 73% of its records were produced with the beings'
needs force-reset to near-zero every round; 53% under an author-written myth; 12% around author-emitted
hero deeds. It covers 163 beings in one world archetype, and its behavioral repertoire is 12 intent kinds
(4 of 16 never appear) in 139 plan shapes, half of them the same five. The doctrine ("never train on the
answers") is *technically* intact — zero civilization-leak terms — but only because the beings never get
far enough to invent anything. The v0 fine-tune `ft-g2b3h3sp-zqfxn` was trained on a **different, now-deleted
file** (`tools/_yggdrasil_corpus_llm.jsonl`, absent from disk and git) with no card, no hash, no eval record.
It is unreproducible and its lineage is unknown. **Recommendation: do not spend on training. Rebuild the
capture layer first.**

## 1. Artifact inventory

| Artifact | Reality |
|---|---|
| `civilization.jsonl` | 2,119 lines / 3.62 MB. Observation log. No prompt, no completion, no provenance. |
| `CognitionRecord` (prompt+output) | In-memory only, `CognitionLog` cap 2000, **never persisted anywhere**. |
| `training/corpus.ts` `curateCorpus` | Consumes `CognitionRecord[]`. Nothing in the repo calls it outside tests. Dead relative to the data that exists. |
| `training/eval.ts` | 2 gates, both weak (§5). No behavioral A/B harness (runbook admits it's deferred). |
| `tools/_yggdrasil_corpus_llm.jsonl` (Gahalla repo) | **Does not exist.** The actual training set of `ft-g2b3h3sp-zqfxn`. |
| `tools/_gen_capability_corpus.mjs` (Gahalla repo) | Templated invented-world reasoning seed. Genuinely doctrine-clean, never used in a run. |
| `ft-g2b3h3sp-zqfxn` | qwen2.5-7b-instruct, LoRA rank 8, 3 epochs, ~300 examples of gpt-oss-120b output. No dataset card, no gate results, no A/B. |

## 2. Corpus profile (measured)

**Schema — 5 variants, no version field.**
`agentId, at, experiment, kind, name, thought` + optional `trigger, goals[], utterances[], storiesHeld[], kin[], data.plan[]`.
1,093 records carry no `trigger`; 1,243 carry no `goals`; **150 (cultural-mutation) carry only a thought** —
no goals, plan, utterances, kin or stories at all.

**Coverage.** 163 distinct beings (ids 1834–2640), 195 (experiment, being) pairs, 31 beings reused across
experiments. 16 experiment tags / 16 seed strings, but one worldgen, one biome set, `agentCount` 100–120,
and 13 of 16 runs start at tick ≈43,200 (same 18-day warm-up) — effectively **one world, one epoch, one
population**. Ticks span 33k–102k; no run exceeds ~2,200 ticks of conscious time (≈1 sim day).

**Triggers.** Two values only: `periodic` (564) and *absent* (1,555). The Fireworks runbook advertises
"event-driven triggers (wasAttacked / witnessedDeath / planFailed / periodic)" — **none of the event triggers
are present in a single record.** The corpus is 100% periodic ticks.

**Actions.** 3,404 intents, mean 2.0 per plan (max 4).
`MoveTo 1039 · Sleep 637 · Eat 486 · Gather 466 · Speak 420 · Follow 146 · Idle 128 · Build 48 · Craft 25 ·
Attack 4 · Give 3 · Dig 2`. **`Drink`, `Deposit`, `Withdraw`, `Flee` never occur.** 139 distinct plan shapes;
the top five (`MoveTo`, `MoveTo>Sleep`, `MoveTo>Speak`, `Sleep`, `Gather>Eat`) are 49% of all plans.
**87% of intents (2,968/3,404) are a bare `kind` with no arguments** — because `_p2lib.toCorpus` only keeps
`{kind, targetId, x, y}` and discards `objectKind`, `buildKind`, `durationTicks`. Result: **zero `objectKind`
values survive in the whole corpus** — no record says what was eaten, built, or given. Same-kind arg styles
are inconsistent where they survive (`MoveTo` bare 767 / `x+y` 227 / `targetId` 45).

**Speech.** 1,454 utterances, 1,277 distinct. `request` 1,186 (82%) · `share-knowledge` 175 · `share-episode`
88 · `inform` 5. 847 have no addressee. Almost every utterance is a variant of "where is the nearest shelter"
or "do you know the place from the story".

**Goals.** 1,465 strings, 543 distinct; the first verb is `stay/sleep/rest/reduce/return` in 47% of them.
Vocabulary is unnormalized: `"Stay near kin and friends"` (63) vs `"stay near kin & friends"` (50);
`berries` 568 vs `berry` 80; `bushes` 17 vs `bush` 25.

**Thoughts.** 2,081 present, 1,980 distinct, mean 143 chars, max 290. Register is uniform first-person
therapese — "I feel the pull of…", "I think I should…" — across every experiment and every being.

**Redundancy.** 41 groups of byte-identical lines = 101 extra copies (4.8%). Ignoring `experiment`/`at`/
`agentId`: 104 copies. Near-duplicate thoughts (Jaccard ≥ 0.8, within experiment) touch **142 records (6.7%)**.
Realistic redundancy floor **≈11%**, and the same act appears up to 5 times — consistent with
`runRounds` re-reading `cognitionLog.recent(500)` every round with de-dup scoped only to the current process.
`cultural-mutation` shows 22 backward tick jumps and `civilization-contact` 15 (worst −2,182): **multiple runs
concatenated under one tag**, exactly as suspected.

**Bulk is context, not signal.** `storiesHeld` averages 17.7 entries/record (~35k strings); one founder myth
is repeated verbatim in 455 records. 91.6% of carried stories are *not* firsthand. Strip stories and kin and
the corpus is roughly 400 KB of actual decisions.

## 3. Scaffolded / authored conditions

| Condition | Records | Share |
|---|---|---|
| Needs force-reset each round (`b.needs.hunger=8; rest=8; safety=5; social=20; health=100; sickUntil=0`, inventory topped to wood/stone/fiber ≥2) | 1,555 | **73.4%** |
| Author-written myth injected (`seedMyth(..., timesHeard: 6)`) | 1,131 | 53.4% |
| Author-emitted hero events (`bus.emit` BuiltStructure/KilledPredator — exp14 comments say "the Inventor's deeds are authored") | 247 | 11.7% |
| Fully unscaffolded (exp1–6 + apprenticeship, `_p2lib` path) | 564 | 26.6% |

This is defensible *as experiment design* — it isolates the cultural variable. It is disqualifying **as training
data**: three quarters of the corpus shows a well-fed, healthy, equipped being whose "decision" is where to walk.
Train on it and you teach a model to be comfortable. The very reports that harvested it note `GaveItem` exchanges
= 0 and recommend "prioritising survival under scarcity" — the corpus is the opposite of that curriculum.

## 4. Leakage and doctrine

**Clean, with a caveat.** Word-boundary scan of all 5,000 being-authored strings (thought/goal/utterance):
zero hits for agriculture, farm(ing), harvest, kingdom, government, religion, temple, priest, money, trade,
market, economy, law, council, guild, profession, civilization, technology, metal, bronze, iron, wheel, writing,
calendar, medicine, ritual. `ancestor` 14. Zero fourth-wall terms (experiment, simulation, researcher, model,
prompt, JSON, tick, "as an"). `prompt.ts` is well-disciplined: no analysis labels, confidence-qualified
knowledge, provenance marked ("you were told this"), the sacred place rendered as a felt pull with the meaning
explicitly left to the being, and archetype/interpretation labels never fed back.

**Caveat the doctrine can't claim credit for:** the beings never attempt anything a leak could show up in.
Zero `Deposit`, 25 `Craft`, 48 `Build`, 3 `Give`. A clean leak scan over a corpus with no invention in it is
not evidence that the fidelity discipline works — it is evidence there was nothing to leak.

**The prompt is a second leak surface nobody scanned.** It hands the model the 16-intent vocabulary, the arg
grammar, need names and the 0–100 scale. Any model trained on outputs paired with *this* prompt learns Yggdrasil's
API, not cognition — and the corpus doesn't even contain the prompt, so a trainer would have to re-synthesize it
and would silently train on a prompt distribution that never produced the data.

## 5. Curation and eval code

- `cognitionToExample` — correct in principle (drops invalid + reflex-fallback). Inapplicable: no persisted
  `CognitionRecord` exists.
- `curateCorpus` dedupe key = `trigger | ordered intent kinds`. With 2 triggers × 139 observed shapes, the key
  space caps the output at ~278 examples **regardless of corpus size**, and it deletes all linguistic variety —
  two beings reasoning completely differently to the same `MoveTo>Sleep` collapse to one. This is a cap dressed
  as dedup; it is the single most damaging line in `training/`.
- `maxPerTrigger` balances across a field with 2 values. No balancing by experiment, being, need state, or
  behavior — the real imbalance axes.
- `evalJsonValidity` is near-vacuous: `parseMindOutput('{}')` returns `{goals:[],plan:[],utterances:[]}` and
  counts as **valid**, because `parseGoals/parsePlan/parseUtterances` all return `[]` on `undefined`, and
  `extractJson` salvages JSON out of prose or fences. The corpus itself contains 35 empty plans and 576 empty
  utterance arrays. The headline "100% schema validity" measures almost nothing.
- `evalKnowledgeFidelity` is a **single** trap (`Deposit` + `seed` without succession knowledge) on an intent
  kind that never once appears in 3,404 intents, with binary pass/fail and no scoring or held-out set.
- `LlmMind` is constructed with `now: () => this.tick`, so every `latencyMs` in the cognition log is a tick
  delta, not milliseconds. A corrupted field that a curation pass might filter on.
- **Missing entirely:** train/val/test split, held-out world, dataset card or hash, behavioral A/B harness,
  believability/aliveness metric, long-horizon consistency, persona/name stability across sessions,
  fourth-wall-refusal probe, out-of-distribution world transfer, regression suite against the bootstrap.
  7 tests in `training.test.ts`, all on synthetic records.

## 6. What training on this would actually buy

Nothing worth the spend, and plausibly negative.

- **Distillation, not capability.** 2,119 (really ~1,880 after redundancy) outputs of a 120B teacher, on one
  world, one prompt template, one population, mean 143-char thoughts and 2-intent plans. A 7B student trained
  on this learns the *teacher's surface register plus this world's API* — "I feel the pull of…" + `MoveTo>Sleep`.
  There is no reasoning trace to distill: the corpus stores conclusions (`thought`, `goals`, `plan`), never the
  deliberation, never the outcome, never whether the plan worked.
- **No reward signal.** Not one record links an act to its consequence. You cannot learn "how to find answers"
  from a dataset that never records whether an answer was found. This is the deepest structural flaw: the
  strategy doc's own canonical loop (observe→hypothesize→experiment→result→conclusion) needs *result*, and the
  capture layer throws it away.
- **Actively hostile to "one brain, any world".** Fine-tuning on 2k same-template samples at rank 8 / 3 epochs
  is a strong prior toward *this* vocabulary (berries, shelter, kin, Gahallian #NNNN), *this* intent set, and
  *this* comfort regime. Drop that model into a medieval or modern world and it will emit `Gather>Eat` at a
  market stall. Every marginal epoch on this corpus trades generality for one-world mimicry.
- **It would also make the research unfalsifiable.** Training the mind on its own world's outputs and then
  reporting what "emerges" in that world is a closed loop. Doctrine forbids training on answers; it should
  equally forbid training on one's own transcripts without a held-out world.

## 7. Strategy options

| Path | Buys | Costs / risks |
|---|---|---|
| **A. Prompt-only frontier model + world-agnostic cognitive architecture.** Keep the LLM untrained; put the intelligence in a portable observation/action schema, memory, knowledge and reflection layers. | Instant multi-world transfer; zero training spend; leakage controlled at the prompt boundary; every capability gain is legible code, not weights. | Per-act inference cost; latency; no persona compression; ceiling set by the base model. |
| **B. SFT/DPO of a small open model on multi-world traces.** Only after A produces traces from ≥3 dissimilar worlds with outcomes attached. | Cheap inference at population scale; latency; a "house style" of being alive. | Needs ~10⁵ outcome-labeled acts across worlds to beat prompting; freezes vocabulary if worlds are too few. |
| **C. RL in simulated worlds with verifiable rewards** (survival, knowledge-formation rate, promise-keeping, teaching success, long-horizon goal completion). | Directly optimizes *how to find answers* — the stated doctrine — with a signal the world can verify. | Needs a fast headless sim and reward hacking guards; the current engine's ~1 day of conscious time per run is nowhere near long enough. |
| **D. Hybrid: A now → C as the capability engine → B to distill C's policy for scale.** | Each stage is gated by measurement rather than hope. | Sequencing discipline. |

**Recommendation: D, starting at A, with all training spend frozen until the measurement bar in §8 is met.**

**World-agnostic schema (the precondition for any of B/C).** Data transfers across worlds only if the mind
never sees world-specific nouns. Observations must be typed and affordance-shaped, not named:
`{ self: {needs:[{id,urgency}], state}, percepts: [{entityRef, affordances:[edible|shelter|agent|obstacle|tool], properties:{...}, distance, bearing}], knowledge:[{claim, confidence, provenance, evidenceCount}], memory:[...], social:[{ref, feeling, ties}], narratives:[{text, firsthand}], affordanceVocabulary:[...] }`.
Actions must be a small closed verb set over refs (`approach/take/use/combine/give/say/observe/wait/flee`) with
world-specific nouns supplied per world as a runtime vocabulary, never baked into the weights. Names, biome
words and intent kinds stay in the world adapter. Volume: A needs none; B needs ≈10⁵ acts across ≥5
structurally different worlds with outcome labels and ≥10⁴ beings; C needs a sim running ≥10⁶ agent-steps/hour
headless.

**Measure before any training spend:** (1) baseline a plain frontier agent vs the Yggdrasil mind on the same
world+seed — if prompting wins, there is nothing to distill yet; (2) held-out-world transfer score; (3)
outcome-linked act rate (currently 0%); (4) behavioral entropy (currently: 139 plan shapes, 5 shapes = 49%);
(5) blind believability A/B by a harsh critic; (6) persona and knowledge consistency across a 10-session horizon.

## 8. Top 10 rework items

| # | Item | Effort | Acceptance criterion |
|---|---|---|---|
| 1 | **Persist the full cognition record** — prompt, raw output, model id, seed, world id, trigger, and the complete `ThinkInput` — to a durable store; corpus entries reference it by id. | M | Any corpus row can be replayed into a byte-identical prompt and re-scored offline; 0 rows missing prompt/model/seed. |
| 2 | **Attach outcomes.** Every act row carries what happened in the next N ticks: intents executed vs failed, need deltas, knowledge formed, utterance answered. | L | ≥95% of acts have an outcome record; a reviewer can compute success rate per plan shape without touching the sim. |
| 3 | **Freeze all training spend** until §7 measurement (1)–(3) exists. Mark `ft-g2b3h3sp-zqfxn` deprecated with its provenance gap documented. | S | No fine-tune job is created without a committed dataset card (hash, counts, splits, gate results). |
| 4 | **Stop the lossy capture** — persist full intent args (`objectKind`, `buildKind`, `durationTicks`) and the `need` field on goals. | S | `objectKind` non-null on ≥90% of `Eat/Give/Deposit` intents in new data; currently 0 of 3,404 intents carry any. |
| 5 | **Replace `curateCorpus`'s dedupe key** with near-duplicate detection (MinHash/embedding over prompt+output) and balance by experiment × being × need-regime × plan shape. | M | On a 10k-act input, output retains >70% of unique acts, exact-dup rate <0.5%, near-dup (J≥0.8) <2%, and no single plan shape exceeds 10% of the set. |
| 6 | **Make the eval gates bite.** Validity must require a non-empty plan or utterance and reject prose-salvage; grow fidelity to ≥20 leak traps across ≥5 domains with a scored rate. | M | `{}` scores invalid; the bootstrap model's reported validity moves off 100%; fidelity reports a rate, not a boolean, and a deliberately leaky model scores <50%. |
| 7 | **Build the behavioral A/B harness** the runbook has deferred since June: same world+seed, mind A vs mind B, blind labels, reporting survival, knowledge formation, plan success, behavioral entropy, and a critic verdict. | L | Reproduces a known result (reflex vs LLM) with the expected sign, and refuses to pass a model that is non-worse on validity but worse on behavior. |
| 8 | **Un-scaffold data collection.** Keep `provision()` for controlled experiments but tag every record `scaffold: {needsReset, seededMyths[], authoredEvents[]}`, and collect a survival-pressure corpus with no resets. | S | Every corpus row carries a scaffold tag; ≥50% of new acts come from unprovisioned runs; need distribution at capture time spans all four pressure bands. |
| 9 | **Define and implement the world-agnostic observation/action schema** (§7) with ≥2 adapters (current forager world + one modern or medieval world). | L | The same unmodified mind runs both worlds end-to-end; no world-specific noun appears in the mind's own code or prompt template; a held-out-world transfer score is reported. |
| 10 | **Broaden the trigger and behavior distribution** — wire the event triggers the docs claim (`wasAttacked`, `witnessedDeath`, `planFailed`, `goalAchieved`) and run long enough for scarcity, conflict, giving and making to occur. | M | New data has ≥5 trigger types with none above 50%; `Give`/`Craft`/`Build`/`Flee` each ≥2% of intents (today: 0.09% / 0.7% / 1.4% / 0%). |

---
*Method: full-file aggregation via throwaway Node scripts in the session scratchpad (corpus opened read-only);
~15 records read in full for qualitative judgement. No network calls, no Fireworks contact, no `.env` read.
All scripts were one-shot synchronous `node` runs; no background process was left running.*
