import { CLASSIC_SCALE } from '../../world/geography.js';
import type { BodyScale } from '../../world/geography.js';
import { WORLD } from '../../world/regions.js';
import {
  CONTINENT_LAKES,
  CONTINENT_SPAN,
  FOUNDING_VALLEY,
  HIGHLAND_M,
  RIVER_COUNT,
  UPLAND_M,
} from '../../world/continent.js';

/** The two forager worlds a run may be started in. */
export type ScenarioId = 'forager-classic' | 'forager-continent';

/**
 * How much faster a person walks on the continent than in the classic world.
 * Every animal speed is multiplied by exactly this, so predator-versus-person
 * is the same chase it always was — only the metres are real now.
 */
const PACE = 2.8;

const classicAnimal = CLASSIC_SCALE.animalSpeed;

/**
 * THE CONTINENT'S BODY CONSTANTS. A value differs from the classic world's
 * ONLY where the classic one is physically impossible at 1 unit = 1 metre;
 * everything else is held equal so survival balance stays comparable and a
 * behaviour difference between the two worlds is about the WORLD.
 * `SCALE_TABLE` below says which, and why, row by row.
 */
export const CONTINENT_SCALE: BodyScale = Object.freeze({
  ...CLASSIC_SCALE,
  moveSpeed: 1.4,
  predatorGiveUp: 120,
  animalSpeed: Object.freeze({
    deer: classicAnimal['deer']! * PACE,
    hare: classicAnimal['hare']! * PACE,
    boar: classicAnimal['boar']! * PACE,
    fish: classicAnimal['fish']! * PACE,
    wolf: classicAnimal['wolf']! * PACE,
    bear: classicAnimal['bear']! * PACE,
    crocodile: classicAnimal['crocodile']! * PACE,
  }),
});

export interface ScaleRow {
  readonly constant: string;
  readonly classic: number;
  readonly continent: number;
  readonly meaning: string;
  readonly why: string;
}

const KEPT = 'physically plausible at 1 m = 1 unit, so held equal — a shared value keeps survival balance comparable';

/**
 * THE AUDIT, AS DATA. Every scale-bearing constant the continent uses, what it
 * means in metres or metres per second, and why it did or did not move.
 * `test/scale-constants.test.ts` pins each row against the live `BodyScale`
 * objects and fails if a constant exists that no row explains.
 */
