# 05 — Gahalla as the sandbox world (audit, 2026-09-18)

Read-only audit of `C:\dev\GahallaGameEngine` @ `feat/render3d-voxel-world` `71a55ed`, against the owner's directive ("a larger world … where these AIs aren't bigger than their house or a tree or mountains"). **G:** = `C:\dev\GahallaGameEngine\`, **Y:** = `C:\dev\YggdrasilLab\`. **[m]** = measured by me headlessly via `tsx` against engine source (method §3); no source file was modified (`git status` clean).

## 1. What the 3D sandbox actually is

| Concern | Module | API |
|---|---|---|
| Terrain function | `G:engine/src/render3d/VoxelStream.ts:195` `StreamingVoxelWorld` | `sampleDensity(x,y,z)` `:318`, `materialAt` `:354`, `surfaceY(x,z)` `:408`, `applyEdit` `:427`, `removeLastEdit` `:433`, `setFocus` `:463`, `update()` `:508`, `stats()` `:521` |
| z-up↔y-up adapter | `G:engine/src/render3d/VoxelTerrainRuntime.ts:102` `createStreamingVoxelTerrain` | `StreamingTerrainHandle` `:70`; only remap site besides `SceneSync` |
| Composition | `G:engine/src/render3d/WorldRuntime.ts:23` | terrain+water+orbit cam+controller+hero; host injects renderer/player `:29-36` |
| Worldgen | `G:packages/worldgen/src/pipeline.ts` `generateRegion`, `config.ts:33` | deterministic seeded passes, golden-locked |
| Worldgen→3D | `G:packages/worldgen/src/voxel-export.ts:115` `regionToVoxelField` | `VoxelField{dims,voxelSize,sizeM,seaLevelZ,spawn,density,material,surfaceZ,features}` `:90-107` |
| Edits | `G:packages/worldgen/src/world-edit-session.ts:46` `WorldEditSession` | `apply(op,'user'\|'atlas')` `:84`, `beginStroke/endStroke` `:99/:105`, `undo` `:116`, `attach(sink)` `:74` |
| Persistence | `G:packages/worldgen/src/voxworld-file.ts` | `.gvoxworld` = config + `VoxelEditDelta[]`, never volumes |
| Navigation | `G:engine/src/nav/NavGrid.ts:79`, `NavigationSystem3D.ts:53` | `cellAt` `:90`, `findPath` `:101` (8-conn A*), `invalidate()` |
| Kinematic body | `G:engine/src/physics3d/CharacterController3D.ts:112` | `step(dt,{moveX,moveY,jump})`, pure over `DensitySampler` `:32` |
| Dynamics | `G:engine/src/physics3d/RapierPhysics.ts:30` `initRapier()` — explicit, not at import `:16-19` | z-up, box/ball/capsule `:52-55` |

**Load-bearing idea** (`VoxelStream.ts:10-21`): no persistent volume. Density = base callback folded with the ordered edit list; chunk volumes are transient mesh-time caches. Memory is O(loaded meshes); off-chunk queries are analytic, so terrain is identical whether a chunk is resident or not. Genuinely excellent architecture — and what makes a headless world service cheap, **until edits accumulate (§3)**.

**Sim queries available:** height (`surfaceY` renderer-space / `VoxelField.surfaceZ` z-up bilinear), solid (`sampleDensity < 0`), material/biome (`materialAt` → 11 ids, `voxel-export.ts:24-36`), walkable+headroom (`NavGrid.cellAt`). **Missing: no terrain line-of-sight / voxel raycast** — `Renderer3D.ts:527` is a screen-space three.js picker, `RapierPhysics.ts:305` hits rigid bodies only. Water is a plane at `seaLevelZ`, not a queryable volume.

**Bounds:** `dims` fixed at construction (`VoxelStream.ts:227-229`); outside them density returns air (`:320-325`). This is region streaming in a finite volume, **not open-world paging** — the repo's own audit agrees (`G:ClaudeGaHallaVault/research/audit/rendering-world.md:64`). Defaults: chunk 32 voxels, radius 120 m, lodRadius 60 m (stride-2), 2 chunks/`update()` (`VoxelStream.ts:216-223`). Seed determinism is real and golden-tested.

## 2. Scale — the good news

