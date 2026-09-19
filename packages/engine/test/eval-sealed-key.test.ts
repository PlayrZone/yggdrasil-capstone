import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { blindTraces, foragerAdapter, verifyCommitment } from '../src/index.js';
// S4: not an index export any more — see the describe block at the foot of this file.
import { swapArmLabels } from '../src/eval/aggregate.js';
import type { RawBeingTrace } from '../src/index.js';

/**
 * R4 — THE SEALED KEY WAS ENUMERABLE, AND FIVE ONE-LINERS OPENED IT.
 *
 * Round 3's `SealedTraceKey` held `entries`, `secret`, `unsealCount`,
 * `publicSeed` and `commitment` as ordinary enumerable own properties. The
 * reviewer measured `Object.getOwnPropertyNames(key)` returning all five, and
 * the 128-bit secret AND the complete `traceId → arm` map coming out of
 * `Object.entries(key)`, `Object.assign({}, key)`, `{...key}`,
 * `structuredClone(key)` and `util.inspect(key)` — the last being exactly what
 * `console.log(result)` prints. Only `JSON.stringify` was guarded, by `toJSON`,
 * and README:190's *"the secret is in **no** result, manifest, spend log or
 * tool output"* was false of the result object every agent holds.
 *
 * This file is the reviewer's route table, plus the routes the reviewer did not
 * name, plus the falsification control: the same table run against a plain
 * object that DOES hold the state must leak through every one of them, so a
 * green row here is a fact about the key rather than a fact about the test.
 */

const SECRET = '0123456789abcdef0123456789abcdef';

function sealedKey(): ReturnType<typeof blindTraces>['key'] {
  const moment = {
    t: 0,
    day: 1,
    night: false,
    season: 'spring',
    felt: [{ drive: 'hunger', pressure: 40 }],
    perceived: [{ kind: 'berryBush', count: 1 }],
    others: 0,
    carried: [],
    thought: 'a thought',
    did: ['Wait()'],
    said: [],
    happened: null,
  };
  const lives: RawBeingTrace[] = [];
  for (const arm of ['A', 'B'] as const) {
    for (let i = 0; i < 4; i++) lives.push({ runId: `r-${arm}`, arm, beingId: i + 1, moments: [{ ...moment }] });
  }
  return blindTraces(lives, foragerAdapter, { seed: 'public-label', secret: SECRET, minMoments: 1 }).key;
}

/** Everything a disclosure route can hand back, flattened to one searchable string. */
function textOf(value: unknown): string {
  const seen = new WeakSet<object>();
  const parts: string[] = [];
  const walk = (node: unknown, depth: number): void => {
    if (depth > 8 || node === null || node === undefined) return;
    if (typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') {
      parts.push(String(node));
      return;
    }
    if (typeof node !== 'object') return;
    if (seen.has(node)) return;
    seen.add(node);
    for (const key of Reflect.ownKeys(node)) {
      parts.push(String(key));
      try {
        walk((node as Record<PropertyKey, unknown>)[key], depth + 1);
      } catch {
        /* a getter that throws reveals nothing, which is the point */
      }
    }
  };
  walk(value, 0);
  return parts.join('');
}

