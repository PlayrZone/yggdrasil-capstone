import { describe, expect, it } from 'vitest';
import { RateLimiter, THINK_LIMITS, estimateBytes, guardLlmComplete, llmRateLimiter, validateThinkInput } from '../src/main/ipcGuards.js';

/** A minimal ThinkInput of the shape AgentMind.buildThinkInput really produces. */
function thinkInput(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    snapshot: {
      id: 12,
      name: 'Gahallian #12',
      ageTicks: 900,
      traits: { curiosity: 50, aggression: 10, compassion: 60, ambition: 20, loyalty: 70, riskTolerance: 30 },
      needs: { hunger: 0.4, rest: 0.6, safety: 0.9, socialConnection: 0.5 },
      health: 88,
      sick: false,
      x: 120,
      y: 240,
      inventory: { berry: 2 },
      context: {},
    },
    recalledMemories: [{ tick: 10, text: 'ate a berry' }],
    knowledge: [{ ruleKey: 'eat:berryBush', confidence: 0.8 }],
    relationships: new Map([[7, { agentId: 7, affinity: 0.2 }]]),
    worldView: { tick: 900, night: false, season: 'summer', agents: [], resources: [], structures: [] },
    goals: [{ id: 1, description: 'find water', createdTick: 800 }],
    trigger: 'periodic',
    ...over,
  };
}