- **Units are metres, z-up, stated:** `CharacterController3D.ts:15`, `voxel-export.ts:9`.
- **Human = 1.7 m:** `CharacterController3D.ts:96-110` — `height 1.7`, `radius 0.4`, `stepHeight 0.6`, `moveSpeed 5`, `jumpSpeed 7`, `gravity 22` (game-y, not 9.81). Observatory Gahallians are already 1.66 m capsules (`G:desktop/src/renderer/src/editor/observatory/ObservatoryScene.ts:82-83`).
- **Trees ≈ 7–10 m:** `Foliage.ts:430-439,456-463` — block `U=0.62 m`, oak trunk 7 + canopy ±2.6 → ~7–8 m; tall variant `:550` ≈ 9–10 m. Correct against a 1.7 m human.
- **No door/building constant exists** — there is no architecture kit; structures are free-hand voxel edits.
- **1 voxel is NOT one number.** `voxelSize` is per-world: 0.75 m canonical (`voxel-export.ts:67`), 0.35 m playground (`G:playground/src/main3d.ts:74`), 1.0 m Observatory + all tests. No engine-wide `METERS_PER_VOXEL`. One 2D cell = `voxelsPerTile 2 × 0.75 = 1.5 m` (`voxel-export.ts:65-70,121`).
- **Extents shipped are small.** Default world 160×160 cells (`config.ts:77`) = **240 × 240 m**. Observatory = 400×400×20 voxels @1 m = **400 × 400 m, 20 m vertical** (`ObservatoryScene.ts:68-69`). Playground = 61.6 m. Nothing has ever run at km scale.
- **Mountains.** Base density is a pure heightfield — `density = wz − surfaceZ(wx,wy)` (`voxel-export.ts:163`): **no caves, overhangs or cliffs from worldgen**; only dig edits make them. Height = `heights[] × zUnitVoxels × voxelSize` = **1.5 m per z-unit** (`:122,136`). There is no metre-denominated peak parameter, only normalized `mountainBoost 0.3` (`passes/heightstack.ts:18-22`). An 800 m peak has never been generated and would need `dims.z ≈ 1070` at 0.75 m.

**The lab side of the mismatch.** `Y:packages/engine/src/world/regions.ts:11` `WORLD = 2000`; `heightAt` `:92-109` returns **0.25 … ~21**. At 1 unit = 1 m that is a 2 km continent with 21 m "mountains" — a pancake; `elevationBand` `:111-116` calls h ≥ 8 "highland", i.e. an 8 m hill. The directive is literally true: the tallest terrain in the lab is shorter than a Gahalla oak grove. **Fixing scale is ~40× vertical amplification + a metre contract, not new physics.**

## 3. Headless operation — the strongest finding

**Fully headless today, no shim.** `G:engine/vitest.config.ts` sets no `environment` → vitest default `node`. `G:engine/test/voxel-stream.test.ts:2` constructs a real `StreamingVoxelWorld` in Node; `voxel-terrain-runtime`, `world-runtime`, `character-controller-3d` and `navigation` tests all run terrain/controller/A* headlessly. I reproduced this outside vitest with `tsx` importing `VoxelStream.ts` directly — it meshed chunks with zero DOM.

- three.js is imported at module top (`VoxelStream.ts:1`) but only `Group/Mesh/BufferGeometry/Material` are used — no `WebGLRenderer`, no canvas. Cost is bundle weight, not a DOM dependency.
- Rapier WASM init is **explicit, not at import** (`RapierPhysics.ts:16-19,30`), so a world service can skip dynamics entirely. `WorldEditSession` is contractually THREE/DOM/Electron-free (`world-edit-session.ts:13-15`).
- **Zero workers repo-wide** (`new Worker(`/`OffscreenCanvas`/`worker_threads` → no source hits; corroborated `G:ClaudeGaHallaVault/gahalla_capability_audit.md:22`). All meshing is synchronous.

**Measured [m]** (Node 24, 512×96×512 @1 m, chunk 32, analytic base field):

| Query | 0 edits | 100 edits | 1000 edits |
|---|---|---|---|
| `sampleDensity` | **28 ns** (36 M/s) | 1.16 µs | **13.6 µs** (0.07 M/s) |
| `surfaceY` (column raymarch) | 3 µs | 197 µs | **2.31 ms** |
| mesh one 32³ chunk | **1.2 ms** | — | **339 ms** |

The O(edits) fold (`VoxelStream.ts:327` — linear scan of every edit for every sample, no spatial index) is not theoretical: it is a **40–280× cliff arriving at a few hundred edits**. The repo knows — `G:ClaudeGaHallaVault/engine_gap_matrix.md:36` item 29 "Voxel scale walls … Spatial index for edit folding; worker meshing", still open. A world where beings *build* is exactly the workload that breaks it.

