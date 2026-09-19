import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { foragerAdapter } from '../src/worlds/forager/adapter.js';

/**
 * THE MIND STOPPED KNOWING GEOMETRY, ENFORCED (W1-B4).
 *
 * `world-tables-out.test.ts` refuses the forager world's NAMES in the mind.
 * This refuses its SHAPE: a mind that may live in a street graph, a voxel
 * sandbox or a plane may not reach for a coordinate, may not subtract one from
 * another, and may not decide for itself that the answer is "north". It holds
 * opaque `PlaceRef`s and asks `SpaceOps`.
 *
 * DATA-DRIVEN, like the guard beside it: the coordinate names are the fields
 * the forager world says it writes a place with (`SpaceOps.fields`) and the
 * direction words are the ones it declares (`SpaceOps.directions`). Declare a
 * third coordinate in that world and this starts policing it for free.
 *
 * The type system is the first line — `PlaceRef` has no readable member, so
 * `place.x` does not compile, and `mind-type-graph.test.ts` builds the whole
 * mind to prove it. This is the second: it catches geometry done on something
 * that is NOT a `PlaceRef` (a raw pair a mind built for itself, a compass table
 * typed out again), which the compiler would be perfectly happy with.
 *
 * WHAT IT DOES NOT LOOK AT. Comments — an explanation may name what it replaced.
 */

const SRC = fileURLToPath(new URL('../src/', import.meta.url));

/** The directories that are the mind (docs/rework/ARCHITECTURE.md §2). */
const MIND_DIRS = ['agent', 'memory', 'learning', 'knowledge', 'relationships', 'narrative', 'consciousness'];

/** The fields THIS world writes a place with — `x`, `y`. */
const COORDS = new Set(foragerAdapter.space.fields.map((field) => field.id));
/** …and the words it decides a direction is. */
const DIRECTIONS = new Set(foragerAdapter.space.directions);

/** Arithmetic that only means one thing: turning two points into one answer. */
const GEOMETRY = new Set(['hypot', 'atan2']);

/**
 * Every way a file REACHES a coordinate or a direction word. Deliberately
 * broader than "reads `.x`": a place literal a mind assembled for itself, a
 * pair it destructured out of something, and a compass table written back in
 * are all the same leak wearing different clothes.
 */
