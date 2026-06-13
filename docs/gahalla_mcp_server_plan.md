# Gahalla MCP Server — Plan (V1)

**Status:** ACTIVE. Drafted 2026-06-12. Companion to [[yggdrasil_civilization_design]]. Parallel track ("M" phases), independent of the Yggdrasil Y-phases.

> **M0 SHIPPED 2026-06-13** — `tools/mcp/` (`@gahalla/mcp-server`, MCP SDK 1.29, stdio). 9 read-only tools: `search_code`, `find_files`, `read_file`, `code_outline`, `vault_search`, `vault_read`, `build_info`, `engine_overview`, `agent_rules`. Path-confined to the repo, no writes/shell/network. Wired via root `.mcp.json` (Claude Code auto-loads it). Smoke-tested end-to-end (`node tools/mcp/smoke.mjs`). Next: M1 gated execution, M2 Yggdrasil run-DB queries.

---

## 1. Purpose

Make Claude (and any MCP-capable agent) a first-class engineering collaborator inside the Gahalla ecosystem. Today an agent session rediscovers the repo from scratch: where systems live, how to build, what the vault has already decided. The MCP server turns that tribal knowledge into tools — structured, fast, and safe — so agent sessions start productive and stay inside the repo's rules.

Secondary purpose (later): give Claude direct query access to Yggdrasil run datasets, so emergence analysis ("show me every food-sharing chain in run 12") becomes a tool call instead of ad-hoc SQL.

## 2. Stack & Placement

- **TypeScript**, official `@modelcontextprotocol/sdk`, **stdio transport** (local-first; the consumers are Claude Code / desktop-adjacent agents on the same machine).
- Lives at **`tools/mcp/`** — fits the existing `tools/*` workspace glob in `pnpm-workspace.yaml`; ships as `@gahalla/mcp-server` with a `gahalla-mcp` bin.
- Configured in consumers via standard MCP config (Claude Code `mcpServers` entry pointing at the bin).
- Read-only filesystem access rooted at the repo; no network access of its own.

## 3. Tools

### M0 — read-only (first ship)

| Tool | What it does |
|---|---|
| `search_code` | ripgrep-backed regex/literal search with glob filters; returns file:line matches |
| `find_files` | glob over the repo (respecting .gitignore) |
| `read_file` | bounded file reads (path + optional line range) |
| `code_outline` | exported symbols / classes / functions of a TS file (ts-morph or regex-lite first pass) |
| `engine_overview` | generated map of engine systems: each `engine/src/*` area + one-line purpose, sourced from a maintained manifest + vault docs |
| `vault_search` / `vault_read` | search and read `ClaudeGaHallaVault/` — decisions, plans, progress log |
| `build_info` | workspace topology: packages, scripts, dependency edges (parsed from package.json files) |
| `agent_rules` | returns the AI-agent constraints (CLAUDE.md §5 + `ai_agent_rules.md`) so any agent can self-check before editing |

### M1 — gated execution

| Tool | What it does |
|---|---|
| `run_tests` | `pnpm -r --filter <pkg> test` (or full run), structured pass/fail + failure excerpts |
| `run_build` | per-package build, structured result |
| `validate_game` | `gahalla-validate games/<Game>` wrapped, structured findings |
| `run_generator` | execute an **allowlisted** `tools/*.mjs` generator with declared args |

Gating rules: an explicit allowlist of runnable commands baked into the server config — **no arbitrary shell, ever**. Mutating tools (generators) declare what paths they write; anything outside `games/**` and generated-asset paths is refused. Execution tools are disabled unless the server is started with `--allow-exec`.

### M2 — Yggdrasil dataset tools

| Tool | What it does |
|---|---|
| `runs_list` | enumerate run DBs with seed/config/duration/population summary |
| `run_query` | parameterized, read-only query templates over a run DB: events by type/actor/window, agent biography (memories+beliefs+relationships over time), interaction networks, metric series |
| `run_sql` | raw **read-only** SQL (opened with `?mode=ro`), row-capped |

This is how Claude becomes a research assistant on emergence data, not just a code collaborator.

## 4. Safety boundaries

- Read-mostly by default; M1 execution behind a startup flag + allowlist.
- All paths canonicalized and confined to the repo root; symlink escapes rejected.
- Run DBs opened read-only; the server never writes to a dataset.
- The server itself follows CLAUDE.md §5: it will refuse to be the vehicle for editing `engine/**`, `desktop/**`, vault docs (beyond the two agent-writable files), or root configs — refusals cite the rule.
- Resource caps: result row/byte limits, command timeouts, single-flight execution queue.

## 5. Phases

| Phase | Scope | Exit criterion |
|---|---|---|
| **M0** | Server scaffold + all read-only tools | From a fresh Claude Code session with only the MCP server attached, the agent can answer "where is voxel streaming implemented and what decisions govern it?" without a single raw shell call |
| **M1** | Gated execution (tests, builds, validator, generators) | Agent runs the engine test suite and reports structured failures via tools only |
| **M2** | Yggdrasil dataset tools | Agent answers an emergence question over a recorded run via `run_query` |

## 6. Open questions

1. **Manifest vs generation** for `engine_overview` — hand-maintained manifest is honest but stale-prone; generation from source is fresh but shallow. Likely: generated skeleton + manifest annotations. (M0)
2. **HTTP transport** later for the desktop app to consume the same tools in-Observatory? Out of scope until a concrete consumer exists.
3. Whether `run_sql` ships at all, or `run_query` templates cover real research needs. Decide in M2 from actual usage.
