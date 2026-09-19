import type { World } from '../../core/World.js';
import type { TerrainField } from '../../body/PerceptionSystem.js';
import type { WorldAdapter } from '../../contract/adapter.js';
import type { ResourceNodeKind } from './types.js';
import { createResourceNode, DEFAULT_REGROW, spawnGahallians, TICKS_PER_SEASON } from '../../body/index.js';
import { ContinentWildlife } from '../../body/ContinentWildlife.js';
import { mulberry32, hashSeed } from '../../body/prng.js';
import type { ActivityRegions } from '../../world/activity.js';
import type { BodyScale, WorldGeography } from '../../world/geography.js';
import type { Region } from '../../world/regions.js';
import {
  CONTINENT_LAKES,
  CONTINENT_TILE,
  FOUNDING_VALLEY,
  continentGeography,
  freshWaterNearness,
  inFoundingValley,
  riverCourse,
  RIVER_COUNT,
} from '../../world/continent.js';
import { foragerAdapter, foragerEdges } from './adapter.js';
import { CONTINENT_SCALE } from './scale.js';
import type { ActivitySettings, Demography, Scenario, ScenarioWorld } from '../../runner/Scenario.js';
import { ForagerNarrator } from '../../runner/society/Narration.js';
import type { NarrationHost } from '../../runner/society/Narration.js';
import type { NarrativeAuthor } from '../../runner/society/SocietySystem.js';

/**
 * RESOURCE NODES PER SQUARE KILOMETRE, BY HABITAT — the classic world's own
 * densities, recovered by dividing each `ForagerScenario` scatter count by the
 * area of the region it was scattered into. Using them unchanged is what makes
 * "the same world, at the right size" a claim rather than a hope: a being
 * standing on a riverbank here sees what a being standing on a riverbank there
 * saw, and only the distance to the next riverbank has grown.
 *
 * TWO DELIBERATE ADDITIONS, both because the founding valley has to be
 * liveable and the classic founders got these from groves inside their spawn
 * band: riparian `tree` (the classic tables put wood only in forest and hills,
 * and a valley with no wood cannot build a shelter), and a little `stone` on
 * the plains. `lake` is empty because the classic table scattered food INSIDE
 * the lake discs, which are deep water here; that food lives on the shore.
 */
const DENSITY: Record<Region, Partial<Record<ResourceNodeKind, number>>> = {
  river: { berryBush: 1014, tuberPlant: 811, clayDeposit: 243, fiberPlant: 176, tree: 130 },
  lake: {},
  wetland: { fiberPlant: 258, clayDeposit: 157, tuberPlant: 138, waterSource: 83, tree: 40 },
  coast: { saltFlat: 136, fiberPlant: 118, berryBush: 82, waterSource: 120 },
  forest: { tree: 480, berryBush: 180, tuberPlant: 112, nightshadePlant: 72, mushroomPatch: 56, fiberPlant: 56 },
  mountain: { stoneDeposit: 83, copperVein: 58, ironVein: 47, coalSeam: 47, tinVein: 36, gemVein: 25, silverVein: 19, goldVein: 10 },
  hills: { stoneDeposit: 96, clayDeposit: 58, tree: 58 },
  plains: { berryBush: 65, tuberPlant: 45, fiberPlant: 30, mushroomPatch: 18, tree: 70, stoneDeposit: 5 },
};

/**
 * Opening stock, by kind. Minerals keep the classic scatter's values — a seam
 * of ore is as big as it ever was. What a LIVING thing holds is cut to about a
 * third, because standing stock is a larder: at the classic 14 the valley's
 * bushes alone held eighteen days' food for the founding band, which is long
 * enough that a population can double before it ever feels a shortage. At 5 it
 * holds five days, so what a being can find depends on what has regrown, which
 * is the thing the carrying capacity below actually governs.
 */
const STOCK: Record<ResourceNodeKind, number> = {
  berryBush: 5, foodPlant: 4, mushroomPatch: 3, tuberPlant: 5, nightshadePlant: 3, tree: 6,
  stoneDeposit: 13, waterSource: 9999, river: 9999, clayDeposit: 18, fiberPlant: 4, copperVein: 10,
  tinVein: 8, ironVein: 10, coalSeam: 12, saltFlat: 14, silverVein: 4, goldVein: 3, gemVein: 4, game: 4,
};

