# Yggdrasil Rework Campaign (opened 2026-09-18)

Resume anchor for every `/loop` iteration. Read this first, act on **Next action**, update it before ending the turn.

## Mission (Hakim, 2026-09-18)

Rework the NPC, the Lab, the NPC brain, and the training data. The goal is beings that are real — or believe they live in a real world — forming virtual civilizations, driven by possibly **ONE brain** that can be placed into any world (modern, fantasy, medieval, …) and live, learn, thrive, grow, adapt, create. Like humans. Players step into that world and meet players *and* beings.

Everything before this campaign was built with Opus 4.8 (last commit 2026-06-15). Audit it skeptically; do not assume it is correct or well designed.

**Benchmark:** not game studios — they are not attempting this. Compare against AGI labs, robotics companies, agent-society research, and frontier models themselves.

## Operating model

- **Fable 5.1 = architect / manager / reviewer / advisor.** Plans, decomposes, reviews every diff, audits, directs revisions. Writes planning docs only — never production code.
- **Opus 5 subagents (`model: opus`) = coders.** No change lands unreviewed.
- **Separate harsh critic subagent per item.** "Acceptable" is a fail; the coder loops until the critic passes it. Gate by surface:
  - *Visual (lab UI, beings in-world, dashboards):* screenshots, judged against the best research/robotics observability tools, not game HUDs.
  - *Mind / behavior:* blind A/B of behavior traces — Yggdrasil mind vs a plain frontier-LLM agent baseline on the same world and seed, randomized labels. Critic must prefer Yggdrasil and say why.
  - *Training data:* dataset-card audit — provenance, dedup, leakage, distribution, eval gates. No "it trained" as evidence.
- **Research doctrine stands:** honest reporting, negative results kept, never tune toward a positive, analysis labels never read back into minds, the world is the source of knowledge. If an audit shows doctrine blocks the mission, escalate to Hakim — do not quietly drop it.

## Resource rules (Hakim, 2026-09-18 — shared PC)

- Token frugality: small fan-outs, reports ≤ 200 lines, agent final messages ≤ 25 lines, no re-reading.
- No paid LLM/API calls without Hakim's go. No sims longer than ~2 minutes during audits.
- Process hygiene: every process an agent starts is recorded by PID and killed by PID before the agent finishes. **Never kill by image name** — other sessions share this machine. Only this campaign's own leftovers get cleaned.
- At most one heavy process (Electron / browser / long sim) alive at a time.

## Scope

| Area | Where |
|---|---|
| Brain + body + runner | `C:\dev\YggdrasilLab\packages\engine` |
| Lab (Electron observatory) | `packages/lab`, plus `packages/mcp`, `packages/db` |
| Training data | `~/.yggdrasil-lab/corpus/civilization.jsonl` (2119 acts), `packages/engine/src/training`, `docs/yggdrasil_training_strategy.md` |
| NPC in Gahalla | `C:\dev\GahallaGameEngine` — `packages/yggdrasil`, `engine/src/yggdrasil`, desktop observatory. Older duplicate of the lab engine. CLAUDE.md §12 froze NPC systems for the engine-quality campaign; this directive lifts that for this campaign. Audit deferred to iteration 2 (integration seam). |

## Status board

| # | Item | State |
|---|---|---|
| 0 | Baseline audits → `docs/rework/audits/` | 01, 03, 04 done · 02 lab-visual still running |
| 1 | Architect synthesis → `docs/rework/ARCHITECTURE.md` (waves 0/1/2/L/G/T, decisions) | done (Wave L pending audit 02) |
| W0-A | Engine correctness sweep | **DONE** — commit `0a5b6a9`; hostile-verified over 3 rounds (PASS); tests 85→105 |
| W0-B | Lossless cognition record + outcomes + scaffold tags + full intent args (audit 03 items 1, 2, 4, 8) | queued (after W0-A; shares `Experiment.ts`) |
| W0-C | Spatial index — pure optimisation; golden state fingerprints must stay bit-identical; bench at 100/300/1000 beings | coder running (reordered ahead of W0-B, which needs L1 committed first — both touch `mcp/src/corpus.ts`) |
| W0-D | Erratum report: re-run corrected accuracy / superstition / diffusion numbers | queued (after W0-A) |
| W1-A…E | See ARCHITECTURE.md §7 | queued |
| L1 | Lab/MCP/DB security + audit-trail integrity + shared-home package + activity tail + lab test script (audit 02 "Code audit", item 9) | coder running (parallel with W0-A; disjoint packages) |
| L2 | Sim off the UI thread: Worker + serializable frame protocol; controls respond < 100 ms at 2400× | queued (after L1) |
| L3 | Beings you can see and tell apart (World3D) — **first visual-critic loop**; baseline shots in `~/.yggdrasil-lab/rework/shots/` | queued (after L2) |
| L4 | Time axis: population / deaths / diffusion charts; run identity stamp on every tab | queued |
| L5+ | Inspector as stream-of-consciousness, provenance walk, replay/scrub, A/B compare, human participation — **wait for W0-B and the Wave 1 seam** (they depend on mind data shapes) | deferred |

