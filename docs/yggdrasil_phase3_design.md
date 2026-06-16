# Yggdrasil — Phase 3 Research Design: Technological Inheritance

_Pre-registration. Author: ai-researcher. Date: 2026-06-15._

This document is written **before** the experiments are run, so the hypotheses, controls,
measures, and falsifiers are fixed in advance and cannot be retrofitted to whatever the
runs produce. Per doctrine (`docs/yggdrasil_civilization_design.md` + the Mission Reminder):
the Gahallians are the experimental population, the sim is the experiment, negative results
are valuable, and we never tune an experiment toward success.

---

## Where we are (the arc this builds on)

Full record: 35 reports in `~/.yggdrasil-lab/reports/` (3 syntheses: phase2-synthesis,
curiosity-arc, history-arc; plus `emergence-roadmap.md`).

- **Cycles 1–14** — a civilization *substrate* emerges unscripted (survival, generations,
  demonstration-learning of outcomes, social identity, knowledge lineages, culture,
  narratives, myth, myth-survival, sacred places). Reflex could **not** produce leadership
  (C13) or belief→behaviour without separating sacred-from-dwelling (C10 neg → C11 pos).
- **Phase 2 Exp 1–6** — conscious minds (gpt-oss-120b) inherit culture immediately and
  reason inside it; relationally, instrumentally, under survival pressure.
- **Curiosity Arc 7–9** — minds *can* improve the civ, but only when the **culture** aims
  them at it; the bottleneck is culture+conditions, not mind.
- **Exp 10–11** — myths steer curiosity and give identical minds **different destinies**.
- **History Arc 12–15** — **one law: STORY moves faster than PRACTICE.** Myths, legends,
  reverence, deference spread fast and stick; behaviours/habits change slowly or never. A
  maker is **mythologized instantly but imitated ~0/12** (Exp 14). A newcomer who acts is
  *remembered into* the world by the Gahallians' own machinery (Exp 15 — the human+Gahallian
  goal proven in mechanism).

**The open wound Phase 3 probes:** practice does not transmit. Every prior result says the
behavioural layer is rigid. Phase 3 asks whether there is **any** mechanism by which a
practice — a *technology* — crosses generations, survives, and evolves. If practice can
never be inherited, there is no technological civilization, only a narrative one.

---

## The standing constraints (how, not what)

- **Affordance, not outcome.** I may add the *possibility* of learning a skill by watching.
  I may **never** script "generation 2 has 3 makers." Whether makers multiply is the
  measurement, not the setup.
- **Deterministic miners form knowledge; the LLM only reasons over it.** The transmission
  mechanism must be reflex-level so it can compound across a whole population over many
  generations (LLM cognition is too slow/costly to cover every maker — it only *samples*
  the lived experience into the corpus).
- **Controls are mandatory.** Every positive claim must beat a control that isolates the
  proposed cause. Independent rediscovery and habitat/social confounds must be ruled out.
- **Honest reporting.** If the control matches the treatment, the result is negative and the
  report says so. Auto-verdicts that disagree with the controls get overwritten by hand.

Current engine facts (verified 2026-06-15, re-verify before building):
- Crafting is real and discovered-not-scripted: `CRAFT_RECIPES` in `body/YggdrasilSystem.ts`
  (wood+stone→spear, etc.). No persistent skill token; "knowing how" = choosing to try
  `Craft` with the right inventory. Emits a `Crafted`/`Made` event.
- Generations exist (`body/genesis.ts`, `Experiment.reproduce()`/`bearChild()`, blended
  traits). Demonstration-learning exists for **outcomes** only (`OutcomeMiner`: experience
  1.0 / observation 0.4 / testimony 0). **No miner transmits a craft recipe/skill by
  observation** — that is the gap Exp 1 must fill.

---

## Experiment 1 — Apprenticeship

**Question.** Can a skill spread if learners spend *years* with a master?

**Hypothesis (H1).** Sustained, repeated observation of a master successfully crafting
transmits the *practice* of crafting (not merely a story about it), producing a compounding
maker lineage across generations.

**Honest prior.** This may fail. Exp 14 showed practice imitated ~0/12 in a brief encounter.
Exp 1 is the rematch under the one missing condition — *time and repetition*, not minutes.