/**
 * THE FOUNDING VALLEY'S CARRYING CAPACITY, AS ARITHMETIC.
 *
 * The first draft of this world had NO carrying capacity: 351 food nodes
 * regrowing every 220 ticks fed the valley four thousand people a day, so in
 * twelve days it recorded 219 births, 66 deaths and not one of them from
 * hunger, and by day 20 the population sat on `maxPopulation` — a ceiling in a
 * table, not a limit the world imposed. A world that cannot be outgrown gives
 * a people no reason to go anywhere.
 *
 * So the valley is sized, on purpose, at roughly the band that founds it. The
 * numbers below are read off the body and the climate, not chosen:
 *
 *   food a being eats per day = hunger burnt per day ÷ hunger one meal
 *                               relieves, taxed by the cold seasons
 *   food a node yields per day = ticks per day ÷ its regrowth interval,
 *                                gated by the growing part of the year
 *
 * Set those equal over the food nodes that actually fall inside the valley and
 * one unknown is left: how much slower than the classic world everything here
 * regrows. `REGROW_SLOWDOWN` is that number, computed at build time from the
 * nodes the scatter really placed — so the DENSITIES stay comparable to the
 * classic world (which is what a founder sees, and what
 * `continent-placement.test.ts` measures) while the FLOW is what the valley
 * can sustain. It is applied continent-wide: a bush in the far hills regrows
 * as slowly as one on the riverbank, so richer ground is richer because there
 * is more of it, never because it is faster.
 */
export const VALLEY_CARRYING_CAPACITY = 175;
const HUNGER_PER_TICK = 0.022; // YggdrasilSystem DECAY.hunger
const HUNGER_PER_MEAL = 55; // YggdrasilSystem EAT_HUNGER_RELIEF
const COLD_TAX = 1.21; // mean of Climate.hungerRateMultiplier over a year
const GROWING_YEAR = 0.625; // mean of Climate.growthFactor over a year
const TICKS_PER_DAY = 2400;
/** Food items one being eats per day, averaged over a year. */
const FOOD_PER_BEING_DAY = (HUNGER_PER_TICK * TICKS_PER_DAY * COLD_TAX) / HUNGER_PER_MEAL;

const FOOD_KINDS: ReadonlySet<ResourceNodeKind> = new Set<ResourceNodeKind>([
  'berryBush', 'tuberPlant', 'mushroomPatch', 'foodPlant',
]);

/** Nothing scattered on the ground walks: keep it out of the tick reconcile. */
const STATIC = { static: true } as const;

/**
 * Metres between drinkable spots along a river. Not the classic world's 30:
 * every founder here is born on the bank where a classic one might be a field
 * away, so the same spacing put half again as much water inside a founder's
 * eyesight (×1.4–1.6 on ten seeds, outside the parity band). 42 m is the
 * spacing at which the two worlds' founders see the same amount of water.
 */
const RIVER_DRINK_SPACING = 42;

/** Every kind any habitat grows, in a fixed order — the dither's key set. */
const SCATTERED_KINDS: readonly ResourceNodeKind[] = [
  ...new Set(Object.values(DENSITY).flatMap((table) => Object.keys(table) as ResourceNodeKind[])),
].sort();

/**
 * What grows better on a bank than on open ground. Applied to the regions that
 * are NOT already defined by their water — so the river and the marsh keep the
 * classic numbers, and how good a patch of plain or hillside is depends on how
 * far the water is. This is the habitat rule that makes the valley worth living
 * in and the far plains worth leaving.
 */
const RIPARIAN: ReadonlySet<ResourceNodeKind> = new Set<ResourceNodeKind>([
  'berryBush', 'tuberPlant', 'mushroomPatch', 'fiberPlant', 'tree',
]);
const RIPARIAN_REGIONS: ReadonlySet<Region> = new Set<Region>(['plains', 'hills']);
/**
 * TUNED, NOT CHOSEN. The one number in this file that was fitted: it is set so
 * that a founder standing in the valley has as many food nodes inside its
 * perception radius as a classic founder had — the operational definition of
 * "early survival is comparable", and what `test/continent-placement.test.ts`
 * measures. At 3.5 the valley was 55% richer than the classic world.
 */
const RIPARIAN_GAIN = 2.2;

/**
 * Candidate points a tile draws, per km². It sets the RESOLUTION of the
 * scatter and bounds it: no single kind's effective density may reach it, or
 * a tile would want more than one node of that kind per candidate and the
 * habitat would be silently thinned. `test/continent-placement.test.ts` fails
 * if any table, riparian gain included, gets near it.
 */
export const MAX_DENSITY = 2400;

/**
 * A pure ceiling against runaway, not a carrying capacity: the ECOLOGY is what
 * limits this population now (see `VALLEY_CARRYING_CAPACITY`). The first draft
 * pinned at 320 by day 20 and stayed there, which said nothing about the
 * world. Kept only so a pathological run cannot exhaust the machine.
 */
const CONTINENT_POPULATION_GUARD = 4000;

