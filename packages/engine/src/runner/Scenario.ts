import type { World } from '../core/World.js';
import type { Entity } from '../core/Entity.js';
import type { WorldAdapter } from '../contract/adapter.js';
import type { WorldEdges } from '../contract/edges.js';
import type { ResourceNodeKind } from '../worlds/forager/types.js';
import type { TerrainField } from '../body/PerceptionSystem.js';
import type { WildlifeRules } from '../body/WildlifeSystem.js';
import { WildlifeSystem, createResourceNode, spawnGahallians, TICKS_PER_SEASON } from '../body/index.js';
import { mulberry32, hashSeed } from '../body/prng.js';
import { foragerAdapter, foragerEdges } from '../worlds/forager/adapter.js';
import { ContinentScenario } from '../worlds/forager/continentScenario.js';
import { CONTINENT_TILE } from '../world/continent.js';
import { CLASSIC_SCALE, classicGeography } from '../world/geography.js';
import type { ActivityRegions } from '../world/activity.js';
import type { BodyScale, WorldGeography } from '../world/geography.js';
import { WORLD, elevationBand, regionAt, riverY, tributaryY, LAKE_CENTERS, isDeepWater } from '../world/regions.js';
import type { Region } from '../world/regions.js';
import { FORAGER_CONTINENT, TRUE_SCALE_CONTINENT } from './options.js';
import type { ExperimentOptions } from './options.js';
import { ForagerNarrator } from './society/Narration.js';
import type { NarrationHost } from './society/Narration.js';
import type { NarrativeAuthor } from './society/SocietySystem.js';

/**
 * EVERYTHING WORLD-SPECIFIC ABOUT A RUN lives behind this interface: what the
 * ground is, what grows where, who the founders are, what else is alive. The
 * runtime knows none of it — it asks a scenario to furnish a world and then
 * only ever talks about beings, events and ticks.
 *
 * This is the near side of the future `WorldAdapter` line (docs/rework
 * ARCHITECTURE §3): every noun, constant and table below is forager-continent
 * data, and a second world arrives as a second implementation, not as a branch
 * inside the host.
 */
export interface Scenario {
  /** Recorded on every cognition row so a held-out-world split has a key. */
  readonly worldId: string;
  /**
   * What this world IS, as data a mind can read: its drives, events, context
   * features, clock and cognition curves. W1-B1 — the scenario furnishes the
   * world AND declares it; by B6 the two are one thing.
   */
  readonly adapter: WorldAdapter;
  /**
   * The same world's EDGES: the codec that turns a place into this world's own
   * fields and back, plus whatever readers its own body and instrument use. A
   * world factory hands back both halves and they go to different places — the
   * adapter to every mind, this to the handful of components that sit at an
   * edge (round 4; see contract/edges.ts).
   */
  readonly edges: WorldEdges;
  /** The ground: extents, relief, water, and the world's own edge. */
  readonly geography: WorldGeography;
  /** How far a metre is to a body here — reach, pace, earshot, eyesight. */
  readonly scale: BodyScale;
  /** Elevation provider for the `highland` context feature. */
  readonly terrain: TerrainField;
  /** Life-cycle numbers the society processes run on. */
  readonly demography: Demography;
  /** How the world is tiled for activity, and how live a tile stays. */
  readonly activity: ActivitySettings;
  /** Furnish `world`: resources, founders, wildlife. Called once, at birth. */
  build(world: World, tiles: ActivityRegions): ScenarioWorld;
  /** This world's tale-teller, bound to the host that knows beings' names. */
  narrator(host: NarrationHost): NarrativeAuthor;
}

/**
 * The world's activity tiling — see `world/activity.ts`. A `radius` that is
 * not finite means every tile is always live, which is what the classic world
 * asks for: it steps exactly what it always stepped.
 */
export interface ActivitySettings {
  readonly tileSize: number;
  readonly radius: number;
}

