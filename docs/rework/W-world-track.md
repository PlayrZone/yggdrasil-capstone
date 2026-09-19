# World track — true scale, a larger world, a real sandbox (design brief, 2026-09-18)

Answers Directive 2 (see `CAMPAIGN.md`). Grounded in `audits/05-gahalla-sandbox.md`. Depends on `W1-B-worldadapter.md`.

## What the owner asked for, restated as acceptance

1. A being is never bigger than its house, a tree, or a mountain — anywhere, at any zoom.
2. The world is much larger than today's 2 km plane with 21 m of relief.
3. The beings live in an actual sandbox — the Gahalla voxel world — where what they build is real and a human can stand next to them.

**The final acceptance test (M3):** a 1.7 m being walks through the 2 m doorway of a hut it built itself out of voxels, under a 12 m tree, with an 800 m ridge on the horizon, while a human avatar stands beside it; 300 beings simulating at ≥ 55 fps; the hut survives save/reload as `.gvoxworld` edit deltas; the critic proves the hut is real by digging a hole in its wall.

## Facts that shape the plan (audit 05)

- Gahalla is z-up METRES: human capsule 1.7 m (r 0.4, step 0.6), trees 7–10 m. There is no single voxel size (0.75 canonical / 0.35 playground / 1.0 observatory) — the sandbox world for beings must pick one and state it.
- Deterministic A* exists (`NavGrid` + `NavigationSystem3D`), the voxel world runs headless under Node, and `WorldEditSession.apply(op, source)` is the ONE mutation seam — an agent is already a first-class builder with the same deltas as a player.
- The three real gaps: (1) **O(edits) density fold** — `sampleDensity` 28 ns → 13.6 µs at 1,000 edits, a 32³ chunk mesh 1.2 → 339 ms; building beings will produce 10⁴–10⁶ edits; (2) **no crowd rendering** for characters (10–14 draw calls + CPU skinning each, no culling); only instanced capsules scale; (3) **nav has no incremental invalidation** and paths cap at ~60 m of detour; largest world ever run is 400 m.
- The Gahalla repo contains a frozen older duplicate of the Yggdrasil engine (body, mind, observatory sim) — to be retired; its instanced-agent scene, panels and screenshot harness are reusable.
- A dependency on `@yggdrasil/engine` may enter Gahalla only HOST-side (desktop / `packages/boot`), never `engine/`, as a workspace or tarball dep.

## Unit and time conventions (decided)

- **1 world unit = 1 metre**, in every world, in the sim and in every viewer. Bodies are true size (adult ≈ 1.7 m). Legibility comes from the camera and from a cartographic annotation layer — never from inflating bodies or shrinking scenery.
- **1 tick ≈ 1 second of motion**; a sim day stays 2,400 ticks (a 40-minute day, the convention every sandbox uses). Walking ≈ 1.4 m/tick. Any existing speed/range constant that is implausible under this convention is fixed in M1, listed band by band.
- Perception (~90 m), earshot, co-presence (~13 m) and reach are reviewed against human scale in M1 and become forager-adapter data.

## Milestones

| | What | Where | Depends on | Acceptance |
|---|---|---|---|---|
| **M0** (in flight) | Lab viewer proportions: true-size bodies, huts, trees; annotation layer reads as UI; camera down to street level; `scaleReport()` probe | lab renderer (L3 round 3 amendment) | — | NEAR screenshot: being beside hut + tree, proportions verified numerically |
| **M1** | **"One metre is one metre" forager world**: world 8–16 km across, relief in metres (plains 5–40 m, hills 50–200 m, a range to ~800 m), rivers/lakes/forests at scale, founders seeded into ONE fertile valley (not uniformly), resource density per km² preserved, wildlife ranges in metres; viewer gets chunked terrain LOD + instanced vegetation with distance culling + atmospheric depth so mountains read as far and huge | engine `worlds/forager` scenario + lab renderer | **W1-B1–B2** (so the new world is adapter/scenario DATA, zero mind changes — the first real proof of the seam) | Eye-height screenshot: tree canopy ≥ 3× the being, probe-confirmed ≥ 500 m ridge on the horizon; 300 beings × 1 sim-day headless within today's tick budget; goldens re-recorded deliberately with a written band-by-band explanation; `git diff --stat` empty over the mind directories |
| **M2** | **Headless `GahallaWorldService`** (Node): `surfaceZ / density / materialAt / lineOfSight / findPath / applyEdit` over `StreamingVoxelWorld` + `NavGrid`, plus the two engine fixes it needs — an **edit spatial index** so sampling stays flat as edits grow, and **incremental NavGrid invalidation by edit AABB**; hierarchical nav for km-scale travel | Gahalla repo, host-side + `engine/3d` fixes, on a dedicated branch off `feat/render3d-voxel-world`, local commits only, under Gahalla's own §12 operating model | — (can start as a SPIKE in parallel once a slot is free; it is the top-ranked risk) | Measured on a 2 km world with 10,000 edits: `sampleDensity` < 100 ns, 32³ chunk mesh < 5 ms, cold nav page < 20 ms, 300-agent tick (controller + replan every 0.5 s) < 8 ms; a critic re-runs the bench |
| **M3** | **Beings living in the Gahalla sandbox**: `GahallaWorldAdapter` (W1-B contract: `space` = voxel metres, `kinds` = materials + resource refs, core verb `Build` → `WorldEditSession.apply(op,'being')`, `Take/Use/Combine` on real blocks and items), body systems host-side, minds from `@yggdrasil/engine`; rendering = instanced far tier + rigged "chunky" characters for the nearest ring; the human's existing third-person avatar shares the world; the lab attaches to the running world as the instrument (corpus, replay, analysis) | Gahalla desktop host + lab | W1-B complete (B1–B6), M2 | THE final acceptance test above |
| **M4** | Crowd rendering to the visual bar (GPU-skinned / instanced characters, animation LOD, impostors), first-person walk-among-them, multiplayer hook | Gahalla | M3 | Blind visual critic prefers it; 1,000 beings |

## Decisions (senior engineer)

- **Option D from the audit: fix scale now, make Gahalla the destination.** Do not import Gahalla's render stack into the research repo (option B pays the integration cost twice).
- M1 is scheduled immediately after W1-B2 rather than before it, so the larger world arrives as adapter data and proves the seam; M0 covers the visible complaint in the meantime.
- The M2 edit-index spike is the first Gahalla-side work, because every later milestone rides on terrain sampling staying cheap while beings build.
- Beings build with the same edit deltas as players, tagged with their own `EditSource`; nothing about a being's construction is a prop entity.
- Determinism: Rapier dynamics stay out of the being loop; kinematic controller + NavGrid only, so lab replay guarantees survive the move.
- Gahalla-side work never pushes, never touches `main`, and follows that repo's §12 model (Opus coders, harsh critic, blind visual A/B for anything visible).

## Open questions for spikes

1. Does a chunk-bucketed edit index preserve ordered-fold semantics (later edits override earlier) at 28 ns, or is a per-sample sorted merge unavoidable?
2. Does worldgen run at 8–16 km (the streaming `generateChunk` path is incomplete; the region path has global post-passes)?
3. Non-terrain streaming (foliage, water, entities are placed once at boot today).
4. How the lab's run store attaches to a Gahalla-hosted run.