A headless world service is otherwise trivial: `new StreamingVoxelWorld({density: field.density, …})`, never call `update()` (never mesh), expose `surfaceZ / density / materialAt / NavGrid.findPath` per tick.

## 4. Bodies that move in it

- `CharacterController3D.step` is pure and deterministic over its samplers (`:7-13`), slope-aware via density gradient, with step/coyote/jump-buffer feel. **[m]** it costs **13.3 density samples per step** and **0.2 µs/char/tick** on an analytic field → **1000 agents = 0.23 ms/tick**. Excellent.
- **Composed with the real fold:** 13.3 × 13.6 µs = **~181 µs/char/tick at 1000 edits** → ~5 agents per frame-millisecond. The controller is never the bottleneck; the terrain function is.
- **Pathfinding EXISTS** — the biggest correction to the brief's assumption. `NavGrid` (Phase D7, `NavGrid.ts:1-23`) is a lazily-paged 32×32 walkable-surface grid over the *same* `DensitySampler`: 8-connected A*, `maxStep 1.1 m`, `headroom 2 m`, no corner-cutting, `nodeCap 4096`, deterministic. `NavigationSystem3D.ts:53` steers `Transform3D + NavAgent3D` entities with patrol/wander/follow (`G:engine/src/components/NPCBehavior.ts`). **[m]** cold 85 m path = **2.9 ms / 130,270 density samples**; warm = **0.27 ms / 0 samples**; one cold page (32×32 cells) = **21,064 samples**.
- **Nav gaps that matter:** (a) **no edit invalidation** — `NavGrid.ts:20-22` says v1 has none; the only hook is `invalidate()` = drop *all* pages, so every building act nukes the whole nav cache. (b) `nodeCap 4096` caps a path at ~60 m of detour; no hierarchical/portal nav for continental travel. (c) no flow fields, no navmesh, **no crowd or agent-agent avoidance** ("crowd" appears in zero engine source files). (d) a 2 km² world at cellSize 1 ≈ 3,900 pages ≈ 36 MB resident — fine; but the cold build is ~82 M density samples ≈ **2.3 s at 0 edits, ~18 min at 1000 edits**.
- **Sim-LOD locomotion doesn't exist but needn't be invented**: `VoxelField.surfaceZ` *is* a cheap analytic heightfield follow for far agents (bilinear, no fold, no physics). Two-tier is a ~1-day adapter.

## 5. Building — sanctioned, and the cleanest part of the engine

`WorldEditSession.apply(op, source)` (`world-edit-session.ts:84`) is explicitly the ONE mutation seam: *"A brush stroke and an Atlas op are the SAME `VoxelEditDelta` taking the SAME path"* (`:7-11`), with `EditSource='user'|'atlas'` as **metadata only — provenance never changes how an op applies** (`:18-20`). An agent is therefore already a first-class builder: same deltas as a player, same API, persisted in `.gvoxworld`, replayed on attach (`:74-77`). Verbs (`VoxelStream.ts:45-50`): `dig/build/paint`, `boxbuild/boxdig/boxpaint`, `pathbuild/pathdig`, `replace`, `stamp` (asset by id). Stroke grouping + undo/redo per session.

Cost: `applyEdit` re-meshes every loaded chunk whose AABB is within the edit's bounding sphere (`VoxelStream.ts:443-459`) — correct, but each re-mesh rides the 1.2 ms → 339 ms curve, over an edit list the agents keep growing. **Collision updates for free** (the controller reads the same fold); **nav does not** (§4a).

## 6. Characters and crowds — the second-biggest gap

The 2026-08 "chunky" work is a mature *single*-character pipeline: `CharacterParts.ts:423` `CHUNKY_SCHEME` (`DEFAULT_SCHEME_ID='chunky'` `:531`), `CharacterModel.ts:177` bakes identity → per-bone voxel parts, `Skeleton.ts:188`, `AutoRig.ts:19`, `WeightBrush.ts:4`, `Ik.ts` foot IK, `gameplayRagdoll.ts:11`, `AnimationController.ts:239` (crossfade + additive layers), `AnimGraphMachine.ts:11` (three-free), driven by `heroFactory.ts:142` `driveLocomotion(dt, speed)` or per-entity by `SceneSync.ts:244` `syncCharacter`.

