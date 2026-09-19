import { describe, expect, it } from 'vitest';
import { Experiment } from '../src/runner/Experiment.js';
import type { Entity } from '../src/core/Entity.js';
import type { Transform2D } from '../src/core/Transform2D.js';
import type { Animal } from '../src/body/animals.js';
import { CONTINENT_SCALE } from '../src/worlds/forager/scale.js';

/**
 * NOTHING A BEING CAN SEE MAY JUMP — OR BEGIN.
 *
 * The continent's animals hold closed-form home ranges, which is what makes a
 * 67 km² world affordable — and which the first draft used as a licence to
 * SNAP one back onto its loop the moment a chase ended. Measured over 6,000
 * ticks with 80 beings: a 526 m single-tick displacement, and the worst one
 * inside a being's own 92 m eyesight was 156 m against a top speed of 1.23
 * m/tick. A 400× jump is unmissable in a viewer and is not something a world
 * is allowed to do to an observer.
 *
 * MOVEMENT WAS ONLY HALF OF IT. This test used to exempt a newly created
 * animal verbatim — `if (!was) continue; // born this tick` — on the grounds
 * that a thing with no previous position cannot have moved. Under that
 * exemption the respawn ledger drew a replacement uniformly from the dead
 * animal's 256 m tile and 18 of 23 replacements appeared inside a being's 92 m
 * sight, the nearest 15.9 m away. To a being whose world is real, an animal
 * that was not there and then is is exactly as impossible as one that jumped
 * 156 m, so the exemption is gone: a replacement must first exist where nobody
 * can see it and then WALK in.
 *
 * The rule this file holds the world to, in two parts:
 *  · an animal within perception of any living being — on the tick before or
 *    the tick after — moves by at most its own speed;
 *  · an animal's FIRST position is outside every living being's perception
 *    radius, so the first position anyone perceives is one it walked to.
 * Animals nobody is near may still jump, and must, because that is the
 * fast-forward doing its job; the vacuity guards below require it, so the
 * guarantees cannot pass by the world having quietly stopped skipping tiles.
 *
 * Reflex minds do not hunt, so nothing would ever be replaced in a run left to
 * itself: the test does the killing, inside the founders' own eyesight, which
 * is the worst case the ledger can be handed.
 */

const SIGHT = CONTINENT_SCALE.perceptionDay;
const EPS = 1e-6;
/** Ticks between culls, and the radius one sweeps. See the run below. */
const CULL_EVERY = 400;
const CULL_RADIUS = 400;

interface Seen {
  x: number;
  y: number;
  kind: string;
}

function snapshot(exp: Experiment): Map<number, Seen> {
  const out = new Map<number, Seen>();
  exp.world.spatial.each('Animal', (e: Entity) => {
    const animal = e.components['Animal'] as Animal;
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

function nearestPerson(people: [number, number][], x: number, y: number): number {
  let best = Infinity;
  for (const [px, py] of people) best = Math.min(best, Math.hypot(px - x, py - y));
  return best;
}

function nearAnyone(people: [number, number][], x: number, y: number): boolean {
  for (const [px, py] of people) if ((px - x) ** 2 + (py - y) ** 2 <= SIGHT * SIGHT) return true;
  return false;
}

describe('an animal never teleports, and never begins, inside a being’s sight', () => {
  it('walks everywhere it goes, into existence included', () => {
    const exp = new Experiment({ seed: 'continuity', agentCount: 80, scenario: 'forager-continent' });
    // The ledger's own creations, caught at the instant they are made rather
    // than inferred from a diff, so nothing born and removed inside one tick
    // can slip past.
    const bornThisTick: number[] = [];
    exp.world.events.on('entityCreated', ({ id }) => {
      if (exp.world.getEntity(id)?.components['Animal']) bornThisTick.push(id);
    });
    exp.advance(1);
    bornThisTick.length = 0; // the opening stock is the world beginning, not an arrival
    let before = snapshot(exp);
    let peopleBefore = living(exp);
    let watched = 0;
    let unwatchedJumps = 0;
    let worstWatched = 0;
    let births = 0;
    let walkedIn = 0;
    let closestBirth = Infinity;
    /** Animals born during the run that no being has perceived yet. */
    const unseen = new Set<number>();

    for (let tick = 0; tick < 14_400; tick++) {
      // Hunting pressure the reflex minds cannot supply: everything around one
      // living being, wiped out, so replacements are booked into the very tiles
      // the band is standing in — the only place this invariant can be tested.
      if (tick % CULL_EVERY === 0 && peopleBefore.length > 0) {
        const [hx, hy] = peopleBefore[tick % peopleBefore.length]!;
        cull(exp, hx, hy, CULL_RADIUS);
      }
      exp.advance(1);
      const after = snapshot(exp);
      const peopleAfter = living(exp);

      // NOTHING MAY APPEAR IN SIGHT. Checked against where the beings are at
      // the END of the tick, because that is where they were standing when
      // perception ran.
      for (const id of bornThisTick) {
        const now = after.get(id);
        if (!now) continue; // created and gone inside one tick: nobody's world changed
        births++;
        const d = Math.min(nearestPerson(peopleAfter, now.x, now.y), nearestPerson(peopleBefore, now.x, now.y));
        if (d < closestBirth) closestBirth = d;
        expect(d, `${now.kind} ${id} materialised ${d.toFixed(1)} m from a living being`).toBeGreaterThan(SIGHT);
        unseen.add(id);
      }
      bornThisTick.length = 0;

      for (const [id, now] of after) {
        const was = before.get(id);
        if (!was) continue; // its first tick — the arrival rule above covers it
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
          // …and if this is the first time anyone could see this replacement,
          // it got here on its own feet: the assertion above just held for the
          // step that carried it in, from a position that was itself in the
          // world on the previous tick.
          if (unseen.delete(id)) walkedIn++;
        } else if (moved > speed + EPS) {
          unwatchedJumps++;
        }
      }
      before = after;
      peopleBefore = peopleAfter;
    }
    console.log(
      `\ncontinuity: ${watched} watched animal-ticks, worst watched step ${worstWatched.toFixed(4)} m | ` +
        `${births} births observed, closest ${closestBirth.toFixed(1)} m from a living being (sight ${SIGHT}) | ` +
        `${walkedIn} of them later walked into somebody's sight | ${unwatchedJumps} unwatched fast-forwards\n`,
    );
    // Not vacuous: beings really were beside animals, for a long time…
    // (measured on this seed: 105,113 watched animal-ticks, worst watched step
    // 1.2320 m — a wolf's own speed to four places; 62 births, the nearest
    // 95.4 m out; 881 fast-forwards. The guards are floors, not the figures.)
    expect(watched, 'no animal was ever near a being').toBeGreaterThan(50_000);
    expect(worstWatched).toBeGreaterThan(0); // …and those animals really moved
    // …the ledger really did have replacements to make, in ground the band was
    // standing in…
    expect(births, 'nothing was ever replaced').toBeGreaterThan(25);
    expect(walkedIn, 'no replacement was ever seen at all').toBeGreaterThan(0);
    // …and the world really is skipping ground, which is what makes the
    // guarantees above worth anything.
    expect(unwatchedJumps, 'nothing was ever fast-forwarded').toBeGreaterThan(0);
    // A host that moves a static entity behind the index's back is a silent
    // wrong answer for up to 256 ticks; the audit counts it, and nothing in a
    // run this long may ever trip it.
    expect(exp.world.spatial.staticDrift, 'a static entity moved without markMoved').toBe(0);
  }, 900_000);
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
