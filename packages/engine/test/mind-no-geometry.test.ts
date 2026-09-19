import { at, foragerEdges } from '../src/index.js';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { foragerAdapter } from '../src/worlds/forager/adapter.js';
import { compilerOptionsFor, functionNamesIn, leakKey, placeLeaksIn } from './placeLeaks.js';

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
const TSCONFIG = fileURLToPath(new URL('../tsconfig.json', import.meta.url));

/** The directories that are the mind (docs/rework/ARCHITECTURE.md §2). */
const MIND_DIRS = ['agent', 'memory', 'learning', 'knowledge', 'relationships', 'narrative', 'consciousness'];

/** The fields THIS world writes a place with — `x`, `y`. */
const COORDS = new Set(foragerEdges.codec.fields.map((field) => field.id));
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

/**
 * ─── THE SAME GUARD, ASKED OF THE TYPE CHECKER ──────────────────────────────
 *
 * Everything above matches NAMES, and the W1-B4 verifier's second fail is the
 * hole that leaves: `Object.values(a)` twice and a `Math.sqrt` is a full
 * Euclidean distance in which not one token is a coordinate or a compass word.
 * So `placeLeaksIn` asks the compiler instead — every expression whose TYPE is
 * `PlaceRef` flowing into anything that could open it. A name can be avoided; a
 * type cannot.
 *
 * ONE REVIEWED SEAM, ALLOW-LISTED BY FILE AND FUNCTION. Writing a place down is
 * legitimate and has to happen somewhere; what is not legitimate is a blanket
 * exemption for a file. The four entries below are the whole of it, each names
 * the function it excuses, and a fifth finding anywhere — including a new one in
 * the same file — fails.
 */

const POLICED_SEAMS = ['contract/wire.ts', 'record/serialize.ts'];

const ALLOW_LIST: { key: string; why: string }[] = [
  {
    key: 'contract/wire.ts:writeIntent:mint',
    why: "narrows an Intent's own `place` field before handing it to the codec — the codec's whole job",
  },
  {
    key: 'contract/wire.ts:inlinePlace:mint',
    why: 'the same narrowing for a record that carries one, on its way to `encode`',
  },
  {
    key: 'record/serialize.ts:withPlacesWritten:mint',
    why: "a story's site and the places a tragedy shuns are places THEMSELVES, and this narrows each before the world writes it",
  },
  {
    key: 'record/serialize.ts:asPlace:mint',
    why: 'inside `withPlacesLifted`: the stored fields of a site, narrowed on their way back through `decode`',
  },
];

/**
 * NO MIND FILE MAY HOLD THE CODEC, AND NONE DOES (W1-B4 round 4).
 *
 * There used to be one entry here: `consciousness/schema.ts:vocabularyOf`, the
 * MODEL's edge, which read a model's JSON and had to build a place out of the
 * fields this world writes one as. It kept a bound `decode` rather than the
 * whole codec, which sounded narrow and was not — a mind that can MINT a place
 * of coordinates it chose recovers any place it is given from three `distance`
 * calls, which is how round 2 read `748.25,-311.5` off a handle.
 *
 * So the lifting moved to the edge (`contract/wire.ts`'s `liftPlan`, called by
 * `SimRuntime.applyPlan`), the parser yields the fields as the model wrote
 * them, and the list is EMPTY. It is kept as an empty list rather than deleted
 * because the next person to need a codec in a mind directory should have to
 * add a line here and explain it.
 */
const CODEC_SEAMS: { key: string; why: string }[] = [];

