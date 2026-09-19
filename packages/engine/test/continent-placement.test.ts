import { describe, expect, it } from 'vitest';
import { Experiment } from '../src/runner/Experiment.js';
import type { Entity } from '../src/core/Entity.js';
import type { Transform2D } from '../src/core/Transform2D.js';
import type { ResourceNode } from '../src/body/ResourceNodeSystem.js';
import type { ResourceNodeKind } from '../src/worlds/forager/types.js';
import { DEFAULT_REGROW } from '../src/body/ResourceNodeSystem.js';
import { SEED_SPROUT_TICKS } from '../src/body/WorldRegularities.js';
import { ContinentScenario, MAX_DENSITY } from '../src/worlds/forager/continentScenario.js';
import { CONTINENT_ACTIVITY_RADIUS } from '../src/runner/Scenario.js';
import { CLASSIC_SCALE } from '../src/world/geography.js';
import { continentGeography, inFoundingValley } from '../src/world/continent.js';

/**
 * WHERE THINGS ARE, AND WHY. Resource placement on the continent is rules over
 * terrain fields, not a scatter over 42 km², and the rules are the reason a
 * being would ever leave the valley it was born in: the food is here, the ore
 * is in the range, the salt is on the coast. These are those rules, measured.
 */

const ORE: ReadonlySet<string> = new Set([
  'copperVein', 'tinVein', 'ironVein', 'coalSeam', 'silverVein', 'goldVein', 'gemVein',
]);
const FOOD: ReadonlySet<string> = new Set(['berryBush', 'tuberPlant', 'mushroomPatch', 'foodPlant']);
const WOOD: ReadonlySet<string> = new Set(['tree']);
const WATER: ReadonlySet<string> = new Set(['river', 'waterSource']);

/** Ten seeds, so nothing here can be true only of the one it was tuned on. */
const SEEDS = ['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9'];

interface Placed {
  x: number;
  y: number;
  kind: ResourceNodeKind;
}

function worldOf(scenario: 'forager-classic' | 'forager-continent', agents: number, seed = 'placement') {
  const exp = new Experiment({ seed, agentCount: agents, scenario });
  exp.advance(1); // let the wildlife stock itself
  const nodes: Placed[] = [];
  exp.world.forEach((e: Entity) => {
    const node = e.components['ResourceNode'] as ResourceNode | undefined;
    if (!node) return;
    const t = e.components['Transform2D'] as Transform2D;
    nodes.push({ x: t.x, y: t.y, kind: node.kind });
  });
  const founders = exp.agentIds
    .slice(0, agents)
    .map((id) => exp.agentEntity(id)!.components['Transform2D'] as Transform2D);
  return { exp, nodes, founders };
}

/** How many nodes of a set a being standing here has inside its eyesight. */
function inSight(nodes: Placed[], at: Transform2D, kinds: ReadonlySet<string>): number {
  const r2 = CLASSIC_SCALE.perceptionDay ** 2;
  let n = 0;
  for (const node of nodes) {
    if (!kinds.has(node.kind)) continue;
    if ((node.x - at.x) ** 2 + (node.y - at.y) ** 2 <= r2) n++;
  }
  return n;
}

function mean(ns: Placed[], at: Transform2D[], kinds: ReadonlySet<string>): number {
  return at.reduce((s, p) => s + inSight(ns, p, kinds), 0) / at.length;
}

