import {
  WORLD,
  EDGE,
  clampToWorld,
  elevationBand,
  heightAt,
  isDeepWater,
  isWater,
  regionAt,
} from './regions.js';
import type { Region } from './regions.js';

/**
 * THE GROUND, AS A SCENARIO SUPPLIES IT.
 *
 * Every body system used to import `world/regions.js` directly, which meant the
 * engine could only ever have one map. This is the same set of questions —
 * where is the water, how high is it here, where does the world stop — as an
 * object the scenario hands over, so a second world is a second value rather
 * than a branch inside `YggdrasilSystem`.
 *
 * UNITS: one world unit is one METRE, everywhere, in every world. `heightAt`
 * answers in metres above sea level and may be negative (the sea floor).
 * `slopeAt` is |∇h| — dimensionless rise over run, so 1.0 is 45°.
 *
 * This is the near side of the adapter's future `space` (W1-B4): it is still
 * cartesian x/y, because the body is, and only the body and the instrument may
 * read it. No mind sees a coordinate.
 */
export interface WorldGeography {
  readonly id: string;
  /** Side of the square world, in metres. Coordinates live in [0, span]. */
  readonly span: number;
  /** Hard-boundary inset. Points are kept inside [edge, span − edge]. */
  readonly edge: number;
  /**
   * Where this world's people begin — the one place anything that needs
   * "somewhere in particular" (a seeded myth with no site) should use.
   */
  readonly origin: Readonly<{ x: number; y: number }>;
  /** Metres above sea level. Negative is under water. */
  heightAt(x: number, y: number): number;
  /** |∇heightAt| at a point — rise over run, bounded by design. */
  slopeAt(x: number, y: number): number;
  /** 0 lowland · 1 upland · 2 highland. Thresholds are the world's own. */
  elevationBand(x: number, y: number): number;
  regionAt(x: number, y: number): Region;
  /** Any water — sea, lake, river. Fish and crocodile habitat. */
  isWater(x: number, y: number): boolean;
  /** Water a walker cannot enter. Rivers stay fordable. */
  isDeepWater(x: number, y: number): boolean;
  /** Keep a point inside the world's hard boundary. Mutates in place. */
  clamp(p: { x: number; y: number }): void;
}

/**
 * THE SCALE-BEARING CONSTANTS OF A BODY, as data.
 *
 * Every one of these used to be a module constant in `YggdrasilSystem`,
 * `PerceptionSystem`, `WildlifeSystem` or `WorldRegularities`, which is fine
 * while there is one world and fatal the moment two worlds disagree about how
 * far a metre is. The audited table — what each means physically, and why it
 * does or does not change between the two forager scenarios — is
 * `worlds/forager/scale.ts`.
 *
 * Lengths are METRES; speeds are metres per tick, and a tick is one second of
 * motion.
 */
export interface BodyScale {
  /** Walking pace. */
  readonly moveSpeed: number;
  /** Multiplier on `moveSpeed` while fleeing. */
  readonly fleeSpeed: number;
  /** Close enough to count as arrived at a destination. */
  readonly arriveDistance: number;
  /** Reach to a resource node (gather). */
  readonly interactRange: number;
  /** Reach to another person or a container (give, deposit, withdraw, drink). */
  readonly giveRange: number;
  /** Striking distance. */
  readonly attackRange: number;
  /** Company close enough to relieve the social need. */
  readonly socialRange: number;
  /** "By the water" — the radius the `nearWater` context feature looks in. */
  readonly nearWaterRadius: number;
  /** "Inside" a shelter. */
  readonly inShelterRadius: number;
  /** How far a person notices things by day / by night. */
  readonly perceptionDay: number;
  readonly perceptionNight: number;
  /** A predator notices a person this close. */
  readonly predatorDetect: number;
  /** …and abandons the chase past here. */
  readonly predatorGiveUp: number;
  /** …and can maul one from here. */
  readonly predatorAttack: number;
  /** Prey bolt from a predator within this range. */
  readonly preyFear: number;
  /**
   * Metres per tick by animal kind. Keyed by string rather than `AnimalKind`
   * because `body/` imports this file, not the other way round;
   * `test/scale-constants.test.ts` pins that every kind has an entry.
   */
  readonly animalSpeed: Readonly<Record<string, number>>;
  /** How far apart a newborn may land from the midpoint of its parents. */
  readonly childSpawnJitter: number;
  /** INSTRUMENT ONLY: how close two story sites are still "the same place". */
  readonly sacredPlaceRadius: number;
  /** INSTRUMENT ONLY: the radius congregation around a story site is counted in. */
  readonly congregationRadius: number;
}

const EPS = 2; // metres — the half-step of the central difference below

/** |∇h| by central difference. Shared: every world's slope means the same thing. */
export function slopeOf(field: (x: number, y: number) => number, x: number, y: number): number {
  const dx = (field(x + EPS, y) - field(x - EPS, y)) / (2 * EPS);
  const dy = (field(x, y + EPS) - field(x, y - EPS)) / (2 * EPS);
  return Math.hypot(dx, dy);
}

/**
 * THE WORLD AS IT HAS ALWAYS BEEN — `world/regions.ts`, unchanged, behind the
 * interface. Every function is the same function, so the classic scenario is
 * bit-identical across this move; the goldens are the proof.
 *
 * Its scale is honestly out of proportion (a 2 km plane whose highest ground is
 * 21 m and whose people walk at 0.5 m/s) and is kept exactly so, because every
 * golden, every corpus and every published result stands on it.
 */
export const classicGeography: WorldGeography = Object.freeze({
  id: 'forager-classic',
  span: WORLD,
  edge: EDGE,
  origin: Object.freeze({ x: WORLD / 2, y: WORLD / 2 }),
  heightAt,
  slopeAt: (x: number, y: number) => slopeOf(heightAt, x, y),
  elevationBand,
  regionAt,
  isWater,
  isDeepWater,
  clamp: clampToWorld,
});

/**
 * The classic world's body constants, transcribed from the modules that owned
 * them: `YggdrasilSystem` (MOVE_SPEED … SOCIAL_RANGE), `PerceptionSystem`
 * (NEAR_WATER_RADIUS, IN_SHELTER_RADIUS), `WorldRegularities`
 * (PERCEPTION_RADIUS_*), `WildlifeSystem` (SPEED, DETECT, GIVE_UP_DIST,
 * ATTACK_R, FEAR_R), `society/Reproduction` (the ±3 birth jitter) and the
 * instrument's own radii. Values are unchanged; `test/scale-constants.test.ts`
 * pins each against its original.
 */
export const CLASSIC_SCALE: BodyScale = Object.freeze({
  moveSpeed: 0.5,
  fleeSpeed: 1.5,
  arriveDistance: 1.0,
  interactRange: 2.5,
  giveRange: 3,
  attackRange: 2,
  socialRange: 8,
  nearWaterRadius: 12,
  inShelterRadius: 4,
  perceptionDay: 92,
  perceptionNight: 38,
  predatorDetect: 42,
  predatorGiveUp: 70,
  predatorAttack: 7,
  preyFear: 46,
  animalSpeed: Object.freeze({
    deer: 0.34,
    hare: 0.4,
    boar: 0.3,
    fish: 0.3,
    wolf: 0.44,
    bear: 0.36,
    crocodile: 0.4,
  }),
  childSpawnJitter: 3,
  sacredPlaceRadius: 70,
  congregationRadius: 60,
});
