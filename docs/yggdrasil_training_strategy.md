# Yggdrasil — Model Training Strategy

**Status:** ACTIVE, canonical, 2026-06-13 (user-authored principle). Governs
all Yggdrasil model training. Companion to [[yggdrasil_civilization_design]]
§7 (cognition ladder) and [[yggdrasil_fireworks_training]] (the Fireworks
runbook).

## The load-bearing principle

> The goal of Yggdrasil is **not** a model that already knows civilization.
> It is a model **capable of learning, reasoning, communicating, and
> discovering**. Train Yggdrasil on **capabilities, not outcomes** — on *how
> to find the answers*, never on the answers.

Why it matters: if the model is trained heavily on civilizations, governments,
professions, agriculture, economics, kingdoms, religions, and historical
societies, then "discoveries" inside the sim are just **recollections from
training**, not genuine emergence. That would invalidate the entire research
question. The point is to be *surprised* by what the Gahallians figure out —
which is only meaningful if they couldn't have read the answer in pretraining.

This is the training-side statement of the V2 doctrine. The in-sim
enforcement is the **knowledge-fidelity eval gate** (`evalKnowledgeFidelity`):
a model that plans agriculture without having learned seeds grow is leaking
pretrained outcomes — it fails the gate and does not ship.

## The four phases

### Phase 1 — Bootstrap model
An existing high-quality open reasoning model (Qwen, Llama, similar), hosted
on Fireworks. It supplies language, communication, planning, reasoning, social
interaction, problem-solving — the raw cognitive substrate. We do not train
it; we *use* it.

### Phase 2 — Capability fine-tune ("different data")
Fine-tune the bootstrap on **capability** datasets — process, not domain:

| Capability | Train on |
|---|---|
| Reasoning | logical reasoning, multi-step planning, cause & effect, decision-making, tradeoff evaluation |
| Social reasoning | trust, cooperation, negotiation, conflict resolution, teaching, knowledge-sharing |
| Scientific thinking | observation, hypothesis generation, experimentation, testing, evidence evaluation, belief revision |
| Causal reasoning | action→consequence, observation→pattern, pattern→hypothesis, hypothesis→experiment, experiment→knowledge |
| Knowledge formation | how knowledge forms, how confidence updates, how evidence is weighed, how beliefs change when evidence changes |
| False beliefs | that beliefs **can be wrong** — superstition, rumor, myth, misunderstanding from imperfect pattern recognition |

The canonical thinking pattern the model should internalize (the *process*,
never the agricultural answer):

```
Observation:  seeds become plants
Hypothesis:   planting seeds may create food
Experiment:   plant seeds intentionally
Result:       plants grow
Conclusion:   intentional planting increases food
```

**DO NOT prioritize training on:** kingdoms · governments · political systems
· professions · factions · guilds · religion systems · MMORPG mechanics ·
quest systems · technology trees. These must EMERGE through simulation, never
be embedded as objectives.

Data sources for Phase 2 (mix; keep domain-neutral):
- External reasoning/CoT datasets restricted to *method* (logic, math-word
  reasoning, causal QA, scientific-method, negotiation/social-reasoning sets).
- The **capability seed corpus** (`tools/_gen_capability_corpus.mjs` →
  `tools/_yggdrasil_capability_corpus.jsonl`): hand-shaped observe→hypothesize
  →experiment→evaluate→revise + belief-updating + false-belief + social-trust
  examples set on **invented micro-worlds** (glimmer-moss, thrum-stones, the
  cold-time…) so the reasoning shape transfers with ZERO real-civilization
  leakage. It's a SEED — mix it with the external method datasets, don't ship
  it alone.

Filter any external set through one test: *does this teach the model an answer
about human civilization, or a way of thinking?* Keep the latter only.

### Phase 3 — Gahallian corpus (harvest)
Once Yggdrasil runs in-sim, store memories, conversations, knowledge
discoveries, belief formation, plans, outcomes, failures, successes in
`cognition_log` / `event_log` / `knowledge_log`. SHIPPED: the headless harvest
(`packages/yggdrasil/test/harvest.test.ts`) runs the sim on the Phase-1/2
model and writes a Fireworks-SFT corpus of real reasoning + event-driven
triggers.

### Phase 4 — Yggdrasil v1 (Gahallian fine-tune)
Fine-tune on Gahallian-generated data so the model learns how Gahallians
think, learn, teach, discover, and adapt. **Long-term goal:** Yggdrasil
trained primarily on the experience of its own artificial civilization, not on
human civilization. The loop renews itself — each run's cognition_log feeds the
next version.

## Final principle

Train Yggdrasil on: **how to learn · how to reason · how to communicate · how
to discover.** Never on the answers — on how to find them.
