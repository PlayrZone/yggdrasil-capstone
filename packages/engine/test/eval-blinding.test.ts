import { describe, expect, it } from 'vitest';
import { FaithfulMockBackend, OmniscientMockBackend, foragerAdapter, runAb } from '../src/index.js';
import type { BlindTrace, TraceKey } from '../src/index.js';

/**
 * THE BLINDING RULE, TESTED THE ONLY WAY IT CAN BE.
 *
 * A trace is blind iff a reader who is given ONLY its formatting cannot tell
 * which arm made it. So the test builds an A/B in which both arms emit the SAME
 * content — two copies of the faithful mind, one of them plugged in through the
 * baseline agent's whole apparatus (its own memory, its own prompt, its own
 * transport) — and asserts that what comes out the far end is byte-identical
 * once the opaque handle is taken off, and that every token-shape statistic a
 * classifier could compute agrees exactly.
 *
 * If a prompt, a model id, a run id, a knowledge field or a belief ever leaks
 * into the renderer, these two traces stop matching, because arm B's prompt is
 * built by a different file from arm A's.
 */

const world = foragerAdapter;
const SPEC = { seed: 'w1e-blind', ticks: 420, cohortSize: 3, agentCount: 14 } as const;

/** Everything about a text a classifier could read WITHOUT understanding it. */
function tokenShape(text: string): Record<string, number | string> {
  const lines = text.split('\n');
  const tokens = text.split(/\s+/).filter(Boolean);
  const lengths = new Map<number, number>();
  for (const token of tokens) lengths.set(token.length, (lengths.get(token.length) ?? 0) + 1);
  const prefixes = new Map<string, number>();
  for (const line of lines) {
    const label = line.trim().split(':')[0] ?? '';
    prefixes.set(label, (prefixes.get(label) ?? 0) + 1);
  }
  const punctuation: Record<string, number> = {};
  for (const mark of ['"', '(', ')', '[', ']', ';', ',', '·', '+', '×', '#', '—']) {
    punctuation[mark] = text.split(mark).length - 1;
  }
  return {
    chars: text.length,
    lines: lines.length,
    tokens: tokens.length,
    lengthHistogram: JSON.stringify([...lengths].sort((a, b) => a[0] - b[0])),
    linePrefixes: JSON.stringify([...prefixes].sort((a, b) => (a[0] < b[0] ? -1 : 1))),
    punctuation: JSON.stringify(punctuation),
  };
}

function armTraces(traces: readonly BlindTrace[], key: readonly TraceKey[], arm: 'A' | 'B'): BlindTrace[] {
  const wanted = new Set(key.filter((k) => k.arm === arm).map((k) => k.traceId));
  return traces.filter((t) => wanted.has(t.traceId));
}

describe('W1-E · blinded traces', () => {
  it('are indistinguishable by formatting when both arms say the same things', async () => {
    // Both arms are the faithful mind. Arm B still goes through the baseline
    // agent's memory, prompt and transport, so anything of that apparatus that
    // reached the renderer would show up as a difference.
    const result = await runAb({ ...SPEC }, {
      a: { backend: new FaithfulMockBackend(world) },
      b: { backend: new FaithfulMockBackend(world) },
    });
    const a = armTraces(result.traces, result.key, 'A');
    const b = armTraces(result.traces, result.key, 'B');
    expect(a.length).toBeGreaterThan(0);
    expect(a).toHaveLength(b.length);

    for (let i = 0; i < a.length; i++) {
      const left = a[i]!;
      const right = b[i]!;
      // The handle is the only thing that may differ.
      expect(strip(right.text)).toBe(strip(left.text));
      expect(tokenShape(strip(right.text))).toEqual(tokenShape(strip(left.text)));
      expect(right.features).toEqual(left.features);
    }
  }, 60_000);

  it('carry no artefact that names an arm, a model, a run or a being', async () => {
    const result = await runAb({ ...SPEC }, {
      a: { backend: new FaithfulMockBackend(world) },
      b: { backend: new OmniscientMockBackend(world) },
    });
    expect(result.traces.length).toBeGreaterThan(0);
    for (const trace of result.traces) {
      const text = trace.text;
      for (const tell of [
        'mock/faithful',
        'mock/omniscient',
        'baseline',
        'Yggdrasil',
        'yggdrasil',
        'w1e-ab',
        'runId',
        'beingId',
        'WHAT YOU KNOW',
        'RECENT OBSERVATIONS',
        'confidence',
        'ruleKey',
        'provenance',
        'arm A',
        'arm B',
      ]) {
        expect(text).not.toContain(tell);
      }
      // Every handle in the body of the trace is a per-trace ordinal, and they
      // start at 1 and have no gaps — so no run-wide id can be hiding in one.
      const refs = [...text.matchAll(/#(\d+)/g)].map((m) => Number(m[1]));
      const distinct = [...new Set(refs)].sort((x, y) => x - y);
      expect(distinct).toEqual(distinct.map((_, at) => at + 1));
      expect(trace.traceId).toMatch(/^trace-[0-9a-z]+$/);
    }
  }, 60_000);

  it('prints the same lines in the same order every moment, whatever happened', async () => {
    const result = await runAb({ ...SPEC }, {
      a: { backend: new FaithfulMockBackend(world) },
      b: { backend: new OmniscientMockBackend(world) },
    });
    const labels = ['feels', 'sees', 'carries', 'thinks', 'does', 'says', 'then'];
    for (const trace of result.traces) {
      const blocks = trace.text.split('\n\n').slice(1);
      expect(blocks.length).toBe(trace.moments);
      for (const block of blocks) {
        const lines = block.split('\n');
        expect(lines[0]).toMatch(/^\[\+\d+ · day \d+ · \w+ · (day|night)\]$/);
        expect(lines.slice(1).map((line) => line.trim().split(':')[0])).toEqual(labels);
      }
    }
  }, 60_000);
});

/** The opaque handle is the one thing a pair of otherwise identical traces differs by. */
function strip(text: string): string {
  return text.replace(/^TRACE trace-[0-9a-z]+ /, 'TRACE ');
}
