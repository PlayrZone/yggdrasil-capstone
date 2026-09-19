import { describe, expect, it } from 'vitest';
import { Experiment } from '../src/runner/Experiment.js';
import { MockMindBackend } from '../src/consciousness/MockMindBackend.js';
import { foragerAdapter } from '../src/worlds/forager/adapter.js';
import type {
  CognitionOutcome,
  CognitionRecordV2,
  ICognitionSink,
  OutcomeCloseReason,
  RunManifest,
  RunSummary,
} from '../src/record/types.js';
import type { ProvenanceLevel } from '../src/learning/ILearner.js';

/**
 * WHERE IN THE TICK the recorder is sampled is a semantic choice, and the
 * goldens cannot see it: they run reflex-only, with no recording at all.
 *
 * `OutcomeTracker.tick` asks "is the body still on the plan this act set?".
 * Reflex takes a finished plan away the instant it is done, so the sample has
 * to happen in the window between `YggdrasilSystem.step` and the mind loop.
 * Move it later (after the minds run) or earlier (to the top of the tick,
 * which is the same thing one tick along) and every window that should close
 * as `planCompleted` closes as `planReplaced` instead — the corpus still looks
 * full, and every outcome in it is wrong about why it ended.
 */

class MemorySink implements ICognitionSink {
  manifest: RunManifest | null = null;
  summary: RunSummary | null = null;
  readonly records: CognitionRecordV2[] = [];
  readonly outcomes: CognitionOutcome[] = [];
  openRun(m: RunManifest): void {
    this.manifest = m;
  }
  cognition(r: CognitionRecordV2): void {
    this.records.push(r);
  }
  outcome(o: CognitionOutcome): void {
    this.outcomes.push(o);
  }
  closeRun(s: RunSummary): void {
    this.summary = s;
  }
}

async function run(options: { provenance?: ProvenanceLevel } = {}): Promise<MemorySink> {
  const sink = new MemorySink();
  const exp = new Experiment({
    seed: 'recorder-tick',
    agentCount: 24,
    mindBackend: new MockMindBackend({ world: foragerAdapter }),
    now: () => 0,
    ...(options.provenance ? { provenance: options.provenance } : {}),
    recording: { sink, runId: 'run-recorder-tick', scenarioId: 'w1a1b', nowMs: () => 0 },
  });
  for (const id of exp.agentIds.slice(0, 8)) exp.makeConscious(id);
  for (let i = 0; i < 30; i++) {
    exp.advance(25);
    await new Promise<void>((r) => setTimeout(r, 0));
  }
  await exp.settleCognition();
  exp.endRecording();
  return sink;
}

function byReason(sink: MemorySink): Record<string, number> {
  const out: Record<string, number> = {};
  for (const o of sink.outcomes) {
    const r: OutcomeCloseReason = o.closedReason;
    out[r] = (out[r] ?? 0) + 1;
  }
  return out;
}

describe('the recorder is sampled between the body and the minds', () => {
  it('closes windows as planCompleted, which only holds at that one sample point', async () => {
    const sink = await run();
    expect(sink.outcomes.length).toBeGreaterThan(0); // not vacuous
    const reasons = byReason(sink);
    // The load-bearing assertion. At the correct sample point this run closes
    // 14 windows as planCompleted; sampled after the mind loop — or at the top
    // of the tick, which is the same place one tick along — it closes ZERO,
    // because reflex has already swapped the plan array out. Deliberately not
    // pinned to 14: the exact mix depends on `MockMindBackend` and the schema,
    // which are another engineer's to move. Zero is the failure, not a shift.
    expect(reasons['planCompleted'] ?? 0).toBeGreaterThan(0);
    // planReplaced legitimately dominates here — a conscious being's next think
    // usually lands before its current plan runs out. That is not the signal.
    expect(reasons['planReplaced'] ?? 0).toBeGreaterThan(0);
  }, 120_000);
});

describe('the manifest states the provenance the run was made at', () => {
  it('carries the run’s level, not the recorder’s default', async () => {
    for (const level of ['off', 'compact', 'full'] as const) {
      const sink = await run({ provenance: level });
      expect(sink.manifest!.options.provenance, level).toBe(level);
      // The manifest and the rows under it can never disagree about one run.
      expect(sink.records[0]!.options.provenance, level).toBe(level);
    }
  }, 180_000);
});
