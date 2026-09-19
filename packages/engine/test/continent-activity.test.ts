import { describe, expect, it } from 'vitest';
import { Experiment } from '../src/runner/Experiment.js';
import type { Entity } from '../src/core/Entity.js';
import type { Transform2D } from '../src/core/Transform2D.js';
import type { ResourceNode } from '../src/body/ResourceNodeSystem.js';
import { regrowthCount } from '../src/body/ResourceNodeSystem.js';
import { growthFactor } from '../src/body/Climate.js';
import type { ResourceNodeKind } from '../src/worlds/forager/types.js';
import { World } from '../src/core/World.js';
import { ActivityRegions, TiledEntities } from '../src/world/activity.js';
import { CONTINENT_TILE } from '../src/world/continent.js';
import { CONTINENT_SCALE } from '../src/worlds/forager/scale.js';
import { createResourceNode } from '../src/body/ResourceNodeSystem.js';
import { createGahallianBody } from '../src/body/GahallianBody.js';
import { identityAt } from '../src/body/identities.js';
import { fingerprintOf } from './fingerprint.js';

/**
 * ACTIVITY REGIONS CHANGE NOTHING — the load-bearing claim of the whole
 * scheme. A world sixteen times larger is only affordable because most of it
 * is not stepped; that is only honest if a being cannot tell.
 *
 * Two proofs here, one by construction and one by experiment:
 *  1. the closed-form regrowth equals the literal per-tick loop, across
 *     season boundaries, for every regrowing kind;
 *  2. the same continent run at two very different activation radii gives
 *     every being exactly the same thing to perceive, tick after tick.
 *
 * The third — that the classic world is untouched — is the golden file.
 */

/** The per-tick rule of `ResourceNodeSystem`, written out literally. */
function regrownByLoop(kind: ResourceNodeKind, every: number, from: number, to: number, deficit: number): number {
  const seasonal = new Set<ResourceNodeKind>([
    'berryBush', 'foodPlant', 'mushroomPatch', 'tuberPlant', 'nightshadePlant', 'fiberPlant', 'tree',
  ]);
  let grown = 0;
  for (let tick = from + 1; tick <= to; tick++) {
    if (grown >= deficit) break;
    if (tick <= 0 || tick % every !== 0) continue;
    if (seasonal.has(kind)) {
      const growth = growthFactor(tick);
      if (growth <= 0) continue;
      if (growth < 1 && Math.floor(tick / every) % 2 !== 0) continue;
    }
    grown++;
  }
  return grown;
}

describe('a dormant tile catches up exactly', () => {
  it('matches the per-tick loop for every regrowing kind, across seasons', () => {
    const kinds: [ResourceNodeKind, number][] = [
      ['berryBush', 220], ['foodPlant', 220], ['mushroomPatch', 600], ['tuberPlant', 260],
      ['nightshadePlant', 700], ['fiberPlant', 450], ['tree', 1000],
    ];
    // Spans that start and end inside every season, and one that covers a year.
    const spans: [number, number][] = [
      [0, 1], [0, 2400], [1, 219], [219, 221], [9500, 9700], [19_100, 19_300],
      [28_700, 29_000], [0, 38_400], [5000, 41_000], [37_000, 76_800], [123, 45_678],
    ];
    for (const [kind, every] of kinds) {
      for (const [from, to] of spans) {
        for (const deficit of [1, 3, 9999]) {
          expect(
            regrowthCount(kind, every, from, to, deficit),
            `${kind} every ${every} over (${from}, ${to}] deficit ${deficit}`,
          ).toBe(regrownByLoop(kind, every, from, to, deficit));
        }
      }
    }
  });

  it('never grows a node that cannot regrow', () => {
    expect(regrowthCount('stoneDeposit', 0, 0, 100_000, 10)).toBe(0);
    expect(regrowthCount('berryBush', 220, 500, 400, 10)).toBe(0);
    expect(regrowthCount('berryBush', 220, 0, 100_000, 0)).toBe(0);
  });
});

/**
 * Everything a being could have perceived, at one tick: the nodes, structures
 * and people inside its own eyesight, and the context features it stands in.
 * This is the comparison that matters — not the raw world, which legitimately
 * differs (an animal in a sleeping tile has not been moved yet), but every
 * fact any mind could have been handed.
 */
