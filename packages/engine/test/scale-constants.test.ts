import { describe, expect, it } from 'vitest';
import { CLASSIC_SCALE, classicGeography } from '../src/world/geography.js';
import type { BodyScale } from '../src/world/geography.js';
import { CONTINENT_SCALE, SCALE_TABLE, scaleReport } from '../src/worlds/forager/scale.js';
import { PERCEPTION_RADIUS_DAY, PERCEPTION_RADIUS_NIGHT, TICKS_PER_DAY } from '../src/body/WorldRegularities.js';

/**
 * THE CONSTANTS TABLE, PINNED AS DATA.
 *
 * `SCALE_TABLE` is the audit the continent was built under: every scale-bearing
 * number, what it means in metres or metres per second, and why it did or did
 * not move when one unit became one metre. A table nobody checks is a comment,
 * so this holds it to three things — it says the truth about the live objects,
 * it covers every constant those objects carry, and it explains every change.
 */

const ANIMALS = ['deer', 'hare', 'boar', 'fish', 'wolf', 'bear', 'crocodile'] as const;

describe('the scale table', () => {
  const rows = new Map(SCALE_TABLE.map((r) => [r.constant, r]));

  it('quotes the live values, not remembered ones', () => {
    for (const key of Object.keys(CLASSIC_SCALE) as (keyof BodyScale)[]) {
      if (key === 'animalSpeed') continue;
      const row = rows.get(key);
      expect(row, `no row explains ${key}`).toBeDefined();
      expect(row!.classic, key).toBe(CLASSIC_SCALE[key]);
      expect(row!.continent, key).toBe(CONTINENT_SCALE[key]);
    }
    for (const kind of ANIMALS) {
      const row = rows.get(`animalSpeed.${kind}`)!;
      expect(row.classic).toBe(CLASSIC_SCALE.animalSpeed[kind]);
      expect(row.continent).toBe(CONTINENT_SCALE.animalSpeed[kind]);
    }
  });

  it('covers every constant, and explains every change', () => {
    const keys = Object.keys(CLASSIC_SCALE);
    expect(Object.keys(CONTINENT_SCALE).sort()).toEqual(keys.sort());
    for (const row of SCALE_TABLE) {
      expect(row.meaning.length, row.constant).toBeGreaterThan(8);
      if (row.classic !== row.continent) {
        expect(row.why, `${row.constant} changed but does not say CHANGED`).toContain('CHANGED');
      }
    }
    // Most of the table is UNCHANGED on purpose — that is the claim that makes
    // a behaviour difference between the worlds about the world.
    const changed = SCALE_TABLE.filter((r) => r.classic !== r.continent);
    const unchanged = SCALE_TABLE.length - changed.length;
    expect(changed).toHaveLength(11);
    expect(unchanged).toBe(20);
  });

  it('holds the classic column against the modules the values came from', () => {
    // If someone edits a body constant without touching the table, this fails.
    expect(CLASSIC_SCALE.perceptionDay).toBe(PERCEPTION_RADIUS_DAY);
    expect(CLASSIC_SCALE.perceptionNight).toBe(PERCEPTION_RADIUS_NIGHT);
    expect(rows.get('ticksPerDay')!.classic).toBe(TICKS_PER_DAY);
    expect(CLASSIC_SCALE.moveSpeed).toBe(0.5);
    expect(CLASSIC_SCALE.arriveDistance).toBe(1.0);
    expect(CLASSIC_SCALE.interactRange).toBe(2.5);
    expect(CLASSIC_SCALE.giveRange).toBe(3);
    expect(CLASSIC_SCALE.attackRange).toBe(2);
    expect(CLASSIC_SCALE.socialRange).toBe(8);
    expect(CLASSIC_SCALE.nearWaterRadius).toBe(12);
    expect(CLASSIC_SCALE.inShelterRadius).toBe(4);
    expect(CLASSIC_SCALE.predatorDetect).toBe(42);
    expect(CLASSIC_SCALE.predatorGiveUp).toBe(70);
    expect(CLASSIC_SCALE.predatorAttack).toBe(7);
    expect(CLASSIC_SCALE.preyFear).toBe(46);
    expect(CLASSIC_SCALE.childSpawnJitter).toBe(3);
  });

  it('scales every animal by exactly the walking ratio', () => {
    const pace = CONTINENT_SCALE.moveSpeed / CLASSIC_SCALE.moveSpeed;
    for (const kind of ANIMALS) {
      expect(CONTINENT_SCALE.animalSpeed[kind]!, kind).toBeCloseTo(CLASSIC_SCALE.animalSpeed[kind]! * pace, 10);
    }
    // …so a fleeing being still outruns the fastest predator by the same
    // fraction of its own pace, which is what keeps predation comparable.
    const margin = (s: BodyScale): number =>
      (s.moveSpeed * s.fleeSpeed - s.animalSpeed['wolf']!) / s.moveSpeed;
    expect(margin(CONTINENT_SCALE)).toBeCloseTo(margin(CLASSIC_SCALE), 10);
  });

  it('keeps the chase the same LENGTH OF TIME, not the same distance', () => {
    const ticks = (s: BodyScale): number =>
      (s.predatorGiveUp - s.predatorDetect) / (s.moveSpeed * s.fleeSpeed - s.animalSpeed['wolf']!);
    expect(ticks(CONTINENT_SCALE)).toBeCloseTo(ticks(CLASSIC_SCALE), 0);
  });

  it('gives every animal kind a speed in both worlds', () => {
    for (const kind of ANIMALS) {
      expect(CLASSIC_SCALE.animalSpeed[kind], kind).toBeGreaterThan(0);
      expect(CONTINENT_SCALE.animalSpeed[kind], kind).toBeGreaterThan(0);
    }
    expect(Object.keys(CONTINENT_SCALE.animalSpeed).sort()).toEqual([...ANIMALS].sort());
  });

  it('cannot be written to by anything that reads it', () => {
    expect(Object.isFrozen(CLASSIC_SCALE)).toBe(true);
    expect(Object.isFrozen(CONTINENT_SCALE)).toBe(true);
    expect(Object.isFrozen(classicGeography)).toBe(true);
    expect(Object.isFrozen(SCALE_TABLE)).toBe(true);
  });

  it('agrees with the scale report a viewer will read', () => {
    expect(scaleReport('forager-continent').walkSpeedMPerTick).toBe(CONTINENT_SCALE.moveSpeed);
    expect(scaleReport('forager-classic').walkSpeedMPerTick).toBe(CLASSIC_SCALE.moveSpeed);
  });
});
