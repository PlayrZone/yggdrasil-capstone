import { describe, expect, it } from 'vitest';
import { MATERIAL_PROPERTIES, isEdible, isPoisonous } from '../src/index.js';
import type { ObjectKind } from '../src/index.js';

describe('material properties (not recipes)', () => {
  it('classifies edible vs poisonous foods', () => {
    expect(isEdible('berry')).toBe(true);
    expect(isEdible('tuber')).toBe(true);
    expect(isEdible('meat')).toBe(true);
    expect(isPoisonous('mushroomRed')).toBe(true);
    expect(isPoisonous('nightshade')).toBe(true);
    // A material is never both.
    for (const kind of Object.keys(MATERIAL_PROPERTIES) as ObjectKind[]) {
      expect(isEdible(kind) && isPoisonous(kind)).toBe(false);
    }
  });

  it('ores carry the metal they smelt to (the discoverable chain, no recipe)', () => {
    expect(MATERIAL_PROPERTIES.copperOre?.smeltsTo).toBe('copper');
    expect(MATERIAL_PROPERTIES.tinOre?.smeltsTo).toBe('tin');
    expect(MATERIAL_PROPERTIES.ironOre?.smeltsTo).toBe('iron');
  });

  it('encodes the property primitives technology could emerge from', () => {
    expect(MATERIAL_PROPERTIES.clay?.moldable).toBe(true); // → brick under heat
    expect(MATERIAL_PROPERTIES.fiber?.twistable).toBe(true); // → rope
    expect(MATERIAL_PROPERTIES.coal?.burnsHot).toBe(true); // → smelting fuel
    expect(MATERIAL_PROPERTIES.salt?.preserves).toBe(true); // → food storage
    expect(MATERIAL_PROPERTIES.hide?.worksTo).toBe('leather');
    expect(MATERIAL_PROPERTIES.wood?.burns).toBe(true);
  });

  it('tiers the materials for distribution/analysis', () => {
    expect(MATERIAL_PROPERTIES.water?.tier).toBe('basic');
    expect(MATERIAL_PROPERTIES.copperOre?.tier).toBe('advanced');
    expect(MATERIAL_PROPERTIES.gold?.tier).toBe('rare');
    expect(MATERIAL_PROPERTIES.brick?.tier).toBe('intermediate');
  });
});
