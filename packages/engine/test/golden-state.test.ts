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
 *
 * RE-RECORDED ONCE, for W0-E (the memory-footprint bound), because the digest
 * covered state the item exists to free: the archive of evicted records, and a
 * dead being's episodic tier. Nothing the simulation can still reach moved —
 * verified by running HEAD's engine and the changed one side by side in one
 * process over all seven configs × both checkpoints and comparing the whole
 * world, every living mind's hot records, every mind's knowledge /
 * relationships / narratives / goals / memories-ever-formed / archetype label,
 * and the analysis, society, culture, myth, sacred-places, leadership and
 * belief-behaviour reports. All 14 pairs: identical. The digest now also hashes
 * each mind's first-hand tally, which survives both eviction and death, so the
 * lock did not weaken where the records went away.
 */
const GOLDENS: Record<string, string[]> = {
  'alpha-20': ['af34a866d8218ff6:184346', '07e17599a89e39af:264189'],
  'alpha-70': ['fe34b248927a25a0:268246', 'ac4e2acc80204c68:666130'],
  'beta-20': ['898883a0fff5381a:196007', '866287199774e9bb:261894'],
  'beta-70': ['0196b00d5dbbe325:306016', 'a39fd07bb420f003:668391'],
  'gamma-20': ['85bbe4d2bf06b57e:211238', 'a3d5bef65f2c556a:318347'],
  'gamma-70': ['9dd43009601697c3:326089', 'd93196a008560122:672686'],
  'seeded-30': ['cbca95b6f60ed26c:259054', '533ea9199525930b:444023'],
};

describe('golden state (behaviour lock)', () => {
  for (const run of GOLDEN_RUNS) {
    it(`${run.name} matches its recorded fingerprints`, () => {
      expect(fingerprintsFor(run)).toEqual(GOLDENS[run.name]);
    }, 180_000);
  }
});
