# Stage 4 — F1 + F2 build spec (senior engineer, 2026-09-19)

Build order item 1 of `S4-mind.md`. **Prerequisite:** W1-B4 landed (opaque `PlaceRef`, `SpaceOps`/`SpaceCodec` split). Read `S4-mind.md` (doctrine, non-negotiables) first; this file is the HOW.

## The finding this item must reverse (M1b, 2 unseen seeds)

Day 30 on the 8 km continent: every food node within 500 m of the birth valley is empty, ~14,000 food items sit 2–4 km away, and beings starve beside them. They never hunt, never look for ore or salt. Cause: behaviour is `worlds/forager/reflexPolicy.ts` (466 lines of authored survival script). Nothing outside the script can be learned or done.

## What gets built

```
src/agent/fastmind/            (mind directory — world-agnostic, no forager nouns, no geometry)
  AffordanceModel.ts   miner: what did (action × target tag) do to my drives, and how often was it refused
  PlaceMemory.ts       miner: where have I found / failed to find things with tag T; told-but-unverified places
  Frontier.ts          per-direction "how far have I been" tallies, from Move episodes
  Arbiter.ts           option generation + scoring + commitment; implements ReflexPolicy
  index.ts
```

`Arbiter` plugs in where a world's `reflexPolicy` plugs in today (`policyFor(world)`), selected by a scenario/instrument option **`fastMind: 'authored' | 'learned'`** (default stays `'authored'` until this item passes — that is the ablation switch and keeps every existing golden bit-identical). The authored forager policy is NOT deleted in this item; it becomes the baseline arm. Deleting it is the follow-up once `'learned'` wins.

### AffordanceModel (deterministic miner, per being)

