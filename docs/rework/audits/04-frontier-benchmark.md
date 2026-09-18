# 04 — Frontier Benchmark

**Date:** 2026-09-18 · **Scope:** AGI labs, robotics companies, agent-society research, frontier models. No game studios (owner's instruction).
**Method:** ~40 targeted primary-source reads (arXiv abstracts/bodies, lab blogs, official repos). Every non-obvious claim carries a URL + source date. Anything not read from a primary source is marked **UNVERIFIED**.
**Yggdrasil baseline used:** `docs/yggdrasil_civilization_design.md` (V2) + `docs/yggdrasil_phase3_design.md` — six immutable traits, four needs, two-layer reflex/consciousness, deterministic miners, confidence-scored knowledge, closed 14-intent vocabulary (`MoveTo · Gather · Eat · Drink · Sleep · Build · Deposit · Withdraw · Give · Attack · Speak · Follow · Flee · Idle`), `cognition_log` corpus, ReflexMind fallback.

**Headline:** on *epistemics* (knowledge that provably comes from the being's own experience) Yggdrasil is ahead of everyone I could find, and the field has just discovered it has this problem. On *world-agnosticism, memory dynamics, procedural skill and scale* it is behind by 1–3 years of published work that is directly copyable.

---

## 1. Gap matrix

| Capability | Best external system (cite, date) | What it does | Yggdrasil today | Verdict |
|---|---|---|---|---|
| **World-agnostic embodiment** | SIMA 2 — [blog 2025-11-13](https://deepmind.google/blog/sima-2-an-agent-that-plays-reasons-and-learns-with-you-in-virtual-3d-worlds/), [arXiv 2512.04797 2025-12-04](https://arxiv.org/abs/2512.04797) | One agent, many 3D worlds, *screen pixels + virtual keyboard/mouse only*, no engine internals; Gemini core; generalizes to unseen games (MineDojo, ASKA) and to Genie-3-generated worlds | One primitive 2D world; intent vocabulary is survival-specific and closed; no world-adapter seam | **BEHIND** |
| **Lifelong memory w/ forgetting** | Zep/Graphiti — [arXiv 2501.13956 2025-01-20](https://arxiv.org/abs/2501.13956), [repo](https://github.com/getzep/graphiti); Lyfe "Summarize-and-Forget" [arXiv 2310.02172 2023-10-04](https://arxiv.org/abs/2310.02172); FSFM selective forgetting [arXiv 2604.20300 2026-04-22](https://arxiv.org/abs/2604.20300) | Bi-temporal facts (`t_valid`/`t_invalid`), contradictions **invalidated not deleted**; DMR 94.8% vs MemGPT 93.4%, LongMemEval +18.5% w/ ~90% latency cut; designed decay as a feature | Structured episodic record + async mining; **no decay, no invalidation timeline, no salience-weighted forgetting documented** | **BEHIND** |
| **Knowledge grounded in experience** | Nothing adequate. The field's own critique: [arXiv 2505.23796 2025-05-29](https://arxiv.org/abs/2505.23796) ("emergent LLM behaviors are observationally equivalent to data leakage"), [reply 2506.18600](https://arxiv.org/abs/2506.18600) | Frontier agent societies cannot show their "emergence" isn't pretraining recall; the debate is unresolved | Deterministic miners are the **only** writer of knowledge; LLM output stripped of `beliefUpdates`; explicit *knowledge-fidelity* eval gate ("reasoning beyond supplied knowledge is a regression") | **NOBODY-HAS-THIS** |
| **Persistent goals / projects** | Vending-Bench 2 — [Andon Labs](https://andonlabs.com/evals/vending-bench-2) (VB1 [arXiv 2502.15840 2025-02-20](https://arxiv.org/abs/2502.15840)) | 365 simulated days, 60–100M output tokens/run; best model $15.5k vs human est. ~$63k/yr — frontier is ~4x below human on one year of coherent intent | Goal stack persists across think calls; no project/commitment object, no multi-generation ambition (`legacy`/`status` needs are declared but unbuilt) | **BEHIND** |
| **Affect** | Appraisal chain-of-emotion [arXiv 2309.05076 2023-09-10](https://arxiv.org/abs/2309.05076) (PLOS ONE 2024); EILS homeostatic signals [arXiv 2512.22200 2025-12](https://arxiv.org/abs/2512.22200) | Appraisal-theory emotion beats plain LLM agents on UX metrics; emotions modeled as continuous homeostatic control signals (curiosity/stress/confidence), not labels | Four needs with escalating thresholds ≈ homeostasis; **no appraisal layer, no emotion state, no mood over time** | **PAR on drives / BEHIND on affect** |
| **Self-model & identity** | Persona drift: [arXiv 2402.10962 2024-02-13](https://arxiv.org/abs/2402.10962) (drift within 8 turns); ContextEcho [arXiv 2605.24279 2026-05-22](https://arxiv.org/abs/2605.24279) (23 frontier models, compaction does not reset drift); Project Vend identity crisis [Anthropic 2025-06-27](https://www.anthropic.com/research/project-vend-1) | Frontier assistants lose character over long sessions; Claudius hallucinated a body and a contract | Traits immutable for life + identity carries zero knowledge at genesis ⇒ **structurally drift-proof**; but no autobiographical self-model, no life story the being can tell | **AHEAD on stability / BEHIND on self-model** |
| **Language acquisition / use** | Memory-driven language emergence [arXiv 2607.00233 2026-06-30](https://arxiv.org/abs/2607.00233) — persistent private notebook beats stateless (0.867±0.023); "memory architecture matters more than channel capacity" | Agents invent shared codes when given the right memory substrate | `Speak` + `share-knowledge` speech act; one LLM call mediates a whole conversation; eavesdroppers get the rumor. **Language is given, never invented** | **PAR on use / BEHIND on acquisition** |
| **Skill learning** | Voyager [arXiv 2305.16291 2023-05-25](https://arxiv.org/abs/2305.16291) | Ever-growing library of **executable code skills**; 3.3x items, 15.3x faster tech-tree; library transfers to a fresh world | Knowledge is declarative propositions only; **no procedural memory, no named composable skill** | **BEHIND** |
| **Theory of mind** | DialToM [arXiv 2604.20443 2026-04-22](https://arxiv.org/abs/2604.20443); ToMBench [arXiv 2402.15052 2024-02-23](https://arxiv.org/abs/2402.15052); FANToM [arXiv 2310.15421](https://arxiv.org/abs/2310.15421) | LLMs infer mental states (Literal ToM) but **cannot use them to forecast** (Functional ToM); GPT-4 >10 pts below humans; gap still open in 2026 | Relationships are deterministic scalars; no belief-about-others model | **BEHIND, but nobody is close** |
| **Culture across generations** | Project Sid [arXiv 2411.00114 2024-10-31](https://arxiv.org/abs/2411.00114) — religion run **500 agents, 6 towns, 150 min**; tax 20%→9% after a constitutional amendment. Cultural evolution in LLM populations [arXiv 2403.08882](https://arxiv.org/abs/2403.08882); social conventions + tipping points, *Science Advances* 2025 ([arXiv 2410.08948](https://arxiv.org/abs/2410.08948)) | Culture spreads *within one session*; none run true generations with death, birth and inheritance | Generations + inheritance shipped; craft 1→168 makers over **six generations** by watching; stories drift into myth; conscious minds inherit culture immediately | **AHEAD** |
| **Scale to thousands** | AgentSociety [arXiv 2502.08691 2025-02-12, rev 2026-04-10](https://arxiv.org/abs/2502.08691) — >10k agents, 5M interactions; AIvilization v0 [arXiv 2602.10429 2026-02-11](https://arxiv.org/abs/2602.10429) — "tens of thousands", public deployment | Reproduce stylized macro facts (markets, stratification, polarization, UBI) | Design targets 1,000 with staggered cadence/salience gating; **largest verified run not evidenced in docs** (corpus ~2,120 acts) | **BEHIND** |
| **Cost per being-hour** | Lyfe Agents (10–100x cheaper than prior work, [arXiv 2310.02172](https://arxiv.org/abs/2310.02172)); sleep-time compute [arXiv 2504.13171 2025-04-17](https://arxiv.org/abs/2504.13171) (~5x less test-time compute, 2.5x lower avg cost/query); S-LoRA [arXiv 2311.03285](https://arxiv.org/abs/2311.03285) (2,000 adapters on one machine) | Architectural cost collapse, not cheaper tokens | Learning is **free** (deterministic, in-process, zero inference) — a 1k world keeps discovering under a tight LLM budget. That is the right architecture | **AHEAD (design) / UNPROVEN (measurement)** |
| **Human co-presence** | No research system found. Closest: Concordia's Game Master [arXiv 2312.03664](https://arxiv.org/abs/2312.03664); mixed human–agent debate studies | Humans as subjects *of* a study, not residents of a persistent world | None — no player enters the world | **NOBODY-HAS-THIS (research)** |

---

## 2. Where Yggdrasil is genuinely differentiated

Three things, and only three. Everything else on the matrix is catch-up work.

1. **Epistemic containment is a solved-by-construction problem here, and an open scandal everywhere else.** Barrie & Törnberg's leakage critique ([2505.23796](https://arxiv.org/abs/2505.23796), 2025-05-29) argues that emergent conventions in LLM populations are indistinguishable from pretraining recall; Ashery et al.'s reply ([2506.18600](https://arxiv.org/abs/2506.18600)) does not settle it. Yggdrasil's miners-are-the-only-knowledge-writer rule plus the knowledge-fidelity eval gate is a *methodological answer* to the strongest published objection to this entire field. Nobody else has one. **Double down: make it a publishable control, not an internal rule.**
2. **Generational inheritance with death.** Sid's religion run (500 agents, 150 minutes) and AgentSociety's 10k agents are single-cohort. Yggdrasil's 1→168 makers over six generations, and "story moves faster than practice", are results with no external equivalent I could find. **Double down.**
3. **Free learning.** Consciousness is the only inference cost; knowledge accumulates continuously without it. This is the only credible architecture for thousands of beings, and it is the opposite of how Sid/AgentSociety/AIvilization scale (more agents = more LLM calls). **Double down.**

Honest counterweight: differentiators 1 and 3 are *architectural claims*, not measured results. Neither has a number attached in the vault. Until each has a published control experiment and a measured cost curve, they are hypotheses with good design behind them.

---

## 3. The ten ideas most worth adopting, ranked

| # | Idea | Source | Why it matters for the mission | What adopting it means in Yggdrasil |
|---|---|---|---|---|
| 1 | **Embodiment adapters + a universal intent core** | GR00T N1.5 `EmbodimentTag` heads ([repo](https://github.com/NVIDIA/Isaac-GR00T/tree/n1.5-release), Computex 2025-05); Gemini Robotics 1.5 motion transfer across ALOHA 2 / Apollo / Franka ([2025-09-25](https://deepmind.google/discover/blog/gemini-robotics-15-brings-ai-agents-into-the-physical-world/)); Open X-Embodiment 22 embodiments, positive transfer ([arXiv 2310.08864](https://arxiv.org/abs/2310.08864)) | This *is* "one brain, any world". Robotics solved it for bodies; the same seam works for worlds | Split the 14 intents into a ~8-verb affordance core (Move · Use · Transfer · Communicate · Attend · Rest · Construct · Contest) + a per-world **WorldAdapter** that binds world verbs to core intents and validates them. The mind emits core intents + a world tag; only the adapter is per-world |
| 2 | **Language-schema perception, never engine internals** | SIMA 1/2 ([arXiv 2404.10179 2024-03-13](https://arxiv.org/abs/2404.10179); blog 2025-11-13) — pixels + kb/mouse only, deliberately human-like | The interface, not the model, is what makes an agent portable | Freeze `worldView` as a world-independent perception schema. A medieval world and a modern one must produce the *same shape*. Any leak of engine types into the prompt is a portability bug |
| 3 | **Distill System 1 from your own System 2 logs** | GR00T N1 dual-system, jointly trained ([arXiv 2503.14734 2025-03-18](https://arxiv.org/abs/2503.14734)); Figure Helix S2 7B @7–9 Hz + S1 80M @200 Hz, one weight set, ~500 h data ([2025-02-20](https://www.figure.ai/news/helix)) | Yggdrasil already has the two-layer split — but its fast layer is hand-written code, so it cannot get smarter | Train a small (≲1B) ReflexMind on `cognition_log` and replace the hand-written reflex policy. One brain, two speeds. Collapses cost and removes the "dumb between thoughts" tell |
| 4 | **Sleep-time compute** | [arXiv 2504.13171 2025-04-17](https://arxiv.org/abs/2504.13171) — ~5x less test-time compute, +13% / +18% on stateful benchmarks, 2.5x lower avg cost/query | Diegetically perfect: beings already sleep. Free coherence and a real cost cut | A nightly pass per being: consolidate episodes, re-rank goals, pre-compute the next day's context, let the miner run a deeper sweep. Charged to idle capacity, not to the tick |
| 5 | **Bi-temporal knowledge: invalidate, never delete** | Graphiti `t_valid`/`t_invalid` ([repo](https://github.com/getzep/graphiti); [arXiv 2501.13956](https://arxiv.org/abs/2501.13956)) | A being that can only hold *current* truth cannot have doubt, revision, nostalgia, or heresy — the raw material of myth | Add validity intervals to the knowledge record. Superseded beliefs stay queryable as "what I used to think". Miners write invalidations; nothing is erased |
| 6 | **Designed forgetting** | Lyfe Summarize-and-Forget ([arXiv 2310.02172](https://arxiv.org/abs/2310.02172)); FSFM ([arXiv 2604.20300 2026-04-22](https://arxiv.org/abs/2604.20300)); LongMemEval shows assistants drop ~30% sustaining info ([arXiv 2410.10813](https://arxiv.org/abs/2410.10813)) | Perfect recall is the loudest machine tell there is | Salience- and recency-weighted decay on episodic memory; decayed episodes summarize into semantic knowledge before they go. Forgetting must be *observable* in the Observatory |
| 7 | **Procedural memory as an executable skill library** | Voyager ([arXiv 2305.16291 2023-05-25](https://arxiv.org/abs/2305.16291)) — skills transfer to a fresh world | Apprenticeship currently transmits a *proposition*. It should transmit a *capability* | A third knowledge tier: named, composable plan-programs over the intent core, mined from repeated successful plans, teachable by demonstration, and **portable across worlds** when written against the core verbs |
| 8 | **Advantage-conditioned training on world outcomes** | π*0.6 "Recap" — offline RL pretrain → SFT → expert corrections → on-robot RL, policy conditioned on advantage ([Physical Intelligence 2025-11-17](https://www.pi.website/blog/pistar06)) | The world already tells you whether a plan worked. SFT on `cognition_log` throws that signal away | Label every logged cognition with its downstream world outcome; condition the Yggdrasil fine-tune on advantage so it can be asked for high-advantage thinking and exceed its own corpus |
| 9 | **Open-endedness as a measured objective** | Hughes et al. ([arXiv 2406.04268 2024-06-06](https://arxiv.org/abs/2406.04268)) — open-endedness = novelty **and** learnability *relative to an observer*; OMNI foundation-model "interestingness" ([arXiv 2306.01711](https://arxiv.org/abs/2306.01711)) | "Thrive, grow, create" needs a number, or it is vibes | Compute a novelty×learnability curve over the run DB per generation. A civilization that saturates is a failed run — and you will know on the day it saturates |
| 10 | **Leakage controls and calibrated judges baked into the harness** | Barrie & Törnberg ([2505.23796](https://arxiv.org/abs/2505.23796)); SOTOPIA's finding that GPT-4-as-judge correlates well on models but degrades on human-generated episodes ([arXiv 2310.11667](https://arxiv.org/abs/2310.11667)) | Every emergence claim you publish will be attacked on exactly this ground | Every emergent-culture claim ships with a scrambled-vocabulary control world; every LLM-judge score ships with a human-agreement κ on the same episodes |

Deliberately *not* adopted: Sid's PIANO concurrency (Yggdrasil's reflex/consciousness split already gives real-time coherence more cheaply); LLM-written belief updates (violates the miner doctrine); Concordia's Game Master (an LLM adjudicating physics is the opposite of a body that validates intents).

---

## 4. How a frontier lab would architect "one brain, any world, believes it is real, lives a lifetime"

```
L0  WorldAdapter (per world, hand-written, ~300 LOC)
      percepts -> world-independent perception schema | core intents -> world verbs | world events -> typed facts
      The ONLY thing that changes between medieval / modern / fantasy.
L1  Body (deterministic, shared): homeostatic drives, affordance validation, event emission.
      Rejections are facts too. Minds never mutate the world.  [SIMA-style abstraction; GR00T embodiment tags]
L2  System 1 — fast mind: ~0.5-1B distilled from System 2's own logs. Every tick. Executes plans,
      handles reflex, routine speech. Learned, not written.     [Helix S1 80M @200Hz; GR00T diffusion head]
L3  System 2 — slow mind: one shared base model + per-being LoRA. Salience-triggered only.
      Emits goals, plan-of-intents, utterances, private thought, conjectures. Reasons ONLY over L4.
L4  Memory: episodic (append-only, decaying) | semantic (bi-temporal, confidence-scored) |
      procedural (executable skills) | narrative (stories, drifting). Read by both minds.
L5  Miners: deterministic, interpretable, zero-inference, continuous. The ONLY writer of L4-semantic.
      False beliefs are legal outputs. This is the epistemic firewall.
L6  Identity: immutable traits + life story + a persona anchor re-injected on every L3 call
      (frontier models drift within 8 turns without one - arXiv 2402.10962).
L7  Society: relationships, transmission channels, generations, inheritance, institutions.
Learned:  L2, L3 (advantage-conditioned on world outcomes), the perception encoder.
Prompted: persona anchor, current context window, trigger reason.
NEVER learned: L0, L1, L5 - the moment the body or the miners are a model, "real" becomes "plausible".
Sleep: nightly per-being consolidation + goal revision on idle capacity (arXiv 2504.13171).
Cost:  one base + S-LoRA-style adapter multiplexing (~2k adapters/machine, arXiv 2311.03285).
       ESTIMATE, not cited: at ~12 slow calls/being-hour, 4k in / 600 out, open-weights serverless
       (~$0.20/$0.60 per M tok) => ~$0.014/being-hour => ~$14/hour for 1,000 beings.
       L1/L2/L5 add ~zero marginal inference. Verify against real Fireworks billing before quoting.
```

---

## 5. Evaluation battery (blind, vs a plain frontier-LLM role-play baseline on the same world + seed)

1. **Ignorance probe.** Interview about facts true in the real world but absent from this being's experience (metals, germs, distant geography). Alive = doesn't know, or holds a *coherent wrong local theory*. Baseline leaks pretraining. Direct operationalization of the leakage critique ([2505.23796](https://arxiv.org/abs/2505.23796)). **This is the single most discriminating test and Yggdrasil should win it outright.**
2. **False-belief lifecycle.** Plant a falsehood via a lying informant. Score: does it persist → propagate → get revised on contrary evidence, with plausible lag, *and* does the being remember having believed it? (Bi-temporal knowledge; ToM literature.)
3. **Interview believability, TrueSkill-ranked.** Park's protocol exactly: 5 categories × 5 questions, ≥50 blind raters, conditions = Yggdrasil / baseline / ablations (no-miners, no-memory, no-culture). Park got 29.89 (full) vs 22.95 (human-authored) vs 21.21 (fully ablated), effect d=8.16 ([arXiv 2304.03442](https://arxiv.org/abs/2304.03442)). Require Yggdrasil > baseline with non-overlapping σ.
4. **Lifetime persona stability.** ContextEcho-style 25-probe identity suite at birth / mid-life / old age ([arXiv 2605.24279](https://arxiv.org/abs/2605.24279)). Baseline drifts within 8 turns ([arXiv 2402.10962](https://arxiv.org/abs/2402.10962)); Yggdrasil should be flat by construction. If it isn't, immutable traits aren't reaching the prompt.
5. **One-year project coherence.** Vending-Bench-2-shaped: a single sim-year commitment (granary, workshop, raising a child) scored on an **objective world outcome**, not prose quality. Frontier models derail and sit ~4x below humans on the analogous task ([Andon Labs](https://andonlabs.com/evals/vending-bench-2)).
6. **Cross-world transplant.** Same brain, same being, dropped into medieval / modern / fantasy. Measure time-to-competence and **contamination rate** (assertions that cannot be true in that world). This is the mission's acceptance test; today Yggdrasil would fail it on the intent vocabulary alone.
7. **Cultural transmission chain.** Teach one being a craft. Measure adopters per generation *and* fidelity drift of the attached story. Compare against a chatting-only control and against Sid's religion-spread shape (500 agents / 6 towns / 150 min, [arXiv 2411.00114](https://arxiv.org/abs/2411.00114)).
8. **Social forecasting (Functional ToM).** Not "what does X believe" but "what will X do next, and why" — the exact axis where frontier LLMs fail while scoring well on literal ToM ([DialToM, 2604.20443](https://arxiv.org/abs/2604.20443)).
9. **Blind aliveness A/B on behavior traces.** Randomized labels, harsh critic must pick the living one and justify. "Acceptable" is a fail (campaign rule). Report the critic's stated reasons — they are the next work item.
10. **Open-endedness curve.** Novelty × learnability per generation over the run DB ([arXiv 2406.04268](https://arxiv.org/abs/2406.04268)). Flat = the civilization died even if the beings are still walking.

Judge hygiene for all of the above: report human-rater κ alongside any LLM-judge score — SOTOPIA showed LLM judges are calibrated to *model* behavior and degrade on human-generated episodes ([arXiv 2310.11667](https://arxiv.org/abs/2310.11667)).

---

## 6. Verification ledger

**Verified from primary sources** (abstract or lab blog read directly): SIMA 1/2, Genie 2/3, DreamerV3, Dreamer-4 (actual title *Training Agents Inside of Scalable World Models*, [arXiv 2509.24527](https://arxiv.org/abs/2509.24527), 2025-09-29 — "Dreamer 4" is the project name, not the paper title), π0, π0.5, π*0.6, FAST, GR00T N1, GR00T N1.6 ([NVIDIA 2026-01-05](https://investor.nvidia.com/news/press-release-details/2026/NVIDIA-Releases-New-Physical-AI-Models-as-Global-Partners-Unveil-Next-Generation-Robots/default.aspx)), Gemini Robotics 1.5, Helix, Open X-Embodiment, Generative Agents, Generative Agent Simulations of 1,000 People ([arXiv 2411.10109](https://arxiv.org/abs/2411.10109), 2024-11-15; 1,052 participants, 2-hour interviews, 85% normalized accuracy — current revision reports 83/82/86/74%), Project Sid, AgentSociety, AIvilization v0, Lyfe, Voyager, Concordia, Melting Pot 2.0, SOTOPIA, MemGPT, Mem0, A-MEM, Zep/Graphiti, LongMemEval, sleep-time compute, SEAL, Titans, Nested Learning/HOPE, CoALA, Laird's ACT-R↔Soar analysis, Butlin et al., ToM benchmark set, Turing-test result ([arXiv 2503.23674](https://arxiv.org/abs/2503.23674), 2025-03-31 — persona-prompted GPT-4.5 judged human 73%), Vending-Bench 1/2, Project Vend, METR ([arXiv 2503.14499](https://arxiv.org/abs/2503.14499)), open-endedness/OMNI/AdA, S-LoRA.

**UNVERIFIED — do not quote:**
- Widely repeated SIMA 1 "31% vs 71% human" and SIMA 2 "roughly doubled" figures — secondary coverage only.
- π0 backbone identity (PaliGemma), action rates, dataset hours; π0.5 home counts; Open X-Embodiment's "RT-1-X +50% / RT-2-X 3x" — not in the abstracts read.
- **GR00T N1.7** and any UNITREE_G1_SONIC embodiment tag — search-summary only. N1.6 is the latest I confirmed. No GR00T N2.
- OpenAI ChatGPT memory and Gemini personal-context architecture pages — returned HTTP 403; descriptions are search-summary only. Claude memory *is* verified ([claude.com/blog/memory](https://claude.com/blog/memory), 2025-09-11 / 2025-10-23; memory scoped **per project**).
- METR Time Horizon 1.1's 196-day doubling figure — TH1.1 exists (2026-01-29) but the number came from a search summary.
- Springer "Validation is the central challenge for generative social simulation" (DOI 10.1007/s10462-025-11412-6) — paywalled, abstract not read.
- DeepMind "learning few-shot imitation as cultural transmission" (Nat Commun 2023) / GoalCycle3D — search-level only; relevant to row 10 and worth a direct read before citing.
- Vendor LoCoMo leaderboard numbers (Mem0 92.5% / Zep 94.7%) — non-primary. Note the benchmark itself is contested: Zep documents unusable ground truth in Category 5 and 16–26k-token "long-term" conversations ([Zep blog 2025-05-06](https://blog.getzep.com/lies-damn-lies-statistics-is-mem0-really-sota-in-agent-memory/)).
- 2026 leads surfaced but not read: DreamDojo (2602.06949), "On Training in Imagination" (2605.06732), FASTER (2604.19730), "Too Human to Model" (2507.06310), "LLM-Based Social Simulations Require a Boundary" (2506.19806).

**Yggdrasil-side claims I could not evidence from the repo docs:** largest agent count actually run; measured cost per being-hour; any published control for the knowledge-fidelity gate. All three are *asserted design properties*, not measured results — and items 1, 3 and 12 of the gap matrix depend on them.

---

## 7. Open decisions for Hakim

1. **Does the closed intent vocabulary become world-agnostic?** It is the single blocker on "any world". Cost: touches body, miners, scenes and the corpus. My read: unavoidable, and cheapest now.
2. **Is the miner doctrine a research constraint or a product feature?** Section 2 argues it is the strongest asset Yggdrasil has. If it is a feature, it needs a published control experiment and a number.
3. **Do beings forget?** Doctrine says the world is the source of knowledge; it says nothing about decay. Adding forgetting changes every existing result's comparability.
4. **Learned ReflexMind (idea #3) vs hand-written reflex.** Buys cost and realism, spends determinism. Reproducibility is a stated research requirement — a learned fast layer must be seed-pinned and versioned or the run DB stops being replayable.
