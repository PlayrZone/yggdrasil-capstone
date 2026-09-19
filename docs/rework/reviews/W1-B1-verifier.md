# W1-B1 — hostile verifier: **PASS** (with a backlog)

Verified 2026-09-18 against base `d661380` (temp worktree, junctioned `node_modules`, removed junction-first; shared pnpm store re-counted intact). No source edited: all 28 item files hash-identical before/after (`docs/rework/CAMPAIGN.md` moved — the L3 agent appended it.2m, not me). Scratch `_verify_*.test.ts` deleted.

## 1. Behavioural identity — independently, on 8 configs the engineer never ran
`verify-hostile-1…6` (18–30 agents, 2000–2400 ticks, leadership on/off, myth off, provenance off/full, craftLearning, seeded myth+recipe+idea), a 10,200-tick run crossing the season **and** year boundary, and a `MockMindBackend` conscious cohort (6 of 16) with the recorder on. Dump per config at two checkpoints: `fingerprintOf` **plus** every entity/component, every mind's held memories (id, tick, type, origin, outcome, **importance**, toldBy, causedBy, subjects, summary), knowledge (ids, order, statement, confidence, provenance ids), relationships, narratives, goals, the ordered event log, births/deaths/counters, and 14 analysis facades; plus the full corpus (manifest, summary, 93 records, 93 outcomes) with injected `now`/`nowMs`.
Driven deliberately through the blind spots via `authorEvent`/`grantItems`/`provisionNeeds`/`relocate`: 37 `ReceivedItem` memories from `GaveItem`, 5 `WasAttacked` from `AttackedAgent`, 14 `causedBy` from witnessed killings, 48 witness fear-moves, 16 respect-moves with `leadership:true` vs **0** with it off, 57 `toldBy`, the three non-causal ids, an authored `AgentDied` (entomb path).
**Result: 37,366,804 bytes, byte-identical base vs new.** No divergence anywhere.

**Cognition curves, bit for bit.** Old expressions transcribed by me from `git show d661380:.../Runtime.ts`, not from the fixture. ~162k points (curiosity 0→100 step 0.125 × ambition step 0.5) plus ~24k points constructed to land exactly on each curve's `.5` rounding boundary: `Object.is`-equal everywhere. `(c+a)/2` vs `0.5c+0.5a` is exact (halving is a power-of-two scaling), and `180 - x` vs `180 + (-1)·x` likewise.

## 2. Table fidelity — every entry diffed against d661380 source
`BASE` (29 saliences + order), `EVENT_DELTAS` (7, incl. the empty `SleptSafely`), `OBSERVER_APPLICABLE` (`{WitnessedDeath}`), `FEATURES` + the `featureActive` projection, `NEED_THRESHOLD` 48/70/60/74 and `NEED_PRESSING/CRITICAL`, `DEFAULT_EXCLUDE`, the prestige rule (`KilledPredator` 5, `BuiltStructure`+`buildKind==='shelter'` 3), `endsLife` = `AgentDied` alone, the perspective switch (all five role entries), the `outcome` expression (only `GatherSucceeded` ends `Succeeded`), `narratable` = exactly `ForagerNarrator.storyFor`'s four cases, clock 2400/9600/38400 and `ADULT_AGE = TICKS_PER_SEASON`, and `seasonAt` being the body's own function object. All correct.
`fixtures/foragerTablesBefore.ts` **is** the old code: compared line-by-line to `git show d661380:` output, including the verbatim switch and the inlined `Math.min(1, BASE[type] + magnitude*0.3)`. It imports nothing from the adapter.
**Order is pinned and the pins bite.** Swap two `context` entries → `world-tables-transcribed` RED **and** goldens RED (order is genuinely load-bearing). Swap two `events` → transcribed RED, goldens green. Swap two `drives` → transcribed RED. Eight value mutations (a friendship delta, a prestige respect, a curve base, a salience, `whenPayload.equals`, an observer delta, `adultAge`, dropping the empty `SleptSafely` record) — **all** caught; **five** invisible to the goldens. The new test is doing real work.

