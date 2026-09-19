import { describe, expect, it } from 'vitest';
import { Experiment } from '../src/runner/Experiment.js';
import type { Entity } from '../src/core/Entity.js';
import type { Transform2D } from '../src/core/Transform2D.js';
import type { Animal } from '../src/body/animals.js';
import { CONTINENT_SCALE } from '../src/worlds/forager/scale.js';

/**
 * NOTHING A BEING CAN SEE MAY JUMP.
 *
 * The continent's animals hold closed-form home ranges, which is what makes a
 * 67 km² world affordable — and which the first draft used as a licence to
 * SNAP one back onto its loop the moment a chase ended. Measured over 6,000
 * ticks with 80 beings: a 526 m single-tick displacement, and the worst one
 * inside a being's own 92 m eyesight was 156 m against a top speed of 1.23
 * m/tick. A 400× jump is unmissable in a viewer and is not something a world
 * is allowed to do to an observer.
 *
 * The rule this file holds the world to: an animal within perception of any
 * living being — on the tick before or the tick after — moves by at most its
 * own speed. Animals nobody is near may still jump, and must, because that is
 * the fast-forward doing its job; the second assertion below requires it, so
 * the first cannot pass by the world having quietly stopped skipping tiles.
 */

const SIGHT = CONTINENT_SCALE.perceptionDay;
const EPS = 1e-6;

interface Seen {
  x: number;
  y: number;
  kind: string;
}

function snapshot(exp: Experiment): Map<number, Seen> {
  const out = new Map<number, Seen>();
  exp.world.forEach((e: Entity) => {
    const animal = e.components['Animal'] as Animal | undefined;
    if (!animal) return;
    const t = e.components['Transform2D'] as Transform2D;
    out.set(e.id, { x: t.x, y: t.y, kind: animal.kind });
  });
  return out;
}

function living(exp: Experiment): [number, number][] {
  const out: [number, number][] = [];
  for (const id of exp.agentIds) {
    if (!exp.agentBody(id)?.alive) continue;
    const t = exp.agentEntity(id)!.components['Transform2D'] as Transform2D;
    out.push([t.x, t.y]);
  }
  return out;
}

function nearAnyone(people: [number, number][], x: number, y: number): boolean {
  for (const [px, py] of people) if ((px - x) ** 2 + (py - y) ** 2 <= SIGHT * SIGHT) return true;
  return false;
}

describe('an animal never teleports inside a being’s sight', () => {
  it('moves by at most its own speed wherever anyone could be watching', () => {
    const exp = new Experiment({ seed: 'continuity', agentCount: 80, scenario: 'forager-continent' });
    exp.advance(1);
    let before = snapshot(exp);
    let peopleBefore = living(exp);
    let watched = 0;
    let unwatchedJumps = 0;
    let worstWatched = 0;
    for (let tick = 0; tick < 8000; tick++) {
      exp.advance(1);
      const after = snapshot(exp);
      const peopleAfter = living(exp);
      for (const [id, now] of after) {
        const was = before.get(id);
        if (!was) continue; // born this tick — a replacement has no previous place
        const moved = Math.hypot(now.x - was.x, now.y - was.y);
        const speed = CONTINENT_SCALE.animalSpeed[now.kind]!;
        const inSight =
          nearAnyone(peopleBefore, was.x, was.y) ||
          nearAnyone(peopleAfter, now.x, now.y) ||
          nearAnyone(peopleAfter, was.x, was.y) ||
          nearAnyone(peopleBefore, now.x, now.y);
        if (inSight) {
          watched++;
          if (moved > worstWatched) worstWatched = moved;
          expect(moved, `${now.kind} ${id} moved ${moved.toFixed(1)} m in one tick at ${now.x},${now.y}`)
            .toBeLessThanOrEqual(speed + EPS);
        } else if (moved > speed + EPS) {
          unwatchedJumps++;
        }
      }
      before = after;
      peopleBefore = peopleAfter;
    }
    // Not vacuous: beings really were beside animals, for a long time…
    expect(watched, 'no animal was ever near a being').toBeGreaterThan(100_000);
    expect(worstWatched).toBeGreaterThan(0); // …and those animals really moved
    // …and the world really is skipping ground, which is what makes the
    // guarantee above worth anything.
    expect(unwatchedJumps, 'nothing was ever fast-forwarded').toBeGreaterThan(0);
  }, 600_000);
});

