# 02 — Lab: visual + code audit (harsh)
Audited 2026-09-18. Comparison class: Rerun, Foxglove, Neuroglancer, W&B, interpretability dashboards,
the Generative Agents / AI Town viewers. Not game studios.

## How it was captured

Playwright `_electron.launch` (1.60, resolved from `C:\dev\GahallaGameEngine\node_modules`) against a
freshly built `packages/lab/out/main/index.js`, in **reflex mode** — `YGG_HOME` pointed at a throwaway
home (copied reports + tail of `activity.jsonl`, empty `settings.json`) so `effectiveKey()`
(`lab/src/main/shared.ts:222`) returned undefined. No paid calls. Drivers outside both repos at
`C:\Users\hakim\.yggdrasil-lab\rework\drive*.mjs`; 13 PNGs in `…\rework\shots\`. Two passes, ~90 s of
sim, seed `genesis-01`, pop 150. `v33.4.11` in the title bar is Electron's version leaking because the
app ran unpackaged — an artifact of my launch, not a defect.

## What I saw

**The 3D world does not show beings.** `01-first-run.png`, `02-running-world.png`: at the default
camera a Gahallian is a ~2 px dot. 150 minds are visually indistinguishable from scattered gravel.
`03-world-closeup.png` — eight wheel-zooms in — is worse than it looks: agents (colored capsules) and
resource nodes (colored icosahedra) are the same size and near-identical hues (berry bush `#40b340`
vs "active" `#43d18a`, `World3D.ts:9,43`), so the legend in `01` is unusable. The capsule-plus-nose
heading geometry (`World3D.ts:270-276`) never resolves at any usable zoom. ~35 % of the canvas in
`01`/`02` is empty black sky; the most expensive pixels in the app render nothing.

**The world lies.** `03-world-closeup.png` at ~(830,770) and ~(1000,875): shelters and containers sit
*inside the lake* — `makeStructure` plants at `heightAt()` with no sea-level test (`World3D.ts:400-421`).
An instrument that renders impossible states unflagged cannot be trusted for the states it does render.

**You cannot tell what one being thinks, wants or is doing.** `04-being-inspector.png` is the whole
product promise, and it delivers: four unlabelled need bars, one of them literally titled
`SocialConnection` (raw camelCase, `App.tsx:330`), and a belief list. No current goal. No current
action. No episodic memory. No relationships. No kin. No age. No cause of anything. The heading reads
"WHAT GAHALLIAN HAS LEARNED (30)" for *every* being — `selected.name.split(' ')[0]` on a name of the
form `Gahallian #1830` (`App.tsx:335`). It then shows 12 of those 30 and silently drops 18
(`App.tsx:336`), inside a 200 px scroll box (`styles.css:51`). The panel floats over the world it is
describing (`styles.css:40`) instead of beside it.

**Beings have no names.** In `09-society.png` the entire social structure is six four-digit integers.
Nobody can hold "#1931 → #2135, 6×" in their head, let alone narrate a civilization from it. The goal is
beings that are real; the UI numbers them like samples.

**Beliefs leak engine identifiers into the minds.** `04`: "IntentRejected rarely happens at night 99%".
`08-analysis.png`: "UtteranceSpoken rarely happens at night" held by 127 beings; "AttackedByPredator is
followed by a death" listed as a superstition. Event-type symbols surfacing as first-person knowledge —
a debug dump wearing a mind's clothes.

**Provenance is dead, and two tabs contradict each other.** Every single row in `08-analysis.png` reads
`0 saw · 0 were told` (`AnalysisView.tsx:11-12`) — while the same run reports 3347 Shares (`07`) and
`09-society.png` claims "#1912 taught 43 lessons to 16 others" and "22 teachings passed down a family
line". Either the cluster provenance fields are never populated or the view reads the wrong ones.
Either way the headline research claim — *how* knowledge spread — is displayed as zero and nobody
noticed.

**Counters that are always zero.** Exchanges 0 and Conflicts 0 in `01`–`04` and `07` across both runs
and 14 sim-days, presented at the same weight as Shares 20864.

**No time axis anywhere.** Not one chart in the entire application. Diffusion, influence, divergence,
archetypes, deaths — all point-in-time scalars. `04` shows 149 deaths out of 310 ever-born; a
population halving is a number in a 4×2 table with no trend, no alarm, no history. For an emergence
lab, the absence of "over time" is disqualifying.

**Nothing is attributable.** `08`–`12` carry no seed, run id, day or wall-clock. Screenshot any analysis
tab and it is scientifically worthless — you cannot say which world it came from. And the archetype
classifier is degenerate without the UI caring: `08` shows Talker 133, Forager 26, Wanderer 3,
Woodcutter 1 — 81 % in one bucket, drawn as a proud bar chart under "EMERGENT — NEVER ASSIGNED".