function whatTheySee(exp: Experiment): string {
  const out: string[] = [];
  for (const id of exp.agentIds) {
    const entity = exp.agentEntity(id);
    const body = exp.agentBody(id);
    if (!entity || !body?.alive) continue;
    const t = entity.components['Transform2D'] as Transform2D;
    const view = exp.perception.worldViewFor(exp.world, entity, exp.tick);
    const context = exp.perception.contextAt(exp.world, t.x, t.y, exp.tick);
    out.push(
      `${id}@${t.x},${t.y} h${body.health} ${JSON.stringify(body.needs)} ${JSON.stringify(body.inventory)}`,
      `  ctx ${context.nearWater ? 'w' : '-'}${context.night ? 'n' : '-'}${context.inShelter ? 's' : '-'}${context.elevationBand}`,
      `  res ${view.resources.map((r) => `${r.id}:${r.kind}:${r.stock}:${r.x}:${r.y}`).join('|')}`,
      `  who ${view.agents.map((a) => `${a.id}:${a.x}:${a.y}`).join('|')}`,
      `  str ${view.structures.map((s) => `${s.id}:${s.kind}:${s.x}:${s.y}`).join('|')}`,
    );
  }
  return out.join('\n');
}

/**
 * What the components literally hold — the STORED world, before the settled
 * view catches a sleeping tile up. Two runs at different radii must differ
 * here (or nothing ever slept and the equalities below are vacuous) and must
 * agree once settled.
 */
function storedState(exp: Experiment): string {
  const parts: string[] = [];
  const rows: string[] = [];
  exp.world.forEach((e: Entity) => {
    const node = e.components['ResourceNode'] as ResourceNode | undefined;
    const t = e.components['Transform2D'] as Transform2D | undefined;
    if (node) rows.push(`${e.id}:${node.kind}:${node.stock}`);
    if (e.components['Animal'] && t) rows.push(`${e.id}@${t.x},${t.y}`);
  });
  rows.sort();
  parts.push(rows.join('|'));
  return parts.join('\n');
}

describe('the activation radius is not observable', () => {
  it('gives every being the same world to perceive at 512 m and at 3000 m', () => {
    const near = new Experiment({ seed: 'activity', agentCount: 40, scenario: 'forager-continent', activityRadius: 512 });
    const wide = new Experiment({ seed: 'activity', agentCount: 40, scenario: 'forager-continent', activityRadius: 3000 });
    for (let checkpoint = 0; checkpoint < 6; checkpoint++) {
      near.advance(400);
      wide.advance(400);
      expect(whatTheySee(near), `tick ${near.tick}`).toBe(whatTheySee(wide));
    }
    expect(near.aliveCount()).toBe(wide.aliveCount());
    expect(near.eventCount).toBe(wide.eventCount);
    // The WHOLE state, animals and node stock included, through the settled
    // view: the two runs are the same world, not merely the same experience.
    // (The `animals: false` exclusion this test used to need is gone — see
    // `runner/settled.ts`.)
    expect(fingerprintOf(near)).toBe(fingerprintOf(wide));
    // …and it is not vacuous: the stored components really do differ, because
    // ground really was left unstepped.
    expect(storedState(near)).not.toBe(storedState(wide));
  }, 300_000);

  it('matches a control that never sleeps at all', () => {
    // The strongest form: against a run whose tiles are ALL live, every tick,
    // there is nothing left to be honest about.
    const tiled = new Experiment({ seed: 'never-dormant', agentCount: 40, scenario: 'forager-continent' });
    const awake = new Experiment({
      seed: 'never-dormant',
      agentCount: 40,
      scenario: 'forager-continent',
      activityRadius: 60_000, // wider than the world: nothing is ever dormant
    });
    tiled.advance(2400);
    awake.advance(2400);
    expect(fingerprintOf(tiled)).toBe(fingerprintOf(awake));
    expect(storedState(tiled)).not.toBe(storedState(awake));
  }, 300_000);

  it('leaves the classic world identical whether or not it skips dormant tiles', () => {
    // The classic scenario's default is "every tile, always". Given a finite
    // radius it skips dormant ground like the continent does — and must still
    // produce the same world, which is the same claim the goldens make.
    const stepped = new Experiment({ seed: 'classic-activity', agentCount: 8 });
    const skipping = new Experiment({ seed: 'classic-activity', agentCount: 8, activityRadius: 64 });
    stepped.advance(9600);
    skipping.advance(9600);
    expect(fingerprintOf(skipping)).toBe(fingerprintOf(stepped));
    // Not vacuous: at the 300 m this case used to ask for, a 2 km world was
    // lit end to end and nothing was ever skipped. At 64 m most of it sleeps.
    const tiles = ActivityRegions.within(2000, 256, 64);
    tiles.update(skipping.world, skipping.tick);
    expect(tiles.activeTiles.length, 'the classic world never slept').toBeLessThan(tiles.count / 2);
  }, 300_000);
});

