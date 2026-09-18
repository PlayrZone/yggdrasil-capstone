# Target Architecture — One Brain, Any World (2026-09-18)

Architect synthesis of audits 01 (engine/brain), 03 (training data), 04 (frontier benchmark). Audit 02 (lab) lands separately and feeds Wave L. This document is the design authority for the rework; `CAMPAIGN.md` tracks execution.

## 1. Where we actually stand

**Worth keeping — and doubling down on.**
1. *Epistemic containment.* Deterministic miners are the only writer of knowledge; the LLM reasons over what the being holds. The agent-society field has an open, unanswered leakage critique (arXiv 2505.23796); this design is a methodological answer nobody else has. It is currently an assertion — it needs a control experiment and a number.
2. *Generations with death and inheritance.* No external system found runs true generational turnover. The observation-learning channel (`CraftObservationMiner`, 1→168 makers) is the strongest result in the codebase.
3. *Free learning.* Knowledge accumulates with zero inference. The only credible cost model for thousands of beings.

**Not what it claimed to be.** Audit 01 §3 stands as the research erratum:
- Myth→ideology escalation is 22 hand-written English rungs scored by a regex that matches those rungs. Not emergence.
- Pilgrimage, prestige-following and craft adoption are `if` branches in `ReflexMind` whose effect is then measured by the analysis. The "control" deletes the branch.
- `leadership()` measures followership with a copy of the formula that produces it.
- `groundTruth.ts` graded every true highland regularity as false, so every published accuracy / superstition figure is wrong.
- LLM-driven beings could never teach or pass a story (`schema.ts` dropped the payload), so every diffusion and story-spread number is reflex-only.
- The corpus (2,119 acts) has no prompts, no raw outputs, no outcomes, 73% captured under force-reset needs. It is a log of parsed fields, not a dataset. The v0 fine-tune is unreproducible.

Defensible restatements are in audit 01 §3. Reports in `~/.yggdrasil-lab/reports/` are left untouched as history; an erratum report is written once Wave 0 re-runs the affected numbers.

**Thin where the mission is heaviest.** Persistent goals, affect, self-model, theory of mind, creativity: missing. Memory, forgetting, consolidation, language, planning, skills, development: shallow. The mind is typed against this one world's 34 object kinds, 28 event types, 4 needs, English strings and 2-D geometry.

## 2. Layer model

```
L0 WorldAdapter   per world, data only. The ONLY thing that differs between forager / medieval / modern / fantasy / Gahalla voxel.
L1 Body           deterministic: drives, affordance validation, event emission. Rejections are facts. Minds never mutate the world.
L2 Fast mind      every tick. Drive arbitration over LEARNED affordances and skills. No world nouns, no authored outcome branches.
L3 Slow mind      LLM, salience-triggered. Reasons ONLY over L4. Emits goals, plan of core actions, utterances (by reference), private thought.
L4 Memory         episodic (decaying) · semantic (bi-temporal, confidence-scored) · procedural (skills) · narrative (drifting stories).
L5 Miners         deterministic, interpretable, zero-inference. The ONLY writer of L4-semantic and L4-procedural. False beliefs are legal.
L6 Identity       immutable temperament + autobiographical life story + persona anchor injected on every L3 call.
L7 Society        relationships, transmission, kinship, generations, institutions.
Instrument        analysis + run store + replay. Reads everything, is read by nothing in L1–L7.
```
Never learned by a model: L0, L1, L5. The moment the body or the miners are a model, "real" becomes "plausible".

## 3. The seam — `WorldAdapter`

One object supplied by the host, declaring data. Never English in the mind, never coordinates in the mind.

| Member | Replaces today |
|---|---|
| `drives: DriveSchema[]` `{id, pressingAt, criticalAt}` | `NeedKey`, need thresholds |
| `context: ContextSchema[]` `{featureId, type}` | `ContextFeatures`, miners' hardcoded `FEATURES` |
| `events: EventSchema[]` `{id, roles, driveDeltas, salience, relationshipDeltas}` | `SimEventType`, `importance.BASE`, `memoryFromEvent` switch, `EVENT_DELTAS` |
| `actions: ActionBinding[]` core verb → world verb + params + validation | `IntentKind`, `INTENT_VOCAB`, schema allowlists |
| `affordances` `{ref, kindId, tags[], properties, at}` | `ObjectKind`, `ResourceNodeKind`, `FOOD_NODES`, `MATERIAL_NODE` |
| `space` `{distance, sample, directionWord}` | every `x,y` / `Math.hypot` in the mind |
| `lexicon` `{phraseFor(id), locale}` | `templates.ts`, reflex English, world prose in `prompt.ts` |
| `mechanics` declared regularities | hand-written `groundTruth.ts` oracle (instrument side only) |

**Core action vocabulary** (closed, world-independent, over refs): `Move · Take · Use · Combine · Give · Say · Attend · Rest · Build · Contest · Flee · Wait`. World verbs (eat, drink, smelt, buy, cast) are adapter bindings of `Use`/`Combine`, discovered by the being through outcomes, not listed for it.