**Layout wastes the screen in both directions.** `05-analysis-empty.png`: ~85 % of the viewport is black.
`08`: the right column is ~40 % empty below the superstitions card; four stat cards eat a 1950×120 band
for four integers. `09`: the detections card is mostly air and mentor bonds wrap to three lines each
("Gahallian #1931 / → Gahallian / #2135"). `10-culture.png`: `.aname { flex: 0 0 90px }` (`styles.css:161`)
squeezes shared stories into a 90 px centred column; "TWO CULTURES, ONE WORLD" compares a tribe of 3
against another of 3 while the tab reports 15 tribes, and `capitalize` mangles it to "A Tribe Of 3
Believes:".

**The intended empty states are unreachable.** `05-analysis-empty.png` shows zeros and blank cards,
not the written copy "Run the world a while, then come back". `App.tsx:228-264` computes a snapshot the
instant the tab mounts, so `AnalysisView.tsx:21`, `SocietyView.tsx:10-11` and `CultureView.tsx:11` are
effectively dead branches. Somebody wrote three thoughtful empty states and shipped a blank screen.

**"Live Activity" is neither.** `11-activity.png` is captioned "what the AI engineer is doing" and
"Mirroring the AI engineer's latest run snapshot" while showing a run from **June** — three months
stale — because no row carries a timestamp of any kind. 25 consecutive identical rows
("Day 12 — 116/100 alive, 4450 knowledge"). "116/100 alive" reads as a broken fraction. No filter, no
search, no run selector, no grouping, no relative time. The minimap is a 360 px black square with ~40
dots, no terrain, no scale, no legend, and 60 % dead space beneath it.

**Reports is Notepad.** `13-report-open.png`: raw Markdown in a monospace `<textarea>`
(`styles.css:137`), tables as pipe characters. The best content in the whole app — genuinely good
research prose — is rendered as source. No preview, search, dates, delete, diff, or link back to the run.

**The API-key nag is permanent furniture.** A 70 px amber bar with a password field sits above every tab
in all 13 screenshots — while reflex mode, which produced every published result in `docs/`, is framed
as a broken state.

**The most mind-revealing panel is below the fold.** "WHAT THEY'RE DOING & SAYING" is last in a 340 px
scrolling column (`styles.css:59`); at 1360×900 only its heading shows (`01`, `02`). When it does show
(`04`) it is flooded with `couldn't Gather (out-of-range)` — 8 of 14 consecutive lines in the run log.

## Code audit

**Security / IPC**
- Path traversal, renderer → disk: `reports:read` / `reports:write` pass an unsanitised `slug` from the
  renderer (`preload/index.ts:64-65`, `main/index.ts:167-168`) into `join(reportsDir(), slug + '.md')`
  (`main/shared.ts:184,193-194`). `slug = "../../../../x"` reads or writes arbitrary `.md` paths.
  Same hole on the MCP side (`mcp/src/reports.ts:67,80`), reachable by any MCP client.
- Fireworks key stored plaintext in `~/.yggdrasil-lab/settings.json` (`main/shared.ts:212-217`).
  Electron ships `safeStorage`; it is unused.
- `llm:complete` (`main/index.ts:151-155`) forwards an unvalidated renderer-supplied `ThinkInput`
  straight to a paid network endpoint with the key attached. No schema, no size cap, no rate limit.
- `sandbox: false` (`main/index.ts:97`) with no stated reason. No `will-navigate` or
  `setWindowOpenHandler` guard on the window.
- Credit: the renderer CSP (`renderer/index.html:5`) and keeping the key out of the renderer are right.
- `readonlyQuery` (`db/src/ResearchDB.ts:209-219`) is a regex denylist over raw SQL (it rejects
  `SELECT 'update'`) — wrong shape; `node:sqlite` supports a read-only connection.

**Correctness**
- Every MCP mutation is audited with timestamp **0**: `recordAction(actor, action, detail, runId)` with
  `at = 0` defaulted (`ResearchDB.ts:128`) and `logMutation` never passing it (`mcp/src/index.ts:50-53`).
  The append-only audit trail cannot be ordered against wall time.
- `announce()` writes `at` = sim tick (`mcp/src/index.ts:57-59`) while `ActivityLine.at` is documented
  as a clock on the lab side. Two meanings, one field — the root cause of the timestamp-less feed.
- Hard-coded display caps: `setPopulation(360)` / `setAnimals(300)` (`App.tsx:147-149,162-164`) truncate
  silently at `Math.min(list.length, mesh.instanceMatrix.count)` (`World3D.ts:339,358`). The run in `04`
  had 310 alive. Beings vanish from the view with no indication.
- `World3D.dispose()` (`World3D.ts:461-465`) disposes controls + renderer only; terrain, water, wall,
  6000 tree instances, rocks, resources, animals and structure groups leak.

**Performance**
- The simulation runs synchronously inside the render loop: `clock.tickFrame()` → `exp.advance(n)` on the
  main thread (`App.tsx:208`, `sim.ts:72`), up to 320 ticks per frame (`sim.ts:32`). Observed: at 600× a
  plain Playwright click on a speed button **did not complete in 30 s**; pausing needed `force: true` and
  a 90 s timeout. The UI is hostage to the sim. This belongs in a Worker.
- Per-frame allocation: a full `Map` of every agent rebuilt each frame (`App.tsx:127`) plus a fresh array
  of objects from `interpolated()` (`sim.ts:87-95`). 60 Hz garbage for a static population.
