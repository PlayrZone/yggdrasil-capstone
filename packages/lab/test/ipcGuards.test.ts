import { describe, expect, it } from 'vitest';
import { codecFor, foragerAdapter } from '@yggdrasil/engine';
import {
  PROMPT_LIMITS,
  RateLimiter,
  THINK_LIMITS,
  estimateBytes,
  guardLlmComplete,
  llmRateLimiter,
  validateThinkInput,
  validateThinkPrompt,
} from '../src/main/ipcGuards.js';

/**
 * WHAT A PLACE IS, ASKED OF THE WORLD (engine W1-B4). The guard is pure and
 * engine-free — the predicate is threaded in by whoever resolved the world —
 * so these tests hand it the REAL `foragerSpace.isPlace` rather than a
 * transcription: that function accepts a HALF-WRITTEN place on purpose (a model
 * may write `{"kind":"MoveTo","x":5}`), and a hand-rolled copy would have
 * quietly guessed otherwise.
 */
const foragerPlaces = codecFor(foragerAdapter.space);
const isPlace = (value: unknown): boolean => foragerPlaces.isPlace(value);

/** A payload whose only unusual thing is where the being is standing. */
const withPlace = (place: unknown): Record<string, unknown> =>
  thinkInput({ snapshot: { ...(thinkInput()['snapshot'] as object), place } });

/**
 * The three ways a renderer-supplied object can raise while it is being READ.
 * Each must come back as a refusal: a thrown `TypeError` is not one of the
 * three codes the worker reads, so it escapes the contract entirely.
 */
const hostileReads: [string, () => unknown][] = [
  [
    'a revoked Proxy',
    (): unknown => {
      const { proxy, revoke } = Proxy.revocable({ x: 120, y: 80 }, {});
      revoke();
      return proxy;
    },
  ],
  [
    'a Proxy whose get trap throws',
    (): unknown =>
      new Proxy(
        { x: 120, y: 80 },
        {
          get(): never {
            throw new Error('boom — a message that must not become a reason');
          },
        },
      ),
  ],
  [
    'an object with a throwing getter',
    (): unknown => ({
      get x(): number {
        throw new Error('boom — a message that must not become a reason');
      },
      y: 80,
    }),
  ],
];

/** What the engine actually composes: a system preamble and the situation. */
function thinkPrompt(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { system: 'You are the mind of Gahallian #12.', user: 'You are hungry. What do you do?', ...over };
}

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
      place: { x: 120, y: 240 },
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

