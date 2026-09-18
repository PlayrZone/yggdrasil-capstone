import { describe, expect, it } from 'vitest';
import { GOLDEN_RUNS, fingerprintsFor } from './fingerprint.js';

/**
 * BEHAVIOUR LOCK. Each entry is a whole-state fingerprint (positions, needs,
 * health, inventories, every mind's memory/knowledge/relationships/narratives,
 * the births ledger and the run counters) at ticks 1200 and 3000, recorded from
 * the reflex engine.
 *
 * These are not values anyone reasoned out — they are a recording of what the
 * engine does. A change that is meant to be behaviour-neutral (an optimisation,
 * a refactor) must leave every one of them untouched. If one moves, the change
 * altered the simulation: fix the change, do NOT re-record.
 */
const GOLDENS: Record<string, string[]> = {
  'alpha-20': ['32318d40e286e2ae:183390', '08112359b8c1fb99:261439'],
  'alpha-70': ['0b8116d02460d92a:264439', 'b3137e66706d5f04:666418'],
  'beta-20': ['791f4a4ea3af28b0:197907', '6587d5bb6b47b0e9:270224'],
  'beta-70': ['60b560e91755f4b9:305712', '39fd3d34a683bbda:786295'],
  'gamma-20': ['940b9e73a458fa33:210245', '200f12d66b437ce6:374364'],
  'gamma-70': ['6c67bcd07c2946d2:322664', '5470b9bd0ba859a3:749514'],
  'seeded-30': ['cbab89165bdb0bbc:257550', 'ae93e18e9a1fd2f6:602398'],
};

describe('golden state (behaviour lock)', () => {
  for (const run of GOLDEN_RUNS) {
    it(`${run.name} matches its recorded fingerprints`, () => {
      expect(fingerprintsFor(run)).toEqual(GOLDENS[run.name]);
    }, 180_000);
  }
});