/** How a people ages, pairs and is bounded — world data, not mind data. */
export interface Demography {
  /** Ticks from birth to being able to reproduce. */
  readonly adultAge: number;
  /** Ticks a parent waits before another child. */
  readonly reproCooldown: number;
  /** How often the population is checked for births. */
  readonly reproInterval: number;
  /** How close two adults must be to pair. */
  readonly reproRange: number;
  /** Population ceiling (perf + a carrying capacity). */
  readonly maxPopulation: number;
}

export interface ScenarioWorld {
  /** The founding population, in spawn order. */
  readonly founders: readonly Entity[];
  readonly wildlife: WildlifeRules;
}

/** How far from a living being a continent tile stays live, in metres. */
export const CONTINENT_ACTIVITY_RADIUS = 768;

/** A bush does not walk: keep it out of the per-tick position reconcile. */
const STATIC = { static: true } as const;

/**
 * WHICH WORLD THIS RUN HAPPENS IN. Two scenarios, one mind: both hand the same
 * `foragerAdapter` to every being, so nothing under `agent/ memory/ learning/
 * knowledge/ relationships/ narrative/ consciousness/` can tell them apart.
 * The classic world stays the default, because every golden, corpus and
 * published result stands on it.
 */
export function scenarioFor(options: ExperimentOptions): Scenario {
  const agents = options.agentCount ?? 100;
  if (options.scenario === 'forager-continent') {
    return new ContinentScenario(
      TRUE_SCALE_CONTINENT,
      options.seed,
      agents,
      options.activityRadius ?? CONTINENT_ACTIVITY_RADIUS,
    );
  }
  return new ForagerScenario(FORAGER_CONTINENT, options.seed, agents, options.activityRadius);
}

const REPRO_COOLDOWN = TICKS_PER_SEASON; // a season between births

const FORAGER_DEMOGRAPHY: Demography = {
  adultAge: foragerAdapter.time.adultAge,
  reproCooldown: REPRO_COOLDOWN,
  reproInterval: 300,
  reproRange: 14,
  maxPopulation: 320,
};

/**
 * A deliberately UNEQUAL continent (yggdrasil_world_design.md). Resources
 * are keyed to geography: a food-rich river valley, ore-rich/food-poor
 * mountains, wood-rich forests with poison-plant danger, a salt coast,
 * sparse plains. The inequality is the point — it's what can drive trade,
 * migration, competition, and exploration. Nothing is labelled or social.
 */
export class ForagerScenario implements Scenario {
  readonly adapter = foragerAdapter;
  readonly edges = foragerEdges;
  readonly geography: WorldGeography = classicGeography;
  readonly scale: BodyScale = CLASSIC_SCALE;
  readonly terrain: TerrainField = { elevationBand };
  readonly demography = FORAGER_DEMOGRAPHY;
  readonly activity: ActivitySettings;

  constructor(
    readonly worldId: string,
    private readonly seed: string,
    private readonly agentCount: number,
    /** Present only so a test can prove the tiling is what it claims: a finite
     *  radius here makes this world skip dormant tiles too. Default: none. */
    activityRadius?: number,
  ) {
    this.activity = { tileSize: CONTINENT_TILE, radius: activityRadius ?? Number.POSITIVE_INFINITY };
  }

  narrator(host: NarrationHost): NarrativeAuthor {
    return new ForagerNarrator(host, this.geography);
  }