describe('validateThinkInput', () => {
  it('accepts what the engine actually sends', () => {
    expect(validateThinkInput(thinkInput())).toEqual({ ok: true });
    expect(validateThinkInput(thinkInput(), 'previous reply was not JSON')).toEqual({ ok: true });
    expect(
      validateThinkInput(
        thinkInput({
          sacredPlace: { x: 1, y: 2 },
          tragedyPlaces: [{ x: 3, y: 4 }],
          stories: [{ text: 'a tale', firsthand: false }],
          mostTold: 'the tale',
          kin: [{ name: 'Ash', relation: 'mother' }],
          social: [{ id: 3, name: 'Ash' }],
          offerMaking: false,
          relationships: undefined,
        }),
      ),
    ).toEqual({ ok: true });
  });

  it.each([
    ['not an object', 'a string'],
    ['null', null],
    ['an array', []],
    ['a missing snapshot', thinkInput({ snapshot: undefined })],
    ['a snapshot that is an array', thinkInput({ snapshot: [] })],
    ['a non-numeric id', thinkInput({ snapshot: { ...(thinkInput()['snapshot'] as object), id: 'x' } })],
    ['a NaN coordinate', thinkInput({ snapshot: { ...(thinkInput()['snapshot'] as object), x: Number.NaN } })],
    ['a missing worldView', thinkInput({ worldView: undefined })],
    ['a non-array knowledge', thinkInput({ knowledge: { length: 3 } })],
    ['an unknown trigger', thinkInput({ trigger: 'whenever' })],
    ['a relationships object instead of a Map', thinkInput({ relationships: { 7: {} } })],
  ])('rejects %s', (_name, input) => {
    expect(validateThinkInput(input).ok).toBe(false);
  });

  it('rejects a bad retryError before looking at anything else', () => {
    expect(validateThinkInput(thinkInput(), 42).ok).toBe(false);
    expect(validateThinkInput(thinkInput(), 'x'.repeat(THINK_LIMITS.retryError + 1)).ok).toBe(false);
  });

  it('caps every renderer-controlled array', () => {
    const big = (n: number): unknown[] => Array.from({ length: n }, () => ({}));
    expect(validateThinkInput(thinkInput({ recalledMemories: big(THINK_LIMITS.memories + 1) })).ok).toBe(false);
    expect(validateThinkInput(thinkInput({ knowledge: big(THINK_LIMITS.knowledge + 1) })).ok).toBe(false);
    expect(validateThinkInput(thinkInput({ goals: big(THINK_LIMITS.goals + 1) })).ok).toBe(false);
    expect(validateThinkInput(thinkInput({ stories: big(THINK_LIMITS.stories + 1) })).ok).toBe(false);
    const wv = thinkInput()['worldView'] as Record<string, unknown>;
    expect(validateThinkInput(thinkInput({ worldView: { ...wv, agents: big(THINK_LIMITS.observed + 1) } })).ok).toBe(false);
    const rel = new Map<number, object>();
    for (let i = 0; i <= THINK_LIMITS.relationships; i++) rel.set(i, {});
    expect(validateThinkInput(thinkInput({ relationships: rel })).ok).toBe(false);
  });

  it('rejects an oversized payload even when every array is within its cap', () => {
    const fat = validateThinkInput(thinkInput({ knowledge: Array.from({ length: 200 }, () => ({ text: 'x'.repeat(8000) })) }));
    expect(fat.ok).toBe(false);
    expect(fat.ok === false && fat.reason).toMatch(/bytes/);
  });

  it('rejects size smuggled through an unknown field', () => {
    expect(validateThinkInput(thinkInput({ padding: 'x'.repeat(THINK_LIMITS.bytes + 1) })).ok).toBe(false);
    // ...while a small unknown field stays forward-compatible with the engine.
    expect(validateThinkInput(thinkInput({ somethingNew: [1, 2, 3] })).ok).toBe(true);
  });

  /**
   * A TypedArray survives structured clone, so a renderer could hand one to
   * `llm:complete`. The old `isPlainObject` accepted it and `Object.entries`
   * then built one pair array per element: 1e6 stalled main for ~275 ms and
   * 64e6 killed the process outright. Rejection must be O(1).
   */
  it.each([
    ['at an unknown key', (a: unknown) => thinkInput({ junk: a })],
    ['as snapshot.traits', (a: unknown) => thinkInput({ snapshot: { ...(thinkInput()['snapshot'] as object), traits: a } })],
    ['as the whole input', (a: unknown) => a as Record<string, unknown>],
    ['inside worldView.agents', (a: unknown) => thinkInput({ worldView: { ...(thinkInput()['worldView'] as object), agents: [a] } })],
  ])('rejects a huge TypedArray %s in O(1)', (_name, build) => {
    for (const n of [1e6, 64e6]) {
      const payload = build(new Uint8Array(n));
      const t0 = process.hrtime.bigint();
      const r = validateThinkInput(payload);
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      expect(r.ok, `n=${n}`).toBe(false);
      expect(ms, `n=${n} took ${ms}ms`).toBeLessThan(50);
    }
  });

  it('rejects every non-plain object structured clone can carry', () => {
    for (const exotic of [
      new Uint8Array(8),
      new Float64Array(8),
      new ArrayBuffer(8),
      new DataView(new ArrayBuffer(8)),
      new Set([1, 2]),
      new Date(),
      /re/g,
      new Error('boom'),
      new (class Thing {
        v = 1;
      })(),
    ]) {
      expect(validateThinkInput(thinkInput({ junk: exotic })).ok, String(exotic)).toBe(false);
    }
  });

  it('measures strings in UTF-8 bytes, not UTF-16 units', () => {
    // 4 bytes per astral char but 2 UTF-16 units: counting units made the cap
    // twice as generous as advertised.
    const astral = '🌍'.repeat(THINK_LIMITS.bytes / 4);
    expect(validateThinkInput(thinkInput({ mostTold: undefined, junk: astral })).ok).toBe(false);
    expect(estimateBytes('🌍', 1000, 5).bytes).toBe(6);
    expect(estimateBytes('é', 1000, 5).bytes).toBe(4);
  });

  it('rejects a cyclic payload instead of hanging', () => {
    const input = thinkInput();
    (input['snapshot'] as Record<string, unknown>)['self'] = input;
    const r = validateThinkInput(input);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toMatch(/cycle/);
  });
});