describe('validateThinkPrompt', () => {
  it('accepts what the engine actually composes, and hands back a copy of it', () => {
    const sent = thinkPrompt();
    const r = validateThinkPrompt(sent);
    expect(r).toEqual({ ok: true, prompt: sent });
    // A copy, not the caller's object: what was measured is what gets billed.
    expect(r.ok === true && r.prompt).not.toBe(sent);
  });

  it('accepts a null-prototype prompt — that is still genuinely plain', () => {
    const bare = Object.assign(Object.create(null) as Record<string, unknown>, thinkPrompt());
    expect(validateThinkPrompt(bare).ok).toBe(true);
  });

  it.each([
    ['not an object', 'a string'],
    ['null', null],
    ['undefined', undefined],
    ['an array', ['system', 'user']],
    ['a missing user', { system: 'you are' }],
    ['a missing system', { user: 'what now?' }],
    ['an empty object', {}],
    ['an extra key', thinkPrompt({ junk: 'pay for this too' })],
    ['a numeric system', thinkPrompt({ system: 42 })],
    ['a null user', thinkPrompt({ user: null })],
    ['an undefined user', thinkPrompt({ user: undefined })],
    ['an empty system', thinkPrompt({ system: '' })],
    ['an empty user', thinkPrompt({ user: '' })],
  ])('rejects %s', (_name, prompt) => {
    expect(validateThinkPrompt(prompt).ok).toBe(false);
  });

  it('rejects every non-plain object structured clone can carry', () => {
    for (const exotic of [
      new Map([
        ['system', 'a'],
        ['user', 'b'],
      ]),
      new Set(['system']),
      new Date(),
      new Uint8Array(8),
      new ArrayBuffer(8),
      /re/g,
      new Error('boom'),
      Object.assign(
        new (class Prompt {
          declare system: string;
          declare user: string;
        })(),
        thinkPrompt(),
      ),
    ]) {
      expect(validateThinkPrompt(exotic).ok, String(exotic)).toBe(false);
    }
  });

  it('rejects prototype tricks', () => {
    // An object whose prototype is someone else's is not a plain object, even
    // when it answers `system` and `user` correctly.
    const planted = Object.assign(Object.create({ evil: true }) as Record<string, unknown>, thinkPrompt());
    expect(validateThinkPrompt(planted).ok).toBe(false);
    // JSON.parse makes `__proto__` an OWN enumerable key, so it shows up as a
    // stranger rather than silently redefining the prototype.
    const parsed: unknown = JSON.parse('{"__proto__":{"evil":true},"system":"you are","user":"what now?"}');
    expect(validateThinkPrompt(parsed).ok).toBe(false);
    // Inherited system/user do not count as present.
    expect(validateThinkPrompt(Object.create(thinkPrompt()) as unknown).ok).toBe(false);
  });

  it('measures the fields in UTF-8 bytes, not UTF-16 units', () => {
    // Exactly at the cap in ASCII is fine.
    expect(validateThinkPrompt(thinkPrompt({ user: 'x'.repeat(PROMPT_LIMITS.field) })).ok).toBe(true);
    expect(validateThinkPrompt(thinkPrompt({ user: 'x'.repeat(PROMPT_LIMITS.field + 1) })).ok).toBe(false);
    // 4 bytes per astral char but 2 UTF-16 units: counting units would have let
    // 80 KiB of billable text through a 64 KiB cap.
    const astral = '🌍'.repeat(PROMPT_LIMITS.field / 4 + 1);
    expect(astral.length).toBeLessThan(PROMPT_LIMITS.field);
    const r = validateThinkPrompt(thinkPrompt({ user: astral }));
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toMatch(/bytes/);
    // Two bytes per 'é', one UTF-16 unit — the same trick, just below astral.
    expect(validateThinkPrompt(thinkPrompt({ system: 'é'.repeat(PROMPT_LIMITS.field / 2 + 1) })).ok).toBe(false);
  });

  it('holds a total budget that the per-field caps already imply', () => {
    // 2 × field === total, so two maximal fields sit exactly ON the ceiling and
    // pass. The total only ever bites if a field cap is later raised.
    expect(PROMPT_LIMITS.field * 2).toBe(PROMPT_LIMITS.total);
    const maxed = { system: 'x'.repeat(PROMPT_LIMITS.field), user: 'y'.repeat(PROMPT_LIMITS.field) };
    expect(validateThinkPrompt(maxed).ok).toBe(true);
  });

  /**
   * The hazard the input validator was hardened against — a value whose mere
   * inspection allocates per element — must not reappear on the prompt slot.
   * A 64e6-element view used to kill main outright; here it is a prototype
   * check away from rejection.
   */
  it('rejects a huge TypedArray in the prompt slot in O(1)', () => {
    for (const n of [1e6, 64e6]) {
      const t0 = process.hrtime.bigint();
      expect(validateThinkPrompt(new Uint8Array(n)).ok, `n=${n}`).toBe(false);
      expect(Number(process.hrtime.bigint() - t0) / 1e6, `n=${n}`).toBeLessThan(50);
    }
  });

  it('refuses an object of a million strangers at the price of one enumeration', () => {
    const wide: Record<string, unknown> = thinkPrompt();
    for (let i = 0; i < 1_000_000; i++) wide[`k${i}`] = 'x';
    // V8 materialises the key list for `for…in` whatever is done with the keys,
    // so exactness cannot be checked for less than a single pass. What must not
    // happen is per-key work ON TOP of that pass — so the validator is measured
    // against a `for…in` that does nothing at all.
    let t = process.hrtime.bigint();
    for (const k in wide) {
      void k;
      break;
    }
    const baseline = Number(process.hrtime.bigint() - t) / 1e6;
    t = process.hrtime.bigint();
    expect(validateThinkPrompt(wide).ok).toBe(false);
    const measured = Number(process.hrtime.bigint() - t) / 1e6;
    expect(measured, `${measured}ms vs a ${baseline}ms bare enumeration`).toBeLessThan(baseline * 1.5 + 25);
  });

  it('bounds the stranger key it names, so a reason cannot itself be a payload', () => {
    const r = validateThinkPrompt(thinkPrompt({ ['k'.repeat(100_000)]: 1 }));
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason.length).toBeLessThan(200);
  });

  it('cannot be changed after it is approved', () => {
    // An accessor is flattened by structured clone in the real world, but the
    // copy makes the guarantee unconditional: what was measured is what ships.
    let reads = 0;
    const sneaky = {
      system: 'you are',
      get user(): string {
        return reads++ === 0 ? 'a short question' : 'x'.repeat(1_000_000);
      },
    };
    const r = validateThinkPrompt(sneaky);
    expect(r.ok === true && r.prompt.user).toBe('a short question');
  });

  it('rejects a ThinkInput handed in where a prompt belongs', () => {
    expect(validateThinkPrompt(thinkInput()).ok).toBe(false);
  });
});

