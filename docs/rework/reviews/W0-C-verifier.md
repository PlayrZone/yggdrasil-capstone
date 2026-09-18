# W0-C — hostile verification of the `SpatialIndex` optimisation — **PASS** (round 1) · **PASS** (round 2 hardening)

## Round 1 — the optimisation

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

---

# Round 2 (hardening)

**PASS** — D1, D2, D3, D4, D5, D6 all independently confirmed fixed; 0 behavioural divergences; 1 LOW residual + 1 perf note, neither blocking.
Scope: only `src/core/SpatialIndex.ts`, `test/spatial-index.test.ts`, `bench/spatial.bench.ts` (working tree over `ffc2efb`). Another coder is mid-flight in `runner`/`scheduler`/`consciousness`/`training`/`mcp`/`home` (plus new `src/record/`, `src/version.ts`) — excluded from this review and **nothing of theirs is red**: the live tree runs 150/150. Proof of "tree as found" is per-file SHA256 of the three fenced files, identical before and after my work: `45131350…` / `16d71eca…` / `84104603…`. Two temp worktrees created and removed (`git worktree list` = main only); scratch tests deleted; only my own PIDs killed, by PID.

## Independent re-attack on the fixes

I wrote my own probes again rather than trusting `test/spatial-index.test.ts`; 10 tests, all green, including a **900-step randomised model test** that cross-checks `within`/`anyWithin`/`each`/`count` against a live full scan at 129 points while churning creates, removes, component add/remove, `Transform2D` add/remove, tracked moves, silent moves + `reconcile`, object swaps (to NaN / ±Infinity / ±3M coordinates) and `clear()`.

| round-1 defect | round-2 result |
|---|---|
| **D1** losing `Transform2D` un-lists from `each`/`count` | **fixed.** `componentRemoved` now nulls `transform` and calls `settle` (`:150-163`), keeping the listing. `each`/`count` equal the scan through remove → re-add → re-grid; a component added while unpositioned now lands (round-1 silent no-op gone, `componentAdded` falls back to `insert` at `:136-139`). |
| **D2** ±Infinity centre/radius hangs | **fixed.** `Number.isFinite` guards on centre and radius (`:192`, `:245`) return `[]`/`false`. All 42 combinations of {finite, NaN, ±Infinity} centre × {0, 10, 5000, NaN, ±Infinity} radius terminate and match the scan. Non-finite *positions* now behave as "no position" (`settle:315`) yet stay listed — matches the scan for every reachable case. |
| **D3** O(radius²) cell walk | **fixed by fallback.** `(cells > bucket.all.length)` switches to the bucket scan (`:200`, `:252`). `r` = 92 / 2 000 / 20 000 / 1e6 / 1e12 all exact and < 50 ms where 20 000 alone cost 9.3 ms before. Bonus: a **negative** radius now matches the old `r2 = radius*radius` semantics instead of returning empty. |
| **D4** cached `Transform2D` object | **fixed.** `reconcile` re-reads the component off the entity (`:179-186`), so a swapped, dropped or directly-added object is picked up — including a swap to numerically identical values. |
| **D5** mutation during iteration | **fixed for `each`.** Snapshot + per-record liveness re-check (`:287-289`): removing an already-visited entity no longer skips the next; removing an unvisited one skips exactly it, as the live-Map scan did; removing self and creating mid-walk are both well defined. `anyWithin`'s predicate is now explicitly documented as required-pure (`:94-96`) rather than silently lossy. |
| **D6** counter hid `reconcile` | **fixed.** `reconcile` adds `records.size` (`:177`). Verified directly (31 records → 31 visits) and by arithmetic in the bench: visits/tick at 1000 beings rose 12.4k → 15.8k, i.e. +3.4k ≈ the 3 427 records reconciled per tick. The bench header now states that the metric counts entities, not work. |
| **D-pack** (round-1 analysis) | `cellAxis` clamps to ±32 767 cells (`:34-37`), so packed keys can no longer collide. Verified exact against the scan for coordinates at ±2M, ±1.57M (the exact bias boundary), 1e12, `MAX_SAFE_INTEGER` and 1.7e308, including two distinct far points sharing one edge cell, with no leakage into a near query. |

## Equivalence, index isolated

To keep the other coder's in-flight engine edits out, I compared a worktree at `0a5b6a9` against a second worktree at `ffc2efb` with **only the three fenced files** copied in (`git status` in it showed exactly those three, nothing else). Same independent fingerprint as round 1 (whole component records, every mind's stores, ordered event log, births/deaths/counters).

4 configs — `craft-55` (seeded myth + 2 recipes, `craftLearning`), `relocate-cluster-18` (host piles every being into one patch every 53 ticks), **`swap-object-22`** (new: the host *replaces* the `Transform2D` object every 29 ticks, the exact D4 hazard), `long-craft-60` (14 000 ticks: 29 births, 3 starvations, 3 predator kills, 49 structures, 1 104 crafts, 2 665 knowledge records) — **86 checkpoints × 4 sections, all identical.** 23 900 ticks total. Isolated tree: 140/140 tests (goldens untouched), `tsc --noEmit` clean.

## Residual

**R1 · LOW · `each` re-checks the record, not the component.** `:288` tests `records.get(id) === record`, so an entity whose *component* is removed during the walk is still visited: `each = [1,2,3,4,5,6]` vs `scan = [1,2,3,4,6]` when the callback drops `Mark` from id 5. Unreachable (no caller of `World.removeComponent` in engine/mcp/lab) and arguably outside the header's "still present when reached", but the phrase reads as membership, not liveness. One `key in entity.components` check would close it.

**R2 · NOTE · small-population throughput slipped, headline unchanged.** Same machine, same session, same harness — before hardening → after: 1000 beings **408.2 → 409.3** ticks/s (unchanged, still 44× the 9.3 baseline), 300 beings 2 471 → 2 394 (−3 %), 100 beings **6 143 → 5 309 (−14 %)**. The 100-being cost is `each`'s per-call `.slice()` plus the per-visit `records.get`, paid over ~2 000-entity buckets several times a tick, and the fallback path being taken at small bucket sizes. Well inside the win; worth knowing before someone optimises `each` again.

## Round 2 verdict

Every defect I raised is genuinely fixed, not papered over — I re-broke each one my own way and could not reproduce any of them, and the fixes cost nothing in behaviour across 23 900 ticks of index-isolated comparison including a driver that swaps position objects wholesale. **PASS.**
