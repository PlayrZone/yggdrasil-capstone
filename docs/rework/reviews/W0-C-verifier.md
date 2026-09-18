# W0-C — hostile verification of the `SpatialIndex` optimisation

**PASS** — 0 divergences, 2 MEDIUM + 5 LOW latent defects, none reachable from shipped code. Engine suite 132/132 (18 files, 11.8 s), `tsc -p tsconfig.json --noEmit` 0 errors.
Tree restored: `git diff --stat 0a5b6a9 -- packages/engine` byte-identical before/after (15 files, +236/−141); `git status --short` hash `df0e8490` unchanged; `SpatialIndex.ts` SHA256 `18D5AC0D…` before and after the spot-checks. Scratch tests deleted, `git worktree remove --force` done (`git worktree list` = main only). The whole-tree `git diff` hash moved (`a0ea43f`→`3ac8e08`) **only** in `packages/lab/src/renderer/**` + `docs/rework/CAMPAIGN.md`, written 13:57–14:03 by the other agent; every `packages/engine` file kept its pre-session mtime.

## Independent equivalence — the claim holds

I did **not** use `test/fingerprint.ts`. I built `git worktree add --detach <temp> 0a5b6a9` outside the repo (node_modules junctioned, no install), wrote my own canonical dump (every entity's *whole* component record via sorted-key serialisation — not a hand-picked field list — plus every mind's memories / knowledge / relationships / narratives / goals, the event log in order, births, deaths-by-cause and all run counters, hashed per section), and ran identical scenario code in both trees.

| configs | seeds/sizes the coder never used | ticks | checkpoints | result |
|---|---|---|---|---|
| 8 short | 45, 33, 28, 55, 40, 3, 24, 18 agents; `mythBehavior:false`, `leadership:false`, `offerMaking:false`, `craftLearning:true`, seeded myth + 2 seeded recipes; 2 host-driver runs that write `Transform2D` **directly** between `advance(1)` calls (scatter every 37 ticks, pile-into-one-patch every 53) | 2 000–3 500 | 22–30 each | **identical** |
| 2 long | 60 agents craft+myth (14 000 t), 90 agents plain (10 000 t) | 24 000 | every 500 | **identical** |

The long runs exercise the paths that matter: births 29/28, deaths `{starvation:3,violence:3}` / `{violence:10,starvation:3}` (predator kills), 49/65 structures, 1 104 crafts, 1 534/2 137 shares, 2 665/2 370 knowledge records, ~2 000 entities. Old and new agreed on every counter and every section hash at every checkpoint. **No divergence found — the bit-identical claim survives.**

## Bench — reproducible, honest, understated

Re-ran `bench/spatial.bench.ts` on the new tree, and the same timed pass verbatim against `0a5b6a9` (seed `bench-spatial`, same sizes/tick budgets). Entity counts matched exactly (1987 / 2307 / 3427), proving the same world.

| beings | before (0a5b6a9) | after | speed-up |
|---|---|---|---|
| 100 | 284.1 ticks/s | 6 143.2 | 21.6× |
| 300 | 46.3 | 2 471.2 | 53.4× |
| 1000 | **9.3** | **408.2** | **43.9×** |

The claimed 14.5 → 366 is conservative against my machine's numbers; direction and order of magnitude reproduce. Nothing is skipped that a real run performs (reflex-only, as the goldens and the lab default are).

## Defects

**D1 · MEDIUM · losing `Transform2D` un-lists an entity from `each()`/`count()` entirely.** `componentRemoved` routes `'Transform2D'` to `remove(entity.id)` (`src/core/SpatialIndex.ts:115-119`), deleting the record and every bucket listing. The class header promises the opposite (`:60-62`: "An entity with no `Transform2D` is still listed under its components (`each` and `count` see it, as a full scan did)"), and `test/spatial-index.test.ts:49` only covers an entity that *never* had one. Repro: `place(world,100,100)` with `Mark` → `world.removeComponent(e.id,'Transform2D')` → scan finds `[1]`, `each('Mark')` yields `[]`, `count('Mark')` is `0`. Aggravator: while the record is gone, `componentAdded` for any other key silently returns (`:109-110`), so `addComponent(e.id,'Other',{})` leaves `count('Other') === 0`. A seeded churn loop lost 3, then 7, then 14 entities against the scan. **Unreachable today:** `World.addComponent`/`removeComponent` have *no* caller in `packages/engine`, `packages/mcp` or `packages/lab` (whole-repo grep). Fix: keep the record, null its `transform`, and drop it only from cells.

