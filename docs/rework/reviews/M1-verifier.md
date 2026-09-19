# M1 (engine half) — verifier: **PASS**, with a backlog

Hostile verification of the uncommitted `forager-continent` work on `rework/2026-09` (base `02f0c89`). No game running → full battery. Scratch harness (`_verify_*` + a `git archive` copy of `02f0c89`'s `src`; no worktree, no junction, no install) deleted; 163 engine files hashed before/after — **identical**. No source edited. `tsc --noEmit` clean; engine **533/42 files**, lab **258/8**, mcp **13/3** — all green.

## 1. Mind untouched — HOLDS
`git diff --stat 02f0c89` over `agent|memory|learning|knowledge|relationships|narrative|consciousness` is **empty**. No `.prototype.` patching, no `defineProperty`, no subclassing of a mind class in `src`. No mind module imports `world/` or `body/`; `PERCEPTION_RADIUS_DAY/NIGHT` (92/38) unchanged. Mind distances are `ReflexMind` literals (`:437` 22→48, `:443` 35, `:149` 6), unmoved.

## 2. Classic bit-identical — HOLDS (but `fingerprint.ts` did move)
`golden-state.test.ts` untouched, 7×2 hashes pass. **`test/fingerprint.ts` is not identical** (+52/−7: `animals?` option, `a.home`, `scenario`/`checkpoints`, `CONTINENT_RUNS`) — additive, default-off for classic, and I proved that by measurement, not reading.

Byte-dump (every entity's components, whole event log, births, all counters, every mind's full object graph, 12 reports + per-agent `agentDetail`/`archetype`; ~2.1–2.6k hashed sections) run against a `02f0c89` tree **in one process**, six configs the engineer never used, 3,000 ticks: `delta-45`, `epsilon-110`, `flags-off-40` (myth/leadership/offerMaking false), `craft-full-35` (`provenance:'full'` + seeded myth/recipe/idea), `interventions-50` (relocate ×2, provisionNeeds, grantItems, authorEvent, mid-run seedMyth), recording mock-LLM cohort (9 conscious of 26, settleCognition). **Zero diverging sections in all six**; record/outcome counts equal. Negative control: two seeds → 1,839 diverging sections, so the harness is not blind.

All 31 `SCALE_TABLE` classic values match `02f0c89` source (0.5 / 1.0 / 2.5 / 3 / 2 / 8 / 12 / 4 / 92 / 38 / 42 / 70 / 7 / 46, 7 speed rows, jitter ±3, bands 4/8, repro 14, co-presence 13, 2400, stride 22). `analyzeSacredPlaces`'s default radius is already 70, so the new explicit arg is a no-op. Classic never sleeps: `ForagerScenario` asks `radius = +Infinity` → `everywhere`, all 64 tiles live every tick.

## 3. Activity regions — HOLDS
I dropped the engineer's 92 m exclusion and compared against a **never-dormant control** (`activityRadius: 60000`), hashing every non-animal entity in full, every animal's **full** component set (`health`/`targetId`/`lastAttack`/`home` — which `{animals:false}` silently drops, not just position), animal *positions* within **256 m** of a living being (2.8× perception, 6× `predatorDetect`), plus the verbatim predator event trace.

- Continent, 80 agents, 2 days, radii **300/768/2000 vs never-dormant**: 0 divergence, identical predator traces → (a)(b)(d)(e).
- Same seed twice: byte-identical → (f).
- Classic + finite radius vs default (classic wildlife is *not* tiled, so full equality incl. animal positions must hold): 256/384/1024 over 3,000 ticks → 0 divergence.
- `regrowthCount` vs a literal transcription of `02f0c89`'s rule: **19,440 cases** (every kind × 8 periods × 9 `from` straddling season/year boundaries × 5 deficits) — exact → (c).

**The one divergence, and why it is not a FAIL.** Classic + radius 256 over a full year (40,000 ticks) leaves 3 plant nodes one stock behind; the 12-day continent run at 400 vs 1600 leaves 5 trees one behind. Every case sits in a tile **asleep at the instant I looked**, 791–2,322 m from the nearest being. Walking a living being to 60 m healed it on the arriving tick (9→10, matching never-dormant) — `tiles.update` (`Runtime.ts:206`) and `resources.step` (`:207`) both precede perception (`:229`). No being can perceive it. An **omniscient reader can**: `exp.resourceNodes()`, the observatory and the lab will render stale stock, and `continent-golden.test.ts` hashes it — so those goldens lock the *activation schedule*, not just behaviour, and will move if `CONTINENT_ACTIVITY_RADIUS` is retuned.

## 4. The continent is what it says — HOLDS, two defects
Sampled independently (8 m height, **4 m** slope, 16 m flood fill): peak **899.2 m** at (5552,2760) = the report exactly; walkable **41.64 km²** vs 41.6; max |∇h| **0.972** at (4056,4112), under the 1.2 bound (a literal in the test, not in `continent.ts`). Flood-fill from the valley reaches 41.6 km² and touches **zero** border cells — no walkable leak. Valley sampled over its **curved** band (the engineer's test scans an axis-aligned box and misses slivers): h **12.0–28.0 m**, width **840–844 m**, no deep water. Three unseen seeds × 150 founders: ore only in `mountain`, never in the valley; salt only on `coast`; no non-`game` node in deep water; **zero** founders outside the valley or in water.

- **Only river 0 reaches the sea** (mouth h −11.6 m, deep water 10 m off). Rivers 1 and 2 end on dry land at **27.3 m** and **18.5 m**, 340 m and 140 m short of deep water, and not in a lake.
- Density parity is single-seed. Engineer: food ×1.29 / wood ×0.94 / water ×1.00. Two unseen seeds: food ×1.21, ×1.17; water ×1.03, ×1.25; **wood ×1.43 and ×0.89** — ×1.43 is outside the (0.65,1.35) band `continent-placement.test.ts` asserts, so that test passes only for its own seed.

## 5. Scale constants — plausible; leftovers listed, not fixed
`moveSpeed 1.4`, 92/38 m sight, reach 2.5–3 m, attack 2 m, social 8 m, co-presence 13 m, repro 14 m, child ≤3 m from the midpoint, predators ×2.8 (wolf 1.23 m/s), detect 42 m, give-up 120 m — all defensible. Still odd: **`inShelterRadius 4 m`** justified as "a hut is ~8 m across" (a forager's hut is ~3 m, so standing outside counts as inside); **`arriveDistance 1.0` under `moveSpeed 1.4`** — a walker overshoots its own arrival threshold every step; **`preyFear 46`** is carried in `BodyScale` and read by nothing on the continent; **`reflexWanderStride` 22–48 m unchanged**, so a continent being re-plans **2.8× as often** (table says so, nothing tests it); `SpatialIndex` `CELL_SIZE = 48` still sized off classic radii ("half the largest, 92") and absent from `SCALE_TABLE`, while `predatorGiveUp 120` now exceeds that 92; `PERCEPTION_RADIUS_DAY/NIGHT` are **dead** (re-exports + the scale test only) yet the test pins the classic column to them; `walkableAreaKm2`, `uplandFromM`, `highlandFromM`, `CLASSIC_PEAK_M` are asserted nowhere despite `scale.ts:278` claiming every measured figure is pinned (their values are right — I measured them).

## 6. Performance + viability — reproduced; the world is too easy
Bench TOTALS: classic **build 0.02 s, 2,067 entities, day 1 in 1.1 s, steady 0.709 ms/tick, heap 18→30 MB**; continent **build 0.19 s, 21,193 entities (20,936 nodes, 960 animals), day 1 in 1.3 s, steady 0.589 ms/tick, heap 32→47 MB** — the 10× world is *cheaper per tick*. 300 beings × 1 sim-day: **2.4 s** of a 90 s budget, 991 ticks/s, heap 67 MB. 12-day life reproduces: 166→303, 219 births, 66 deaths, 234 structures, mean 389 m from the valley, p90 657 m, **only 7 beings ever beyond 1 km**.

The suspicion is right. Classic at the same age (12 days, 150 founders): **173 births / 112 deaths — 74 violence, 31 starvation, 5 sickness, 2 exposure**. Continent: **219 / 66 — 66 violence, zero starvation**. The riparian valley removed hunger as a cause of death outright: +82 % population vs classic's +34 %, and 2.5× the structures (234 vs 94) on abundant valley wood. At 30 days it pins at **320 = `maxPopulation`** — a demographic cap, not a carrying capacity. So yes, unbalanced: predators are the only real mortality, and the people occupy ~1 km² of a 42 km² continent.

## 7. Backlog (input for B4 `space`)
1. **Animals teleport, visibly.** Largest single-tick displacement **236.9 m**, and **156.5 m (a wolf) inside a being's 92 m sight**, against a 1.23 m/tick top speed. Identical at radius 768 and at never-dormant, so **not** a dormancy bug: `ContinentWildlife.settle()` snaps an animal back onto its closed-form loop, and `stepPredator` calls it the moment a chase is abandoned. A 130× jump will be unmissable in the viewer.
2. `SpatialIndex.reconcile` is **22.2 % of a continent tick** (0.244 ms of 1.099 ms at 21,243 entities) vs 2.0 % classic — ungated by `ActivityRegions`, O(all entities), every tick.
3. No wildlife respawn, but attrition is **zero**: 986 animals on day 0 and exactly 986 on day 30, unchanged in every kind. Reflex beings never hunt — the 546 deer are scenery and the ecology runs one way.
4. `Runtime.ts` is **435 lines**.
5. `WorldRegularitiesSystem` and `CoPresenceSystem` are neither tiled nor scale-driven — every seed walked every tick; `CO_PRESENCE_RANGE = 13` is a module constant the table only mirrors.
6. `ResourceNodeSystem`'s untiled fallback is **dead in production** — `SimRuntime` always passes both a tiling and an index.
7. Test gaps: `bench/continent.bench.ts` has **zero assertions** (all five budgets are prose); `continent-activity.test.ts` compares animals once, at the end, against a hard-coded `92`, in two runs that are *both* partly dormant — there is **no never-dormant continent run** in the suite; its classic case has no anti-vacuity guard and at radius 300 nothing ever sleeps (measured 0/64 dormant), so it currently tests nothing; `MAX_DENSITY` is pinned to a remembered literal (2374) because `DENSITY` is unexported; `continent-placement.test.ts` carries an unexplained `(6200,5200)` with divisors `0.69`/`1.54`.

**Verdict: PASS.** Mind diff empty; classic bit-identical on six unseen configs; no activity-region divergence perceivable by any being. Items 1, 2 and 6 are the real follow-up.

---

# Round 2 (M1b) — verifier: **PASS**, with a backlog

Hostile verification of the uncommitted M1b work, base `5975770`. No game running → full battery. Scratch harness (`_verify_*` + a `git archive` copy of `5975770`'s `src`; no worktree, no junction, no install) deleted; 166 engine files hashed before/after — **identical**. No source edited. `tsc --noEmit` clean; engine **544/44 files**, mcp **13/3** green. Lab left alone (another engineer's).

## A. Mind empty, classic byte-identical — HOLDS
Mind diff `git diff --stat` is **empty vs `5975770` and vs `02f0c89`**. Byte-dump (entities, event log, minds, births, counters, 12 reports, per-agent detail/archetype; ~2.1–2.7k sections) old-vs-new in one process, **6 unseen configs × 3,000 ticks** + the 3 golden configs: **0 diverging sections** everywhere. One config was built to hit exactly what M1b touched in classic code — 33 structures, death-drop containers, host `relocate`, `grantItems` — and `staticDrift` stayed **0**. The walker clamp is provably inert in classic (stride 0.5 < arrive 1.0) and the dump confirms it.

**The static/dynamic split, measured.** Supported path (`relocate` → `markMoved`): correct on the **next tick**, old cell cleared. A being moved by a raw write is still re-homed in **1 tick**. The unsupported path — a host writing `t.x` on a *static* entity with no `markMoved` — leaves the index wrong for **159 ticks** (bound 256) and is counted in `staticDrift` (1), not silent. Nothing in the engine takes that path; it is a host-contract risk, and `staticDrift` is a counter no runtime code reads.

## B/C. Activity regions and the teleport invariant
**Claim 1 verified, harder than claimed.** My own watcher (theirs checks the raw transform only; mine also checks `settled.positionOf`, the position the lab renders) over **202,553–421,388 watched animal-ticks** at radii 300/768/2000 and a second seed: worst in-sight single-tick move **1.2320 m — exactly the wolf's speed**, raw *and* settled, in every run. Round 1's 156.5 m in-sight wolf teleport is gone. Zero animals vanished in sight.

**Ledger/id stability — HOLDS.** At 8 days, radii 300/768/2000 vs never-dormant: **20,139 entities and 947 animals, rosters identical to 6 dp**. Respawn is genuinely radius-independent.

**THE CRACK: re-anchored predators are radius-dependent.** `reanchor` sets `px = θ − wx·tick` (`ContinentWildlife.ts:186`), so the phase depends on *which tick* the chase was observed to end — and a predator is only stepped while its tile is awake. `settled` cannot repair it, because the divergence is baked into `home`, which is state, not a closed form. Measured, 12 days, 80 agents, full state through `settled`, no exclusions: radius 300/768 each differ from a never-dormant control in **2 animal sections**; settled positions **14.0 m** and **33.8 m** apart, one run holding `targetId=19988` where the control holds `0`. Reproduced on a second seed at 6 days (default radius: 1 animal; 400: 2; 1536: 0). Nearest living being **752–1392 m** — so **nothing perceivable, not a FAIL** — but claim 7 as written is false.

**And the golden's radius-independence is an artefact of its checkpoints.** At 1200/3000 the digest is identical at 400/768/1536/3000/**60000** — I added the never-dormant control the engineer omitted, and it agrees. At deeper checkpoints it does not: at **tick 16,800** the digest is `e5a6cbfd…` (r400) / `f7ef8d26…` (r768) / `e77e192b…` (r1536 **and** never-dormant); same split at 28,800. So "`CONTINENT_ACTIVITY_RADIUS` can be retuned without any of these values moving" is true to 1.25 days and false by day 7.

## D. Ecology — real, reproducible, and the derivation is seed-specific
`FOOD_PER_BEING_DAY` recomputes to **1.16160** items/day from the code's own constants, not the reported 1.153. **`6.29` is not a constant** — `solveSlowdown` re-runs the valley scatter per seed; across five seeds it is **5.83 / 5.97 / 6.02 / 6.10 / 6.46** (berry 1282–1421 ticks), and `placement` and `bench-valley` both give ≈5.83/6.02, so 6.29 is some other seed's value.

Two unpublished seeds, 120 founders, 30 days — the pattern reproduces, it is not a lucky seed. Starvation first appears **day 14–16** (seed A: 12 by d16 → **100** by d30; seed B: 1 by d14 → 39 by d30). The population **overshoots and corrects**: A 134 → peak **463** (d28) → **398** (d30); B 136 → **318** → **295**. `maxPopulation 4000` is never approached. They spread, but not far: p90 627→1008 m, `>1 km` 0→43.

**Starvation happens beside uneaten food.** At day 30, seed A: food nodes within 500 m of the valley hold **0 items across 228 nodes**, while 1–2 km out **1,240 nodes hold 5,793** and 2–4 km out **3,007 hold 14,285**. Seed B: 95 items inside 500 m against 14,287 at 2–4 km. The valley is stripped bare while ~26,000 items sit within an hour's walk. Carrying capacity is derived for the valley; the beings' 92 m sight and 22–48 m reflex stride cannot reach the rest.

Against classic at the same age (12 d, 120 founders, same seeds): classic already kills by hunger (**19–20 starvation deaths**) where the continent still has **zero**. Per-capita births/day continent-vs-classic: 0.109 vs 0.067 (A), 0.090 vs 0.106 (B) — now comparable, where M1 was uniformly easier. M1's "no starvation ever" is fixed; onset is ~2 weeks late.

## E. Rivers and parity — both fixed, independently confirmed
All three mouths are **below sea level** (−4.43, −5.27, −4.13 m) with open sea **within 5 m**, and **zero dry samples** along each full course. Round 1's two rivers ending on dry land at 27.3 m and 18.5 m are gone. Caveat: on a 2 m walk the *carved height field* is not monotone — **136 / 56 / 74 uphill steps, worst +0.64 m**; the engineer's monotonicity test walks `riverBedHeight`, a running minimum that is monotone by construction, not the ground the world renders.

Parity on **10 fresh seeds** against a pooled classic baseline (food 8.72 / wood 3.27 / water 1.46 per founder): food **0.85–1.04**, wood **0.72–0.83**, water **0.92–1.26** — all inside 0.65–1.35. Round 1's wood ×1.43 blowout is gone, though wood is now **one-sidedly low** (never above 0.83).

## F. Performance — better than claimed
At 300 beings, M1 → M1b: continent **0.788 → 0.580 ms/tick**, reconcile share **24.2 % → 1.2 %**; classic **0.883 → 0.774 ms**, reconcile **1.8 % → 0.3 %**; `staticDrift` 0 in both. The 256-tick audit costs 0.134 ms, **0.09 % amortised**. Bench re-run passes its 10 new assertions: classic 0.396, continent 0.300 ms/tick (budget 0.8), ratio 0.76 (budget 2.5), build 0.02/0.15 s (budget 10), 300 beings × 1 day 1.5 s (budget 90). The assertions are live — the same expression at a 10 %-tighter budget fails — but slack runs 1.9× to 500×.

## G. A node born into a dormant tile — not reachable
Every node is created full (`createResourceNode` sets `maxStock = stock`), so `stockOf`/`step` see `deficit ≤ 0` and the `lastStepped` fast-forward never applies; only a being can deplete one, and a being lights the tile. Measured over 8 days at radius 300 with **902/1024 tiles dormant**: **0 settled-stock disagreements** against a never-dormant control across 20,281 entities, 0 nodes over `maxStock`.

## Backlog
1. **A respawned animal materialises in plain sight.** The invariant test exempts it verbatim (`if (!was) continue; // born this tick`). I killed 23 animals inside the founders' eyesight; **18 of the 23 replacements appeared inside a being's 92 m sight, the closest 15.9 m away**. Placement is uniform in the dead animal's 256 m tile with no regard for who is standing there. Conservation is exact and radius-independent, so this is not a determinism bug — but "animals do not teleport" only covers animals that already exist. I did not treat this as the FAIL condition because the stated invariant is about movement; if the owner counts a materialisation, this is the item.
2. **Re-anchor phase is tick-dependent** (B/C above) — the one thing `settled` cannot settle. Fix by deriving the phase from a quantity that does not depend on when the tile woke, or by re-anchoring on a schedule the dormant path can replay.
3. **Golden-radius test needs a deeper checkpoint and a never-dormant arm** — as recorded it cannot see (2).
4. **A sprouted plant bypasses the slowdown**: `WorldRegularities.ts:74` calls `createResourceNode('foodPlant', 4)` with no third argument, so on the continent it regrows every **220** ticks against every scattered food node's ~1,300 — ~6× faster. Unexercised in my runs (beings planted no seeds) but live in code, and outside `solveSlowdown`'s accounting.
5. **`staticDrift` is measured and ignored** — nothing reads it at runtime, and a host that breaks the contract is wrong for up to **159 ticks** before the audit.
6. **`reanchor`'s `if (smallest) return;` is unreachable** (the `smallest` branch always returns at `k = 0`).
7. **The slowdown is seed-solved but documented as a constant**; no test pins it, and `continent-placement.test.ts` re-derives it with the same arithmetic over the same scatter, so it checks `solveSlowdown` against itself.
8. Cheaper test gaps: the engineer's never-dormant arm runs **2,400 ticks** and 60,000 is a finite radius, not `everywhere()`; `continent-rivers.test.ts`'s "10 seeds" loop runs 10 identical iterations of unseeded module functions; `walkableAreaKm2` is pinned by the same probe that produced it; `MAX_DENSITY ≥ 2374` compares against a row *sum* while its comment reasons about a single kind.

**Verdict: PASS.** Mind diff empty; classic byte-identical on nine configs including one built for the static-index change; no being-perceivable activity-region divergence; the in-sight teleport is gone at 1.2320 m over 400k+ watched animal-ticks. Items 1 and 2 are the real follow-up.