/** Every animal alive, by kind. */
function census(exp: Experiment): Map<string, number> {
  const by = new Map<string, number>();
  exp.world.forEach((e: Entity) => {
    const animal = e.components['Animal'] as Animal | undefined;
    if (!animal) return;
    by.set(animal.kind, (by.get(animal.kind) ?? 0) + 1);
  });
  return by;
}

function total(by: Map<string, number>): number {
  let n = 0;
  for (const v of by.values()) n += v;
  return n;
}

/** Kill every animal within `radius` of a point. Hunting, as a test may do it. */
function cull(exp: Experiment, x: number, y: number, radius: number): number {
  const doomed: number[] = [];
  exp.world.forEach((e: Entity) => {
    if (!e.components['Animal']) return;
    const t = e.components['Transform2D'] as Transform2D;
    if (Math.hypot(t.x - x, t.y - y) <= radius) doomed.push(e.id);
  });
  for (const id of doomed) exp.world.removeEntity(id);
  return doomed.length;
}

function animalsNear(exp: Experiment, x: number, y: number, radius: number): number {
  let n = 0;
  exp.world.forEach((e: Entity) => {
    if (!e.components['Animal']) return;
    const t = e.components['Transform2D'] as Transform2D;
    if (Math.hypot(t.x - x, t.y - y) <= radius) n++;
  });
  return n;
}

/**
 * KILLING IS REMEMBERED, AND SO IS BREEDING.
 *
 * The first draft had no respawn at all — 986 animals on day 0 and exactly 986
 * on day 30 — which was only survivable because reflex beings never hunt. The
 * ledger replaces a killed animal in the tile it died in, three sim-days on:
 * long enough that emptying the ground beside the camp is felt, short enough
 * that sustained predation cannot empty a continent.
 */
describe('the herds neither vanish nor ignore being killed', () => {
  it('thins where it is hunted, and comes back there', () => {
    const exp = new Experiment({ seed: 'thinning', agentCount: 30, scenario: 'forager-continent' });
    exp.advance(1);
    const spot = { x: 5400, y: 6200 }; // open plains, far from the founders
    const before = animalsNear(exp, spot.x, spot.y, 700);
    expect(before, 'nothing to hunt at the test spot').toBeGreaterThan(8);
    const killed = cull(exp, spot.x, spot.y, 700);
    expect(animalsNear(exp, spot.x, spot.y, 700)).toBe(0);

    exp.advance(3600); // a day and a half — well inside the respawn delay
    const halfway = animalsNear(exp, spot.x, spot.y, 700);
    expect(halfway, `${halfway} back after 1.5 days; the loss should still be felt`).toBeLessThan(before / 2);

    exp.advance(4200); // past the three-day delay
    const recovered = animalsNear(exp, spot.x, spot.y, 700);
    expect(recovered, `${recovered} of ${before} back after 3+ days`).toBeGreaterThanOrEqual(killed - 2);
  }, 600_000);

  it('does not go extinct over sixty days of being hunted out', () => {
    const exp = new Experiment({ seed: 'extinction', agentCount: 24, scenario: 'forager-continent' });
    exp.advance(1);
    const start = census(exp);
    const stocked = total(start);
    let lowest = stocked;
    let killed = 0;
    for (let chunk = 0; chunk < 18; chunk++) {
      // A standing hunting pressure the reflex minds cannot supply themselves:
      // everything within 1.2 km of one spot, wiped out every 3⅓ days — just
      // longer than the respawn delay, so each round kills the last round's
      // replacements too, for two months.
      killed += cull(exp, 3000, 3000, 1200);
      exp.advance(8000);
      lowest = Math.min(lowest, total(census(exp)));
    }
    const end = census(exp);
    expect(exp.tick).toBeGreaterThan(60 * 2400);
    // Enough killing for the ledger to have anything to answer for: more than
    // the whole continent holds, over the run.
    expect(killed, `only ${killed} killed of ${stocked} standing`).toBeGreaterThan(stocked);
    // The ledger conserves: hunting dents the total, it does not drain it, and
    // it never breeds one back that was not taken.
    expect(lowest / stocked, `fell to ${lowest} of ${stocked}`).toBeGreaterThan(0.8);
    expect(total(end) / stocked, `ended at ${total(end)} of ${stocked}`).toBeGreaterThan(0.9);
    expect(total(end) / stocked, 'the herds multiplied').toBeLessThan(1.05);
    // …and no kind is wiped out, predators included.
    for (const [kind, n] of start) {
      expect(end.get(kind) ?? 0, `${kind}: ${start.get(kind)} → ${end.get(kind) ?? 0}`).toBeGreaterThan(n * 0.8);
    }
  }, 600_000);
});