  build(world: World): ScenarioWorld {
    const rng = mulberry32(hashSeed(`${this.seed}:world`));
    const place = (kind: ResourceNodeKind, x: number, y: number, stock: number): void => {
      world.createEntity({ Transform2D: { x, y }, ResourceNode: createResourceNode(kind, stock) }, STATIC);
    };
    // Rejection-sample `count` nodes of `kind` inside a given region.
    const scatter = (kind: ResourceNodeKind, region: Region, count: number, stock: number): void => {
      let placed = 0;
      for (let attempts = 0; placed < count && attempts < count * 90; attempts++) {
        const x = 8 + rng() * (WORLD - 16);
        const y = 8 + rng() * (WORLD - 16);
        if (regionAt(x, y) !== region) continue;
        place(kind, x, y, stock);
        placed++;
      }
    };

    // Great river + tributary — drinking water along the lines + abundant food
    // banks (the continent's breadbasket; supports dense populations).
    for (let x = WORLD * 0.06; x <= WORLD * 0.84; x += 30) place('river', x, riverY(x), 9999);
    for (let x = WORLD * 0.36; x <= WORLD * 0.82; x += 34) place('river', x, tributaryY(x), 9999);
    scatter('berryBush', 'river', 150, 18);
    scatter('tuberPlant', 'river', 120, 18);
    scatter('clayDeposit', 'river', 36, 20);
    scatter('fiberPlant', 'river', 26, 10);

    // Lakes — freshwater drawn from the SHORE (the centre is impassable water),
    // plus fertile shores.
    for (const [cx, cy, r] of LAKE_CENTERS) {
      place('waterSource', cx + r + 10, cy, 9999);
      place('waterSource', cx - r - 10, cy, 9999);
      place('waterSource', cx, cy + r + 10, 9999);
      place('waterSource', cx, cy - r - 10, 9999);
    }
    scatter('berryBush', 'lake', 34, 16);
    scatter('tuberPlant', 'lake', 26, 16);
    scatter('fiberPlant', 'lake', 22, 10);

    // Wetlands — reeds (fiber), clay, tubers, standing water.
    scatter('waterSource', 'wetland', 18, 9999);
    scatter('fiberPlant', 'wetland', 56, 12);
    scatter('clayDeposit', 'wetland', 34, 18);
    scatter('tuberPlant', 'wetland', 30, 12);

    // Coast — sea water reachable from the beach (not out in the deep) + salt.
    for (let y = 20; y < WORLD - 20; y += 40) place('waterSource', WORLD * 0.05, y, 9999);
    scatter('saltFlat', 'coast', 30, 14);
    scatter('fiberPlant', 'coast', 26, 10);
    scatter('berryBush', 'coast', 18, 12);

    // Forests — wood-rich, decent food, and poison-plant danger.
    scatter('tree', 'forest', 240, 10);
    scatter('berryBush', 'forest', 90, 14);
    scatter('tuberPlant', 'forest', 56, 14);
    scatter('nightshadePlant', 'forest', 36, 6);
    scatter('mushroomPatch', 'forest', 28, 8);
    scatter('fiberPlant', 'forest', 28, 10);

    // Mountains — resource-rich, FOOD-POOR (no food placed here on purpose).
    scatter('stoneDeposit', 'mountain', 60, 14);
    scatter('copperVein', 'mountain', 42, 10);
    scatter('ironVein', 'mountain', 34, 10);
    scatter('coalSeam', 'mountain', 34, 12);
    scatter('tinVein', 'mountain', 26, 8);
    scatter('gemVein', 'mountain', 18, 4);
    scatter('silverVein', 'mountain', 14, 4);
    scatter('goldVein', 'mountain', 7, 3);

    // Hills — stone + clay, a little wood.
    scatter('stoneDeposit', 'hills', 46, 12);
    scatter('clayDeposit', 'hills', 28, 16);
    scatter('tree', 'hills', 28, 8);

    // Plains — modest forage so the open ground isn't a death zone.
    scatter('berryBush', 'plains', 100, 10);
    scatter('tuberPlant', 'plains', 70, 10);
    scatter('fiberPlant', 'plains', 46, 8);
    scatter('mushroomPatch', 'plains', 28, 8);

    // Spawn in a generous CENTRAL band — dense enough that groups meet and
    // knowledge spreads, with the whole continent around them to migrate into.
    const founders = spawnGahallians(
      world,
      this.agentCount,
      this.seed,
      { x: WORLD * 0.14, y: WORLD * 0.2, width: WORLD * 0.5, height: WORLD * 0.6 },
      -this.adapter.time.adultAge, // the founders are already adults (able to reproduce)
      isDeepWater, // never born in the sea or a lake
    );

    // Wild animals roam the lowlands — mobile food, and a reason to range.
    const wildlife = new WildlifeSystem(
      this.seed,
      Math.max(40, Math.round(this.agentCount * 0.6)),
      this.geography,
      this.scale,
    );
    return { founders, wildlife };
  }
}