describe('nothing in the mind opens a place (W1-B4 verifier, the second fail)', () => {
  const options = compilerOptionsFor(TSCONFIG);
  const mindSources = mindFiles().map((file) => path.join(SRC, file));
  const seamSources = POLICED_SEAMS.map((file) => path.join(SRC, file));
  const controls = ['place-leaks.ts', 'place-legal.ts', 'place-refused.ts', 'place-codec.ts'].map((f) =>
    path.join(SRC, '..', 'test', 'fixtures', f),
  );
  const program = ts.createProgram([...mindSources, ...seamSources, ...controls], options);

  it('finds nothing at all in the seven directories that are the mind', () => {
    const found = placeLeaksIn(program, mindSources).map(leakKey);
    expect(found.filter((key) => !CODEC_SEAMS.some((entry) => entry.key === key))).toEqual([]);
    for (const entry of CODEC_SEAMS) expect(found, entry.why).toContain(entry.key);
  }, 120_000);

  /**
   * THE ALLOW-LIST CANNOT BE WIDENED BY REUSING A NAME (round 2's last finding).
   * Its key is `file:fn:route`, and a function name is not unique in a file — a
   * SECOND local arrow called `asPlace`, inside a different function of
   * `record/serialize.ts`, casting an arbitrary stored row to `PlaceRef`, left
   * the guard green. So every excused name is asserted to occur exactly once in
   * the file that excuses it.
   */
  it('every excused function name occurs exactly once in its file', () => {
    const counted = new Map<string, Map<string, number>>();
    for (const entry of [...ALLOW_LIST, ...CODEC_SEAMS]) {
      const [file, fn] = entry.key.split(':');
      const names =
        counted.get(file!) ?? functionNamesIn(program, path.join(SRC, file!));
      counted.set(file!, names);
      expect(names.get(fn!), `${file}: ${fn} must be the only function of that name`).toBe(1);
    }
  }, 120_000);

  /**
   * `contract/wire.ts` and `record/serialize.ts` are not the mind, but they are
   * where a place is legitimately written down — so they are policed too, and
   * everything they do is either on the list or a failure.
   */
  it('finds only the reviewed serialisation seam, by name, in the files that write a place down', () => {
    const found = placeLeaksIn(program, seamSources, 'seam').map(leakKey);
    expect(found.filter((key) => !ALLOW_LIST.some((entry) => entry.key === key))).toEqual([]);
    // …and the list is not stale: every entry on it is something that is really
    // there, so a fix that removes a seam removes its excuse with it.
    for (const entry of ALLOW_LIST) expect(found, entry.why).toContain(entry.key);
  }, 120_000);

  /**
   * NEGATIVE CONTROLS — one per route. `place-leaks.ts` compiles CLEANLY, which
   * is the whole point: the type system is no defence against any of these, so
   * the guard is. Plant one of these in a mind directory and the test above
   * turns red.
   */
  it('the routes that compile are all caught, and the fixture really does compile', () => {
    const leaks = path.join(SRC, '..', 'test', 'fixtures', 'place-leaks.ts');
    expect(diagnosticsFor(program, leaks)).toEqual([]);
    expect(placeLeaksIn(program, [leaks]).map((leak) => `${leak.fn}:${leak.route}`).sort()).toEqual(
      [
        'castToAny:cast away',
        'castToUnknown:cast away',
        'compareByIdentity:comparison',
        'forInLoop:for…in',
        'inOperator:in',
        'jsonStringify:reflection',
        'mintFromAPair:mint',
        'objectAssign:reflection',
        'orderThem:arithmetic',
        'objectEntries:reflection',
        'objectKeys:reflection',
        'objectValues:reflection',
        'ownPropertyDescriptors:reflection',
        'ownPropertyNames:reflection',
        'prototypeOf:reflection',
        'reflectOwnKeys:reflection',
        'restDestructure:destructuring',
        'spreadIntoAnObject:spread',
        'stringify:reflection',
        'structuredCloneIt:reflection',
        'templateInterpolation:template',
      ].sort(),
    );
  }, 120_000);

  /**
   * THE COMPILE PROOF. Every function in `place-refused.ts` carries a
   * `@ts-expect-error`, so the file compiles clean IF AND ONLY IF every one of
   * those lines really is a type error. Weaken the brand — make it optional
   * again, give `PlaceRef` a member, add an index signature — and an expectation
   * goes unused, which is itself an error, and this goes red naming the line.
   */
  it('the routes the compiler refuses stay refused — including minting one from nothing', () => {
    const refused = path.join(SRC, '..', 'test', 'fixtures', 'place-refused.ts');
    expect(diagnosticsFor(program, refused)).toEqual([]);
    // …and the guard sees them too, so neither defence is load-bearing alone.
    expect(placeLeaksIn(program, [refused]).map((leak) => `${leak.fn}:${leak.route}`).sort()).toEqual(
      [
        'constKeyAccess:element access',
        'elementAccess:element access',
        'memberAccess:member access',
        'namedDestructure:destructuring',
        'subtractThem:arithmetic',
      ].sort(),
    );
  }, 120_000);

  /** POSITIVE CONTROLS: the legal uses stay legal, or the guard is unusable. */
  it('lets a mind ask the world, store a place, and check whether there is one', () => {
    const legal = path.join(SRC, '..', 'test', 'fixtures', 'place-legal.ts');
    expect(diagnosticsFor(program, legal)).toEqual([]);
    expect(placeLeaksIn(program, [legal]).map(leakKey)).toEqual([]);
  }, 120_000);

  /**
   * THE THREE ROUTES THAT ARE NOT ABOUT OPENING A HANDLE (round 3). Holding the
   * codec, reading source at runtime, and handling a `label` result are all
   * things the type system is perfectly happy with — routes 17, 19, 20 and 21 of
   * the verifier's 22. The fixture compiles cleanly and every function in it is
   * caught.
   */
  it('catches holding the codec and eval — the two routes a type is happy with', () => {
    const codec = path.join(SRC, '..', 'test', 'fixtures', 'place-codec.ts');
    expect(diagnosticsFor(program, codec)).toEqual([]);
    expect([...new Set(placeLeaksIn(program, [codec]).map((leak) => `${leak.fn}:${leak.route}`))].sort()).toEqual(
      [
        'evaluatesIt:eval',
        'holdsTheCodec:codec',
        'mintsOne:codec',
        'readsBySource:eval',
        'writesOneDown:codec',
      ].sort(),
    );
    // …and the SEAM scope deliberately does not ask those questions: the files
    // that ARE the codec's callers would otherwise need a dozen excuses saying
    // "the codec file uses the codec".
    expect(placeLeaksIn(program, [codec], 'seam').map((leak) => leak.route)).toEqual([]);
  }, 120_000);
});