describe('W1-E · R4 · the sealed key is sealed against every route, not just JSON.stringify', () => {
  it('leaks neither the secret nor the arm map through any of the reviewer\'s routes', () => {
    const key = sealedKey();
    const arms = key.unseal();
    // Something to look for: the secret, and an actual handle→arm pairing.
    expect(arms.length).toBe(8);
    const handles = arms.map((entry) => entry.traceId);

    const routes: { name: string; take: () => unknown }[] = [
      { name: 'Object.entries', take: () => Object.entries(key) },
      { name: 'Object.values', take: () => Object.values(key) },
      { name: 'Object.assign', take: () => Object.assign({}, key) },
      { name: 'spread', take: () => ({ ...key }) },
      { name: 'structuredClone', take: () => structuredClone(key) },
      { name: 'util.inspect', take: () => inspect(key, { depth: 8, showHidden: true, getters: true }) },
      { name: 'console.log shape', take: () => inspect({ usable: true, key }, { depth: 8 }) },
      { name: 'JSON.stringify', take: () => JSON.stringify(key) },
      { name: 'JSON.stringify(result)', take: () => JSON.stringify({ usable: true, traces: [], key }) },
      { name: 'Object.getOwnPropertyNames', take: () => Object.getOwnPropertyNames(key) },
      { name: 'Object.getOwnPropertySymbols', take: () => Object.getOwnPropertySymbols(key).map(String) },
      { name: 'Reflect.ownKeys', take: () => Reflect.ownKeys(key).map(String) },
      { name: 'Object.getOwnPropertyDescriptors', take: () => Object.getOwnPropertyDescriptors(key) },
      {
        name: 'prototype walk',
        take: () => {
          const out: unknown[] = [];
          for (let node: object | null = key; node !== null; node = Object.getPrototypeOf(node) as object | null) {
            out.push(Object.getOwnPropertyNames(node));
            out.push(Object.getOwnPropertyDescriptors(node));
          }
          return out;
        },
      },
      { name: 'String()', take: () => String(key) },
      { name: 'template literal', take: () => `${key}` },
      { name: 'toJSON()', take: () => key.toJSON() },
      { name: 'JSON.parse(JSON.stringify)', take: () => JSON.parse(JSON.stringify(key)) as unknown },
    ];

    const rows: string[] = [];
    for (const route of routes) {
      const text = textOf(route.take());
      const leakedSecret = text.includes(SECRET);
      // An arm map leaks only if a handle AND its arm can be read together.
      const leakedHandles = handles.filter((handle) => text.includes(handle)).length;
      rows.push(`  ${route.name.padEnd(32)} secret ${leakedSecret ? 'LEAKED' : 'sealed'} · handles ${leakedHandles}/8`);
      expect(leakedSecret, `${route.name} leaked the secret`).toBe(false);
      expect(leakedHandles, `${route.name} leaked handles`).toBe(0);
    }
    // eslint-disable-next-line no-console
    console.log(['', 'R4 · sealed-key route table:', ...rows].join('\n'));

    // The instance carries no own data property at all: the two publishable
    // values are prototype getters, so a clone of it is empty rather than
    // partially populated.
    expect(Object.getOwnPropertyNames(key)).toEqual([]);
    expect(Object.getOwnPropertySymbols(key)).toEqual([]);
    expect(Object.entries(key)).toEqual([]);
  });

  it('is a fact about the key, not about the test — the same table leaks on a plain holder', () => {
    const key = sealedKey();
    const arms = key.unseal();
    // The round-3 shape: the same state, on ordinary own properties.
    const roundThree = {
      entries: arms.map((entry) => ({ ...entry })),
      secret: SECRET,
      unsealCount: 1,
      publicSeed: key.publicSeed,
      commitment: key.commitment,
    };
    for (const take of [
      (): unknown => Object.entries(roundThree),
      (): unknown => ({ ...roundThree }),
      (): unknown => structuredClone(roundThree),
      (): unknown => inspect(roundThree, { depth: 8 }),
    ]) {
      const text = textOf(take());
      expect(text.includes(SECRET) && arms.some((entry) => text.includes(entry.traceId))).toBe(true);
    }
    // `getOwnPropertyNames` hands over the NAMES, which is how a reader knows
    // where to look. Round 3's key named both; this one names nothing.
    expect(Object.getOwnPropertyNames(roundThree)).toContain('secret');
    expect(Object.getOwnPropertyNames(roundThree)).toContain('entries');
    expect(Object.getOwnPropertyNames(key)).toEqual([]);
  });

  it('keeps unseal() the only door, and keeps it one-way-logged', () => {
    const key = sealedKey();
    expect(key.unsealed).toBe(false);
    // Reading the publishable facts does not count as looking.
    void key.publicSeed;
    void key.commitment;
    void key.size;
    void key.handles();
    void key.handlesOf('A');
    void key.arms();
    void key.toJSON();
    void JSON.stringify(key);
    void inspect(key, { depth: 8, showHidden: true, getters: true });
    void String(key);
    expect(key.unsealed).toBe(false);
    expect(() => key.disclose()).toThrow(/only after unseal/);

    const entries = key.unseal();
    expect(key.unsealed).toBe(true);
    expect(entries.length).toBe(8);
    const disclosed = key.disclose();
    expect(disclosed.secret).toBe(SECRET);
    expect(verifyCommitment(disclosed.secret, disclosed.commitment)).toBe(true);
    expect(verifyCommitment('not the secret', disclosed.commitment)).toBe(false);

    // The entries handed out are copies: writing to them cannot relabel the run.
    const first = entries[0]!;
    (first as { arm: string }).arm = 'B+';
    expect(key.unseal()[0]!.arm).not.toBe('B+');
  });

  it('carries the label swap without ever exposing what it swapped', () => {
    const key = sealedKey();
    const swapped = swapArmLabels(key);
    expect(Object.getOwnPropertyNames(swapped)).toEqual([]);
    expect(JSON.stringify(swapped)).not.toContain(SECRET);
    expect(swapped.unsealed).toBe(false);
    const before = new Map(key.unseal().map((e) => [e.traceId, e.arm]));
    for (const entry of swapped.unseal()) expect(entry.arm).not.toBe(before.get(entry.traceId));
  });
});