export const SCALE_TABLE: readonly ScaleRow[] = Object.freeze([
  {
    constant: 'moveSpeed',
    classic: CLASSIC_SCALE.moveSpeed,
    continent: CONTINENT_SCALE.moveSpeed,
    meaning: 'walking pace, metres per tick — and a tick is one second',
    why: 'CHANGED. 0.5 m/s is 1.8 km/h, half a human shuffle; 1.4 m/s is the measured mean adult walk.',
  },
  {
    constant: 'fleeSpeed',
    classic: CLASSIC_SCALE.fleeSpeed,
    continent: CONTINENT_SCALE.fleeSpeed,
    meaning: 'multiplier while fleeing — 2.1 m/s on the continent',
    why: `a frightened jog. ${KEPT}`,
  },
  {
    constant: 'arriveDistance',
    classic: CLASSIC_SCALE.arriveDistance,
    continent: CONTINENT_SCALE.arriveDistance,
    meaning: 'close enough to have arrived (m)',
    why: `a pace. ${KEPT} — and shorter than a continent stride (1.4 m), so the walker clamps its last step to the distance left rather than stepping over its own threshold (YggdrasilSystem.moveToward). In the classic world a stride is shorter than the threshold and the clamp never binds.`,
  },
  {
    constant: 'interactRange',
    classic: CLASSIC_SCALE.interactRange,
    continent: CONTINENT_SCALE.interactRange,
    meaning: 'reach to a bush or a seam (m)',
    why: `arm plus a lean. ${KEPT}`,
  },
  {
    constant: 'giveRange',
    classic: CLASSIC_SCALE.giveRange,
    continent: CONTINENT_SCALE.giveRange,
    meaning: 'hand to hand, or bending to water (m)',
    why: KEPT,
  },
  {
    constant: 'attackRange',
    classic: CLASSIC_SCALE.attackRange,
    continent: CONTINENT_SCALE.attackRange,
    meaning: 'striking distance (m)',
    why: KEPT,
  },
  {
    constant: 'socialRange',
    classic: CLASSIC_SCALE.socialRange,
    continent: CONTINENT_SCALE.socialRange,
    meaning: 'company close enough to ease the social need (m)',
    why: `a group round a fire. ${KEPT}`,
  },
  {
    constant: 'nearWaterRadius',
    classic: CLASSIC_SCALE.nearWaterRadius,
    continent: CONTINENT_SCALE.nearWaterRadius,
    meaning: 'the `nearWater` context feature (m)',
    why: `on the bank. ${KEPT}`,
  },
  {
    constant: 'inShelterRadius',
    classic: CLASSIC_SCALE.inShelterRadius,
    continent: CONTINENT_SCALE.inShelterRadius,
    meaning: 'inside a shelter (m)',
    why: `a hut is about 8 m across. ${KEPT}`,
  },
  {
    constant: 'perceptionDay',
    classic: CLASSIC_SCALE.perceptionDay,
    continent: CONTINENT_SCALE.perceptionDay,
    meaning: 'how far a person NOTICES a thing by day (m)',
    why: `a human sees a mountain, but picks a berry bush out at about 90 m. ${KEPT} — and this is the single constant survival is most sensitive to.`,
  },
  {
    constant: 'perceptionNight',
    classic: CLASSIC_SCALE.perceptionNight,
    continent: CONTINENT_SCALE.perceptionNight,
    meaning: 'the same, in the dark (m)',
    why: KEPT,
  },
  {
    constant: 'predatorDetect',
    classic: CLASSIC_SCALE.predatorDetect,
    continent: CONTINENT_SCALE.predatorDetect,
    meaning: 'a beast notices a person (m)',
    why: KEPT,
  },
  {
    constant: 'predatorGiveUp',
    classic: CLASSIC_SCALE.predatorGiveUp,
    continent: CONTINENT_SCALE.predatorGiveUp,
    meaning: 'a beast abandons a chase (m)',
    why: 'CHANGED. A chase ends when the quarry has opened the gap; at 2.8× the pace the same 90-tick chase covers 120 m, not 70. The DURATION is what was held equal.',
  },
  {
    constant: 'predatorAttack',
    classic: CLASSIC_SCALE.predatorAttack,
    continent: CONTINENT_SCALE.predatorAttack,
    meaning: 'a beast can maul from here (m)',
    why: `a lunge. ${KEPT}`,
  },
  {
    constant: 'preyFear',
    classic: CLASSIC_SCALE.preyFear,
    continent: CONTINENT_SCALE.preyFear,
    meaning: 'prey bolt from a predator within this (m)',
    why: "value held equal but DELIBERATELY UNUSED on the continent, and it stays that way: prey fleeing predators is an animal↔animal interaction, so it would happen — or not — depending on whether the tile was awake, which is exactly what activity regions may not let a being observe. The classic world's WildlifeSystem is the only reader.",
  },
  ...(['deer', 'hare', 'boar', 'fish', 'wolf', 'bear', 'crocodile'] as const).map((kind) => ({
    constant: `animalSpeed.${kind}`,
    classic: CLASSIC_SCALE.animalSpeed[kind]!,
    continent: CONTINENT_SCALE.animalSpeed[kind]!,
    meaning: 'metres per tick',
    why: `CHANGED, by exactly the ${PACE}× walking ratio, so how far a ${kind} is ahead of or behind a person is untouched.`,
  })),
  {
    constant: 'childSpawnJitter',
    classic: CLASSIC_SCALE.childSpawnJitter,
    continent: CONTINENT_SCALE.childSpawnJitter,
    meaning: 'how far from its parents a newborn lands (m)',
    why: `beside them. ${KEPT}`,
  },
  {
    constant: 'sacredPlaceRadius',
    classic: CLASSIC_SCALE.sacredPlaceRadius,
    continent: CONTINENT_SCALE.sacredPlaceRadius,
    meaning: 'INSTRUMENT: how close two story sites are one place (m)',
    why: 'a shrine does not grow because the map did. Held equal so sacred-place counts are comparable between the worlds.',
  },
  {
    constant: 'congregationRadius',
    classic: CLASSIC_SCALE.congregationRadius,
    continent: CONTINENT_SCALE.congregationRadius,
    meaning: 'INSTRUMENT: counted as gathered at a story site (m)',
    why: 'held equal; its uniform-density baseline divides by the WORLD’s own span, which is what actually had to change.',
  },
  {
    constant: 'elevationBand.upland',
    classic: 4,
    continent: UPLAND_M,
    meaning: 'height at which ground becomes `upland` (m)',
    why: 'CHANGED. 4 m is upland only in a world whose highest point is 20 m. 120 m is a hill.',
  },
  {
    constant: 'elevationBand.highland',
    classic: 8,
    continent: HIGHLAND_M,
    meaning: 'height at which ground becomes `highland` — the miners’ feature (m)',
    why: 'CHANGED. Same reason; 400 m puts the feature on the range, which is where the ore is, preserving what `highland` MEANT.',
  },
  {
    constant: 'reproRange',
    classic: 14,
    continent: 14,
    meaning: 'how close two adults must be to pair (m)',
    why: KEPT,
  },
  {
    constant: 'coPresenceRange',
    classic: 13,
    continent: 13,
    meaning: 'together often enough to bond, and within earshot (m)',
    why: `conversational distance. ${KEPT}`,
  },
  {
    constant: 'ticksPerDay',
    classic: 2400,
    continent: 2400,
    meaning: 'a day, in ticks — a 40-minute day at one tick per second',
    why: 'the convention every sandbox uses; the same in both worlds, so every need-decay rate is comparable without conversion.',
  },
  {
    constant: 'reflexWanderStride',
    classic: 22,
    continent: 22,
    meaning: 'shortest leg of a roaming walk (m); curiosity stretches it to 48',
    why: 'UNCHANGED AND UNCHANGEABLE HERE — it lives in `ReflexMind`, which this item may not touch. 22–48 m is a plausible leg either way, but it means a continent being re-plans 2.8× as often as a classic one.',
  },
]);

