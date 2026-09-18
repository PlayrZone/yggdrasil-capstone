# W0-E — hostile verification of the memory-FOOTPRINT bound — **PASS**

**Golden re-record: JUSTIFIED (archive-only).** The only old-vs-new state difference I can produce anywhere is the archive and the dead's episodic records — the two tiers this item exists to free. The digest hashed them (`memory.all()` = hot+archive), so it had to move; and the new digest is *stronger*, not weaker — deleting the tally fold reddens **7/7** goldens.

Scope: I compared `3f6049c` against `3f6049c` + **only this item's five src files** in a temp worktree, to keep the other engineer's in-flight `consciousness`/`record`/`training` edits out. No source edits in the repo; every break was done in a throwaway worktree. Tree-as-found: SHA256 of all ten fenced files identical before/after (`MemoryStream` `25845e49…`, `AgentMind` `078a40bc…`, `archetype` `ccc006c4…`, `Experiment` `aec172dd…`, `fingerprint` `7ca184dc…`, `golden-state` `b029e0b6…`, `memory-bound` `ed4c6988…`, `memory.bench` `5a87a637…`, `bench/vitest.config` `1249a01f…`). `src/index.ts` is the one exception: it moved mid-session because the other engineer added `training/dedupe|leakMatch|leakTraps` exports — W0-E's two lines there are untouched. Both worktrees removed (`git worktree list` = main only), scratch deleted, no stray PIDs.

## 1 · Independent equivalence, archive excluded — 0 divergences

My own fingerprint, not `test/fingerprint.ts`: the **whole** component record of every entity (recursive sorted-key serialisation, no hand-picked field list); for every mind living **and** dead — knowledge, relationships, narratives, goals, `totalCount`; for **living** minds the hot tier via `recent()` in exact internal order; the ordered event log; births, deaths-by-cause, all counters; every facade — `analysis`, `society`, `culture`, `myth`, `sacredPlaces`, `leadership`, `beliefBehavior`, `institutions`, `agentDetail`, `consciousState`, `agentKnowledge`, `archetypeOf` **per being incl. the dead** — plus the sink's manifest/records/outcomes/summary for the recorded runs.

10 configs the engineer never used (seeds `verify-*`; 7/16/18/26/33/40/45/60/95/110 agents; **64 300 ticks, 572 beings, 96 deaths, 552 births**, multi-generation turnover; `craftLearning`, 2 seeded myths + 2 seeded recipes, `mythBehavior`/`leadership`/`offerMaking` all off, a host driver doing `relocate`/`provisionNeeds`/`grantItems`/`giveIdea`/`authorEvent`, a deliberate 26-death famine, and two mock-LLM conscious cohorts with **recording ON**, one of which starves a third of the cohort *while thinks are in flight*). **1 794 section comparisons, 0 divergences.**

Sensitivity proved, not assumed: re-run with the *dead's* records included, it diverges in exactly **20 `hotRecords` sections and nothing else** — the pipeline does see the freed tier, and that tier is all there is. `archetypeOf` matched for all 572 beings at every checkpoint, base computing it from the full record history and new from the tally: **item 4 answered on real runs, not a fixture.** The tally is bounded — keys are `SimEventType` (28) × `ObjectKind|'*'` (39), closed unions, never ids; 646 dead minds' streams measured at **0.9 MB total**.

## 2 · Did anything read what was dropped? No — but provenance now dangles

Whole-repo grep (engine, lab incl. `sim/host.ts`, mcp, home, db): `MemoryStream.get()` has **zero callers anywhere**. `memory.all()` had exactly one src caller — `Experiment.archetypeOf`, now replaced. Outside the engine the only mind reads are `relationships.asMap()` (lab ties view) and `memory.all()` in one lab test on a *living* agent (30/30 green). `record/` reads knowledge and body, never memory; `serialize.ts` deep-copies the `recalledMemories` handed to it at submit time, so a think landing after death is unaffected.

**D1 · MEDIUM (backlog) · knowledge provenance now dangles.** `sourceMemoryIds` is written by all five miners and resolved by nothing — no inspector, no analysis, no MCP tool, no v2 `thinkInput`. But it *was* resolvable: base `get()` searched hot+archive, so every id hit. Measured (24 agents, 4 000 ticks): 196 knowledge records, 1 039 source ids — **0 unresolvable at base, 47 (4.5%) now**, rising with run length and **100% for every dead being**. Worse than the rate suggests: `ProvenanceSample` keeps *first 4 + last 4*, and the first four are precisely the oldest evidence — the part eviction takes first. A future "walk the provenance" observatory can no longer be built from the live object graph; it needs the run DB. Put that in the roadmap now rather than discovering it later.

## 3 · Ordering at death — clean

