import type { World } from '../../core/World.js';
import type { TerrainField } from '../../body/PerceptionSystem.js';
import type { WorldAdapter } from '../../contract/adapter.js';
import type { ResourceNodeKind } from './types.js';
import { createResourceNode, spawnGahallians, TICKS_PER_SEASON } from '../../body/index.js';
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
import { foragerAdapter } from './adapter.js';
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

/** Opening stock, by kind — the commonest value each had in the classic scatter. */
const STOCK: Record<ResourceNodeKind, number> = {
  berryBush: 14, foodPlant: 4, mushroomPatch: 8, tuberPlant: 14, nightshadePlant: 6, tree: 10,
  stoneDeposit: 13, waterSource: 9999, river: 9999, clayDeposit: 18, fiberPlant: 10, copperVein: 10,
  tinVein: 8, ironVein: 10, coalSeam: 12, saltFlat: 14, silverVein: 4, goldVein: 3, gemVein: 4, game: 4,
};

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
 * The densest a point can be, over every habitat — the candidate budget a tile
 * draws, and therefore a CEILING: a habitat denser than this would be silently
 * thinned. `test/continent-placement.test.ts` fails if any table exceeds it.
 */
export const MAX_DENSITY = 2400;

const CONTINENT_DEMOGRAPHY: Demography = {
  adultAge: foragerAdapter.time.adultAge,
  reproCooldown: TICKS_PER_SEASON,
  reproInterval: 300,
  reproRange: 14,
  maxPopulation: 320,
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
  readonly geography: WorldGeography = continentGeography;
  readonly scale: BodyScale = CONTINENT_SCALE;
  readonly terrain: TerrainField = continentGeography;
  readonly demography = CONTINENT_DEMOGRAPHY;
  readonly activity: ActivitySettings;

  constructor(
    readonly worldId: string,
    private readonly seed: string,
    private readonly agentCount: number,
    activityRadius: number,
  ) {
    this.activity = { tileSize: CONTINENT_TILE, radius: activityRadius };
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
   */
  private scatterNodes(world: World, tiles: ActivityRegions): void {
    const tileKm2 = (tiles.tileSize * tiles.tileSize) / 1e6;
    const candidates = Math.round(MAX_DENSITY * tileKm2);
    const kinds: ResourceNodeKind[] = [];
    const weights: number[] = [];
    for (let ty = 0; ty < tiles.cols; ty++) {
      for (let tx = 0; tx < tiles.cols; tx++) {
        const rng = mulberry32(hashSeed(`${this.seed}:nodes:${tx}:${ty}`));
        const x0 = tx * tiles.tileSize;
        const y0 = ty * tiles.tileSize;
        for (let i = 0; i < candidates; i++) {
          const x = x0 + rng() * tiles.tileSize;
          const y = y0 + rng() * tiles.tileSize;
          const roll = rng() * MAX_DENSITY;
          const region = this.geography.regionAt(x, y);
          // Nothing takes root in open water; a river is the exception, as it
          // is in the classic world (its banks ARE the river region).
          if (region !== 'river' && this.geography.isWater(x, y)) continue;
          const table = DENSITY[region];
          const gain = RIPARIAN_REGIONS.has(region) ? 1 + RIPARIAN_GAIN * freshWaterNearness(x, y) : 1;
          kinds.length = 0;
          weights.length = 0;
          let total = 0;
          for (const [kind, density] of Object.entries(table) as [ResourceNodeKind, number][]) {
            total += density * (RIPARIAN.has(kind) ? gain : 1);
            kinds.push(kind);
            weights.push(total);
          }
          if (roll >= total) continue;
          let pick = 0;
          while (weights[pick]! <= roll) pick++;
          const kind = kinds[pick]!;
          world.createEntity({
            Transform2D: { x, y },
            ResourceNode: createResourceNode(kind, STOCK[kind]),
          });
        }
      }
    }
  }

  /** Drinkable water along every river and round every lake. */
  private layWater(world: World): void {
    for (let i = 0; i < RIVER_COUNT; i++) {
      for (const p of riverCourse(i, 30)) {
        // A river that runs through a lake needs no drinking point of its own
        // there, and the lake is deep water: nothing may stand in it.
        if (this.geography.isDeepWater(p.x, p.y)) continue;
        world.createEntity({ Transform2D: { x: p.x, y: p.y }, ResourceNode: createResourceNode('river', 9999) });
      }
    }
    for (const [cx, cy, r] of CONTINENT_LAKES) {
      for (let a = 0; a < 8; a++) {
        const angle = (a / 8) * Math.PI * 2;
        const x = cx + Math.cos(angle) * (r + 14);
        const y = cy + Math.sin(angle) * (r + 14);
        if (this.geography.isDeepWater(x, y)) continue;
        world.createEntity({ Transform2D: { x, y }, ResourceNode: createResourceNode('waterSource', 9999) });
      }
    }
  }
}
