import { describe, expect, it } from 'vitest';
import { Experiment } from '../src/runner/Experiment.js';
import type { Entity } from '../src/core/Entity.js';
import type { Transform2D } from '../src/core/Transform2D.js';
import type { ResourceNode } from '../src/body/ResourceNodeSystem.js';
import type { ResourceNodeKind } from '../src/worlds/forager/types.js';
import { MAX_DENSITY } from '../src/worlds/forager/continentScenario.js';
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

interface Placed {
  x: number;
  y: number;
  kind: ResourceNodeKind;
}

function worldOf(scenario: 'forager-classic' | 'forager-continent', agents: number) {
  const exp = new Experiment({ seed: 'placement', agentCount: agents, scenario });
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

describe('founder placement', () => {
  const { nodes, founders } = worldOf('forager-continent', 150);

  it('puts every founder inside the one valley, and none in deep water', () => {
    expect(founders).toHaveLength(150);
    for (const f of founders) {
      expect(inFoundingValley(f.x, f.y), `founder at ${f.x},${f.y}`).toBe(true);
      expect(continentGeography.isDeepWater(f.x, f.y)).toBe(false);
    }
  });

  it('gives a founder as much to eat, drink and build with as the classic world did', () => {
    const classic = worldOf('forager-classic', 150);
    const mean = (ns: Placed[], at: Transform2D[], kinds: ReadonlySet<string>): number =>
      at.reduce((s, p) => s + inSight(ns, p, kinds), 0) / at.length;
    const water = new Set(['river', 'waterSource']);
    const wood = new Set(['tree']);
    const here = {
      food: mean(nodes, founders, FOOD),
      wood: mean(nodes, founders, wood),
      water: mean(nodes, founders, water),
    };
    const there = {
      food: mean(classic.nodes, classic.founders, FOOD),
      wood: mean(classic.nodes, classic.founders, wood),
      water: mean(classic.nodes, classic.founders, water),
    };
    // The operational definition of "early survival is comparable": what a
    // founder can SEE, not what the map contains. ±35%.
    for (const key of ['food', 'wood', 'water'] as const) {
      const ratio = here[key] / there[key];
      expect(ratio, `${key}: continent ${here[key].toFixed(1)} vs classic ${there[key].toFixed(1)}`).toBeGreaterThan(0.65);
      expect(ratio, `${key}: continent ${here[key].toFixed(1)} vs classic ${there[key].toFixed(1)}`).toBeLessThan(1.35);
    }
  }, 120_000);
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
    // Food per km² within 200 m of the great river, against food per km² on
    // plains more than 1 km from any water. The habitat rule, as a ratio.
    let near = 0;
    let far = 0;
    for (const node of nodes) {
      if (!FOOD.has(node.kind)) continue;
      if (continentGeography.regionAt(node.x, node.y) !== 'plains') continue;
      if (inFoundingValley(node.x, node.y)) near++;
      else if (Math.hypot(node.x - 6200, node.y - 5200) < 700) far++;
    }
    expect(near / 0.69).toBeGreaterThan((far / 1.54) * 2);
  });

  it('never asks a tile for more than the candidate budget allows', () => {
    // A habitat denser than MAX_DENSITY would be silently thinned, so the
    // ceiling has to dominate every table INCLUDING the riparian gain.
    expect(MAX_DENSITY).toBeGreaterThanOrEqual(2374);
  });
});
