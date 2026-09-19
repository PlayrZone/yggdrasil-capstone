import { describe, expect, it } from 'vitest';
import { CONTINENT_RUNS, fingerprintsAtRadius, fingerprintsFor } from './fingerprint.js';
import { CONTINENT_ACTIVITY_RADIUS } from '../src/runner/Scenario.js';

/**
 * BEHAVIOUR LOCK FOR THE TRUE-SCALE CONTINENT.
 *
 * RE-RECORDED ONCE, ON PURPOSE, for item M1b. The values below replace the
 * ones first recorded when `forager-continent` was born; the classic world's
 * goldens (`test/golden-state.test.ts`) were NOT touched and are byte-identical
 * across the whole change. Every reason the continent's fingerprints moved:
 *
 *  1. RIVERS REACH THE SEA. Two of the three used to stop on dry ground, 27.3 m
 *     and 18.5 m up. A river is now followed west until the land goes under
 *     water, and its bed is the running minimum of the ground it crosses, so
 *     the height field itself is different — which moves every region, every
 *     node and every founder. The valley floor is 12.4 m where it was 20.5.
 *  2. DENSITIES BY CONSTRUCTION. The scatter no longer rolls a die per
 *     candidate; it accumulates each habitat's density and plants when a whole
 *     node is owed, with a per-tile dither. Placement order and counts differ
 *     — and rare kinds (gold: 10 seams per km²) are now placed at all.
 *  3. A REAL CARRYING CAPACITY. Living stock opens at about a third of the
 *     classic values and everything regrows ~6.3× slower, both derived from
 *     what the founding valley must feed. `maxPopulation` is no longer a cap
 *     the population sits on.
 *  4. DRINKING SPOTS EVERY 42 m, not 30 — the spacing at which a valley
 *     founder sees as much water as a classic founder did.
 *  5. ANIMALS DO NOT TELEPORT. A predator that gives up a chase re-anchors its
 *     home range where it stands instead of snapping back onto its loop, so
 *     its position, and every later tick of it, is different.
 *  6. KILLED ANIMALS COME BACK, in their own tile, three sim-days later.
 *  7. THE DIGEST IS OF THE SETTLED WORLD (`runner/settled.ts`): node stock and
 *     animal positions are hashed as they WOULD be, not as a dormant tile left
 *     them. This is what makes the second test below possible.
 *  8. A walker clamps its last step to the distance remaining instead of
 *     stepping past its own arrival threshold.
 *
 * From here the rule is what it was: if one of these moves, the change altered
 * the simulation. Fix the change, do NOT re-record.
 */
const GOLDENS: Record<string, string[]> = {
  'continent-40': ['8c71fd27806ee65f:1984343', 'f5590afb733c277f:2204409'],
  'continent-120-seeded': ['cb94199d709160bd:2277606', 'b8506296bb8882e4:3084091'],
};

describe('continent golden state (behaviour lock)', () => {
  for (const run of CONTINENT_RUNS) {
    it(`${run.name} matches its recorded fingerprints`, () => {
      expect(fingerprintsFor(run)).toEqual(GOLDENS[run.name]);
    }, 180_000);
  }

  /**
   * THE GOLDEN IS OF THE WORLD, NOT OF THE ACTIVATION SCHEDULE. Recorded at
   * the default radius and again at twice it, the digests are the same — so
   * `CONTINENT_ACTIVITY_RADIUS` can be retuned for performance without any of
   * the values above moving, and a change that DOES move them is a change to
   * the simulation rather than to how much of it was stepped.
   */
  it('gives the same digest at half and at twice the activation radius', () => {
    const run = CONTINENT_RUNS[0]!;
    expect(fingerprintsAtRadius(run, CONTINENT_ACTIVITY_RADIUS * 2)).toEqual(GOLDENS[run.name]);
    expect(fingerprintsAtRadius(run, 400)).toEqual(GOLDENS[run.name]);
  }, 300_000);
});