describe('validateThinkInput', () => {
  it('accepts what the engine actually sends', () => {
    expect(validateThinkInput(thinkInput())).toEqual({ ok: true });
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
    // A place is world data, so what this edge refuses is a place that is not
    // data at all — not a coordinate, which only a plane has (engine W1-B4).
    ['a place that is not an object', thinkInput({ snapshot: { ...(thinkInput()['snapshot'] as object), place: 7 } })],
    ['a missing worldView', thinkInput({ worldView: undefined })],
    ['a non-array knowledge', thinkInput({ knowledge: { length: 3 } })],
    ['an unknown trigger', thinkInput({ trigger: 'whenever' })],
    ['a relationships object instead of a Map', thinkInput({ relationships: { 7: {} } })],
  ])('rejects %s', (_name, input) => {
    expect(validateThinkInput(input).ok).toBe(false);
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

/**
 * THE PLACE CHECK THE OPAQUE `PlaceRef` TOOK AWAY, PUT BACK WHERE IT BELONGS.
 *
 * Before W1-B4 this file checked `finite(snapshot.x) && finite(snapshot.y)`;
 * B4 replaced it with `isPlainObject(place)`, which is not a check — `{}`,
 * `{x:"120"}`, `{x:NaN,y:Infinity}` and a nested place all pass it, and since
 * `snapshot.place` reaches the billed text only through `sacredPlace`, the
 * prompt beside such an input still BINDS and the call is paid for. The
 * question belongs to the world, and the world is now asked.
 */
describe('validateThinkInput asks the world what a place is', () => {
  it('accepts the places the forager plane really mints', () => {
    expect(validateThinkInput(withPlace({ x: 120, y: 80 }), isPlace)).toEqual({ ok: true });
    // Signed zero, denormals, and the far end of the range are all numbers a
    // body can settle on, and the world says so.
    expect(validateThinkInput(withPlace({ x: -0, y: 5e-324 }), isPlace).ok).toBe(true);
    expect(validateThinkInput(withPlace({ x: Number.MAX_VALUE, y: -1e8 }), isPlace).ok).toBe(true);
    // A null-prototype object carrying real coordinates is genuinely plain AND
    // genuinely a place — it is the BARE one below that is neither.
    expect(validateThinkInput(withPlace(Object.assign(Object.create(null) as object, { x: 1, y: 2 })), isPlace).ok).toBe(true);
  });

  /**
   * THE GUARD ASKS THE QUESTION IT IS HANDED, AND IT IS NOT THE ONE THE WORLD
   * ANSWERS. `foragerSpace.isPlace({y:80})` is TRUE by design — a model can
   * write `{"kind":"MoveTo","x":5}`, and the body's refusal of that half-written
   * act is an event the being remembers, so the world must keep saying yes to
   * one coordinate. A being's POSITION is never half-written, so the edge that
   * takes a ThinkInput composes a sharper question out of the world's own
   * `fields` (`llmBridge.placeAt`, pinned in llmBridge.test.ts) and hands THAT
   * in. This file's job is to ask whatever it is given, faithfully.
   */
  it("takes the predicate it is handed — the completeness question is the caller's", () => {
    // The world's own answer, pinned: the divergence is a decision, not a bug.
    expect(foragerPlaces.isPlace({ y: 80 })).toBe(true);
    expect(validateThinkInput(withPlace({ y: 80 }), isPlace).ok).toBe(true);
    // The edge's sharper question, composed the way `llmBridge` composes it.
    const complete = (v: unknown): boolean =>
      isPlace(v) && foragerPlaces.fields.every((f) => Object.prototype.hasOwnProperty.call(v, f.id) && (v as Record<string, unknown>)[f.id] !== undefined);
    expect(validateThinkInput(withPlace({ y: 80 }), complete).ok).toBe(false);
    expect(validateThinkInput(withPlace({ x: 120, y: 80 }), complete).ok).toBe(true);
    // …and an explicit `undefined` for both is not half-written, it is empty —
    // refused by either question.
    expect(validateThinkInput(withPlace({ x: undefined, y: undefined }), isPlace).ok).toBe(false);
  });

  /** Every accept-regression the W1-B4 verifier listed, one case each. */
  it.each([
    ['an empty place', {}],
    ['string coordinates', { x: '120', y: 80 }],
    ['NaN and Infinity', { x: NaN, y: Infinity }],
    ['a nested place', { place: { x: 120, y: 80 } }],
    ['a bare null-prototype object', Object.create(null) as object],
    ['a JSON-parsed own __proto__ key', JSON.parse('{"__proto__":{"x":120,"y":80}}') as object],
    ['coordinates inherited from a prototype', Object.create({ x: 120, y: 80 }) as object],
    ['a place that is not an object', 7],
    ['a place that is an array of coordinates', [120, 80]],
    ['a TypedArray of coordinates', new Float64Array([120, 80])],
  ])('refuses %s', (_name, place) => {
    const r = validateThinkInput(withPlace(place), isPlace);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toContain('place');
  });

  it('asks the world rather than deciding for itself', () => {
    // A world that names one spot rather than plotting two numbers: its places
    // are nothing the forager plane would accept, and vice versa.
    const spotWorld = (v: unknown): boolean => typeof (v as { spot?: unknown }).spot === 'string';
    expect(validateThinkInput(withPlace({ spot: 'the ridge' }), spotWorld).ok).toBe(true);
    expect(validateThinkInput(withPlace({ spot: 'the ridge' }), isPlace).ok).toBe(false);
    expect(validateThinkInput(withPlace({ x: 120, y: 80 }), spotWorld).ok).toBe(false);
    // …and the structural half stays the guard's own, whatever the world says:
    // a permissive world cannot talk it into walking a TypedArray.
    const anything = (): boolean => true;
    expect(validateThinkInput(withPlace(new Uint8Array(8)), anything).ok).toBe(false);
    expect(validateThinkInput(withPlace(new Date()), anything).ok).toBe(false);
  });

  it('holds sacredPlace to the same question — it is the one that reaches the prompt', () => {
    expect(validateThinkInput(thinkInput({ sacredPlace: { x: 1, y: 2 } }), isPlace).ok).toBe(true);
    for (const bad of [{}, { x: '1', y: 2 }, { x: NaN, y: 2 }, { place: { x: 1, y: 2 } }, 7, Object.create(null) as object]) {
      const r = validateThinkInput(thinkInput({ sacredPlace: bad }), isPlace);
      expect(r.ok, JSON.stringify(bad)).toBe(false);
      expect(r.ok === false && r.reason).toContain('sacredPlace');
    }
  });

  it('holds every tragedyPlace to it too, and still caps how many there are', () => {
    expect(validateThinkInput(thinkInput({ tragedyPlaces: [{ x: 3, y: 4 }, { x: 5, y: 6 }] }), isPlace).ok).toBe(true);
    for (const bad of [[{}], [{ x: 3, y: 4 }, {}], [{ x: 3, y: 4 }, 'over there'], [{ x: '3', y: 4 }], [null]]) {
      const r = validateThinkInput(thinkInput({ tragedyPlaces: bad }), isPlace);
      expect(r.ok, JSON.stringify(bad)).toBe(false);
      expect(r.ok === false && r.reason).toContain('tragedyPlaces');
    }
    const place = (): Record<string, number> => ({ x: 1, y: 1 });
    const atCap = Array.from({ length: THINK_LIMITS.tragedyPlaces }, place);
    expect(validateThinkInput(thinkInput({ tragedyPlaces: atCap }), isPlace).ok).toBe(true);
    // The cap is checked BEFORE the places are, so an over-long array costs one
    // length read rather than a predicate call per entry.
    const overCap = Array.from({ length: THINK_LIMITS.tragedyPlaces + 1 }, place);
    const r = validateThinkInput(thinkInput({ tragedyPlaces: overCap }), isPlace);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toMatch(/exceeds/);
  });

  it('still works with no world to ask — structurally, and only structurally', () => {
    // No predicate is what a caller with an UNKNOWN world passes. The place is
    // then merely plain data, which is why `llmBridge` must refuse that call
    // for the world's sake (`BAD_THINK_PROMPT: unknown world`) — pinned in
    // llmBridge.test.ts — rather than let it reach a backend.
    expect(validateThinkInput(withPlace({})).ok).toBe(true);
    expect(validateThinkInput(withPlace(7)).ok).toBe(false);
  });
});

/**
 * A GUARD THAT THROWS IS A GUARD THAT IS NOT THERE. `llmComplete` turns a
 * `Check` into `BAD_THINK_INPUT: …` and has nothing to say about a raw
 * `TypeError`, so the three ways a hostile object can raise while being read
 * must all come back as refusals — and the thrown message must not ride out
 * inside the reason.
 */
describe('the guard never throws, whatever the payload does while it is read', () => {
  const leaks = (r: { ok: true } | { ok: false; reason: string }): boolean => r.ok === false && /boom/.test(r.reason);

  it.each(hostileReads)('refuses %s in the place slot', (_name, make) => {
    const input = withPlace(make());
    expect(() => validateThinkInput(input, isPlace)).not.toThrow();
    const r = validateThinkInput(input, isPlace);
    expect(r.ok).toBe(false);
    expect(leaks(r)).toBe(false);
  });

  it.each(hostileReads)('refuses %s as the snapshot', (_name, make) => {
    const input = thinkInput({ snapshot: make() });
    expect(() => validateThinkInput(input, isPlace)).not.toThrow();
    const r = validateThinkInput(input, isPlace);
    expect(r.ok).toBe(false);
    expect(leaks(r)).toBe(false);
  });

  it.each(hostileReads)('refuses %s nested at an unknown key, from inside the size walk', (_name, make) => {
    const input = thinkInput({ junk: make() });
    expect(() => validateThinkInput(input, isPlace)).not.toThrow();
    const r = validateThinkInput(input, isPlace);
    expect(r.ok).toBe(false);
    expect(leaks(r)).toBe(false);
  });

  it.each(hostileReads)('refuses %s as the whole input', (_name, make) => {
    expect(() => validateThinkInput(make(), isPlace)).not.toThrow();
    expect(validateThinkInput(make(), isPlace).ok).toBe(false);
  });

  it.each(hostileReads)('refuses %s in the prompt slot too', (_name, make) => {
    expect(() => validateThinkPrompt(make())).not.toThrow();
    const r = validateThinkPrompt(make());
    expect(r.ok).toBe(false);
    expect(r.ok === false && /boom/.test(r.reason)).toBe(false);
  });

  it.each(hostileReads)('answers %s at the gate with BAD_THINK_INPUT, and spends the token', (_name, make) => {
    const rl = new RateLimiter(1, 60_000);
    let gate: ReturnType<typeof guardLlmComplete> | undefined;
    expect(() => {
      gate = guardLlmComplete(rl, thinkPrompt(), withPlace(make()), { isPlace, now: 0 });
    }).not.toThrow();
    expect(gate).toMatchObject({ ok: false, code: 'BAD_THINK_INPUT' });
    // The token is taken FIRST, deliberately: a refusal is still metered.
    expect(rl.tryTake(1)).toBe(false);
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

  it('counts object keys in UTF-8 bytes, not UTF-16 units', () => {
    // 'é' is one UTF-16 unit but two UTF-8 bytes.
    expect(estimateBytes({ é: 1 }, 1000, 5).bytes).toBe(estimateBytes({ e: 1 }, 1000, 5).bytes + 1);
    expect(estimateBytes({ '🌍': 1 }, 1000, 5).bytes).toBe(estimateBytes({ ab: 1 }, 1000, 5).bytes + 2);
  });

  it('abandons a very wide object as soon as the budget is gone', () => {
    const wide: Record<string, number> = {};
    for (let i = 0; i < 200_000; i++) wide[`k${i}`] = 1;
    const r = estimateBytes(wide, 1024, 24);
    expect(r.over).toBe(true);
    // Charging for every key up front would have jumped straight past a million.
    expect(r.bytes).toBeLessThan(4096);
    expect(validateThinkInput(thinkInput({ wide })).ok).toBe(false);
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
    const rl = new RateLimiter(3, 60_000);
    expect(guardLlmComplete(rl, 'not a prompt', thinkInput(), { now: 0 })).toMatchObject({ code: 'BAD_THINK_PROMPT' });
    expect(guardLlmComplete(rl, thinkPrompt(), 'not an object', { now: 1 })).toMatchObject({ code: 'BAD_THINK_INPUT' });
    expect(guardLlmComplete(rl, thinkPrompt(), { snapshot: null }, { now: 2 })).toMatchObject({ code: 'BAD_THINK_INPUT' });
    expect(guardLlmComplete(rl, thinkPrompt(), thinkInput(), { now: 3 })).toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('passes a valid prompt and input through the gate', () => {
    const gate = guardLlmComplete(new RateLimiter(5, 60_000), thinkPrompt(), thinkInput(), { isPlace, now: 0 });
    expect(gate).toEqual({ ok: true, prompt: thinkPrompt() });
  });

  /** The world's question is asked at the gate, not only in the validator. */
  it('refuses a place the world does not recognise, as BAD_THINK_INPUT', () => {
    const rl = new RateLimiter(5, 60_000);
    expect(guardLlmComplete(rl, thinkPrompt(), withPlace({ x: '120', y: 80 }), { isPlace, now: 0 })).toMatchObject({
      ok: false,
      code: 'BAD_THINK_INPUT',
    });
    // The same payload with no world to ask passes the structural half — which
    // is why a caller that cannot resolve a world must refuse the call itself.
    expect(guardLlmComplete(rl, thinkPrompt(), withPlace({ x: '120', y: 80 }), { now: 1 })).toMatchObject({ ok: true });
  });

  it('checks the prompt before the input — the prompt is what is billed', () => {
    const gate = guardLlmComplete(new RateLimiter(5, 60_000), 'not a prompt', 'not an input', { now: 0 });
    expect(gate).toMatchObject({ code: 'BAD_THINK_PROMPT' });
  });

  /**
   * The engine composes the prompt once now; `retryError` is gone and its
   * feedback rides inside `prompt.user`. A caller still on the old shape puts a
   * ThinkInput in the prompt slot, and that must die at the gate rather than be
   * forwarded to a paid endpoint as if it were messages.
   */
  it('rejects the legacy (input, retryError) call shape', () => {
    const rl = new RateLimiter(5, 60_000);
    expect(guardLlmComplete(rl, thinkInput(), 'previous reply was not JSON', { now: 0 })).toMatchObject({ code: 'BAD_THINK_PROMPT' });
    expect(guardLlmComplete(rl, thinkInput(), undefined, { now: 1 })).toMatchObject({ code: 'BAD_THINK_PROMPT' });
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