describe('founder placement', () => {
  const { nodes, founders } = worldOf('forager-continent', 150);

  it('puts every founder inside the one valley, and none in deep water', () => {
    expect(founders).toHaveLength(150);
    for (const f of founders) {
      expect(inFoundingValley(f.x, f.y), `founder at ${f.x},${f.y}`).toBe(true);
      expect(continentGeography.isDeepWater(f.x, f.y)).toBe(false);
    }
  });

  /**
   * THE PARITY CLAIM, ON TEN SEEDS.
   *
   * "Early survival is comparable" means what a founder can SEE, not what the
   * map contains. Both sides of the ratio are measured the same way — the mean
   * over 150 founders of the nodes inside 92 m — but they are NOT equally
   * stable. The classic world scatters its wood into forest patches and drops
   * its founders over a 1.2 km band, so whether a founder sees any wood at all
   * is mostly luck: its per-seed means swing by a factor of 1.6 on their own.
   * That swing is what made the single-seed version of this test pass on its
   * own seed and miss the band (wood ×1.43) on an unseen one.
   *
   * So the BASELINE is the classic world pooled over the same ten seeds, and
   * each continent seed is held against it. The continent side needs no
   * pooling: its densities are placed by systematic accumulation rather than
   * by a die per candidate, and the spread below records how tight that is.
   */
  it('gives a founder as much to eat, drink and build with as the classic world did', () => {
    const baseline = { food: 0, wood: 0, water: 0 };
    const here: Record<string, number[]> = { food: [], wood: [], water: [] };
    const waterNodes: number[] = [];
    for (const seed of SEEDS) {
      const classic = worldOf('forager-classic', 150, seed);
      baseline.food += mean(classic.nodes, classic.founders, FOOD) / SEEDS.length;
      baseline.wood += mean(classic.nodes, classic.founders, WOOD) / SEEDS.length;
      baseline.water += mean(classic.nodes, classic.founders, WATER) / SEEDS.length;
      const cont = worldOf('forager-continent', 150, seed);
      here['food']!.push(mean(cont.nodes, cont.founders, FOOD));
      here['wood']!.push(mean(cont.nodes, cont.founders, WOOD));
      here['water']!.push(mean(cont.nodes, cont.founders, WATER));
      waterNodes.push(cont.nodes.filter((n) => n.kind === 'river').length);
    }
    for (const key of ['food', 'wood', 'water'] as const) {
      const seen = here[key]!;
      const lo = Math.min(...seen) / baseline[key];
      const hi = Math.max(...seen) / baseline[key];
      const label = `${key}: continent ${seen.map((v) => v.toFixed(1)).join('/')} vs classic ${baseline[key].toFixed(1)}`;
      expect(lo, label).toBeGreaterThan(0.65);
      expect(hi, label).toBeLessThan(1.35);
    }
    // The scattered kinds are placed by accumulation, so what a founder can
    // see barely moves between seeds — that is what makes the band above a
    // construction rather than luck.
    for (const key of ['food', 'wood'] as const) {
      const seen = here[key]!;
      expect(Math.max(...seen) / Math.min(...seen), `${key} spread`).toBeLessThan(1.25);
    }
    // A river's drinking points are not scattered at all — they are laid along
    // its course, identically on every seed — so a valley founder's ±30 % is
    // entirely where the 150 of them happened to stand relative to the bank.
    expect(new Set(waterNodes).size, `river node counts ${waterNodes.join('/')}`).toBe(1);
  }, 600_000);
});