- Key: `(actionId, targetTag | '∅')` where `targetTag` ranges over the TAGS the adapter declares on the target's kind (W1-B3 kind tags) — one episode updates one cell per tag the target carried. Never a kind id, never a noun.
- Cell: per drive `{n, sumDelta, sumSq}` (relief = negative delta), plus `{attempts, refusals}` and mean ticks-to-complete. Origin weights as `OutcomeMiner` (experience 1, observation 0.4, testimony 0 — testimony creates *hypotheses*, handled below).
- Reads the same `MemoryRecord` stream every other miner reads. Bounded: cells ≤ |actions| × |tags|. Survives `entomb()` rules like other semantic stores (W0-E).
- `expectedRelief(action, tag, drive)` = posterior mean under a weak zero-mean prior (n₀ = 2); `confidence` = n / (n + n₀); `risk` = refusal rate + mean worsening of OTHER drives.
- Does not replace `OutcomeMiner`/`KnowledgeStore` (those feed the slow mind's prompt); it is the fast mind's own procedural tally. One source of episodes, two readers.

### PlaceMemory (deterministic miner, per being) — F2

- Entry: `{place: PlaceRef, tag, found, empty, lastTick, source: 'seen' | 'told', teller?}`; reliability = (found + 1) / (found + empty + 2), decayed by age with a per-tag learned half-life (time between "found" and next "empty" at the same entry).
- Written from episodes: a successful act on a target with tag T at place P → `found`; arriving at a remembered place and perceiving no T → `empty`. Merge rule: a new sighting merges into the nearest entry of the same tag with `space.within(a, b, mergeRadius)`; `mergeRadius` is ADAPTER data (`adapter.cognition.placeMergeRadius`), never a constant in the mind. Cap 96 entries per being, evict lowest `reliability × recency`.
- Testimony about a place ("there are berries by the river") enters as `source: 'told'` with reliability 0.5 × trust-in-teller and is upgraded or struck only by the being's own visit. It is never knowledge.
- Pure `SpaceOps` use: `within`, `distance`, `equal`. No coordinates, no quantising — linear scan over ≤ 96 entries is the budget.

### Frontier + one contract addition

A mind cannot name a place it has never seen, so exploration needs the world's help. **Contract addition (B4 follow-on, tiny):** `SpaceOps.toward(from: PlaceRef, direction: DirectionId, effort: number): PlaceRef` — "a place roughly that way, about that much travel". Plane: a point `effort` metres along the compass bearing, clamped to the world. Toy graph world: the neighbour reached by following that edge label `effort` hops. `effort` is in the world's own `distance` units. `Frontier` keeps, per `DirectionId`, the farthest `distance(home, p)` reached and visits; "home" = the being's highest-reliability shelter/rest entry in PlaceMemory (or birth place).

### Arbiter (implements `ReflexPolicy`)

1. **When it runs.** Not every tick. Re-arbitrate when: the current commitment completes or is refused; a drive crosses a pressure band upward; a threat-tagged entity enters perception; or `recheckEvery` ticks elapse (adapter data). Between those, continue the committed plan. This is the cost control.
2. **Options.** For each drive with pressure > 0, candidates are `(action, target)` where `target` is (a) a perceived entity whose kind tags make the action *attemptable* per the adapter (the adapter says attemptable, never what results), (b) a PlaceMemory entry for a tag whose cell relieves that drive, (c) an exploration step `toward(here, d, effort)` for each direction. Plus `Wait`/rest via the core verb.
3. **Score.** `Σ_drives pressure_d × expectedRelief_d × confidence  −  travelCost  −  pressure-weighted risk  +  curiosity`.
   - `travelCost = λ × space.distance(here, target)`, λ LEARNED per being = mean drive growth per unit distance over its own Move episodes (weak prior).
   - `curiosity = κ(age, affect later) × (1 − confidence(action, tag))` for untried/rarely tried pairs, and `× 1/(1 + visits_dir)` for directions; **scaled up when no drive is pressing, and ALSO when a drive is pressing and no known option relieves it** (a hungry being that knows nothing tries what is in reach — mouthing, not scripting). κ is adapter/scenario data with an ablation value 0.
   - Ties and sampling: softmax with temperature from the being's immutable temperament seed, drawn from the being's own seeded RNG stream; enumeration in ascending entity-id / entry-index order. Bit-reproducible.
4. **Commitment.** The chosen option becomes a plan of core-verb intents (Move → Act) with a hysteresis bonus so beings do not dither; abandoned with a recorded reason (`refused`, `target-gone`, `outbid-by` drive) — that record is F3's seed.
5. **Output** is an ordinary `MindOutput` through the same gate as any mind. It records like any decision (`CognitionRecorder`: source `fast-learned`, options considered top-k with scores) so a trace can show WHY.

### What is forbidden

No rule that says explore, hunt, flee, share, teach. No forager noun or tag literal in `src/agent/**` (guard test, data-driven from the adapter like `world-tables-out`). No reading another being's stores. No LLM call. No coordinate. Nothing the instrument computes feeds back.

## Founders problem (decide by measurement, not by taste)

A founding adult with empty stores may starve before it learns. Two arms, both reported: **(i) blank founders**; **(ii) upbringing scaffold** — a scenario may hand founders N synthetic *episodes* with `origin: 'upbringing'` (weight 0.4, like observation), declared in the ScaffoldLedger so every dataset card and verdict shows it. Default = (i). Children born in-run learn by watching parents (observation weight) — no special case.

## Proof (all seed-paired, `'authored'` vs `'learned'`, ≥ 8 seeds, continent + classic + toy)

1. **Objective, continent, day 60:** share of starvation deaths with food ≤ 2 km away (today ≈ all) — must fall sharply; diet breadth per being over life; first hunt = DISCOVERED (tick, by whom) and then its spread by observation (adopters per generation); distance-from-birth distribution; population at day 60/120. Report honestly if `'learned'` populations crash — that is a finding, not a bug to hide.
2. **Place memory works:** return-visit rate to remembered entries after depletion + regrowth vs chance; told-places visited then confirmed/struck; reliability calibration curve.
3. **World-agnostic:** identical `src/agent/fastmind/**` runs the toy (graph) world and relieves its drives; `mind-type-graph` compile proof includes the new directory; tag/noun guard green.
4. **Deterministic:** same seed → bit-identical state at tick N twice, and across worker/no-worker hosts; record → replay identical.
5. **Cost:** `'authored'` path bit-identical + ≤ 1% slower; `'learned'` ≤ 15% slower than `'authored'` at 1,000 beings (arbitration is event-driven); heap per being reported at fixed checkpoints, bounded at 100k ticks.
6. **Ablations:** κ = 0 (no curiosity), PlaceMemory off, observation weight 0 — each must visibly hurt the metric it claims to serve; if one does not, the component is not earning its place.
7. New goldens recorded ONCE for `'learned'`; all existing goldens untouched.
8. Then the hostile verifier: unseen seeds, re-derives metric 1 from raw events (not from the engineer's counters), hunts for smuggled scripts (any branch on a tag literal, any constant that encodes forager ecology), and checks the trace of ten random decisions reads as *reasons*.

## Order inside the item

(a) `toward` on the contract + plane + toy, byte-neutral → (b) AffordanceModel + PlaceMemory + Frontier as passive miners running beside the authored policy (zero-perturbation proof: goldens identical with miners on) → (c) Arbiter behind `fastMind: 'learned'` → (d) metrics + A/B harness reuse (`eval/pairing`, `stats` sign-flip test) → (e) ablations → verifier.
