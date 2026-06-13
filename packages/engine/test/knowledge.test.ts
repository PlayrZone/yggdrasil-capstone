import { describe, expect, it } from 'vitest';
import { KnowledgeStore } from '../src/index.js';
import type { KnowledgeRule } from '../src/index.js';

const RULE: KnowledgeRule = {
  kind: 'succession',
  causeType: 'SeedDeposited',
  causeObject: 'seed',
  effectType: 'PlantSprouted',
};

function evidence(evidenceCount: number, contradictionCount: number, confidence: number) {
  return { rule: RULE, confidence, evidenceCount, contradictionCount, sourceMemoryIds: [1, 2] };
}

describe('KnowledgeStore lifecycle', () => {
  it('walks hypothesis → held → contested → abandoned from evidence alone', () => {
    const store = new KnowledgeStore();

    let record = store.applyEvidence(evidence(2, 0, 0.75), 100);
    expect(record.status).toBe('hypothesis');

    record = store.applyEvidence(evidence(5, 1, 0.8), 200);
    expect(record.status).toBe('held');
    expect(record.lastReinforced).toBe(200);

    record = store.applyEvidence(evidence(5, 7, 0.42), 300);
    expect(record.status).toBe('contested');

    record = store.applyEvidence(evidence(5, 20, 0.2), 400);
    expect(record.status).toBe('abandoned');

    // Abandoned superstitions are findings, not garbage: still queryable.
    expect(store.all()).toHaveLength(1);
    expect(store.held()).toHaveLength(0);
  });

  it('renders a templated statement and keeps provenance', () => {
    const store = new KnowledgeStore();
    const record = store.applyEvidence(evidence(5, 0, 0.8), 50);
    expect(record.statement.length).toBeGreaterThan(0);
    expect(record.sourceMemoryIds).toEqual([1, 2]);
    expect(record.origin).toBe('experience');
  });
});

describe('testimony', () => {
  it('discounts hearsay by trust in the speaker', () => {
    const trusted = new KnowledgeStore().intakeTestimony(RULE, 0.9, 1.0, 10, 42, 7);
    const distrusted = new KnowledgeStore().intakeTestimony(RULE, 0.9, 0.0, 10, 42, 7);
    expect(trusted.confidence).toBeCloseTo(0.72, 5);
    expect(distrusted.confidence).toBeCloseTo(0.27, 5);
    expect(trusted.status).toBe('held');
    expect(distrusted.status).toBe('hypothesis');
    expect(trusted.origin).toBe('testimony');
    expect(trusted.testimonyFrom).toBe(42);
  });

  it('upgrades testimony to experience when own evidence arrives', () => {
    const store = new KnowledgeStore();
    store.intakeTestimony(RULE, 0.9, 0.8, 10, 42, 7);
    const record = store.applyEvidence(evidence(4, 0, 0.8), 500);
    expect(record.origin).toBe('experience');
    expect(record.status).toBe('held');
  });

  it('never lets hearsay override first-hand knowledge', () => {
    const store = new KnowledgeStore();
    store.applyEvidence(evidence(6, 0, 0.85), 100);
    const record = store.intakeTestimony(RULE, 0.1, 1.0, 200, 42, 7);
    expect(record.confidence).toBeCloseTo(0.85, 5);
    expect(record.origin).toBe('experience');
  });
});
