import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { runMockCohort } from './fixtures/mockCohort.js';
import type { MockCohortTrace } from './fixtures/mockCohort.js';

/**
 * A MOCK PLAYS THE MODEL, AND A MODEL WRITES THE WORLD'S WIRE (W1-B4 verifier,
 * the fail).
 *
 * `MockMindBackend` used to `JSON.stringify` its policy's own `MindOutput`. That
 * was harmless until W1-B4 gave a decision an opaque `place`, and then the mock
 * began writing `{"kind":"MoveTo","place":{"x":900,"y":120}}` where a model
 * writes `{"kind":"MoveTo","x":900,"y":120}` — so `parseMindOutput`, which reads
 * `SpaceOps.fields` at the TOP level, dropped it and handed the being an act
 * with nowhere to go. It is not a test-only mock: it is the MCP server's unpaid
 * default backend and the eval door's `reflex` arm, so every offline conscious
 * cohort since has been recording destination-less movement into v3 rows that
 * claim to be comparable with every row before them.
 *
 * Nothing could catch it. The goldens run no backend at all; `thinkInputCohort`
 * emits place-free acts on purpose; `strayArgCohort` writes its intents in the
 * wire's own fields already. So this is the dump the verifier had: a recording
 * mock cohort whose every decision carries a place, compared against
 * `mockCohortTrace.c727af7.json`, captured by running `fixtures/mockCohort.ts`
 * in a worktree at `c727af7` — the last commit on which a mock-driven being
 * still arrived where it decided to go.
 *
 * IT BITES. With `encodeOutput` taken back out of `MockMindBackend`, all 49 rows
 * diverge, the ordered event log goes 44 → 61, and both coordinate counts below
 * go to ZERO.
 */

const FIXTURE = JSON.parse(
  readFileSync(new URL('./fixtures/mockCohortTrace.c727af7.json', import.meta.url), 'utf8'),
) as { capturedFrom: string; trace: MockCohortTrace };

const BEFORE = FIXTURE.trace;

describe('a mock-driven being decides what the reflex path decides', () => {
  it('was captured from the commit before the mind stopped knowing where it was', () => {
    expect(FIXTURE.capturedFrom).toBe('c727af7');
  });

  /**
   * The cohort is only evidence if what it decided actually carried a place —
   * otherwise "identical" is a statement about an empty set. Asserted on the
   * FIXTURE, so the claim is about the old tree's bytes, not about this one's.
   */
  it('put a coordinate in what the model wrote, and in what the world was given', () => {
    expect(BEFORE.rows.length).toBeGreaterThan(40);
    expect(BEFORE.counts.rawWithCoordinates).toBeGreaterThan(30);
    expect(BEFORE.counts.resolvedWithCoordinates).toBeGreaterThan(30);
    // The pilgrimage itself: the act toward the site a seeded tale tells of.
    expect(BEFORE.rows.some((r) => r.raw.includes('"kind":"MoveTo","x":900,"y":120'))).toBe(true);
    expect(BEFORE.rows.some((r) => r.resolved?.includes('"kind":"MoveTo","x":900,"y":120'))).toBe(true);
    // …and the half-written act, which reached the body before this step and
    // still has to (`x` alone, no `y`).
    expect(BEFORE.rows.some((r) => r.raw.includes('"kind":"MoveTo","x":5,"targetId":3'))).toBe(true);
  });

  it('writes the same bytes the model wrote, decides the same acts, and moves the same world', async () => {
    const now = await runMockCohort();
    expect(now.rows.map((r) => `${r.being}@${r.tick}`)).toEqual(BEFORE.rows.map((r) => `${r.being}@${r.tick}`));
    // Named one field at a time: a whole-trace diff of 49 rows says only "not equal".
    for (let i = 0; i < BEFORE.rows.length; i++) {
      const was = BEFORE.rows[i]!;
      const is = now.rows[i]!;
      expect(is.raw, `row ${i} raw reply`).toBe(was.raw);
      expect(is.parsed, `row ${i} parsedOutput`).toBe(was.parsed);
      expect(is.resolved, `row ${i} resolvedOutput`).toBe(was.resolved);
      expect(is.appliedTick, `row ${i} appliedTick`).toBe(was.appliedTick);
      expect(is.status, `row ${i} status`).toBe(was.status);
    }
    // What the world did about it — the ordered log, in order, byte for byte.
    expect(now.events.length).toBe(BEFORE.events.length);
    for (let i = 0; i < BEFORE.events.length; i++) {
      expect(now.events[i], `event ${i}`).toBe(BEFORE.events[i]);
    }
    expect(now.counts).toEqual(BEFORE.counts);
  }, 300_000);
});