**It cannot do crowds.** Each character = one `RiggedCharacter` with **~10–14 separate `THREE.Mesh` draw calls** (one per bone part, `CharacterModel.ts:151-159`, `RiggedCharacter.ts:178/198`), **CPU linear-blend skinning every frame** (`Skinning.skinInto` via `RiggedCharacter.ts:408`), and **no frustum cull, no distance throttle, no pooling** — `SceneSync.sync()` poses *every* `Character3D` entity unconditionally (`SceneSync.ts:171-176`). Instancing exists only for vegetation (`Foliage.ts`, `GrassField.ts`). No impostors, VAT, bone textures or animation LOD. The team logged it: `G:ClaudeGaHallaVault/progress_log.md:5880-5881` *"instanced crowds would want GPU SkinnedMesh, a V4+ concern"*, repeated `:5991`. No test or bench spawns more than 3 characters.

What *does* scale today: the Observatory's `THREE.InstancedMesh` of capsules (`ObservatoryScene.ts:82-89`, `setMatrixAt`/`setColorAt` per frame `:145-178`, instance picking `:363-373`) — ~100 agents, proven. That is the honest near-term crowd renderer: **instanced capsules far, chunky rigs for the near ring only.**

## 7. The old Yggdrasil duplicate inside Gahalla

| Location | Package | Size | Frozen |
|---|---|---|---|
| `G:packages/yggdrasil/` | `@gahalla/yggdrasil` | 45 files / 4,414 LOC | 2026-06-13 |
| `G:engine/src/yggdrasil/` | inside `@gahalla/engine` | 11 files / 1,449 LOC | 2026-06-13 (one 8-line cleanup 06-21) |
| `G:desktop/.../editor/observatory/` | `@gahalla/desktop` | 8 files / 2,002 LOC | 2026-06-13 |
| `G:tools/_shot_observatory*.mjs` | — | 165 LOC | 2026-06-13 |

Extraction recorded at `G:ClaudeGaHallaVault/progress_log.md:6527-6559`; the lab's `runner/Experiment.ts` is described there (`:6541`) as "a Gahalla-free port of `ObservatorySim`". Everything is frozen on extraction day.

**Correction to the brief: the sim terrain is NOT flat in Gahalla.** `PerceptionSystem.ts:27-35` makes `TerrainField.elevationBand` injectable and notes flat-0 was *"as in Y1"*; desktop wires a real provider — `ObservatorySim.ts:58` `new PerceptionSystem({ elevationBand })` from `observatory/worldRegions.ts:30`, whose header (`:1-6`) says it is "One source of truth for both the 3D terrain (height) and the sim", consumed by `ObservatoryScene.ts:73` as `density = wz − heightAt(wx,wy)`. **Gahalla already solved sim/visual terrain agreement** for ~100 agents on a 400 m world. The flat-sim problem is the lab's today, not Gahalla's.

**Reusable:** `ObservatoryScene.ts` (instanced agents, camera rig, instance picking, marker factory) repointed at another sim's agent array; the Playwright harness (`G:tools/_shot_observatory.mjs:1`) + the `window.__obs` automation hook (`observatoryStore.ts:65-68`); six panels (`observatoryPanels.tsx:54,273,552,583,651,703` — viewport, inspector, events, diffusion, metrics, society map); `runExport.ts:17-30`, `runReport.ts`. **Retire:** all of `G:packages/yggdrasil/src/**` (Mind), `G:engine/src/yggdrasil/**` (Body), `observatory/ObservatorySim.ts` + `worldRegions.ts` — the lab owns these now.

**How an external `@yggdrasil/engine` legally enters.** `G:CLAUDE.md` §3–§5: `engine/` never imports `desktop/`/`games/`; agents never edit `engine/**`, `desktop/**`, `tools/**`. So the dependency lands **host-side (desktop / playground / packages/boot), never in `engine/`** — exactly where the Observatory already lives. Precedents: (a) **workspace link** — `pnpm-workspace.yaml:1-7` `packages/*`, `desktop/package.json:30` `"@gahalla/yggdrasil": "workspace:*"` → `link:../packages/yggdrasil` (`pnpm-lock.yaml:66`), with aliases at `desktop/electron.vite.config.ts:14,51` and `desktop/tsconfig.web.json`. (b) **HTTP client to a deployed service** — `engine/src/npc/YggdrasilNpcAgent.ts:1-11` already POSTs `/v1/decide` to a Railway deployment, its comment naming `@playrzone/yggdrasil-client` as the intended package, "kept inline here (no cross-repo dep)". (c) **`file:` dep — NO precedent here**: every `link:` in `pnpm-lock.yaml` is an in-workspace `workspace:*`; the Playrzone-landing `file:` pattern lives in the Playrzone repo. Cleanest route: **pack/publish `@yggdrasil/engine` and add it as an external workspace entry or a tarball dep of `desktop`/`packages/boot`.**