/**
 * S4 — ONE PUBLIC METHOD REOPENED THE SEALED KEY, AND THE FACADE LIED AFTERWARDS.
 *
 * The reviewer's round-4 attacks, verbatim:
 *
 *   `key.relabelled(a => a).unseal()` returned **12 of 12 arms correct**,
 *   `.disclose().secret` **equalled the run secret**, and the ORIGINAL key still
 *   reported `unsealed === false`. `swapArmLabels(key)` did it in one import and
 *   was **exported from the package index**. After two `unseal()`s
 *   `JSON.stringify(key)` still printed **`"sealed":true`** with no unseal count,
 *   and nothing marked a key as spent for judging: an unseal-then-rejudge was
 *   indistinguishable from a blind pass.
 *
 * Every one of those is a test below.
 */
describe('W1-E · S4 · the seal is one seal, and it tells the truth', () => {
  it('has no public route that mints a fresh seal', () => {
    const key = sealedKey();
    // `relabelled` is gone from the public surface entirely.
    expect((key as unknown as Record<string, unknown>)['relabelled']).toBeUndefined();
    const surface = new Set<string>();
    for (let o: object | null = key; o && o !== Object.prototype; o = Object.getPrototypeOf(o) as object | null) {
      for (const name of Object.getOwnPropertyNames(o)) surface.add(name);
    }
    expect([...surface]).not.toContain('relabelled');
  });

  it('opens the parent when a derived key is opened — one seal, shared', () => {
    const key = sealedKey();
    const derived = swapArmLabels(key);
    expect(key.unsealed).toBe(false);
    expect(derived.unsealed).toBe(false);
    derived.unseal();
    // THE ROUND-4 DEFECT: this was `false` while twelve arms were in hand.
    expect(key.unsealed).toBe(true);
    expect(key.unsealCount).toBe(1);
    expect(derived.unsealCount).toBe(1);
  });

  it('refuses disclose() on a derived key, whatever it has been through', () => {
    const key = sealedKey();
    const derived = swapArmLabels(key);
    derived.unseal();
    expect(() => derived.disclose()).toThrow(/derived key never discloses/);
    // The original still can, because the original is the auditor's handle.
    expect(key.disclose().secret).toBe(SECRET);
  });

  it('prints an honest facade after two unseals, on every route', () => {
    const key = sealedKey();
    key.unseal();
    key.unseal();
    const printed = JSON.stringify(key);
    expect(printed).toContain('"sealed":false');
    expect(printed).toContain('"unsealCount":2');
    expect(inspect(key)).toMatch(/sealed: false/);
    expect(String(key)).toMatch(/UNSEALED ×2/);
    expect(key.unsealLog).toHaveLength(1);
    expect(key.unsealLog[0]).toMatch(/unsealed for the first time/);
    // …and still no secret and no arm on any of them.
    for (const route of [printed, inspect(key), String(key)]) {
      expect(route).not.toContain(SECRET);
      expect(route).not.toMatch(/"arm"/);
    }
  });

  it('logs the unseal ONCE however many times it happens', () => {
    const key = sealedKey();
    for (let i = 0; i < 5; i++) key.unseal();
    expect(key.unsealCount).toBe(5);
    expect(key.unsealLog).toHaveLength(1);
  });

  it('says which cluster a handle came from, and never which arm', () => {
    const key = sealedKey();
    const rows = key.clusters();
    expect(rows.length).toBe(key.size);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(['seed', 'traceId']);
      expect(JSON.stringify(row)).not.toMatch(/"arm"/);
    }
  });
});
