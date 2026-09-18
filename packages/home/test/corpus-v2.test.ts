import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CognitionOutcome, CognitionRecordV2, RunManifest, RunSummary } from '@yggdrasil/engine';
import { JsonlCognitionSink, corpusRunDir, corpusV2Root, listCorpusRuns, readCorpusRun } from '../src/index.js';

const SCHEMA = 2;

function manifest(): RunManifest {
  return {
    runId: 'run-1',
    schemaVersion: SCHEMA,
    engineVersion: '0.1.0',
    scenarioId: 'exp-1',
    worldId: 'forager-continent-v1',
    seed: 'seed-a',
    modelId: 'mock/reflex-policy',
    backendLabel: 'mock/reflex-policy',
    options: { agentCount: 10, mythBehavior: true, leadership: true, offerMaking: true, craftLearning: false, outcomeWindowTicks: 400 },
    openedAtMs: 1,
  };
}

function summary(): RunSummary {
  return {
    closedAtMs: 2,
    finalTick: 100,
    counts: {
      promptsSent: 2,
      recordsWritten: 2,
      unanswered: 0,
      outcomesWritten: 1,
      recordsDropped: 0,
      outcomesDropped: 0,
    },
    status: 'ok',
    scaffold: {
      needsProvisions: 0,
      itemGrants: 0,
      relocations: 0,
      seededMyths: [],
      seededRecipes: [],
      authoredEvents: [],
      ideasGiven: [],
      madeConscious: 1,
    },
  };
}

/** Only the fields the reader gates on matter here; the rest rides as data. */
function record(id: string, schemaVersion = SCHEMA): CognitionRecordV2 {
  return { id, schemaVersion, tick: 1, beingId: 1 } as unknown as CognitionRecordV2;
}

function outcome(cognitionId: string): CognitionOutcome {
  return { cognitionId, schemaVersion: SCHEMA, runId: 'run-1', beingId: 1 } as unknown as CognitionOutcome;
}

describe('v2 corpus files', () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'ygg-corpus-'));
    process.env['YGG_HOME'] = home;
  });
  afterEach(() => {
    delete process.env['YGG_HOME'];
    rmSync(home, { recursive: true, force: true });
  });

  it('writes a manifest, one line per record, and round-trips them', () => {
    const sink = new JsonlCognitionSink('run-1');
    sink.openRun(manifest());
    sink.cognition(record('run-1:1:1'));
    sink.cognition(record('run-1:2:1'));
    sink.outcome(outcome('run-1:1:1'));
    sink.closeRun(summary());

    const dir = corpusRunDir('run-1');
    expect(readFileSync(join(dir, 'cognition.jsonl'), 'utf8').trimEnd().split('\n')).toHaveLength(2);

    const read = readCorpusRun('run-1', SCHEMA);
    expect(read.manifest).toEqual(manifest());
    expect(read.summary).toEqual(summary());
    expect(read.records.map((r) => r.id)).toEqual(['run-1:1:1', 'run-1:2:1']);
    expect(read.outcomes).toHaveLength(1);
    expect(read.skipped).toBe(0);
    expect(listCorpusRuns().map((r) => r.runId)).toEqual(['run-1']);
  });

  it('leaves a readable manifest for a run that never closed', () => {
    const sink = new JsonlCognitionSink('run-2');
    sink.openRun({ ...manifest(), runId: 'run-2' });
    sink.cognition(record('run-2:1:1'));
    const read = readCorpusRun('run-2', SCHEMA);
    expect(read.manifest!.runId).toBe('run-2');
    expect(read.summary).toBeNull();
    expect(read.records).toHaveLength(1);
  });

  it('drops a crash-truncated tail and an unknown schema, and says how many', () => {
    const sink = new JsonlCognitionSink('run-3');
    sink.openRun({ ...manifest(), runId: 'run-3' });
    sink.cognition(record('run-3:1:1'));
    sink.cognition(record('run-3:2:1', 99)); // a version this reader does not know
    // A process killed mid-append leaves a partial line and no newline.
    appendFileSync(join(corpusRunDir('run-3'), 'cognition.jsonl'), '{"id":"run-3:3:1","schemaVer');

    const read = readCorpusRun('run-3', SCHEMA);
    expect(read.records.map((r) => r.id)).toEqual(['run-3:1:1']);
    expect(read.skipped).toBe(2);
  });

  it('never lets a runId leave the corpus directory', () => {
    for (const bad of ['../escape', '..\\escape', '/etc/passwd', 'C:\\Windows', 'sub/run', '..', '', 'ok\u0000']) {
      expect(() => new JsonlCognitionSink(bad), bad).toThrow();
      expect(() => corpusRunDir(bad), bad).toThrow();
      expect(() => readCorpusRun(bad, SCHEMA), bad).toThrow();
    }
    expect(existsSync(join(home, 'escape'))).toBe(false);
  });

  it('ignores directory entries it could not address by id', () => {
    new JsonlCognitionSink('run-1').openRun(manifest());
    writeFileSync(join(corpusV2Root(), '.hidden'), 'x');
    expect(listCorpusRuns().map((r) => r.runId)).toEqual(['run-1']);
  });

  it('leaves the legacy corpus alone', () => {
    const legacy = join(home, 'corpus', 'civilization.jsonl');
    const sink = new JsonlCognitionSink('run-1');
    sink.openRun(manifest());
    sink.cognition(record('run-1:1:1'));
    sink.closeRun(summary());
    expect(existsSync(legacy)).toBe(false); // nothing new is ever appended to it
  });
});