`bus.on` appears **four** times in the whole repo, all in the `Experiment` constructor; `entomb` is genuinely last (`Experiment.ts:333`). `bus` is public so a host *could* register later — none does. `body.alive = false` is set before `die()` emits on both death paths (`YggdrasilSystem.ts:208`, `:612`), `witnessesOf` filters `IS_ALIVE`, the tick loop skips the dead, `injectIdea` and the async-think apply are both gated on `alive`, and the dying being's own final story (`:326`) runs two listeners earlier into `narratives`, which survives. Double death is impossible (alive-guard + `continue`) and `entomb()` is idempotent anyway. An entombed mind survives `consolidate()`, `think()` and a later `append()` without throwing or resurrecting state. The 96 deaths above — 29 of them violent, i.e. mid-tick kills — produced no divergence, and the conscious-cohort famine covers die-mid-think.

**D2 · MEDIUM (backlog, unreachable) · `authorEvent` can entomb a LIVING being.** `authorEvent({type:'AgentDied', actorId:<alive>})` now reaches the listener: measured hot **620 → 0**, learners **4 → 0**, `alive` still `true`, and over the next 3 000 ticks its knowledge stayed at 3 while a peer reached 6 — permanent amnesia *and* permanent inability to learn, since `observe()` then feeds an empty `learners` and `consolidate()` mines nothing. Base: 620 → 621, learners 4. `authorEvent` has no caller in engine/lab/mcp/home, so this is unreachable today, exactly like W0-C's D1/D2 — but it is a research-driver API and a driver authoring a death is not far-fetched. Fix: gate the listener on `!alive`. (Nit, same door: `memoryFromEvent` casts `payload['objectKind']` unvalidated, so an authored event can mint arbitrary tally keys — still strictly smaller than the unbounded archive it replaced.)

## 4 · The bound is real; "plateaus" is the wrong word

Re-ran `bench/memory.bench.ts` myself, heap capped at 3 GB, one run at a time, both trees.

| seed `bench-memory`, 150 agents | day 4 | day 8 | **day 16** | day 24 |
|---|---|---|---|---|
| base `3f6049c` | 66.8 MB | 130.8 MB | **280.8 MB** | — |
| with W0-E | 61.0 MB | 81.3 MB | **97.1 MB** | 127.3 MB |

**282 → 97 MB reproduces exactly**; dead minds' held records go 63 541 → **0**. But it does not plateau: day 16 → 24 is 97 → 127 MB, because the living population grew 179 → 233 minds. The honest claim is *retained episodic memory is now a function of the LIVING population, not of run length* — which is what `memory-bound.test.ts` actually asserts. Pushed to **256 agents / 30 sim-days** (129 s): heap peaks **156.7 MB** at day 10 (308 living) and is **79.7 MB** at day 30, with **1 560 828 memories formed, 90% by the 646 dead**, who retain 0.9 MB between them; at base's measured ≈0.8 KB of heap per retained record that run would have carried ≈1.2 GB of episodic records alone.

**What grows now:** dead beings' `KnowledgeStore` (then `NarrativeStore`, `RelationshipStore`), linear in cumulative deaths. By the bench's own estimator: 80→186 dead = +14.0 MB/100, 186→262 = +14.1, 508→646 = +15.4 → **≈15 MB per 100 deaths, ~80% of it knowledge**. `deepSize` double-counts strings shared between minds (it claims 105 MB of tombstones inside a 79.7 MB heap), so size the follow-up at **6–15 MB of heap per 100 deaths**.

## 5 · Suite, typecheck, spot-checks

Engine **191/191** (20 files, 16 s) on the live tree — nothing red in the other engineer's in-flight areas. `tsc -p tsconfig.json --noEmit` 0 errors (that project is `include: ["src"]`, so `test/` and `bench/` are not typechecked by it). Lab `simHost` 30/30. The re-recorded goldens reproduce bit-exactly from `3f6049c` + this item's five files alone, so the recorded values carry none of the other engineer's work.

Broken, observed red, restored to identical SHA256: (1) `entomb` no longer calls `release()` → `memory-bound` fails *"expected 458 to be +0"*; (2) tally fold deleted from `append` → `memory-bound`'s archetype test falls to `wanderer` **and 7/7 goldens go red**; (3) `evictCount /4 → /8` → 3/7 goldens red; (4) `entomb` also wipes `knowledge` → 5/7 red. Coverage note: `RECENCY_HALF_LIFE 2000 → 1900` moves **no** golden — `retrieve()` is read only by `think`, which the reflex goldens never consult. Pre-existing gap, not this item's; worth one conscious golden.

## Verdict

The archive was dead weight, the tombstone keeps exactly what still has a reader, and I could not find a single behavioural divergence outside the freed tier across 64 300 ticks, 96 deaths and 1 794 section comparisons. The re-record is honest and the lock came back stronger. **PASS**, with D1 (dangling provenance — a real loss for the observatory) and D2 (`authorEvent` entombing the living — one `!alive` guard) as backlog, and the follow-up sized at ≈6–15 MB of heap per 100 deaths in the dead's `KnowledgeStore`.
