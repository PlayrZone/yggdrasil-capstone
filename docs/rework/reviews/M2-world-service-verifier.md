# M2 — headless `GahallaWorldService`: hostile verification

Worktree `.claude/worktrees/agent-a3f362cdfc442692a` @ `7ff0e11`, left clean. node v24.13.1,
Ryzen 9 9950X3D, Win 11; game not running (re-checked before every benchmark); other agents live on
this box, so spreads are given, not single medians.

## VERDICT: **FAIL** — 2 blockers, 2 major, 3 minor. Flat A*, the rejection contract, nav
invalidation, determinism, replay and the axis contract survive attack. What fails is the one budget
M3 depends on, the "only mutation route" claim, and the coarse tier's honesty signal.

## His numbers reproduce (4 runs, `bench:world --json`)
| series | budget | vault | mine, median range | p95 range | max |
|---|---:|---:|---:|---:|---:|
| sampleDensity far / settlement(ungated) | <100 ns | 40.1 / 52.9 | 38.6–42.1 / 52.3–55.3 | ≤49.5 / ≤87.5 | — |
| 32³ mesh far / settlement | <5 ms | 2.21 / 2.41 | 2.13–2.44 / 2.37–2.55 | ≤4.98 / ≤2.71 | — |
| cold nav page far / settlement | <20 ms | 0.38 / 0.70 | 0.36–0.41 / 0.66–0.71 | ≤0.90 / ≤0.97 | — |
| 300-agent tick | <8 ms | 1.30 | 1.30–1.90 | 2.29–3.49 | **110–142 ms** |

Attack 7 reproduces exactly: engine **1179/1179** (104 files), worldgen 202, world-protocol 27,
yggdrasil 55, validate 41, new-game 9, web 14, csharp 4; four CI typechecks exit 0; desktop builds;
SampleGame/Platformer clean, SmartCity with its 4 known warnings.

## BLOCKER 1 — the tick spike is misdiagnosed; the proposed M3 fix would not fix it
The vault blames cold synchronous page builds. I instrumented **his own** workload per tick:
```
median 1.29  p95 2.31  p99 90.51  max 97.4 ms
5 worst ticks: 97.4 / 93.7 / 92.5 / 92.2 / 91.0 ms
  every one: nullPaths=1, slowestQuery 89-92 ms (null), newPages = 0, 3, 17, 30, 34
mean tick with >=1 null replan 15.06 ms (n=64) | with 0 nulls 1.45 ms (n=536)
mean tick that built >=1 page   5.88 ms (n=188)
```

It is **one `findPath` burning `DEFAULT_FLAT_NODE_CAP`=65,536**. Page builds do not correlate (the
92.5 ms tick built zero). Isolated cost of proving "no path" to a sealed goal 400 m away, flat ground:
`4,096 → 8.8 ms | 65,536 → 119.1 ms (the default) | 400,000 → 787 ms | 2,000,000 → 2,180 ms`.
Budgeting page builds leaves all of this untouched.

## BLOCKER 2 — the session is **not** the only mutation route
`readonly terrain` and `StreamingTerrainHandle.applyEdit` are both public:
`svc.terrain.applyEdit({op:'boxbuild',…})` → density 2.000→−1.000, `session.edits()=0`,
`stats().edits=0`, `snapshot().edits=0`, `navPagesDropped=0`, and `findPath` returns the identical
**pre-wall** waypoints. Terrain that never enters the `.gvoxworld`, never invalidates nav, and vanishes
on replay — exactly what "session is REQUIRED" exists to prevent. `terrain.removeLastEdit()` and
`terrain.stream` are the same hole.

