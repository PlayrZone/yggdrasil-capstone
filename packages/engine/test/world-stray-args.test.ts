import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { foragerAdapter } from '../src/index.js';
import { wireFieldsOf } from '../src/contract/actions.js';
import { COHORT_ACTIONS, runStrayArgCohort, strayArgCases } from './fixtures/strayArgCohort.js';
import type { StrayArgTrace } from './fixtures/strayArgCohort.js';

/**
 * THE TEST THAT WOULD HAVE CAUGHT IT.
 *
 * W1-B3 claimed to be behaviour-neutral for the forager world and was not: its
 * new edge refused any intent carrying an argument its action does not declare,
 * and those intents used to reach the BODY, whose own refusal is an event the
 * being remembers. Nothing in the suite could see it — a reflex being emits only
 * the arguments its acts declare — so the divergence was found by a verifier's
 * byte dump rather than by a red test.
 *
 * This is that red test. A scripted "model" asks for every one of this world's
 * sixteen acts three ways (see `fixtures/strayArgCohort.ts`), and everything the
 * decision is observable through is compared against a trace captured by running
 * the same cohort at `01a23d2`, the commit before the seam moved:
 *
 *   · WHAT WAS DECIDED — the corpus's `resolvedOutput`, as its own bytes, which
 *     is the applied plan, the goals, the utterances and the key order;
 *   · WHAT THE BODY SAID — every `IntentRejected`, in order, with its reason;
 *   · WHEN — the tick each row was built and applied on, and the order the
 *     beings were served in.
 *
 * A fixture rather than a re-run of the old engine: the old tree is not here at
 * test time. `strayArgTrace.01a23d2.json` says exactly how it was taken, and it
 * is re-taken the same way if the cohort ever changes — never edited to match.
 */

const FIXTURE = JSON.parse(
  readFileSync(new URL('./fixtures/strayArgTrace.01a23d2.json', import.meta.url), 'utf8'),
) as { capturedFrom: string; trace: StrayArgTrace };

const BEFORE = FIXTURE.trace;

describe('a stray argument behaves as it did before the edge moved', () => {
  it('asks the same questions the captured run was asked', () => {
    const cases = strayArgCases();
    expect(cases).toHaveLength(48);
    // The cohort is only evidence if the old run and this one ran ONE script.
    expect(new Set(BEFORE.script.map((entry) => entry.split(':')[1]!)).size).toBe(cases.length);
    expect(FIXTURE.capturedFrom).toBe('01a23d2');
  });

  /**
   * The cohort writes the argument shapes out rather than reading them off the
   * adapter, so a transcription error cannot hide. This is where the two are
   * held together: the acts, their order, and what each one takes.
   */
  it('is scripted against the acts this world actually declares', () => {
    expect(COHORT_ACTIONS.map(([id]) => id)).toEqual(foragerAdapter.actions.map((a) => a.id));
    for (const [id, args] of COHORT_ACTIONS) {
      // AS THE WIRE WRITES THEM. The cohort emits JSON, so what it must agree
      // with is the fields a model writes — and since W1-B4 the mind's one
      // opaque `place` is written as this world's own `x`,`y`.
      const declared = foragerAdapter.actionById
        .get(id)!
        .params.filter((p) => p.type !== 'speech')
        .flatMap((p) => wireFieldsOf(foragerAdapter, p));
      expect(args, id).toEqual(declared.map((p) => p.id));
    }
  });

  it('decides, executes and remembers exactly what it did at 01a23d2', async () => {
    const now = await runStrayArgCohort();
    // Named one at a time: a whole-trace diff of 114 rows says only "not equal".
    expect(now.script).toEqual(BEFORE.script);
    expect(now.records.map((r) => `${r.being}@${r.tick}`)).toEqual(
      BEFORE.records.map((r) => `${r.being}@${r.tick}`),
    );
    expect(now.records.map((r) => r.appliedTick)).toEqual(BEFORE.records.map((r) => r.appliedTick));
    expect(now.records.map((r) => r.valid)).toEqual(BEFORE.records.map((r) => r.valid));
    // The corpus rows themselves, byte for byte — `COGNITION_SCHEMA_VERSION` is
    // still 3, so a v3 row recorded before and after has to mean one thing.
    expect(now.records.map((r) => r.resolved)).toEqual(BEFORE.records.map((r) => r.resolved));
    // What the body refused, and why: the memories the edge was deleting.
    expect(now.rejectionsByReason).toEqual(BEFORE.rejectionsByReason);
    expect(now.rejections).toEqual(BEFORE.rejections);
    expect(now.executedByKind).toEqual(BEFORE.executedByKind);
  }, 300_000);

  /**
   * The same trace, read as the claim the verifier made: these are the acts
   * whose stray-argument form was executed or refused BY THE BODY, and every
   * one of them was silently dropped while the edge was strict.
   */
  it('still reaches the body with every act the old run reached it with', () => {
    expect(Object.keys(BEFORE.executedByKind).sort()).toEqual(foragerAdapter.actions.map((a) => a.id).sort());
    expect(BEFORE.rejections.length).toBeGreaterThan(50);
    expect(Object.keys(BEFORE.rejectionsByReason).length).toBeGreaterThan(5);
  });
});
