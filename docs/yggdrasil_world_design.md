# Yggdrasil — World Design (the first world)

**Status:** ACTIVE, canonical, 2026-06-13 (user-authored spec). Governs the
Yggdrasil sim world. Companion to [[yggdrasil_civilization_design]] (the V2
platform) and [[yggdrasil_training_strategy]] (capabilities-not-outcomes).

## Principle

> The world contains the **building blocks** of civilization — never
> civilization itself. It begins untouched: no cities, villages, roads,
> kingdoms, factions, religions, governments, or professions. It should feel
> less like a game map and more like a **young Earth waiting for intelligence
> to emerge.** Civilization must emerge through interaction with the
> environment, or not at all.

This is the world-side of the anti-NPC doctrine: the engine *knows* the
physical relationships (seeds→plants, heat melts certain rock, some plants
poison); the Gahallians do **not** — they must discover them. We provide
ingredients and physics, never recipes or systems.

## Scale

A **medium continent** for 100–1000 Gahallians — large enough that groups
form independently, environmental pressures differ by region, knowledge
spreads slowly, and distinct cultures may emerge. (Engine: world extent grows
from the current ~400u to a continent ~1500–2500u with streamed terrain;
agent counts already supported.)

## Terrain → biomes (physics that shapes survival)

Plains · forests · rivers · lakes · mountains · hills · wetlands · coastlines.
Terrain influences survival, not just looks.

- **Rivers (critical):** drinking water, faster plant growth, fertile banks,
  attract animals → river valleys are the natural pull for dense, food-rich
  settlement.
- **Forests:** wood, shelter cover, food, animals — opportunity *and* danger.
- **Mountains:** stone, metals, rare resources — hard to survive in (food-poor,
  cold), valuable to explore.
- **Hills / wetlands / coast:** clay (wet/riverbank), salt (coast), reeds/fiber
  (wetland), varied forage.

Engine mapping: drive terrain + a `BiomeField` from `@gahalla/worldgen`
(heightmap + biomes already exist, golden-locked). `region(x,y)` →
{ biome, elevationBand, nearWater, coastal, fertility } feeds both the 3D
render and resource placement, so visuals and physics agree.

## Resources — materials with PROPERTIES, not recipes

Resources are physical materials with properties. **No crafting recipes** —
agents discover what materials *do* by acting on them.

| Tier | Materials |
|---|---|
| Basic | water, wood, stone, clay, fiber, food-plants, wild animals |
| Intermediate | charcoal, leather, rope, brick |
| Advanced | copper ore, tin ore, iron ore, coal, salt |
| Rare | silver, gold, gemstones |

Each material carries a **property set** (engine `MATERIAL_PROPERTIES`), e.g.:
clay { moldable, hardensWithHeat } · fiber { twistable → rope } · wood {
burns, builds } · copperOre { smeltsAtHighHeat → copper } · coal { burnsHot } ·
salt { preserves food } · animal-hide { tannable → leather }. Intermediate/
advanced materials are **outcomes of applying properties under conditions**
(heat, force, time), never of a recipe lookup — so metallurgy, tanning,
rope-making, brick-firing can be *discovered*.

## Distribution — deliberately UNEQUAL

Resources are **not** balanced. Some regions are rich, some poor.
Environmental inequality is the engine of trade, migration, competition, and
exploration. Mapping: placement is biome/height-keyed —
ore/coal/stone in mountains; clay + dense food on river banks; fiber/reeds in
wetlands; salt on coasts; wood in forests; sparse forage on plains; gems/
silver/gold rare and clustered in specific mountain veins.

## Seasons (Spring · Summer · Autumn · Winter)

Affect food availability, plant growth, animal behavior, survival difficulty.
**Winter is a serious challenge** — forage collapses, cold raises a survival
pressure, shelter + stored food become the difference between life and death
(creating the pressure that can *select for* storage and agriculture).

Engine: a deterministic `Climate` system — `TICKS_PER_SEASON`, current season +
a `growthFactor`/`forageFactor` and a `coldPressure` that modulate
`ResourceNodeSystem` regrowth and need decay. Part of the seeded fixed-step
loop (replayable).

## Weather

Rain · storms · droughts · heat waves · cold snaps — episodic pressure on the
population. Engine: weather states sampled deterministically per region/day,
modulating growth, exposure, perception, and movement. (Slice 2 — see below.)

## Hidden relationships (engine knows; agents must discover)

seeds→plants · water increases growth · certain rock melts under extreme heat
(→ metal) · some plants edible, some poisonous · clay + fire → brick · hide +
work → leather · fiber twisted → rope. Each is a **physical mechanic** in
`WorldRegularities`, never a labelled system. Discovery flows through the
existing learning miners (succession/outcome) → knowledge.

## Technology the world should *allow* to emerge (never provide)

Shelter · agriculture · storage · trade · metallurgy · transportation. The
world ships only the **physical ingredients + conditions**; if a technology
appears it is because Gahallians discovered and combined properties.

## Region → lifestyle (culture from geography)

River populations: food-abundant, dense. Mountain populations: resource-rich,
food-poor. Forest populations: hidden, wood-rich. These differences should
*emerge from geography*, not be assigned. The Observatory measures them
(archetypes, diffusion) post-hoc.

## Starting conditions

Spawn ~100 Gahallians with no knowledge, no civilization, no professions, no
social structure — only basic needs, memory, learning, consciousness. Spawn
scatter spans regions so independent groups can form. The world is designed so
civilization is **possible but not guaranteed**.

## Success condition

The world succeeds if synthetic beings can discover knowledge, share it, adapt
to environmental pressure, and *potentially* build civilization through their
own actions. Measured from the event log / Observatory — never by a programmed
milestone.

---

## Implementation slices (so this ships incrementally, all tested)

**Slice 1 (this pass):** materials taxonomy as data (ObjectKind tiers +
`MATERIAL_PROPERTIES`) + new resource-node kinds; deterministic `Climate`
(4 seasons, winter survival pressure, regrowth/forage modulation); **unequal
biome-region world build** (river-valley / forest / mountain / plains / coast)
replacing the flat ad-hoc world, with region-keyed scarcity; new edible/
poisonous food-plant relationships; Observatory visual region variation.

**Slice 2:** weather events (rain/storm/drought/heat/cold) per-region;
fire/heat mechanic → the metallurgy + brick + charcoal discovery chain;
animal entities with simple behavior (forage/flee/hunt) as a food + hide +
danger source.

**Slice 3:** continent-scale streamed terrain driven by `@gahalla/worldgen`
(true rivers/mountains/coast from the heightmap), transportation pressure
(distance/rivers), multi-region migration tracking in the Observatory.

Each slice keeps the suites green and ships something visible in the
Observatory.
