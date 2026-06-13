import { describe, expect, it } from 'vitest';
import {
  MockMindBackend,
  curateCorpus,
  cognitionToExample,
  evalJsonValidity,
  evalKnowledgeFidelity,
} from '../src/index.js';
import type { CognitionRecord, IMindBackend, ThinkInput } from '../src/index.js';
import { CTX } from './helpers.js';

function rec(overrides: Partial<CognitionRecord>): CognitionRecord {
  return {
    agentId: 1,
    tick: 1,
    trigger: 'periodic',
    systemPrompt: 'sys',
    userPrompt: 'usr',
    rawOutput: '{"plan":[{"kind":"Eat","objectKind":"berry"}]}',
    valid: true,
    retried: false,
    fellBackToReflex: false,
    latencyMs: 5,
    ...overrides,
  };
}

describe('corpus curation', () => {
  it('keeps valid calls, drops invalid/fallback/empty', () => {
    const records = [
      rec({}),
      rec({ valid: false, fellBackToReflex: true }),
      rec({ rawOutput: '' }),
    ];
    const result = curateCorpus(records, { dedupe: false });
    expect(result.kept).toBe(1);
    expect(result.droppedInvalid).toBe(2);
    expect(cognitionToExample(records[0]!)!.messages).toHaveLength(3);
    expect(cognitionToExample(records[1]!)).toBeNull();
  });

  it('dedupes by trigger + plan shape and caps per trigger', () => {
    const same = [rec({}), rec({}), rec({})]; // identical plan shape
    expect(curateCorpus(same, { dedupe: true }).kept).toBe(1);
    expect(curateCorpus(same, { dedupe: true }).droppedDuplicate).toBe(2);

    const varied = [
      rec({ rawOutput: '{"plan":[{"kind":"Eat","objectKind":"berry"}]}' }),
      rec({ rawOutput: '{"plan":[{"kind":"Sleep"}]}' }),
      rec({ rawOutput: '{"plan":[{"kind":"MoveTo","x":1,"y":2}]}' }),
    ];
    const capped = curateCorpus(varied, { dedupe: true, maxPerTrigger: 2 });
    expect(capped.kept).toBe(2);
    expect(capped.droppedOverCap).toBe(1);
  });

  it('emits valid JSONL (one example per line)', () => {
    const result = curateCorpus([rec({}), rec({ rawOutput: '{"plan":[{"kind":"Sleep"}]}' })], { dedupe: true });
    const lines = result.jsonl.split('\n');
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
  });
});

// A backend that ALWAYS plants a seed — simulates a model leaking pretrained
// "agriculture exists" knowledge the agent never learned.
class LeakyBackend implements IMindBackend {
  readonly modelId = 'mock/leaky';
  complete(): Promise<string> {
    return Promise.resolve('{"plan":[{"kind":"Deposit","objectKind":"seed"}],"goals":[],"utterances":[]}');
  }
}

function probeInput(): ThinkInput {
  return {
    snapshot: {
      id: 1,
      name: 'K',
      ageTicks: 1,
      traits: { curiosity: 50, aggression: 0, compassion: 50, ambition: 50, loyalty: 50, riskTolerance: 50 },
      needs: { hunger: 80, rest: 10, safety: 10, socialConnection: 10 },
      health: 90,
      sick: false,
      x: 0,
      y: 0,
      inventory: { seed: 1 },
      context: CTX,
    },
    recalledMemories: [],
    knowledge: [], // crucially: NO seed→plant knowledge
    relationships: new Map(),
    worldView: { tick: 1, night: false, season: 'spring', agents: [], resources: [], structures: [] },
    goals: [],
    trigger: 'periodic',
  };
}

describe('eval gates', () => {
  it('JSON validity: mock backend is 100% valid', async () => {
    const r = await evalJsonValidity(new MockMindBackend(), [probeInput(), probeInput()]);
    expect(r.rate).toBe(1);
  });

  it('knowledge fidelity: faithful reflex policy never plants without knowledge', async () => {
    const r = await evalKnowledgeFidelity(new MockMindBackend(), [{ name: 'hungry-with-seed', input: probeInput() }]);
    expect(r.passed).toBe(true);
    expect(r.violations).toHaveLength(0);
  });

  it('knowledge fidelity: catches a model that leaks pretrained agriculture', async () => {
    const r = await evalKnowledgeFidelity(new LeakyBackend(), [{ name: 'hungry-with-seed', input: probeInput() }]);
    expect(r.passed).toBe(false);
    expect(r.violations[0]!.reason).toContain('pretrained-knowledge leak');
  });
});