**Acceptance test of the line:** an unchanged `agent/ memory/ learning/ knowledge/ relationships/ narrative/` runs a second adapter (modern town: drives hunger/sleep/money/belonging; affordances vending machine, flat, job) with `git diff --stat` empty over those directories; a critic reading 20 traces cannot tell the world from the mechanism; no world noun appears in mind code or the prompt skeleton.

## 4. Mind upgrades (after the seam)

| Faculty | Design | Source idea |
|---|---|---|
| Goals / projects | Goal objects with subgoals, progress, commitment, abandonment-with-reason; survive across thinks and sleeps | Vending-Bench shape |
| Forgetting | Salience × recency × rehearsal decay; episodes summarize into semantic knowledge before they go; bounded footprint | Lyfe Summarize-and-Forget |
| Belief history | Bi-temporal knowledge: `validFrom/validTo`; superseded beliefs stay queryable ("what I used to think") | Graphiti |
| Sleep | Nightly consolidation, goal re-ranking, deeper miner sweep, next-day context precompute — on idle capacity | Sleep-time compute |
| Skills | Procedural tier: named composable programs over core verbs, mined from repeated successful plans, taught by demonstration, portable across worlds | Voyager |
| Affect | Appraisal layer over drives → continuous mood state that colours salience, recall and arbitration | appraisal chain-of-emotion, EILS |
| Self-model | Autobiography mined from own episodic record + persona anchor on every slow call | persona-drift literature |
| Theory of mind | Per-partner model of what they know and want, mined from interaction; drives teaching, trade, deception | DialToM gap |
| Development | Cognition parameters change with age; senescence; age as a cause of death | — |
| Narrative | Structure stays in the mind; all content and any drift model move out. Drift measured content-free (variant entropy, edit distance) | audit 01 §3 |

Deliberately not adopted: LLM-written beliefs, an LLM game-master adjudicating physics, PIANO-style concurrency.

## 5. Data and model strategy (audit 03, path D)

**A now → C later → B last.** Prompt-only frontier model over the world-agnostic schema now. RL in fast headless worlds with verifiable rewards as the capability engine once the sim reaches ≥10⁶ agent-steps/hour. SFT/distillation only to compress a proven policy for population-scale inference (the learned fast mind).

All training spend is frozen until: (1) every cognition is persisted losslessly — prompt, raw output, model, seed, world, trigger, full input; (2) ≥95% of acts carry outcomes; (3) a plain frontier-agent baseline has been beaten on the same world and seed; (4) a held-out-world transfer score exists. `ft-g2b3h3sp-zqfxn` is deprecated with its provenance gap recorded.

## 6. Evaluation battery — the critic's instrument

Blind, against a plain frontier-LLM role-play agent on the same world and seed: ignorance probe (the decisive one) · false-belief lifecycle · interview believability · lifetime persona stability · one-sim-year project coherence · cross-world transplant · transmission chain · functional theory of mind · blind aliveness A/B on traces · open-endedness curve. LLM-judge scores ship with a human-agreement check. Runs that need paid inference wait for Hakim's budget go; harness plumbing is built and proven on the mock backend first.

## 7. Execution waves

| Wave | Items | Gate |
|---|---|---|
| **0 Truth & instrumentation** | W0-A correctness sweep · W0-B lossless cognition record + outcomes + scaffold tags · W0-C spatial index (1000 beings × 5000 ticks < 60 s) · W0-D erratum: re-run corrected numbers | hostile verifier per item |
| **1 The seam** | W1-A split `Experiment` into Host / Scenario / Instrument + snapshot-replay · W1-B `WorldAdapter` + core verbs, forager world becomes adapter #1 · W1-C adapter #2 modern town + transplant test · W1-D delete authored ladders and reflex outcome branches → drive arbitration · W1-E A/B harness + frontier baseline agent (mock-proven) | empty-diff transplant test; blind trace A/B |
| **2 The mind** | goals → forgetting + bi-temporal + sleep → skills → affect → self-model → theory of mind → development | each faculty: blind A/B vs baseline, critic must prefer Yggdrasil |
| **L The lab** | from audit 02; runs in parallel with engine waves (separate package) | harsh visual critic on screenshots |
| **G Gahalla** | adapter #3 = Gahalla voxel world; retire the duplicate `packages/yggdrasil` + `engine/src/yggdrasil` there | beings alive in-engine |
| **T Training** | frozen until §5 bar | dataset card + gates that bite |

Engine coders run one at a time (shared files); a lab coder may run alongside. The architect commits each item locally on `rework/2026-09` only after review and critic pass. Nothing is pushed.

## 8. Decisions

Taken by the architect, because the mission directive implies them — Hakim can overrule:
- The 14-intent survival vocabulary is replaced by the world-independent core. Old corpus and old numbers stop being comparable; they were already compromised (§1).
- Beings forget.
- Claims listed in §1 are restated, not defended.

Genuinely Hakim's:
1. **Inference budget** for the evaluation battery and for any conscious-population run (estimate in audit 04 §4: ~$0.014 per being-hour on open-weights serverless — unverified against billing).
2. **Which model is the slow mind** going forward (gpt-oss-120b on Fireworks was validated in June; the field has moved).
3. **Learned fast mind** (distilled System 1) — buys cost and realism, spends bit-exact reproducibility. Not before Wave 2 is done.