Branch: `rework/2026-09` (local only, never pushed). Architect commits each item after review + critic pass.

## Open decisions for Hakim (none block Waves 0–1)

1. Inference budget for the evaluation battery / conscious-population runs.
2. Which model is the slow mind going forward.
3. Learned fast mind (distilled System 1) — later, costs bit-exact reproducibility.

## Iteration log

- **2026-09-18 · it.1** — Campaign opened. Four Opus audits launched. PID baseline taken (23 pre-existing node/browser procs — not ours, leave alone).
- **2026-09-18 · it.1b** — Audits 01/03/04 landed. Headlines: conscious minds could never teach (schema drop); several "emergent" results are authored closed loops; ground-truth oracle wrong; corpus is not a dataset; mind welded to one world; perf O(agents×entities). ARCHITECTURE.md written. Branch cut. W0-A coder launched.

- **2026-09-18 · it.1c** — Audit 02 landed (13 baseline screenshots; agent's 4 PIDs verified gone). Architect viewed `04-being-inspector.png`: agrees — beings are indistinguishable pellets, beliefs are debug symbols, no charts, sim on UI thread, path traversal on lab + MCP. Wave L sequenced; L1 coder launched.

- **2026-09-18 · it.1d** — W0-A coder delivered all 8 fixes (98/98 tests, typecheck clean, revert-checked). Architect review: speech resolution is doctrine-sound (rebuilt field by field from the speaker's own stores). **One change request sent back:** prompt exposed raw narrative ids (`slew:…`, `seed:myth`) → leaks authored taxonomy + researcher seeding into minds; must be an opaque stateless hash. Known issue carried to W1-B: `AgentDied` names no cause, so witness fear lands on the deceased (inert) — the event schema needs a `cause` role.

- **2026-09-18 · it.1e** — W0-A change request done (opaque `narrativeRefOf` hash, raw ids rejected; 33 affected tests + typecheck green). L1 coder delivered all 7 items (new `@yggdrasil/home` package; home 46 / lab 36 / mcp 7 / db 15 tests green; no processes started). Architect read the slug gate, read-only connection and window hardening: sound; `sandbox: true` unverified at runtime. **Two hostile verifiers running:** W0-A (`docs/rework/reviews/W0-A-verifier.md`) and L1 (`…/L1-verifier.md`, includes one real Electron boot).

- **2026-09-18 · it.1f** — W0-A verifier: **FAIL** (2 medium, 4 low). Held under attack: LLM-speech doctrine path, hash (0 collisions / 4161 ids), determinism bit-identical, contract collapse. Failed: WitnessedDeath fear lands on the corpse (inert + pollutes) — architect had wrongly accepted this; stone mis-graded by the highland oracle; myth age should use `Narrative.firstTick`; rule shared by reference. Sent back to coder. **New finding for Wave 2 (and the erratum):** an LLM being's free `text` never reaches any listener's prompt — conscious beings cannot hear each other, so every "asked X" in June's Exp 7–15 was never answerable.

- **2026-09-18 · it.1g** — W0-A coder fixed D1 (killer named on `AgentDied` at the one site a person's blow lands; fear targets killer, never corpse), D2 (stone → unverified), D3 (myth age from `firstTick`), D6 (`copyRule`); 103/103. Round-2 verification running (special attention: what else consumed `subjects=[deceased]` on WitnessedDeath memories). **L1 verifier: FAIL** — boot PASS with `sandbox: true` (PID 49144 gone), traversal + SQL-write attacks all held; defects: HIGH TypedArray heap-exhaustion in `llm:complete` validation (runs before the rate limiter), MEDIUM runaway recursive CTE hangs MCP, activity-tail memory spike, oversized legacy key stranded in cleartext, NTFS slug case collision. Sent back to L1 coder.

- **2026-09-18 · it.1h** — W0-A round 2: **FAIL**. D2 fixed. Regression: killer overwrote `subjects`, erasing who died (architect had flagged this risk to the verifier — confirmed). Story age still collapses when witnesses die (retellings stamp their own `firstTick`). Co-listeners share one rule object. Predator deaths moving no relationship = accepted by design. Sent back (round 3): `causedBy` field separate from `subjects`; origin `firstTick` carried through every transmission; copy at intake.

- **2026-09-18 · it.1i** — W0-A round 3: **PASS** → committed `0a5b6a9` (engine only, local). Verifier nits folded into W0-C step 1. Erratum note owed: `Narrative.firstTick` now means the story's ORIGIN, so sacred-place selection shifted — trajectory differences vs June runs are not results. L1 round-2 verification running. W0-C coder launched.

## Next action

On each verifier verdict: FAIL → send the defects back to the same coder (W0-A coder agent / L1 coder agent via SendMessage), re-verify; PASS → architect commits that item locally on `rework/2026-09` (engine paths for W0-A; home/lab/mcp/db + lockfile + README for L1 — commit them SEPARATELY), then launch the next item in that track: W0-B (lossless cognition record + outcomes; touches engine + `mcp/src/corpus.ts`, so only after BOTH commits) and L2 (sim in a Worker). After the L1 verifier: confirm its Electron PIDs are gone.