**Affordance to add (minimal, possibility-only).** A reflex-level observational
skill-learning mechanism: a being that witnesses another's *successful* `Craft` enough
distinct times forms that recipe as **known**, which then makes trying it *possible* (and,
per the agent's needs, sometimes chosen). The recipe is still discovered/transmitted, never
injected; the witness count threshold must be high enough that one glance does nothing and
low enough that a childhood beside a maker can suffice — but it must **not** be tuned to
guarantee the cascade.

**Controls.**
- **C-A (no maker):** identical cohort, no one seeded with the skill → measures independent
  rediscovery rate. H1 requires treatment ≫ C-A.
- **C-B (maker present, observation-learning OFF):** isolates that any spread is *from
  apprenticeship*, not from proximity/materials alone.

**Measure.** Maker count per generation (a "maker" = a being that has itself completed a
craft). Report the generational series (gen1/gen2/gen3/gen4…) for treatment vs both controls.
The illustrative target shape is 1→3→11→42, but **the measured series is the result**, not a
goal to hit.

**Falsifier.** If treatment ≈ C-A (makers do not outpace random rediscovery), or the maker
count fails to grow across generations, H1 is **rejected**: observation does not transmit
practice even with time. That is a publishable boundary, consistent with the History Arc.

---

## Experiment 2 — The First School

**Question.** Can an *institution* preserve knowledge better than families?

**Hypothesis (H2).** A place that beings gather around because experts are there preserves a
skill/knowledge longer (across more generations, against population shocks) than purely
parent→child transmission.

**Affordance.** Not a scripted "school." Give beings a *reason to gather around an expert*
(e.g. proximity to a high-knowledge being is where observational learning pays off), and let
a persistent learning-place **emerge** from where experts and learners co-locate — measured,
not placed. (Connects to Cycle 14: the world institutionalizes the *impersonal* — places,
myth, lineages — so a knowledge-place is the natural next institution.)

**Control.** Family-only transmission (no gathering-around-experts affordance), same seed.

**Measure.** Knowledge/skill **survival time** (generations a belief or recipe persists, and
its holder count) with vs without the institution; robustness when a key expert dies.

**Falsifier.** If institutional and family-only transmission preserve knowledge equally long,
H2 is rejected: institutions add nothing over kinship at this scale.

---

## Experiment 3 — The First Technology

**Question.** Over deep time, does a technology survive, spread, improve, and diversify?

**Hypothesis (H3).** Seed Wood+Stone=Spear, leave it 100+ generations untouched, and the
technology will (a) survive, (b) spread, (c) **improve**, and (d) spawn **variants**
(Long/Hunting/Decorated/Ceremonial Spear) — i.e. technological *evolution*, not just
persistence.

**Affordance needed.** Recipe survival/spread already follow from Exp 1's transmission, but
*improvement* and *variants* require a mechanism for a recipe to **mutate** into a related
recipe (analogous to the narrative escalation-ladder for myths in Cycle 08/09, but for
practice). Add the possibility that a known craft, repeated, can be varied — never the
specific variant tree; whether Long/Hunting/Ceremonial appears is the measurement.

**Measure.** Over ≥100 generations (likely tick-compressed — see open item): recipe holder
count over time (survival/spread), count of distinct variant recipes that appear
(diversification), and any directional trend (improvement).

**Falsifier.** If the seeded recipe simply persists unchanged (or fades, as the seeded myth
did in Exp 13) with no variants, H3's *evolution* claim is rejected — technology is inherited
but static. Distinguishing "survives" from "evolves" is the whole point.

---

## Cross-cutting open items

- **Deep time.** Exp 3 needs 100+ generations; 45–60 sim-days (~11–15 gens) is the current
  practical ceiling for full-population runs. Either validate tick-compression (the deferred
  "seconds-as-years" mode — must pass a demographics-match check, must not silently corrupt
  the tuned survival balance) or accept bounded-snapshot proxies and say so.
- **Single seed.** All results to date are single-seed. Multi-seed replication is the
  standing rigor debt; note it in every report.
- **LLM sampling.** Runs are reflex-deterministic for the generational measure; conscious
  minds sample the *lived experience* of apprenticeship/teaching into the corpus, never the
  measured mechanism.

## Why this order

Exp 1 is foundational: if observation cannot transmit a practice, Exp 2 (institutions to
*preserve* a practice) and Exp 3 (a practice *evolving* over deep time) have nothing to
preserve or evolve. So Exp 1's result — positive **or** negative — sets whether 2 and 3 are
about strengthening transmission or about why a civilization can be narrative-rich yet
technologically frozen. The research determines the roadmap.