/**
 * ─── THE RESIDUAL, PINNED AS STILL-YIELDING (W1-B4 round 4, ruling 2) ────────
 *
 * `label` is the one thing a mind holds that still renders a coordinate. Round
 * 3 tried to narrow it with a static rule — a `label` result in a mind file had
 * to flow into a template or a `+` — and the verifier walked past it five ways
 * without a cast, each returning `[748, -311]` from one `.split(',')`. The rule
 * is gone (see `placeLeaks.ts`): a guard that does not hold is worse than a
 * stated residual, because it buys a claim nobody is checking.
 *
 * What is here instead is the residual ITSELF, asserted to still be true. It is
 * a strange-looking test — it proves the hole is open — and that is the job: B5
 * gives places WORDS, and on the day it lands this goes red, somebody reads
 * this comment, and closing the hole is a visible change with an owner rather
 * than a silent improvement nobody can point at.
 */
describe('the label residual is open, and stays pinned until B5 closes it (W1-B4 round 4)', () => {
  it('still renders a place as text a mind could parse back into a coordinate pair', () => {
    const place = at(748.25, -311.5);
    const text = foragerAdapter.space.label(place);
    expect(text).toBe('748,-311');
    // …and this is the parse, spelled out, because the point is that it works.
    expect(text.split(',').map(Number)).toEqual([748, -311]);
  });

  it('is the only textual route: `label` is called from exactly three files, and one is the gate', () => {
    const callers: string[] = [];
    for (const dir of [...MIND_DIRS, 'contract', 'record', 'runner', 'training', 'analysis', 'eval']) {
      for (const entry of readdirSync(path.join(SRC, dir), { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
        const source = readFileSync(path.join(SRC, dir, entry.name), 'utf8');
        // The call, not the declaration or a mention in prose.
        if (/\.label\(/.test(source)) callers.push(`${dir}/${entry.name}`);
      }
    }
    // `contract/edges.ts` is the ownership gate forwarding the call, not a
    // reader of the text; the other two are the prompt (which says it to a
    // model) and the trace (which says it to a judge). Nothing else renders a
    // place, so B5 has exactly two sentences to rewrite.
    expect(callers.sort()).toEqual(['consciousness/prompt.ts', 'contract/edges.ts', 'eval/trace.ts']);
  });
});

function diagnosticsFor(program: ts.Program, fileName: string): string[] {
  const source = program.getSourceFile(fileName);
  expect(source, `fixture not found by the compiler: ${fileName}`).toBeDefined();
  return program
    .getSemanticDiagnostics(source)
    .concat(program.getSyntacticDiagnostics(source))
    .map((d) => {
      const line = d.start === undefined ? 0 : source!.getLineAndCharacterOfPosition(d.start).line + 1;
      return `${path.basename(fileName)}:${line} TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`;
    });
}
