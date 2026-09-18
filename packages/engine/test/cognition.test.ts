import { describe, expect, it } from 'vitest';
import {
  CognitionLog,
  CognitionScheduler,
  LlmMind,
  MindOutputError,
  MockMindBackend,
  ReflexMind,
  buildThinkPrompt,
  parseMindOutput,
} from '../src/index.js';
import type { CognitionRecord, KnowledgeRecord, MindOutput, ThinkInput } from '../src/index.js';
import { ruleKey, renderStatement } from '../src/index.js';
import { CTX } from './helpers.js';

function input(overrides: Partial<ThinkInput['snapshot']> = {}, knowledge: KnowledgeRecord[] = []): ThinkInput {
  return {
    snapshot: {
      id: 1,
      name: 'Kara',
      ageTicks: 100,
      traits: { curiosity: 50, aggression: 10, compassion: 80, ambition: 40, loyalty: 60, riskTolerance: 30 },
      needs: { hunger: 72, rest: 10, safety: 5, socialConnection: 10 },
      health: 90,
      sick: false,
      x: 0,
      y: 0,
      inventory: { berry: 1 },
      context: CTX,
      ...overrides,
    },
    recalledMemories: [],
    knowledge,
    relationships: new Map(),
    worldView: { tick: 500, night: false, season: 'spring', agents: [], resources: [], structures: [] },
    goals: [],
    trigger: 'periodic',
  };
}

describe('prompt builder', () => {
  it('renders knowledge confidence-qualified and never leaks unlearned facts', () => {
    const rule = {
      kind: 'context-association' as const,
      event: 'GatherSucceeded' as const,
      objectKind: 'berry' as const,
      feature: 'nearWater' as const,
      direction: 'positive' as const,
    };
    const k: KnowledgeRecord = {
      id: 1,
      ruleKey: ruleKey(rule),
      rule,
      statement: renderStatement(rule),
      confidence: 0.9,
      evidenceCount: 40,
      contradictionCount: 1,
      sourceMemoryIds: [1],
      status: 'held',
      origin: 'experience',
      firstFormed: 1,
      lastReinforced: 2,
    };
    const prompt = buildThinkPrompt(input({}, [k]));
    expect(prompt.user).toContain('You are sure (90%, seen 40×)');
    expect(prompt.user).toContain('near water');
    expect(prompt.system).toContain('reason ONLY from what you perceive and what you KNOW');
    // An agent with no knowledge is told so — never given world truths.
    expect(buildThinkPrompt(input()).user).toContain('you have learned nothing yet');
  });
});

describe('schema parser', () => {
  it('accepts valid output and strips prose/fences', () => {
    const out = parseMindOutput('here you go:\n```json\n{"plan":[{"kind":"Eat","objectKind":"berry"}]}\n```');
    expect(out.plan[0]).toEqual({ kind: 'Eat', objectKind: 'berry' });
  });
  it('rejects invalid intent verbs', () => {
    expect(() => parseMindOutput('{"plan":[{"kind":"Teleport"}]}')).toThrow(MindOutputError);
  });
  it('rejects invalid speech acts', () => {
    expect(() => parseMindOutput('{"utterances":[{"speechAct":"hex"}]}')).toThrow(MindOutputError);
  });
  it('rejects non-JSON', () => {
    expect(() => parseMindOutput('the model rambled')).toThrow(MindOutputError);
  });
});

describe('LlmMind', () => {
  it('produces a valid plan through the backend and logs the call', async () => {
    const log: CognitionRecord[] = [];
    let clock = 0;
    const mind = new LlmMind(new MockMindBackend(), { onCognition: (r) => log.push(r), now: () => (clock += 5) });
    const out = await mind.complete(input());
    expect(out.plan.length).toBeGreaterThan(0); // hungry → eats the berry
    expect(log).toHaveLength(1);
    expect(log[0]!.valid).toBe(true);
    expect(log[0]!.fellBackToReflex).toBe(false);
    expect(log[0]!.userPrompt).toContain('NEEDS');
  });

  it('retries once then falls back to reflex on persistent bad output', async () => {
    const log: CognitionRecord[] = [];
    const backend = new MockMindBackend({ failTimes: 5 }); // always junk
    const mind = new LlmMind(backend, { fallback: new ReflexMind(), onCognition: (r) => log.push(r) });
    const out = await mind.complete(input());
    expect(out).toBeDefined(); // reflex carried it
    expect(log[0]!.valid).toBe(false);
    expect(log[0]!.retried).toBe(true);
    expect(log[0]!.fellBackToReflex).toBe(true);
    // Both rejected completions survive — a refusal is the most informative
    // row a training corpus can hold, and the old capture threw it away.
    expect(log[0]!.attempts).toHaveLength(2);
    expect(log[0]!.attempts.every((a) => a.raw === 'not json — the model glitched' && a.error)).toBe(true);
    expect(log[0]!.modelId).toBe('mock/reflex-policy');
  });

  it('recovers on the retry when the model fails just once', async () => {
    const log: CognitionRecord[] = [];
    const mind = new LlmMind(new MockMindBackend({ failTimes: 1 }), { onCognition: (r) => log.push(r) });
    await mind.complete(input());
    expect(log[0]!.valid).toBe(true);
    expect(log[0]!.retried).toBe(true);
    expect(log[0]!.fellBackToReflex).toBe(false);
    expect(log[0]!.attempts).toHaveLength(2);
    expect(log[0]!.attempts[0]!.error).toBeDefined();
    expect(log[0]!.attempts[1]!.error).toBeUndefined();
  });
});

describe('CognitionScheduler', () => {
  it('never exceeds the concurrency budget and applies every result', async () => {
    const sched = new CognitionScheduler({ maxConcurrent: 3 });
    let peak = 0;
    let running = 0;
    const applied: number[] = [];
    const make = (id: number) => () =>
      new Promise<MindOutput>((resolve) => {
        running++;
        peak = Math.max(peak, running);
        setTimeout(() => {
          running--;
          resolve({ goals: [], plan: [], utterances: [] });
        }, 5);
      });
    for (let i = 0; i < 12; i++) sched.submit(i, make(i), () => applied.push(i));
    // Wait for drain.
    await new Promise((r) => setTimeout(r, 120));
    expect(peak).toBeLessThanOrEqual(3);
    expect(applied.length).toBe(12);
  });

  it('refuses a second submit while an agent is already pending', () => {
    const sched = new CognitionScheduler();
    const slow = () => new Promise<MindOutput>(() => {}); // never resolves
    expect(sched.submit(7, slow, () => {})).toBe(true);
    expect(sched.submit(7, slow, () => {})).toBe(false);
    expect(sched.isPending(7)).toBe(true);
  });
});

describe('CognitionLog', () => {
  it('tracks validity rate and latest-per-agent', () => {
    const log = new CognitionLog(3);
    const rec = (agentId: number, valid: boolean): CognitionRecord => ({
      agentId,
      tick: 1,
      trigger: 'periodic',
      systemPrompt: '',
      userPrompt: '',
      rawOutput: '',
      attempts: [],
      modelId: 'mock/reflex-policy',
      valid,
      retried: false,
      fellBackToReflex: !valid,
      latencyMs: 1,
    });
    log.push(rec(1, true));
    log.push(rec(1, false));
    log.push(rec(2, true));
    expect(log.validityRate()).toBeCloseTo(2 / 3, 5);
    expect(log.latestFor(1)!.valid).toBe(false);
    log.push(rec(3, true)); // evicts the oldest
    expect(log.count).toBe(3);
    expect(log.droppedCount).toBe(1);
  });
});