const CONTINENT_DEMOGRAPHY: Demography = {
  adultAge: foragerAdapter.time.adultAge,
  reproCooldown: TICKS_PER_SEASON,
  reproInterval: 300,
  reproRange: 14,
  maxPopulation: CONTINENT_POPULATION_GUARD,
};

/**
 * THE TRUE-SCALE FORAGER WORLD. Same people, same drives, same adapter — the
 * mind cannot tell which of the two it was born into, which is the point. What
 * differs is that the ground is honest: the valley they are born in is 840 m
 * across, the salt is an hour's walk west, and the ore is two and a half
 * kilometres east and eight hundred metres up.
 */
export class ContinentScenario implements Scenario {
  readonly adapter: WorldAdapter = foragerAdapter;
  readonly edges = foragerEdges;
  readonly geography: WorldGeography = continentGeography;
  readonly scale: BodyScale = CONTINENT_SCALE;
  readonly terrain: TerrainField = continentGeography;
  readonly demography = CONTINENT_DEMOGRAPHY;
  readonly activity: ActivitySettings;
  /** How much slower than the classic world this one regrows. See below. */
  private readonly slowdown: number;

  constructor(
    readonly worldId: string,
    private readonly seed: string,
    private readonly agentCount: number,
    activityRadius: number,
  ) {
    this.activity = { tileSize: CONTINENT_TILE, radius: activityRadius };
    this.slowdown = this.solveSlowdown();
  }

  /** What the valley was sized to feed, and the interval that buys it. */
  ecologyReport(): { capacity: number; slowdown: number; berryRegrowEvery: number } {
    return {
      capacity: VALLEY_CARRYING_CAPACITY,
      slowdown: this.slowdown,
      berryRegrowEvery: this.regrowEvery('berryBush'),
    };
  }

  narrator(host: NarrationHost): NarrativeAuthor {
    return new ForagerNarrator(host, this.geography);
  }

  build(world: World, tiles: ActivityRegions): ScenarioWorld {
    this.scatterNodes(world, tiles);
    this.layWater(world);
    // Founders begin in ONE valley — not spread over 42 km² — so they start as
    // a people rather than as isolated individuals who could never meet.
    const founders = spawnGahallians(
      world,
      this.agentCount,
      this.seed,
      {
        x: FOUNDING_VALLEY.x - FOUNDING_VALLEY.half,
        y: FOUNDING_VALLEY.y - FOUNDING_VALLEY.half,
        width: FOUNDING_VALLEY.half * 2,
        height: FOUNDING_VALLEY.half * 2,
      },
      -this.adapter.time.adultAge,
      (x, y) => !inFoundingValley(x, y) || this.geography.isDeepWater(x, y),
    );
    const wildlife = new ContinentWildlife(this.seed, world, tiles, this.geography, this.scale, FOUNDING_VALLEY);
    return { founders, wildlife };
  }

  /**
   * Habitat-driven scatter, tile by tile. Each tile draws from its own stream,
   * so what grows here does not depend on what grew there — and the whole
   * continent costs one region lookup per candidate instead of the classic
   * world's rejection sampling, which would take ninety million tries at this
   * size.
   *
   * DENSITY BY CONSTRUCTION, NOT BY EXPECTATION. The first draft rolled one
   * die per candidate against the habitat's total density, so a tile's realised
   * counts were a binomial draw AROUND the table and the founder-parity ratios
   * it was tuned on held on one seed and missed the band on the next (wood
   * ×1.43, ×0.89). Here every candidate instead adds its own ground's density
   * to a per-kind accumulator, and a node is planted each time one crosses one
   * whole node — systematic sampling. A tile's count of a kind is then the
   * table's target rounded, never more than one out, on every seed. Where a
   * node lands is still the seed's business; how many there are is not.
   */
  private scatterNodes(world: World, tiles: ActivityRegions): void {
    for (let ty = 0; ty < tiles.cols; ty++) {
      for (let tx = 0; tx < tiles.cols; tx++) {
        this.scatterTile(tx, ty, (kind, x, y) => {
          world.createEntity(
            { Transform2D: { x, y }, ResourceNode: createResourceNode(kind, STOCK[kind], this.regrowEvery(kind)) },
            STATIC,
          );
        });
      }
    }
  }