## 3. No hidden world
Exactly one module-level `foragerAdapter` import inside `agent/ memory/ learning/ knowledge/ relationships/ narrative/ consciousness/`: `ReflexMind`'s documented constructor default. No module-level "current adapter", no default parameters elsewhere, no adapter-blind caches or static maps. Five minds over four worlds (`rich`/`plain`/`toy`/forager) interleaved round-robin in one process: importance, relationship scalars, mined features, exclusions and roles all stayed per-world.

## 4. The toy adapter proves something
`AgentMind` on `toyWorld` ran memory + all four miners + knowledge + relationships end to end with `worlds/forager/adapter.ts` replaced by a **Proxy that throws on any property read** — nothing touched it. The only forager binding left is the import graph (`AgentMind → ReflexMind → worlds/forager`), and the default argument is never evaluated when a world is passed.

## 5. The guard test can fail
All seven emptied files go RED on a re-added literal, each restored byte-exactly (object-literal key, quoted key, template literal, `new Set([...])`, a member access, a drive id, a context field). Baseline green, 20 tests. The pinned `STILL_LEAKING` list is **accurate**: my own grep of the seven mind directories for all 37 forager ids finds hits only in those files (the hits in `memoryFromEvent`/`ContextMiner`/`OutcomeMiner`/`SuccessionMiner` are comments). Note the brief says six; the test pins seven — `consciousness/schema.ts` is the extra, and it is a real leak.

## 6. The import cycle
Reproduced **at `d661380`**: entering the body graph at `PerceptionSystem` leaves `TICKS_PER_SEASON`/`TICKS_PER_YEAR` `NaN` and `seasonAt()` returning `undefined`. Pre-dates this item; identical on HEAD. The adapter's literals equal the body's (re-derived from source: 4×2400, ×4; `ADULT_AGE = TICKS_PER_SEASON`), and `climate.test.ts` pins it from a sound import order. Writing the clock out was the right call.

## 7. Suites
Engine **442/442**, `tsc -p tsconfig.json --noEmit` exit 0, mcp **13/13** — all single-worker, heap-capped. `golden-state.test.ts` and `test/fingerprint.ts` are byte-identical to `d661380` (`git diff --stat` empty); goldens pass with no re-record.

## Backlog (none blocking; add to B2)
1. **`eventById` is not frozen.** `defineWorld` freezes the spec but a `Map` is not frozen by `Object.freeze`. `adapter.eventById.set('AteFood', {id:'AteFood',salience:0.99})` succeeds and changes importance for every mind on that world — I ran it. Expose a lookup function, or a read-only wrapper.
2. **Two silent forager defaults in `consciousness/`**: `LlmMind.ts:79` and `MockMindBackend.ts:30` both do `new ReflexMind()` with no world, so a non-forager run's fallback policy is the forager continent.
3. **Guard holes.** Blind to split strings / computed keys (`'Gather' + 'Succeeded'` stays green) and to a table re-exported from any NON-mind module (proved: `contract/_probe.ts` imported into `importance.ts` → green). Also blind to importing the adapter itself. Worth a concatenation check and an import-graph rule at B6.
4. **World constants still in the mind:** `RelationshipStore` `DECAY_INTERVAL = 2400` (that is the forager *day*), `NEUTRAL = 50` and the four scalar names; `SuccessionMiner` defaults `windowTicks 600` / `radius 8` (world clock + world space); `AgentMind` defaults `512 / 120 / 300` — a second, non-adapter copy of `cognitionDefaults`.
5. **Payload vocabulary is undeclared world data.** `memoryFromEvent` hard-codes `needDeltas`, `targetNeedDeltas`, `objectKind`, `inputs`, `utterance` and the 0.5 observation discount; `importanceOf` hard-codes `magnitude * 0.3` and the /100 need scale. `prestige.whenPayload.key` already treats payload keys as world data, so the two disagree.
6. `importanceOf` now returns **0** for an undeclared id where it returned `NaN`. Unreachable today (the union is exhaustive), but B2 says an undeclared id should be rejected at the edge, not silently defaulted.
7. `Scenario` takes `REPRO_COOLDOWN` from the body's `TICKS_PER_SEASON` while `adultAge` comes from the adapter — the demography clock is now half-and-half.
8. `narratable` is declared but read by nothing in B1 (`Narration` still switches on ids). Correct as data; B5 must actually consume it or it will rot.