/** The height a grown Gahallian is taken to be, in metres. */
export const ADULT_HEIGHT_M = 1.7;

/** Measured on a 16 m grid by `test/continent-relief.test.ts`. */
const CONTINENT_PEAK_M = 899.2;
const CONTINENT_LAND_SPAN_M = 6816;
const CONTINENT_WALKABLE_KM2 = 41.06;
/** Measured the same way over `world/regions.ts`. */
const CLASSIC_PEAK_M = 20.01;
const CLASSIC_WALKABLE_KM2 = 3.73;

export interface ScaleReport {
  readonly scenario: ScenarioId;
  /** 1, by definition, in every world — stated so a viewer can assert it. */
  readonly metresPerUnit: number;
  readonly secondsPerTick: number;
  readonly ticksPerDay: number;
  readonly adultHeightM: number;
  readonly walkSpeedMPerTick: number;
  readonly worldSpanM: number;
  readonly landSpanM: number;
  readonly walkableAreaKm2: number;
  readonly maxPeakM: number;
  readonly uplandFromM: number;
  readonly highlandFromM: number;
  readonly riverCount: number;
  readonly lakeCount: number;
  readonly valley: {
    readonly x: number;
    readonly y: number;
    readonly widthM: number;
    readonly floorM: number;
  } | null;
}

/**
 * WHAT SIZE THIS WORLD IS, in the units a human uses — a pure lookup, so the
 * lab can print it beside a render without building a world. Every measured
 * figure is pinned by `test/continent-relief.test.ts`; a terrain change that
 * moves one fails there rather than quietly making this file a lie.
 */
export function scaleReport(scenario: ScenarioId): ScaleReport {
  const continent = scenario === 'forager-continent';
  return {
    scenario,
    metresPerUnit: 1,
    secondsPerTick: 1,
    ticksPerDay: 2400,
    adultHeightM: ADULT_HEIGHT_M,
    walkSpeedMPerTick: continent ? CONTINENT_SCALE.moveSpeed : CLASSIC_SCALE.moveSpeed,
    worldSpanM: continent ? CONTINENT_SPAN : WORLD,
    landSpanM: continent ? CONTINENT_LAND_SPAN_M : WORLD,
    walkableAreaKm2: continent ? CONTINENT_WALKABLE_KM2 : CLASSIC_WALKABLE_KM2,
    maxPeakM: continent ? CONTINENT_PEAK_M : CLASSIC_PEAK_M,
    uplandFromM: continent ? UPLAND_M : 4,
    highlandFromM: continent ? HIGHLAND_M : 8,
    riverCount: continent ? RIVER_COUNT : 2,
    lakeCount: continent ? CONTINENT_LAKES.length : 3,
    valley: continent
      ? {
          x: FOUNDING_VALLEY.x,
          y: FOUNDING_VALLEY.y,
          widthM: FOUNDING_VALLEY.half * 2,
          floorM: 12.4,
        }
      : null,
  };
}