  /** One tile's worth of the scatter. The only place the rule is written. */
  private scatterTile(tx: number, ty: number, plant: (kind: ResourceNodeKind, x: number, y: number) => void): void {
    const size = CONTINENT_TILE;
    const tileKm2 = (size * size) / 1e6;
    const candidates = Math.round(MAX_DENSITY * tileKm2);
    const share = tileKm2 / candidates; // km² a candidate speaks for
    const rng = mulberry32(hashSeed(`${this.seed}:nodes:${tx}:${ty}`));
    // Each accumulator starts somewhere in [0, 1) rather than at zero. Without
    // that a tile places `floor(what it is owed)`, so a kind the tile owes less
    // than one of — gold, at 10 seams per km² and 0.065 km² of tile — is never
    // placed anywhere on the continent. Dithered, it places one whenever the
    // offset carries it over, which is right on average and out by at most one
    // per tile instead of by a binomial draw.
    const dither = mulberry32(hashSeed(`${this.seed}:dither:${tx}:${ty}`));
    const acc: Partial<Record<ResourceNodeKind, number>> = {};
    for (const kind of SCATTERED_KINDS) acc[kind] = dither();
    for (let i = 0; i < candidates; i++) {
      const x = tx * size + rng() * size;
      const y = ty * size + rng() * size;
      const region = this.geography.regionAt(x, y);
      // Nothing takes root in open water; a river is the exception, as it is
      // in the classic world (its banks ARE the river region).
      if (region !== 'river' && this.geography.isWater(x, y)) continue;
      const gain = RIPARIAN_REGIONS.has(region) ? 1 + RIPARIAN_GAIN * freshWaterNearness(x, y) : 1;
      for (const [kind, density] of Object.entries(DENSITY[region]) as [ResourceNodeKind, number][]) {
        const owed = (acc[kind] ?? 0) + density * (RIPARIAN.has(kind) ? gain : 1) * share;
        if (owed < 1) {
          acc[kind] = owed;
          continue;
        }
        acc[kind] = owed - 1;
        plant(kind, x, y);
      }
    }
  }

  /** Drinkable water along every river and round every lake. */
  private layWater(world: World): void {
    for (let i = 0; i < RIVER_COUNT; i++) {
      for (const p of riverCourse(i, RIVER_DRINK_SPACING)) {
        // A river that runs through a lake needs no drinking point of its own
        // there, and the lake is deep water: nothing may stand in it.
        if (this.geography.isDeepWater(p.x, p.y)) continue;
        world.createEntity(
          { Transform2D: { x: p.x, y: p.y }, ResourceNode: createResourceNode('river', 9999) },
          STATIC,
        );
      }
    }
    for (const [cx, cy, r] of CONTINENT_LAKES) {
      for (let a = 0; a < 8; a++) {
        const angle = (a / 8) * Math.PI * 2;
        const x = cx + Math.cos(angle) * (r + 14);
        const y = cy + Math.sin(angle) * (r + 14);
        if (this.geography.isDeepWater(x, y)) continue;
        world.createEntity(
          { Transform2D: { x, y }, ResourceNode: createResourceNode('waterSource', 9999) },
          STATIC,
        );
      }
    }
  }

  /** This world's regrowth interval for a kind — see the capacity derivation. */
  private regrowEvery(kind: ResourceNodeKind): number {
    const base = DEFAULT_REGROW[kind];
    return base <= 0 ? base : Math.round(base * this.slowdown);
  }

  /**
   * How much slower than the classic world everything regrows here: solved
   * from the food nodes this very scatter puts inside the founding valley, by
   * running it over the valley's own tiles and counting. Nothing is remembered
   * — change a density table and this number moves with it, so the capacity
   * claim cannot quietly become a lie. `≥ 1`: this world is never richer than
   * the classic one, whatever the arithmetic says.
   */
  private solveSlowdown(): number {
    let perTick = 0; // Σ 1/base-interval: the valley's yield in classic terms
    const tile = CONTINENT_TILE;
    const loX = Math.floor((FOUNDING_VALLEY.x - FOUNDING_VALLEY.half) / tile);
    const hiX = Math.floor((FOUNDING_VALLEY.x + FOUNDING_VALLEY.half) / tile);
    const loY = Math.floor((FOUNDING_VALLEY.y - FOUNDING_VALLEY.half) / tile);
    const hiY = Math.floor((FOUNDING_VALLEY.y + FOUNDING_VALLEY.half) / tile);
    for (let ty = loY; ty <= hiY; ty++) {
      for (let tx = loX; tx <= hiX; tx++) {
        this.scatterTile(tx, ty, (kind, x, y) => {
          if (FOOD_KINDS.has(kind) && inFoundingValley(x, y)) perTick += 1 / DEFAULT_REGROW[kind];
        });
      }
    }
    const wanted = (VALLEY_CARRYING_CAPACITY * FOOD_PER_BEING_DAY) / TICKS_PER_DAY;
    return Math.max(1, (perTick * GROWING_YEAR) / wanted);
  }
}