export function geometryIn(source: string): string[] {
  const file = ts.createSourceFile('probe.ts', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const found: string[] = [];
  const coord = (name: string, how: string): void => {
    if (COORDS.has(name)) found.push(`${name} (${how})`);
  };
  const visit = (node: ts.Node): void => {
    // `place.x`, and `Math.hypot(...)`.
    if (ts.isPropertyAccessExpression(node)) {
      coord(node.name.text, 'member access');
      if (GEOMETRY.has(node.name.text)) found.push(`${node.name.text} (geometry)`);
    }
    // `place['x']`.
    if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
      coord(node.argumentExpression.text, 'computed access');
    }
    // `{ x: 1, y: 2 }` and `interface P { x: number }` — a place a mind built.
    if (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node) || ts.isPropertySignature(node)) {
      if (ts.isIdentifier(node.name) || ts.isStringLiteralLike(node.name)) coord(node.name.text, 'own property');
    }
    // `const { x, y } = somewhere`.
    if (ts.isBindingElement(node)) {
      const named = node.propertyName ?? node.name;
      if (ts.isIdentifier(named)) coord(named.text, 'destructured');
    }
    // A compass word, however it is spelled.
    if (ts.isStringLiteralLike(node) && DIRECTIONS.has(node.text)) {
      found.push(`${node.text} (direction word)`);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(file, visit);
  return [...new Set(found)].sort();
}

function mindFiles(): string[] {
  const out: string[] = [];
  for (const dir of MIND_DIRS) {
    for (const entry of readdirSync(path.join(SRC, dir), { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.ts')) out.push(`${dir}/${entry.name}`);
    }
  }
  return out.sort();
}

describe('no part of the mind does geometry (W1-B4)', () => {
  it('has a vocabulary to police, taken from the world itself', () => {
    expect([...COORDS]).toEqual(['x', 'y']);
    expect(DIRECTIONS.size).toBe(9);
    expect(DIRECTIONS.has('north')).toBe(true);
  });

  for (const file of mindFiles()) {
    it(`${file} holds no coordinate, no distance and no compass`, () => {
      expect(geometryIn(readFileSync(path.join(SRC, file), 'utf8'))).toEqual([]);
    });
  }

  /**
   * `record/` and `training/` are not mind directories (they import this
   * world's own types by design), but they are the two that WRITE places down.
   * What is pinned about them is narrower and stronger: whatever field names
   * they use come from `SpaceOps`, so neither contains a coordinate literal of
   * its own.
   */
  it('the serializer names no field — it asks the world which ones there are', () => {
    expect(geometryIn(readFileSync(path.join(SRC, 'record/serialize.ts'), 'utf8'))).toEqual([]);
    expect(geometryIn(readFileSync(path.join(SRC, 'contract/wire.ts'), 'utf8'))).toEqual([]);
    expect(geometryIn(readFileSync(path.join(SRC, 'contract/space.ts'), 'utf8'))).toEqual([]);
  });

  /**
   * THE ONE SHAPE IN THE CONTRACT THAT STILL NAMES A PLANE, pinned rather than
   * merely unscanned: `SimEvent` is what a BODY emits, it is read by the body,
   * the runner, the instrument and the lab's renderer, and no mind reads its
   * coordinates — `memoryFromEvent` asks `space.placeOf(event)` and is handed a
   * handle. Making the event itself world-neutral is B6's (the step that gives
   * each world its own instrument and moves the directories); until then a NEW
   * coordinate anywhere in the contract fails here.
   */
  it('the contract names a plane in exactly one place, and says which step takes it', () => {
    expect(geometryIn(readFileSync(path.join(SRC, 'contract/types.ts'), 'utf8'))).toEqual([
      'x (own property)',
      'y (own property)',
    ]);
  });
});

/**
 * NEGATIVE CONTROLS. A guard with a hole reads exactly like one that works, so
 * every way of reaching a coordinate is proven to be caught — and the things
 * that are legitimately NOT geometry are proven to be let through.
 */
describe('the scan sees every way of reaching for a coordinate', () => {
  const CAUGHT: [string, string][] = [
    ['a member access', `export const f = (p: { x: number }) => p.x;`],
    ['a computed access', `export const f = (p: Record<string, number>) => p['y'];`],
    ['a place literal', `export const here = { x: 1, y: 2 };`],
    ['a shorthand place literal', `export const f = (x: number, y: number) => ({ x, y });`],
    ['a place in a type', `export interface Place { x: number; y: number }`],
    ['a destructured pair', `export const f = (p: { x: number; y: number }) => { const { x } = p; return x; };`],
    ['a renamed destructure', `export const f = (p: { x: number }) => { const { x: here } = p; return here; };`],
    ['a distance', `export const d = (a: number, b: number) => Math.hypot(a, b);`],
    ['a bearing', `export const d = (a: number, b: number) => Math.atan2(a, b);`],
    ['a compass word', `export const NS = 'north';`],
    ['a compass table', `export const WORDS = { up: 'north', down: 'south' };`],
  ];

  for (const [label, source] of CAUGHT) {
    it(`catches ${label}`, () => {
      expect(geometryIn(source), label).not.toEqual([]);
    });
  }

  const ALLOWED: [string, string][] = [
    ['a comment about what used to be here', `// it used to read place.x and Math.hypot(dx, dy).\nexport const n = 1;`],
    ['arithmetic that is not geometry', `export const mean = (a: number, b: number) => (a + b) / 2;`],
    ['asking the world instead', `export const near = (w: { space: { within(a: unknown, b: unknown, r: number): boolean } }, a: unknown, b: unknown) => w.space.within(a, b, 8);`],
    ['a single-letter parameter that is not a coordinate', `export const twice = (n: number) => n * 2;`],
  ];

  for (const [label, source] of ALLOWED) {
    it(`lets ${label} through`, () => {
      expect(geometryIn(source), label).toEqual([]);
    });
  }
});