describe('estimateBytes', () => {
  it('allows shared references but catches real cycles', () => {
    const shared = { a: 1 };
    expect(estimateBytes({ x: shared, y: shared, z: [shared, shared] }, 1000, 10).cyclic).toBe(false);
    const cyc: Record<string, unknown> = {};
    cyc['self'] = cyc;
    expect(estimateBytes(cyc, 1000, 10).cyclic).toBe(true);
  });

  it('counts Map contents that JSON.stringify would silently drop', () => {
    const m = new Map([[1, 'x'.repeat(500)]]);
    expect(JSON.stringify({ m }).length).toBeLessThan(20);
    expect(estimateBytes({ m }, 10_000, 10).bytes).toBeGreaterThan(500);
  });

  it('stops walking once the budget is blown', () => {
    const wide = Array.from({ length: 100_000 }, () => 'x'.repeat(100));
    const r = estimateBytes(wide, 1000, 10);
    expect(r.over).toBe(true);
    expect(r.bytes).toBeLessThan(200_000);
  });

  it('treats an over-deep graph as over budget', () => {
    let deep: unknown = 'leaf';
    for (let i = 0; i < 50; i++) deep = { deep };
    expect(estimateBytes(deep, 1_000_000, 24).over).toBe(true);
  });
});

describe('RateLimiter', () => {
  it('allows up to max in a window and refuses the rest', () => {
    const rl = new RateLimiter(3, 1000);
    expect([rl.tryTake(0), rl.tryTake(100), rl.tryTake(200), rl.tryTake(300)]).toEqual([true, true, true, false]);
  });

  it('lets the window slide', () => {
    const rl = new RateLimiter(2, 1000);
    expect(rl.tryTake(0)).toBe(true);
    expect(rl.tryTake(500)).toBe(true);
    expect(rl.tryTake(900)).toBe(false);
    expect(rl.tryTake(1001)).toBe(true); // the hit at 0 has aged out
    expect(rl.tryTake(1100)).toBe(false); // the hit at 500 has not
    expect(rl.tryTake(1501)).toBe(true);
  });

  it('does not grow without bound', () => {
    const rl = new RateLimiter(5, 100);
    for (let t = 0; t < 10_000; t += 50) rl.tryTake(t);
    expect(rl.tryTake(10_000)).toBe(true);
  });

  it('meters the validator too: a rejected payload still costs a token', () => {
    // With the limiter behind validation, junk payloads were unmetered and the
    // validator itself was the unprotected target.
    const rl = new RateLimiter(2, 60_000);
    expect(guardLlmComplete(rl, 'not an object', undefined, 0)).toMatchObject({ code: 'BAD_THINK_INPUT' });
    expect(guardLlmComplete(rl, { snapshot: null }, undefined, 1)).toMatchObject({ code: 'BAD_THINK_INPUT' });
    expect(guardLlmComplete(rl, thinkInput(), undefined, 2)).toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('passes a valid payload through the gate', () => {
    expect(guardLlmComplete(new RateLimiter(5, 60_000), thinkInput(), undefined, 0)).toEqual({ ok: true });
  });

  it('builds a generous default limiter that env can override', () => {
    expect(llmRateLimiter().max).toBe(600);
    expect(llmRateLimiter().windowMs).toBe(60_000);
    process.env['YGG_LLM_MAX_PER_WINDOW'] = '5';
    process.env['YGG_LLM_RATE_WINDOW_MS'] = '2000';
    try {
      expect(llmRateLimiter().max).toBe(5);
      expect(llmRateLimiter().windowMs).toBe(2000);
      process.env['YGG_LLM_MAX_PER_WINDOW'] = 'nonsense';
      expect(llmRateLimiter().max).toBe(600);
    } finally {
      delete process.env['YGG_LLM_MAX_PER_WINDOW'];
      delete process.env['YGG_LLM_RATE_WINDOW_MS'];
    }
  });
});