## MAJOR 3 — `complete: false` is constant, so it is not a signal
Rugged 384 m world, 50,000 clustered edits, 3,606 walkable components; 120 pairs at 110–260 m; ground
truth by exhaustive component labelling under NavGrid's own rules:
`coarse non-null 87 | goal in a DIFFERENT component 60 (69%) | complete=false 87/87`;
`cost delta vs flat(400k cap), 27 pairs: median −0.87%, p95 +8.90%, max +9.65%` (claim ≤0.46%).
It fires on every long coarse answer, including his own bench (500 m / 1 km / 2 km "open" are all
`complete:false` — a column the vault's path table omits). The negative deltas are the tell: a coarse
tail is *shorter* than a real path because it goes through walls, so "cost" is not a path cost; the
≤0.46% figure is an artefact of obstacle-free corridors.

## MAJOR 4 — no size/bounds validation; one delta destroys the world, permanently
`validateEditDelta` checks finiteness only. Each in a fresh flat world (surface z=12):
`boxbuild sx=sy=sz=1e9 @origin → ok=true, 0.11 ms, surfaceZ(60,60)=0.00, nav pages 4→0 (all dropped)`;
`build radius=1e9 → same`; `material=1e9 → materialAt returns 1000000000`. Accepted → recorded in
`edits()` → in the `.gvoxworld` → replayed forever. 1,000-delta fuzz through the **real**
`WorldEditSession`: 0 throws, 0 partial applies, 0 world movement on refusal (that contract holds) —
but **23 of 74 accepted deltas had |extent| > 1e6 m**.

## MINOR 5 — `lineOfSight` tests one voxel PAST the segment on a lattice-plane endpoint
`LineOfSight.ts:125` `if (!(t <= limit)) break;` accepts entry at exactly `t == limit`, so solid
*behind* the target blocks. Repro (only solid voxel is x∈[37,38), beyond `b`):
`lineOfSight((52,98,32)→(38,98,32)) = {visible:false, distance:14, blockedBy:'blocked'}`; endpoint
nudged to 38.001 → visible; reverse → visible ⇒ **asymmetric**. Rate 1/1532 integer-coordinate rays,
0/1520 generic — narrow, but integer coords are what a block-placing being uses. Fix: `t < limit`+eps.
Otherwise exact: **0 disagreements vs a 24×-oversampled brute force on 3,457 rays** (grazing, vertical,
zero-length, through-edit, max-range); `origin-solid`/`range`/`invalid` behave as documented.

## MINOR 6 / 7 — `engine/package.json` gained `./world` but no alias map lists it:
`desktop/electron.vite.config.ts`, `desktop/tsconfig.web.json`, `web/vite.config.ts`,
`web/tsconfig.json` (which carry the "subpaths must precede the bare entry" comment). Latent only
because nothing outside `engine/` imports it yet. — And vault §3's "a test asserts the two agree delta
for delta" (snapshot vs `session.serialize()`) is unbacked: no test mentions `serialize`.

## What held up (re-run, not trusted)

* **Flat A***: 220 random pairs, rugged 384 m world + 50,000 edits, every step re-validated against the
  fine grid and an independent Dijkstra — **0 invalid steps / step-height violations / corner cuts /
  non-neighbour jumps / false paths / false "no path" / suboptimal**; waypoints deterministic on repeat.
  (One flagged false path was my own bounded ground truth; an unbounded flood-fill cleared it.)
* **Invalidation**: 4-page-corner edit drops exactly 4; an 80 m box drops 16; 1,000 edits in one tick =
  1.74 ms (1.7 µs each); undo restores **byte-identical waypoints**; redo reproduces the walled result;
  attach-replay == apply-after-construction.
* **Determinism / replay**: two interleaved-edit runs (40 agents, 1,200 ticks, 3,000 edits mid-run)
  bit-identical in positions and 400 path hashes. `snapshot()` is `{config, edits}` only — 372,940
  bytes of plain deltas, no volume, no base64. After replay, **10,000 random density + material +
  surfaceZ queries: 0 mismatches**; 60 paths identical.
* **Axes**: tower at +x → surfaceZ 21.5, pit at +y → 4.46, control 10.0; `editAabb` z-up extents right
  per verb; no third remap site. **Headless/architecture**: built `@gahalla/engine/world` runs in plain
  Node with every DOM global trapped — only touch is three.js's own `typeof window` guard; root entry
  does not export the service; no `desktop/`/`games/`/worldgen imports; all `.js` suffixes; zero `any`;
  NPC files untouched by the diff.
* **My budgets** (rugged relief, 50,000 edits, 1,024 m, two fresh seeds): sampleDensity built-up
  43.6–45.1 ns (p95 56–61) PASS; cold nav page built-up 0.39–0.44 ms PASS; 32³ mesh built-up 1.86/3.43
  ms median, one seed's **max 5.31 ms** just over the line. **300-agent tick: median 1.84–2.04 ms but
  p95 168 ms, p99 194 ms, max 348 ms; 34–36% of ticks over 8 ms; 14% of replans null.** The 8 ms budget
  holds only because his agents' 15–40 m errands almost never touch a settlement (16 × r30 ≈ 2.3% of
  the 1.96 km² they roam).

## M3 backlog

1. **Search budget, not page budget** — resumable / time-sliced A*, or a per-tick expansion budget
   shared across agents. Nothing else removes the 90–120 ms null query.
2. **Reachability memo** — component ids or a coarse flood-fill cache invalidated by `editBounds`, so
   "no path" costs µs instead of being re-proved per agent per 0.5 s.
3. **Close the second seam** — `terrain` private or read-only; every write through `applyEdit`.
4. **Extent/bounds caps in `validateEditDelta`** so a being cannot commit a world-flattening op.
5. **A distinguishing path status** (`refined` / `reachabilityProven` / `gaveUpAtCap`) in place of the
   constant `complete`.
6. **Nav page eviction + cap** — 1,000–1,536 resident pages (~9–14 MB) after one short run, unbounded;
   `residentPages()` is only a report.
7. **Stale-path signalling** — an edit version / changed-bounds stream; today only a global
   `navInvalidations` counter exists.
8. **Warn when no `surfaceHint` exists.** Confirmed live: on a field without `surfaceZ` the same cell
   answers `surfaceZ=12.00` or `18.50` depending on which query touched the page first — silently.
9. Fix `LineOfSight.ts:125`; add the `/world` aliases; add the snapshot↔serialize test.
