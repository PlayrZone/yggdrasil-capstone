import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COGNITION_SCHEMA_VERSION, buildThinkPrompt, deserializeThinkInput, foragerAdapter } from '../src/index.js';
import type { SerializedThinkInput } from '../src/index.js';
import { runThinkInputCohort } from './fixtures/thinkInputCohort.js';
import type { ThinkInputTrace } from './fixtures/thinkInputCohort.js';

/**
 * A V3 ROW MEANS ONE THING, BEFORE AND AFTER (W1-B4).
 *
 * The mind stopped holding coordinates. A corpus row still has to be the same
 * bytes, because `COGNITION_SCHEMA_VERSION` is still 3 and rows recorded on
 * either side of this step are compared against each other — and because the
 * goldens cannot see this at all: nothing in `thinkInput` is ever read back
 * into the simulation, so every coordinate in a row could have moved, been
 * renamed or been nested one level deeper and every fingerprint would still
 * match.
 *
 * `thinkInputRows.c727af7.json` was captured by running
 * `fixtures/thinkInputCohort.ts` in a worktree at `c727af7`, the commit before
 * the step. It is re-taken the same way if the cohort ever changes — never
 * edited to match.
 */

const FIXTURE = JSON.parse(
  readFileSync(new URL('./fixtures/thinkInputRows.c727af7.json', import.meta.url), 'utf8'),
) as { capturedFrom: string; trace: ThinkInputTrace };

const BEFORE = FIXTURE.trace;

describe('a cognition row is the bytes it always was', () => {
  it('was captured from the commit before the mind stopped knowing where it was', () => {
    expect(FIXTURE.capturedFrom).toBe('c727af7');
    expect(COGNITION_SCHEMA_VERSION).toBe(3);
  });

  /**
   * The cohort is only evidence if the rows it produces hold a coordinate in
   * every slot a row can hold one — otherwise "identical" is a statement about
   * an empty set.
   */
  it('puts a place in every field of a row that can carry one', () => {
    expect(BEFORE.rows.length).toBeGreaterThan(20);
    expect(BEFORE.withSacredPlace).toBe(BEFORE.rows.length);
    const carries = (holds: (row: Record<string, never>) => boolean): number =>
      BEFORE.rows.filter((r) => holds(JSON.parse(r.input) as Record<string, never>)).length;
    const numeric = (o: unknown): boolean =>
      typeof (o as { x?: unknown })?.x === 'number' && typeof (o as { y?: unknown }).y === 'number';
    expect(carries((row) => numeric(row['snapshot']))).toBe(BEFORE.rows.length);
    expect(carries((row) => (row['worldView']['resources'] as unknown[]).every(numeric) &&
      (row['worldView']['resources'] as unknown[]).length > 0)).toBeGreaterThan(20);
    expect(carries((row) => (row['recalledMemories'] as unknown[]).some(numeric))).toBeGreaterThan(20);
    expect(carries((row) => numeric(row['sacredPlace']))).toBe(BEFORE.rows.length);
    expect(BEFORE.rows.every((r) => r.input.includes('"sacredPlace":{"x":900,"y":120}'))).toBe(true);
    // …and the sentence the prompt renders from one really did reach the model.
    expect(BEFORE.rows[0]!.user).toContain('it lies northeast, about');
    expect(BEFORE.rows[0]!.user).toContain('(toward 900,120)');
  });

  it('records the same rows, byte for byte', async () => {
    const now = await runThinkInputCohort();
    // Named one at a time: a whole-trace diff of 34 rows says only "not equal".
    expect(now.rows.map((r) => `${r.being}@${r.tick}`)).toEqual(BEFORE.rows.map((r) => `${r.being}@${r.tick}`));
    expect(now.withSacredPlace).toBe(BEFORE.withSacredPlace);
    for (let i = 0; i < BEFORE.rows.length; i++) {
      const was = BEFORE.rows[i]!;
      const is = now.rows[i]!;
      expect(is.input, `row ${i} thinkInput`).toBe(was.input);
      expect(is.system, `row ${i} system`).toBe(was.system);
      expect(is.user, `row ${i} user`).toBe(was.user);
    }
  }, 300_000);

  /**
   * …and a row stored before the step still REPLAYS: the stored fields come
   * back as opaque places and the prompt rebuilt from them is the prompt that
   * was paid for. This is the half a byte comparison cannot make — it reads the
   * old fixture through the new code.
   */
  it('replays a row captured before the step to the prompt it was sent as', () => {
    for (const row of BEFORE.rows) {
      const stored = JSON.parse(row.input) as SerializedThinkInput;
      const rebuilt = buildThinkPrompt(deserializeThinkInput(stored, foragerAdapter), foragerAdapter);
      expect(rebuilt.system, `being ${row.being}@${row.tick}`).toBe(row.system);
      expect(rebuilt.user, `being ${row.being}@${row.tick}`).toBe(row.user);
    }
  });

  /**
   * And it bites. Serialising a think input that has been through the new mind
   * has to reproduce the stored SHAPE, not merely something equivalent: a place
   * nested under a key of its own, or written after the fields that follow it,
   * would fail here while every golden stayed green.
   */
  it('would fail if a place moved, were renamed, or were nested', () => {
    const stored = JSON.parse(BEFORE.rows[0]!.input) as Record<string, unknown>;
    const snapshot = stored['snapshot'] as Record<string, unknown>;
    const keys = Object.keys(snapshot);
    expect(keys).toContain('x');
    expect(keys).toContain('y');
    expect(keys).not.toContain('place');
    // Exactly where they have always been: after `sick`, before `inventory`.
    expect(keys.slice(keys.indexOf('sick'), keys.indexOf('inventory') + 1)).toEqual(['sick', 'x', 'y', 'inventory']);
  });
});