- `setStats` every 8th frame (`App.tsx:209`) rebuilds a 50-item feed and re-renders the whole `App`,
  including the 340 px panel and the inspector, ~7×/s.
- The cross-process channel re-reads the **entire** activity file on every change:
  `readFileSync(path)` then `.subarray(offset)` (`main/shared.ts:90-91`), on a 1 s poll plus an `fs.watch`
  (`shared.ts:112-119`). The file is already 721 KB and has no rotation or cap. If it is ever truncated,
  `size <= offset` makes the watcher silently deaf forever.

**Dead code / duplication**
- `ActivityLine`, `ReportMeta`, `parse`, `slugify`, `listReports`, `readReport`, `writeReport` are
  duplicated verbatim between `lab/src/main/shared.ts` and `mcp/src/{activity,reports}.ts` — ~130 lines,
  two copies that already disagree on the meaning of `at`. There is no shared types package.
- `appendActivity` (`main/shared.ts:65-72`) is never called in the lab and does `require('node:fs')`
  inside a module that already imports `fs`. Plus the three unreachable empty-state branches above.

**Tests**
- 16 test files, **zero** for `packages/lab`: its `test` script is literally
  `echo "(lab has no unit tests)"` (`lab/package.json`). ~1.6 k LOC of renderer, the entire IPC surface,
  the preload bridge and the file-tailing channel are untested. No e2e, no screenshot regression.
  `packages/mcp` has one test file for a 940-LOC server; the path-traversal hole would have been caught
  by a single case.

## What a world-class mind observatory would show

A per-being **stream of consciousness**: a time-ordered column of what it perceived, felt, concluded,
said and chose — the way an interpretability dashboard shows activations, not a needs bar. Every belief
carries **provenance you can walk**: this rule came from these 4 episodes, was told to it by her, who
learned it from him, who was wrong. A **memory view** — what it recalls, what has decayed, what it is
about to forget. A **lineage and culture timeline**: births, deaths, teachings and belief adoptions on
one scrubbable axis, so "this myth outlived its author" is a shape, not a badge. **Replay and
scrubbing** over a recorded run — the DB already stores metrics, events and knowledge snapshots, so the
lab should open run 2 from June and scrub it, not just tail a log of it. **Diffusion curves**:
adoption-over-time per belief, index case marked. **A/B run comparison**: two seeds aligned on day with
the divergence highlighted — that is how you tell a real effect from one lucky world. **Cohort
filtering and search**: "everyone who believes X", "who has never met anyone", brushed onto the 3D view.
**Named, recognisable individuals**, because the researcher's working memory is the real bottleneck.
**Deviation alerts** — the lab should say "population fell 48 % between day 6 and day 14" rather than
printing 149 in a table. **Human participation**: a first-person mode where you walk in, are perceived,
and your acts enter the same event stream as theirs, marked so intervention is never confused with
emergence. And every panel stamped with seed, run id, day and build, so a screenshot is evidence.

## Top 10 rework items

1. **Beings you can see and tell apart.** (L) — *Accept:* at the default camera, a screenshot lets a
   stranger count individuals, tell agents from resources, and read heading; selected being is obvious.
2. **A real being inspector: goal, current action, recent memories, relationships, kin.** (L) —
   *Accept:* from one screenshot you can state what this being wants and why, in a sentence.
3. **Names, not IDs, everywhere.** (S) — *Accept:* no `#1234` appears in World, Society or Culture; the
   inspector heading names the being, not "Gahallian".
4. **Time axis: diffusion, population, deaths, influence as charts.** (L) — *Accept:* Analysis shows an
   adoption curve per belief; a 48 % population collapse is visible as a shape, not a table cell.
5. **Move the sim off the main thread (Worker + transferable state).** (L) — *Accept:* at 2400× every
   control responds within 100 ms; a scripted click on a speed button completes without `force`.
6. **Fix provenance, dead counters and leaked event symbols.** (M) — *Accept:* no row reads
   `0 saw · 0 were told` while Shares > 0; no belief text contains `IntentRejected`, `UtteranceSpoken`
   or `AttackedByPredator`; Exchanges/Conflicts either move or are removed.
7. **Run identity + replay/scrub from the research DB.** (L) — *Accept:* every tab shows seed · run ·
   day · build; a finished run can be reopened and scrubbed to any day.
8. **Rebuild Live Activity as a timestamped, filterable event log.** (M) — *Accept:* every row shows
   absolute and relative time; stale data is labelled; filter by actor/kind/run; the minimap has terrain
   and a legend, or is deleted.
9. **Close the IPC holes.** (S) — *Accept:* slug traversal rejected by test on both lab and MCP paths;
   key in `safeStorage`; `llm:complete` schema-validated and rate-limited; `sandbox: true` or a comment
   justifying it.
10. **Layout + reading pass: kill the key nag, render Markdown, fix dead empty states and whitespace.**
    (M) — *Accept:* reflex mode shows no warning bar; Reports renders formatted Markdown; a fresh world's
    Analysis tab shows the written empty state; no tab is more than 30 % empty at 1360×900.