## 8. Hosts — where a human meets the beings

- **Desktop (winner).** Default screen is already the boot flow: `desktop/src/main/index.ts:35` `GAHALLA_START='home'` → `renderer/src/main.tsx:18-27` → `BootShell.tsx:63-73` → `packages/boot/src/BootApp.ts:32-106` (Title→CharacterCreator→Hub→WorldCreator|VisitWorld). The Hub is a real `Renderer3D` scene with a third-person `CharacterController3D` (`packages/boot/src/Hub.ts:88,121-122`); same in `WorldCreator.ts:155`, `VisitWorld.ts:319-331`. Publish/Visit work via IPC (`desktopBootPlatform.ts:35-108` → `desktop/src/main/publishedWorlds.ts`). **Camera is orbit-only everywhere — no fly cam, no first-person.**
- **Web shell** (`pnpm --filter @gahalla/web dev`) is **2D only** — `web/src/App.tsx:297` `Canvas2DRenderer`; no import of `Renderer3D`/`@gahalla/engine/3d` anywhere under `web/src`. It *does* already talk to a live Yggdrasil over HTTP (`App.tsx:23,379-381`) and has a dormant multiplayer client (`web/src/WorldConnection.ts:83`, imported by nothing).
- **Playground boot** (`playground/src/boot/main.ts`, now a shim into `packages/boot`) runs the same `BootApp` on `localBootPlatform` (localStorage): **no publish/visit**, Worlds + Games portals locked (`Hub.ts:77-81`). Committed and clean (last touched 2026-07-14; `packages/boot` 2026-08-06).
- **Spawning N beings is declarative:** author `Character3D` + `NavAgent3D` (+ `NPCBehavior`) into scene JSON; `SceneLoader.loadInto` materializes them, `NavigationSystem3D` drives them. Working example `G:games/SampleGame/scenes/course.scene.json:333-394` (3 wandering NPCs). No imperative `spawnCharacter(n)` — a runtime host adds entities to the `World` directly.

## 9. Integration options

| | What | Effort | Risk | Proves |
|---|---|---|---|---|
| **A** | Keep the lab's three.js viewer; fix the metre contract, amplify relief, enlarge the plane | **2–4 d** | Low | Scale is a *content* problem. Proves nothing about a sandbox. |
| **B** | Lab depends on Gahalla worldgen/voxel as a headless world service + renders with Gahalla's renderer inside the lab | 3–5 wk | **High** — imports a second engine's render stack into a research repo, inherits the O(edits) cliff with no host to fix it, two Electron apps | Real terrain queries under the WorldAdapter |
| **C** | **Gahalla hosts Yggdrasil**: `GahallaWorldAdapter` + body systems desktop-side, minds from `@yggdrasil/engine`, beings in the Gahalla sandbox, lab becomes the instrument | 6–10 wk | Medium — needs crowd rendering, nav invalidation, the fold index; but every fix lands where it belongs | The whole directive |
| **D** | **A now → C as the WorldAdapter lands** | A's 2–4 d, then C | Low | Both, in the right order |

**Recommend D (A immediately, C as the destination).** (1) The scale complaint is satisfiable this week and is independent of every hard problem — don't block it on an engine integration. (2) The `WorldAdapter` seam (`Y:docs/rework/W1-B-worldadapter.md`, `ARCHITECTURE.md` §2–§3) is *exactly* the interface a Gahalla world would implement — `space` over `PlaceRef`, `kinds` over voxel materials, the core verb `Build` binding to `WorldEditSession.apply`. Landing B1–B4 first makes C a host-side adapter instead of a rewrite. (3) B is the worst of both: it pays C's integration cost while leaving the research repo responsible for rendering and perf, and it puts engine fixes in a repo whose CLAUDE.md forbids touching `engine/**`. (4) C is where the fixes are legal and where the human already has a walkable body, publish/visit, an editor, and a proven 100-agent instanced renderer.

### First three milestones (each with an acceptance test a harsh critic can run)