**D2 · MEDIUM · a query centred at ±Infinity never returns.** `within`/`anyWithin` walk `for (cx = floor((x-r)/48); cx <= floor((x+r)/48); cx++)` (`:148-152`, `:185-189`); with `x = Infinity` both bounds are `Infinity` and `Infinity + 1 === Infinity`. Verified out of process: a single test doing `world.spatial.within('Mark', Infinity, 0, 50)` was still spinning at 25 s and had to be killed (PID 72212); the full scan it replaced returned `[]` instantly. A non-finite *radius* hangs the same way. **Unreachable today:** `clampToWorld` (`src/world/regions.ts:120`) collapses `±Infinity` to the wall, and every engine radius is a constant ≤ 92 — but a host writing `Transform2D` directly (the sanctioned driver pattern) can wedge the process. Fix: one `Number.isFinite` guard on centre and radius.

**D3 · LOW · query cost is O((2r/48)²) map probes, independent of population.** Measured over 300 entities: `r=92` 0.001 ms, `r=2000` 0.138 ms, `r=20000` **9.3 ms**, versus 0.004 ms for a brute scan of the lot. Safe at today's radii; a future world-wide query would be slower than the scan it replaced.

**D4 · LOW · the index caches the `Transform2D` *object* (`:33`, `:81`), so replacing it desyncs past `reconcile()`.** `reconcile` (`:135-140`) compares the live transform against the record's cached copy — but it reads that copy *through the same stale reference*, so an object swap is invisible forever. Repro: `e.components['Transform2D'] = {x:1500,y:1500}` → `reconcile()` → scan `[1]`, index `[]`. Nothing in engine/mcp/lab replaces a component object; `World.addComponent` handles it correctly. Worth one line in the header's "staying in sync" contract.

**D5 · LOW · in-place iteration diverges from the live-`Map` scan under mutation.** `each()` walks `bucket.all` with `for…of`, so removing an *already-visited* entity skips the next one: `each = [1,2,3,4,5,7,8]` vs `scan = [1,2,3,4,5,6,7,8]` (removing id 2 while at id 5). A `within`/`anyWithin` predicate that moves entities visits half of them (5 of 10). All current callbacks are pure or collect-then-mutate, and the header warns about *creation* only — extend it to removal and moves.

**D6 · LOW · the visit counter hides `reconcile()`.** `reconcile` walks every record once per tick (~3 427 at the 1000-being row, ≈ 28 % of the reported 12.4 k visits/tick) and is not counted; empty-cell probes aren't either. The wall-clock ticks/s *does* include it, so the headline is sound — but "visits/tick" is not a complete work metric. State that in the bench header.

**D7 · LOW · the headline bench size skips one of the rewritten loops.** `reproduce()` returns at `aliveCount() >= MAX_POP` (320) (`src/runner/Experiment.ts:549`), so at `agentCount: 1000` the rewritten reproduction pairing never runs. `coPresencePass` is measured; reproduction is only measured by the 100/300 rows.

**D8 · NIT (step-1, not "pure optimisation") · two real behaviour changes rode in.** `NarrativeStore.seed` now takes `Math.min(existing.firstTick, tick)`, so re-seeding a myth mid-run no longer resets its age; `remember` drops a story with a non-finite/negative origin *including its `timesHeard` increment* (`test/narrative-store.test.ts` asserts both). Both are correct and deliberate, and `AgentMind.observe`'s new sanitisation (`src/agent/AgentMind.ts:106-107`) makes the refusal unreachable from engine paths — my 10-config equivalence confirms zero effect. But researchers' seeded-myth protocol changes: flag it in the campaign log rather than leaving it inside an "optimisation" commit. The `copyRule`/`craftInputs` aliasing fixes are correct, tested (`knowledge.test.ts`, `craft.test.ts`) and behaviourally inert.

## Spot-checks (broken, observed red, restored exactly)

1. `reconcile()` body disabled → `spatial-index.test.ts` "reconcile catches a position written by someone who never told it" fails (`expected [] to deeply equal [1]`). Restored.
2. `found.sort(byId)` removed from `within` (`:163`) → `spatial-index.test.ts` ×2 **and** `golden-state.test.ts` alpha-70/beta-70/gamma-70 fail. The goldens genuinely bite on canonical order. Restored; file hash back to `18D5AC0D…`. (Coverage note: the three 20-agent goldens did *not* move — order only bites at density.)

## Verdict

The optimisation is what it claims: I could not produce a single behavioural divergence across 10 configurations, 24 000+ long-horizon ticks, option switches, seeded culture and two direct-`Transform2D` host drivers, and the benchmark reproduces from the base commit with the claimed harness. **PASS.** D1 and D2 are real bugs in new code and should be fixed before `SpatialIndex` is exported to hosts (`src/index.ts:9`) — neither is reachable from the engine as it stands, so neither blocks this landing.
