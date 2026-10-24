# Yggdrasil Lab

## COS650 Capstone — Milestone 2

- **Build under evaluation:** Yggdrasil Lab **v0.3.7**, tag [`milestone-2`](https://github.com/PlayrZone/yggdrasil-capstone/releases/tag/milestone-2) — branch tip, engine 931 / lab 511 / MCP 37 tests, all type-checks clean. Installer: [YggdrasilLab-Setup-0.3.7.exe](https://github.com/PlayrZone/yggdrasil-capstone/releases/download/milestone-2/YggdrasilLab-Setup-0.3.7.exe).
- **New since Milestone 1 (code):** the lab's automated acceptance harness (`pnpm --filter @yggdrasil/lab accept`) that drives the built Electron app with real input and checks it against ground truth — currently **10 of 12 checks pass** ([report](docs/capstone/accept-report-m2.json); `offers` and `perf` still failing); a renderer health probe (shader / console / window errors); occupied shelters drawn solid with a roof chip as the reading; first pass of the place-handle performance fix.
- **New since Milestone 1 (data analysis):** [What the Beings Learned](docs/capstone/data/What-the-Beings-Learned.html) — a data page built from the research database and corpus (knowledge growth, belief life-cycle, the mined rules, the apprenticeship A/B, a real recorded prompt, the thought corpus); the underlying [data sheets](docs/capstone/data/sheets/) exported from `research.db` (metrics per day, rules held at day 20, belief status, events by type, 2,119 corpus thoughts).
- **Project management:** [GitHub milestones and issues](https://github.com/PlayrZone/yggdrasil-capstone/milestones).

## COS650 Capstone — Milestone 1

**Student:** Hakim Corner · **Area:** Artificial Intelligence · **Project:** Yggdrasil — a world-grounded mind for NPCs (artificial-life engine + Electron lab).

- **Build under evaluation:** Yggdrasil Lab **v0.3.6**, tag [`milestone-1`](https://github.com/PlayrZone/yggdrasil-capstone/releases/tag/milestone-1) — the last fully verified commit (engine 927 / lab 499 / MCP 37 tests, all type-checks clean).
- **Installer (Windows):** [YggdrasilLab-Setup-0.3.6.exe](https://github.com/PlayrZone/yggdrasil-capstone/releases/download/milestone-1/YggdrasilLab-Setup-0.3.6.exe) — unsigned; Windows SmartScreen will ask to confirm.
- **Project write-up:** [docs/capstone/Yggdrasil-capstone-breakdown.pdf](docs/capstone/Yggdrasil-capstone-breakdown.pdf) (research question, doctrine, architecture, methodology, results, evaluation design, roadmap).
- **Live engineering log:** [docs/rework/CAMPAIGN.md](docs/rework/CAMPAIGN.md) — every item, decision and review verdict; hostile-review reports under [docs/rework/reviews](docs/rework/reviews).
- **Run from source:** `pnpm install` → `pnpm --filter @yggdrasil/lab dev` (Electron lab) · tests: `pnpm -r test`.
- Commits after `milestone-1` on `main` are work in progress and may not pass tests; the tag is the evaluated state.

**Artificial-life & emergent-civilization research engine and desktop lab.**

A standalone scientific platform for studying whether autonomous synthetic
beings — **Gahallians** — placed in a persistent physical world can learn from
experience, form knowledge, share it, adapt, and eventually build social
structures or civilization **without being programmed to**.

This is **not** a game, an NPC system, or a scripted civilization simulator.
It does **not** depend on the Gahalla engine (it may connect to it later).

## The loop

```
World Physics → Body → Experience → Memory → Machine Learning
→ Knowledge → LLM Consciousness → Action → World Physics
```

The engine knows the world's physical laws (resources have *properties*, never
recipes). The Gahallians do not — they must discover them.

## Packages

- `packages/engine` — `@yggdrasil/engine`: world physics, bodies, needs,
  perception, memory, learning, knowledge, consciousness interface, events,
  experiment runner. **Self-contained** (own ECS/math; no external engine).
- `packages/lab` — `@yggdrasil/lab`: the Electron desktop **observatory**.
- `packages/mcp` — `@yggdrasil/mcp-server`: controlled research + engineering
  access for Claude (read-first; mutations allowlisted; no arbitrary shell).
- `packages/db` — research-database schema + recorder (every run is a record).
- `packages/home` — `@yggdrasil/home`: the shared lab home (`~/.yggdrasil-lab`)
  — paths, the activity feed, and the shared reports. One implementation used
  by both the lab and the MCP server.

## Running tests on a shared machine

This repo is developed on a box that other people (and games) are using, so the
test suites are polite by default: every `vitest.config.ts` caps the pool at
**4 workers** (min 1) instead of vitest's default of one worker per core. Set
`YGG_TEST_WORKERS` to change it — `YGG_TEST_WORKERS=2 pnpm --filter
@yggdrasil/home test` for an even lighter run, or `YGG_TEST_WORKERS=max` (or
`0`) on CI or a machine you have to yourself to restore vitest's default.
Anything empty or non-numeric falls back to 4. Please run full suites **one
package at a time** (`pnpm --filter <pkg> test`) rather than `pnpm -r test`,
which starts every package's pool at once.

## Anti-NPC doctrine

No roles, jobs, factions, leaders, governments, kingdoms, or religions are ever
assigned. They may emerge through behavior and knowledge transfer. The lab only
*labels* observed patterns ("behaves like a gatherer") — analysis-side, never
written back into the simulation.

## Status

Y0 — design & scaffold. Engine ported standalone from the Gahalla prototype;
lab / mcp / db / CI being stood up. See `docs/`.
