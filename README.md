# Yggdrasil Lab

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