**M1 — "One metre is one metre" (option A, ~3 days, lab-only).** Declare 1 unit = 1 m in `Y:packages/engine/src/world/regions.ts`; amplify `heightAt` so peaks reach ~800 m and plains 5–40 m; enlarge `WORLD` to 8,000–20,000 m; re-band `elevationBand` in metres; scale viewer beings to 1.7 m; add 7–15 m trees. *Acceptance:* a screenshot from a being's eye height (1.6 m) shows a tree whose canopy fills ≥ 3× the being's height and a horizon ridge a height probe confirms ≥ 500 m above its feet; the being's capsule is ≤ 0.5 % of world width. Behaviour goldens unchanged (heights are perception context only) or the diff explained band by band.

**M2 — Headless `GahallaWorldService` + the O(edits) spike (~2 weeks, Gahalla host-side).** A Node module composing `regionToVoxelField` + `StreamingVoxelWorld` (never `update()`) + `NavGrid`, exposing `surfaceZ / density / materialAt / findPath / applyEdit`, plus **an edit spatial hash** (gap-matrix item 29) and **incremental `NavGrid` page invalidation by edit AABB**. *Acceptance (measured, not asserted):* on a 2 km × 2 km world with **10,000 edits**, `sampleDensity` stays **< 100 ns** (today 13.6 µs at 1,000), one 32³ chunk meshes in **< 5 ms** (today 339 ms at 1,000), one cold NavGrid page builds in **< 20 ms**, and a 300-agent tick (controller + nav replan every 0.5 s) runs in **< 8 ms**. A critic re-runs my benchmark and sees the cliff gone.

**M3 — 300 beings living in the Gahalla desktop sandbox (~4–6 weeks).** `GahallaWorldAdapter` implementing the W1-B contract (`space` = voxel metres, `kinds` = voxel materials + resource refs, `Build` bound to `WorldEditSession.apply(op,'atlas')`); minds from `@yggdrasil/engine` wired host-side (workspace or tarball dep, never into `engine/`); rendering = instanced capsules far + chunky `RiggedCharacter` for the nearest ~30. *Acceptance:* **a 1.7 m being walks through a 2 m doorway of a hut it built itself from `boxbuild` deltas, under a 12 m tree, with an 800 m ridge on the horizon, while a human stands beside it in third person — 300 beings simulating, ≥ 55 fps, and the hut survives save/reload as `.gvoxworld` deltas.** The critic verifies the hut is real voxels by digging a hole in its wall, not a prop entity.

## 10. Risks and unknowns, ranked (each needs a spike)

1. **O(edits) fold at building scale.** Measured 40–280× degradation by 1,000 edits; building beings will produce 10⁴–10⁶ deltas. Unknown: does a chunk-bucketed edit index actually restore 28 ns, or does the ordered-fold *semantics* (later edits override earlier) force a per-sample sorted merge? **Spike M2 first — everything else is downstream.**
2. **Crowd rendering.** No instanced/GPU-skinned character path exists; the team deferred it. Unknown whether ~30 chunky rigs + 270 instanced capsules passes the visual critic gate or whether GPU skinning (multi-week) is demanded.
3. **World extent never exercised.** Largest ever = 400 m. Unknown: does `generateRegion`'s global post-pass pipeline run at 8,000² cells, and at what memory? The streaming `generateChunk` path is explicitly incomplete (passes 5–8 commented out, `rendering-world.md:29,72`), so growing the world may mean finishing the *other* worldgen pipeline.
4. **Nav at continental distance.** `nodeCap 4096` caps detours at ~60 m; no hierarchical nav. Unknown what "travel to the mountains" compiles to.
5. **Non-terrain streaming.** Foliage, grass, water and entities are placed once at boot for the whole world (`rendering-world.md:33,83`) — a km-scale world boots all its trees. Cost unknown.
6. **Determinism across the seam.** Controller and NavGrid are deterministic; Rapier is only "deterministic on a fixed binary" (`RapierPhysics.ts:21-23`). If the lab's replay guarantees must hold, dynamics stay out of the being loop.
7. **No line-of-sight query.** Perception ("can this being see that fire") needs a DDA over `sampleDensity` — cheap to write, but its cost is risk 1's cost.
8. **Repo governance.** `G:CLAUDE.md` §5 forbids agent edits to `engine/**`, `desktop/**`, `tools/**`, and §12 routes all implementation through Opus subagents under a Fable architect with a blind visual critic gate. Gahalla-side milestones must run inside that model, not around it.
9. **No caves/overhangs from worldgen** (`voxel-export.ts:163`) — a civilisation that shelters in caves has none to find until beings dig them.
10. **The lab's run store / `x.db` were not examined**; whether a Gahalla-hosted run can still feed the lab's instrument (corpus, replay, analysis) is unresolved.
