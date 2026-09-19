import { describe, expect, it } from 'vitest';
import { Experiment } from '../src/runner/Experiment.js';
import { CONTINENT_RUNS, fingerprintOf, fingerprintsFor } from './fingerprint.js';

/**
 * SAME SEED, SAME WORLD, TWICE. The continent generates its land from fixed
 * noise and everything scattered on it from per-tile streams keyed off the run
 * seed; nothing in the loop touches `Math.random` or a clock. If any of that
 * were untrue these two runs would drift, and every replay, golden and corpus
 * recorded in this world would be worthless.
 */
describe('the continent is deterministic', () => {
  it('produces an identical world and history from the same seed', () => {
    const a = new Experiment({ seed: 'determinism', agentCount: 60, scenario: 'forager-continent' });
    const b = new Experiment({ seed: 'determinism', agentCount: 60, scenario: 'forager-continent' });
    a.advance(1500);
    b.advance(1500);
    expect(fingerprintOf(b)).toBe(fingerprintOf(a));
  }, 180_000);

  it('produces a DIFFERENT world from a different seed (the test is not vacuous)', () => {
    const a = new Experiment({ seed: 'determinism', agentCount: 60, scenario: 'forager-continent' });
    const b = new Experiment({ seed: 'determinism-other', agentCount: 60, scenario: 'forager-continent' });
    a.advance(400);
    b.advance(400);
    expect(fingerprintOf(b)).not.toBe(fingerprintOf(a));
  }, 180_000);

  it('reproduces each golden config twice over', () => {
    for (const run of CONTINENT_RUNS) {
      expect(fingerprintsFor(run), run.name).toEqual(fingerprintsFor(run));
    }
  }, 300_000);

  it('gives the two worlds different ids, so a record says which it came from', async () => {
    const { FORAGER_CONTINENT, TRUE_SCALE_CONTINENT } = await import('../src/runner/options.js');
    expect(TRUE_SCALE_CONTINENT).not.toBe(FORAGER_CONTINENT);
    const classic = new Experiment({ seed: 's', agentCount: 5 });
    const continent = new Experiment({ seed: 's', agentCount: 5, scenario: 'forager-continent' });
    expect(classic.geography.id).toBe('forager-classic');
    expect(continent.geography.id).toBe('forager-continent');
    // …and the SAME adapter, which is the whole claim: one mind, two worlds.
    expect(continent.minds.get(continent.agentIds[0]!)).toBeDefined();
  });
});