describe('the tiling itself', () => {
  it('marks only the ground near a living being, and remembers what is in it', () => {
    const world = new World();
    const tiles = ActivityRegions.within(8192, 256, 768);
    const nodes = new TiledEntities(world, tiles, (e: Entity) => e.components['ResourceNode'] !== undefined);

    world.createEntity({ Transform2D: { x: 1000, y: 1000 }, ResourceNode: createResourceNode('berryBush', 5) });
    world.createEntity({ Transform2D: { x: 7000, y: 7000 }, ResourceNode: createResourceNode('berryBush', 5) });
    const near = world.createEntity({ Transform2D: { x: 1010, y: 1005 }, GahallianBody: createGahallianBody('', identityAt(0).traits, 0) });

    tiles.update(world, 10);
    expect(tiles.isActive(tiles.tileOf(1000, 1000))).toBe(true);
    expect(tiles.isActive(tiles.tileOf(7000, 7000))).toBe(false);
    // 32 x 32 tiles; one being lights a 7 x 7 neighbourhood, not the world.
    expect(tiles.activeTiles.length).toBeLessThan(60);
    expect(tiles.activeTiles.length).toBeGreaterThan(20);
    expect(nodes.size).toBe(2);
    expect(nodes.in(tiles.tileOf(1000, 1000))).toHaveLength(1);

    // A being that dies takes its ground's activity with it.
    (near.components['GahallianBody'] as { alive: boolean }).alive = false;
    tiles.update(world, 11);
    expect(tiles.activeTiles).toHaveLength(0);
    expect(tiles.isActive(tiles.tileOf(1000, 1000))).toBe(false);

    // …and `everywhere` is the classic world's answer: all of it, always.
    const all = ActivityRegions.everywhere(2000, 256);
    all.update(world, 11);
    expect(all.activeTiles).toHaveLength(all.count);
    expect(all.isActive(0)).toBe(true);
  });

  /**
   * THE INVARIANT THE WHOLE SCHEME RESTS ON. A being lights every tile within
   * `ceil(radius / tileSize)` tiles of its own, so the nearest DORMANT ground
   * is at least one whole tile away — `CONTINENT_TILE` metres. As long as that
   * exceeds the furthest a being can see, an animal snapping onto its loop as
   * its tile wakes can never be witnessed. 256 m against 92 m of daylight.
   */
  it('keeps dormant ground further away than anyone can see', () => {
    expect(CONTINENT_TILE).toBeGreaterThan(CONTINENT_SCALE.perceptionDay);
    const world = new World();
    const tiles = ActivityRegions.within(8192, CONTINENT_TILE, 768);
    world.createEntity({
      Transform2D: { x: 4000, y: 4000 },
      GahallianBody: createGahallianBody('', identityAt(0).traits, 0),
    });
    tiles.update(world, 1);
    let nearestDormant = Infinity;
    for (let tile = 0; tile < tiles.count; tile++) {
      if (tiles.isActive(tile)) continue;
      const tx = (tile % tiles.cols) * CONTINENT_TILE;
      const ty = Math.floor(tile / tiles.cols) * CONTINENT_TILE;
      // Nearest point of the tile's box to the being.
      const dx = Math.max(0, tx - 4000, 4000 - (tx + CONTINENT_TILE));
      const dy = Math.max(0, ty - 4000, 4000 - (ty + CONTINENT_TILE));
      nearestDormant = Math.min(nearestDormant, Math.hypot(dx, dy));
    }
    expect(nearestDormant).toBeGreaterThan(CONTINENT_SCALE.perceptionDay);
  });
});

describe('the world stays affordable as it grows', () => {
  it('leaves most of the continent unstepped', () => {
    const exp = new Experiment({ seed: 'activity', agentCount: 60, scenario: 'forager-continent' });
    exp.advance(600);
    let nodes = 0;
    exp.world.forEach((e: Entity) => {
      if (e.components['ResourceNode']) nodes++;
    });
    expect(nodes).toBeGreaterThan(15_000);
    // The tick cost has to come from the beings, not from the map: with the
    // founders still in one valley, only a small part of 32×32 tiles is live.
    const exp2 = new Experiment({ seed: 'activity', agentCount: 60, scenario: 'forager-continent' });
    exp2.advance(1);
    const t0 = performance.now();
    exp2.advance(300);
    const perTick = (performance.now() - t0) / 300;
    expect(perTick).toBeLessThan(5); // ms — a very loose ceiling; the bench measures properly
  }, 300_000);
});
