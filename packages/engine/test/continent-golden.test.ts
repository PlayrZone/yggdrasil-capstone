import { describe, expect, it } from 'vitest';
import { CONTINENT_RUNS, fingerprintsFor } from './fingerprint.js';

/**
 * BEHAVIOUR LOCK FOR THE TRUE-SCALE CONTINENT.
 *
 * THESE ARE NEW GOLDENS, NOT RE-RECORDED ONES. They were recorded once, when
 * the `forager-continent` scenario first existed, against a world that had no
 * previous behaviour to preserve — nothing here supersedes an older value, and
 * `test/golden-state.test.ts` (the classic world) was not touched to make them
 * pass. That is the point of shipping the continent as a SECOND scenario: every
 * golden, corpus and published result recorded in the 2 km world keeps its
 * meaning, and the new world gets a lock of its own from day one.
 *
 * The same rule applies from here on: if one of these moves, the change
 * altered the simulation. Fix the change, do NOT re-record.
 *
 * Two configs on purpose — a small band that never leaves the founding valley,
 * and a larger, myth-seeded one whose beings pilgrimage and practise a craft,
 * so the culture, narrative and craft-observation paths are locked at scale too.
 */
const GOLDENS: Record<string, string[]> = {
  'continent-40': ['d855ca321983d73e:2122683', '29dccc751c38c8af:2333392'],
  'continent-120-seeded': ['162ed7c0276bd290:2399507', '02e818f0c0827146:3108060'],
};

describe('continent golden state (behaviour lock)', () => {
  for (const run of CONTINENT_RUNS) {
    it(`${run.name} matches its recorded fingerprints`, () => {
      expect(fingerprintsFor(run)).toEqual(GOLDENS[run.name]);
    }, 180_000);
  }
});