describe('habitat rules', () => {
  const { nodes } = worldOf('forager-continent', 40);

  it('keeps every seam of ore and every gem in the range, and none in the valley', () => {
    let ore = 0;
    for (const node of nodes) {
      if (!ORE.has(node.kind)) continue;
      ore++;
      expect(continentGeography.regionAt(node.x, node.y), `${node.kind} at ${node.x},${node.y}`).toBe('mountain');
      expect(inFoundingValley(node.x, node.y)).toBe(false);
    }
    expect(ore).toBeGreaterThan(500); // the range is worth the walk
  });

  it('puts salt only on the coast', () => {
    const salt = nodes.filter((n) => n.kind === 'saltFlat');
    expect(salt.length).toBeGreaterThan(50);
    for (const node of salt) expect(continentGeography.regionAt(node.x, node.y)).toBe('coast');
  });

  it('puts nothing in open water, and drinkable water along every river', () => {
    for (const node of nodes) {
      if (node.kind === 'game') continue; // fish live in it
      expect(continentGeography.isDeepWater(node.x, node.y), `${node.kind}`).toBe(false);
    }
    expect(nodes.filter((n) => n.kind === 'river').length).toBeGreaterThan(300);
  });

  it('makes the ground near fresh water the fertile ground', () => {
    // Food per km² inside the founding valley, against food per km² on plains
    // more than 2 km from it and away from any river. The habitat rule, as a
    // ratio. The two areas are the valley's 0.706 km² and a 700 m disc.
    let near = 0;
    let far = 0;
    for (const node of nodes) {
      if (!FOOD.has(node.kind)) continue;
      if (inFoundingValley(node.x, node.y)) near++;
      else if (Math.hypot(node.x - 6200, node.y - 5200) < 700) far++;
    }
    expect(near / 0.706).toBeGreaterThan((far / (Math.PI * 0.49)) * 2);
  });

  /**
   * THE DENSITY IS THE TARGET, NOT AN EXPECTATION AROUND IT. Systematic
   * accumulation means a habitat's realised count is its table rounded, so the
   * same seed-independent totals come back run after run. Pinned as a spread
   * rather than a literal: a table change should move both ends together.
   */
  it('places the same counts on every seed', () => {
    const counts = SEEDS.slice(0, 6).map((seed) => {
      const world = worldOf('forager-continent', 20, seed);
      const by = new Map<string, number>();
      for (const node of world.nodes) by.set(node.kind, (by.get(node.kind) ?? 0) + 1);
      return by;
    });
    for (const kind of ['berryBush', 'tree', 'tuberPlant', 'stoneDeposit', 'goldVein', 'saltFlat']) {
      const seen = counts.map((by) => by.get(kind) ?? 0);
      expect(Math.min(...seen), `${kind} is never placed`).toBeGreaterThan(0);
      expect(Math.max(...seen) / Math.min(...seen), `${kind}: ${seen.join('/')}`).toBeLessThan(1.15);
    }
  }, 600_000);

  /**
   * THE VALLEY FEEDS ABOUT THE BAND THAT FOUNDS IT — the whole point of the
   * ecology rebuild. Measured from the world as built: count the food nodes
   * inside `inFoundingValley`, turn their regrowth intervals into items per
   * day over a whole year, and divide by what one being eats. The answer has
   * to land near `VALLEY_CARRYING_CAPACITY`, or the derivation in
   * `continentScenario.ts` has drifted from the world it claims to describe.
   */
  it('feeds roughly its founding band, and no more', () => {
    const report = new ContinentScenario('x', 'placement', 150, CONTINENT_ACTIVITY_RADIUS).ecologyReport();
    const exp = new Experiment({ seed: 'placement', agentCount: 150, scenario: 'forager-continent' });
    exp.advance(1);
    let perDay = 0;
    let valleyFood = 0;
    exp.world.forEach((e: Entity) => {
      if (e.components['Animal']) return;
      const node = e.components['ResourceNode'] as ResourceNode | undefined;
      if (!node || !FOOD.has(node.kind) || node.regrowEvery <= 0) return;
      const t = e.components['Transform2D'] as Transform2D;
      if (!inFoundingValley(t.x, t.y)) return;
      valleyFood++;
      perDay += (2400 / node.regrowEvery) * 0.625; // winter halts, autumn halves
    });
    expect(valleyFood, 'no food in the founding valley').toBeGreaterThan(100);
    const eats = (0.022 * 2400 * 1.21) / 55; // hunger burnt per day ÷ one meal
    const supports = perDay / eats;
    expect(supports, `the valley feeds ${supports.toFixed(0)}`).toBeGreaterThan(report.capacity * 0.85);
    expect(supports, `the valley feeds ${supports.toFixed(0)}`).toBeLessThan(report.capacity * 1.15);
    // …and it gets there by regrowing slower, not by holding fewer bushes.
    expect(report.slowdown).toBeGreaterThan(1);
    expect(report.berryRegrowEvery).toBeGreaterThan(DEFAULT_REGROW['berryBush']);
  }, 120_000);

  /**
   * …AND A PLANT SOMEBODY PLANTED OBEYS IT TOO.
   *
   * `createResourceNode`'s default table is the classic world's, and the sprout
   * in `body/WorldRegularities.ts` took it: a seed pushed into continent ground
   * grew a food plant that came back every 220 ticks while every scattered bush
   * beside it took ~1,300. Six times the yield, for whoever discovered
   * planting, outside the capacity arithmetic above entirely — in the one world
   * built on the premise that food is finite. A sprout is a plant of this
   * world; it regrows at this world's pace.
   */
  it('makes a plant grown from a seed regrow at the world’s pace, not the table’s', () => {
    const berry = DEFAULT_REGROW['berryBush'];
    for (const scenario of ['forager-classic', 'forager-continent'] as const) {
      const exp = new Experiment({ seed: 'sprout', agentCount: 8, scenario });
      exp.advance(1);
      // What this world does to a bush is what it must do to a food plant: read
      // the pace off the ground rather than trusting the report.
      let bush = 0;
      exp.world.forEach((e: Entity) => {
        const node = e.components['ResourceNode'] as ResourceNode | undefined;
        if (node?.kind === 'berryBush' && bush === 0) bush = node.regrowEvery;
      });
      const at = exp.agentEntity(exp.agentIds[0]!)!.components['Transform2D'] as Transform2D;
      exp.world.createEntity(
        { Transform2D: { x: at.x, y: at.y }, SeedInGround: { plantedTick: exp.tick } },
        { static: true },
      );
      exp.advance(SEED_SPROUT_TICKS + 2);
      const sprouted: ResourceNode[] = [];
      exp.world.forEach((e: Entity) => {
        const node = e.components['ResourceNode'] as ResourceNode | undefined;
        if (node?.kind === 'foodPlant') sprouted.push(node);
      });
      expect(sprouted.length, `${scenario}: the seed never sprouted`).toBe(1);
      expect(sprouted[0]!.regrowEvery, `${scenario} sprout vs its own bushes`).toBe(bush);
    }
  }, 120_000);

  it('holds the continent’s sprout to the slowdown the capacity was solved for', () => {
    const report = new ContinentScenario('x', 'sprout', 8, CONTINENT_ACTIVITY_RADIUS).ecologyReport();
    const exp = new Experiment({ seed: 'sprout', agentCount: 8, scenario: 'forager-continent' });
    exp.advance(1);
    const at = exp.agentEntity(exp.agentIds[0]!)!.components['Transform2D'] as Transform2D;
    exp.world.createEntity(
      { Transform2D: { x: at.x, y: at.y }, SeedInGround: { plantedTick: exp.tick } },
      { static: true },
    );
    exp.advance(SEED_SPROUT_TICKS + 2);
    let every = 0;
    exp.world.forEach((e: Entity) => {
      const node = e.components['ResourceNode'] as ResourceNode | undefined;
      if (node?.kind === 'foodPlant') every = node.regrowEvery;
    });
    // A food plant and a bush share a default interval, so the world's answer
    // for one is its answer for the other — and both are the slowdown the
    // valley's carrying capacity was solved for, not the classic 220.
    expect(every).toBe(report.berryRegrowEvery);
    expect(every).toBeGreaterThan(DEFAULT_REGROW['foodPlant'] * 4);
  }, 120_000);

  it('never asks a tile for more than the candidate budget allows', () => {
    // A kind whose effective density reached MAX_DENSITY would be owed more
    // than one node per candidate and would be silently thinned, so the
    // ceiling has to dominate every table INCLUDING the riparian gain.
    expect(MAX_DENSITY).toBeGreaterThanOrEqual(2374);
  });
});
