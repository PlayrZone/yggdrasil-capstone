import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * ONE BRAIN, ANY WORLD — PROVED BY THE COMPILER (W1-B2 item 7; W1-B4 round 4).
 *
 * `test/world-tables-out.test.ts` reads the mind's source and refuses the
 * forager world's NAMES. `test/mind-no-geometry.test.ts` reads its EXPRESSIONS
 * and refuses the ones that open a place. This file asks the only question
 * neither of those can answer: what can the mind REACH?
 *
 * There are two halves, and the second is round 4's.
 *
 * ─── HALF ONE: the mind does not reach a WORLD (W1-B2) ──────────────────────
 *
 * The mind is compiled against a repository in which `src/worlds/` does not
 * exist: the compiler host below reports every path under it as missing. A mind
 * that still reached the forager world, as a value or as a type, fails to
 * resolve it (TS2307), and the fixture that deliberately does reach it proves
 * the stubbing is real. Grep cannot answer this — a type-only import is erased
 * from the emit, so nothing at runtime would ever notice — but the compiler can,
 * because it still has to resolve one.
 *
 * ─── HALF TWO: the mind does not reach the CODEC (W1-B4 round 4) ────────────
 *
 * Round 3 put the codec behind `codecFor(space)`, a module-level `WeakMap`
 * lookup exported from `contract/space.ts`, and guarded it with a type rule:
 * no expression in a mind directory may have type `SpaceCodec`. The verifier
 * widened the FUNCTION instead of the result —
 *
 *     const opener = codecFor as unknown as (s: SpaceOps) => { encode(p: PlaceRef): Record<string, unknown> };
 *
 * — and no expression in the chain had that type any more. Twenty-two routes
 * compiled with the project's own `tsc` and every guard green.
 *
 * A type rule cannot fix that, because a cast is exactly the thing that defeats
 * type rules. What a cast CANNOT do is conjure a value that is not in the
 * module graph. So the proof is structural:
 *
 *   A. the transitive import closure of the seven mind directories contains
 *      NEITHER `contract/edges.ts` NOR anything under `worlds/` — so there is
 *      no declaration of a codec, or of a plane's readers, anywhere a mind file
 *      can name;
 *   B. no dynamic `import()` or `require` appears in a mind directory, which is
 *      what would let a module escape that closure at runtime;
 *   C. walking the TYPE GRAPH of everything a mind is constructed with —
 *      `WorldAdapter`, `SpaceOps`, the reflex policy, the mind constructors'
 *      own parameters — reaches no type declared in either place;
 *   D. no file in `contract/` imports `contract/edges.ts` except `contract/wire.ts`,
 *      which IS the wire codec. This is the one that makes round 3's route 22
 *      impossible: a relay in `contract/` needed no cast at all, because what it
 *      exported was already narrower than `SpaceCodec`.
 *
 * Each of the four is planted against below, in memory, so the proof is known
 * to bite rather than merely to pass.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TSCONFIG = path.join(HERE, '..', 'tsconfig.json');
const SRC = path.join(HERE, '..', 'src');
const WORLDS = path.join(SRC, 'worlds');
const EDGES = path.join(SRC, 'contract', 'edges.ts');

const MIND_ONLY = path.join(HERE, 'fixtures', 'mind-without-world.ts');
const REACHES_WORLD = path.join(HERE, 'fixtures', 'mind-reaches-world.ts');

/** The directories that are the mind (docs/rework/ARCHITECTURE.md §2). */
const MIND_DIRS = ['agent', 'memory', 'learning', 'knowledge', 'relationships', 'narrative', 'consciousness'];

function compilerOptions(): ts.CompilerOptions {
  const read = ts.readConfigFile(TSCONFIG, ts.sys.readFile);
  expect(read.error, ts.flattenDiagnosticMessageText(read.error?.messageText, ' ')).toBeUndefined();
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, path.dirname(TSCONFIG));
  // Nothing is emitted, and the fixtures live under `test/`; `rootDir` would
  // otherwise report every one of them as outside the source tree (TS6059).
  return {
    ...parsed.options,
    rootDir: undefined,
    noEmit: true,
    declaration: false,
    declarationMap: false,
    sourceMap: false,
  };
}

const isInWorlds = (fileName: string): boolean =>
  path.resolve(fileName).toLowerCase().startsWith(WORLDS.toLowerCase() + path.sep);

/** The real host, with `src/worlds/**` removed from the filesystem it sees. */
function hostWithoutWorlds(options: ts.CompilerOptions): ts.CompilerHost {
  const host = ts.createCompilerHost(options, true);
  return {
    ...host,
    fileExists: (f) => (isInWorlds(f) ? false : host.fileExists(f)),
    readFile: (f) => (isInWorlds(f) ? undefined : host.readFile(f)),
    getSourceFile: (f, ...rest) => (isInWorlds(f) ? undefined : host.getSourceFile(f, ...rest)),
  };
}

/**
 * A HOST WITH FILES THAT ARE NOT ON DISK — how every plant below is made.
 *
 * A plant writes nothing: it hands the compiler an extra file, or a REPLACEMENT
 * for one that exists, and the proof is re-run against that. Nothing in `src/`
 * is touched, so nothing else reading the tree while this runs sees a file that
 * is not the committed one, and a plant that throws cannot leave one behind.
 */
function hostWithOverlay(options: ts.CompilerOptions, overlay: ReadonlyMap<string, string>): ts.CompilerHost {
  const host = ts.createCompilerHost(options, true);
  const at = (f: string): string | undefined => overlay.get(path.resolve(f).toLowerCase());
  return {
    ...host,
    fileExists: (f) => at(f) !== undefined || host.fileExists(f),
    readFile: (f) => at(f) ?? host.readFile(f),
    getSourceFile: (f, languageVersion, ...rest) => {
      const planted = at(f);
      if (planted === undefined) return host.getSourceFile(f, languageVersion, ...rest);
      return ts.createSourceFile(f, planted, languageVersion, true, ts.ScriptKind.TS);
    },
  };
}

function overlayOf(entries: readonly (readonly [string, string])[]): Map<string, string> {
  return new Map(entries.map(([file, text]) => [path.resolve(file).toLowerCase(), text]));
}

/** Every `.ts` file in the seven mind directories, plus any planted beside them. */
function mindFiles(extra: readonly string[] = []): string[] {
  const out: string[] = [];
  for (const dir of MIND_DIRS) {
    for (const entry of readdirSync(path.join(SRC, dir), { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.ts')) out.push(path.join(SRC, dir, entry.name));
    }
  }
  return [...out, ...extra].sort();
}

/** Every diagnostic in the whole program, so an unresolved import deep in the
 *  mind's own graph counts — not only one made by the entry file. */
function programDiagnostics(entry: string, host: ts.CompilerHost, options: ts.CompilerOptions): string[] {
  const program = ts.createProgram([entry], options, host);
  expect(program.getSourceFile(entry), `fixture not found by the compiler: ${entry}`).toBeDefined();
  return program.getSemanticDiagnostics().concat(program.getSyntacticDiagnostics()).map((d) => {
    const line = d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start).line + 1 : 0;
    return `${path.relative(HERE, d.file?.fileName ?? '?')}:${line} TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`;
  });
}

// ─── The structural proof ────────────────────────────────────────────────────

/** What a proof run reports. Empty everywhere is the only passing shape. */
interface ClosureReport {
  /** Files in the mind's transitive import closure that may not be there. */
  forbiddenInClosure: string[];
  /** `import(...)` / `require(...)` written inside a mind directory. */
  dynamicImports: string[];
  /** Paths through the type graph of what a mind is built with, to a forbidden type. */
  reachableTypes: string[];
  /** Files in `contract/` that import `contract/edges.ts` and may not. */
  relays: string[];
}

const rel = (f: string): string => path.relative(SRC, f).split(path.sep).join('/');

/** Is this file one the mind may not reach — the codec, or any world? */
function forbidden(fileName: string): boolean {
  const at = path.resolve(fileName);
  return at.toLowerCase() === EDGES.toLowerCase() || isInWorlds(at);
}

/**
 * THE ONE FILE IN `contract/` THAT MAY HOLD THE CODEC. It is the wire codec: it
 * is what the capability is FOR. Every other module in `contract/` — including
 * one nobody has written yet — is a relay if it imports this, and is refused.
 */
const CONTRACT_MAY_IMPORT_EDGES = new Set(['contract/wire.ts', 'contract/edges.ts']);

function proveClosure(options: ts.CompilerOptions, overlay: ReadonlyMap<string, string> = new Map()): ClosureReport {
  const extra = [...overlay.keys()].filter((f) => !ts.sys.fileExists(f));
  const roots = mindFiles(extra.filter((f) => MIND_DIRS.some((d) => f.includes(`${path.sep}${d}${path.sep}`))));
  const host = hostWithOverlay(options, overlay);
  const program = ts.createProgram(roots, options, host);
  const checker = program.getTypeChecker();

  const inSrc = program
    .getSourceFiles()
    .filter((f) => path.resolve(f.fileName).toLowerCase().startsWith(SRC.toLowerCase() + path.sep));

  const forbiddenInClosure = inSrc.filter((f) => forbidden(f.fileName)).map((f) => rel(f.fileName)).sort();

  // ── B: no runtime escape from that closure ────────────────────────────────
  const dynamicImports: string[] = [];
  for (const source of program.getSourceFiles()) {
    const at = path.resolve(source.fileName);
    if (!MIND_DIRS.some((d) => at.toLowerCase().startsWith(path.join(SRC, d).toLowerCase() + path.sep))) continue;
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const callee = node.expression;
        if (callee.kind === ts.SyntaxKind.ImportKeyword || callee.getText() === 'require') {
          dynamicImports.push(`${rel(source.fileName)}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
        }
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(source, visit);
  }

  // ── C: the type graph of what a mind is constructed with ──────────────────
  //
  // Round 3's rule asked about EXPRESSIONS, which a cast rewrites. This asks
  // about DECLARATIONS, which a cast cannot: whatever a mind file calls the
  // variable, the thing it was handed came from one of these types, and if
  // no member of any of them is declared in a forbidden module then there is
  // nothing of that kind to be handed. Members, call and construct signatures,
  // their parameters, their returns and their type arguments are all walked.
  const reachableTypes: string[] = [];
  const seen = new Set<ts.Type>();
  const walk = (type: ts.Type, trail: string, depth: number): void => {
    if (depth > 8 || seen.has(type)) return;
    seen.add(type);
    const symbol = type.aliasSymbol ?? type.getSymbol();
    for (const declaration of symbol?.getDeclarations() ?? []) {
      if (forbidden(declaration.getSourceFile().fileName)) {
        reachableTypes.push(`${trail}: ${symbol?.getName()} (${rel(declaration.getSourceFile().fileName)})`);
        return;
      }
    }
    for (const part of type.isUnionOrIntersection() ? type.types : []) walk(part, trail, depth + 1);
    for (const argument of checker.getTypeArguments(type as ts.TypeReference) ?? []) walk(argument, trail, depth + 1);
    for (const property of type.getProperties()) {
      const declaration = property.valueDeclaration ?? property.declarations?.[0];
      if (!declaration) continue;
      walk(checker.getTypeOfSymbolAtLocation(property, declaration), `${trail}.${property.getName()}`, depth + 1);
    }
    for (const signature of [...type.getCallSignatures(), ...type.getConstructSignatures()]) {
      for (const parameter of signature.getParameters()) {
        const declaration = parameter.valueDeclaration ?? parameter.declarations?.[0];
        if (!declaration) continue;
        walk(checker.getTypeOfSymbolAtLocation(parameter, declaration), `${trail}(${parameter.getName()})`, depth + 1);
      }
      walk(signature.getReturnType(), `${trail}()`, depth + 1);
    }
  };
  for (const [module, names] of MIND_IS_BUILT_WITH) {
    const source = program.getSourceFile(path.join(SRC, module));
    expect(source, `the proof could not compile ${module}`).toBeDefined();
    for (const name of names) {
      const found = typeNamed(program, source!, name);
      expect(found, `${module} no longer declares ${name}`).toBeDefined();
      walk(found!, name, 0);
    }
  }

  // ── D: no relay in `contract/` ────────────────────────────────────────────
  const relays: string[] = [];
  const contractFiles = new Set<string>(
    readdirSync(path.join(SRC, 'contract'), { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.ts'))
      .map((e) => path.join(SRC, 'contract', e.name)),
  );
  for (const planted of overlay.keys()) {
    if (path.dirname(planted).toLowerCase() === path.join(SRC, 'contract').toLowerCase()) contractFiles.add(planted);
  }
  for (const file of contractFiles) {
    if (CONTRACT_MAY_IMPORT_EDGES.has(rel(file))) continue;
    const text = overlay.get(path.resolve(file).toLowerCase()) ?? readFileSync(file, 'utf8');
    if (/from '\.\/edges\.js'/.test(text)) relays.push(rel(file));
  }

  return { forbiddenInClosure, dynamicImports, reachableTypes: [...new Set(reachableTypes)].sort(), relays: relays.sort() };
}

/**
 * EVERYTHING A MIND IS CONSTRUCTED WITH, by the module that declares it. These
 * are the roots of the walk: a mind is handed a world, a space, a policy, a
 * think input and its own options, and nothing else.
 */
const MIND_IS_BUILT_WITH: readonly (readonly [string, readonly string[]])[] = [
  ['contract/adapter.ts', ['WorldAdapter', 'ReflexPolicy', 'ReflexPolicyFactory', 'CognitionDefaults']],
  ['contract/space.ts', ['SpaceOps', 'PlaceRef']],
  ['contract/types.ts', ['ThinkInput', 'MindOutput', 'Intent', 'MemoryRecord']],
  ['contract/gate.ts', ['WorldGate']],
  ['consciousness/IMindBackend.ts', ['IMindBackend']],
  ['consciousness/MockMindBackend.ts', ['MockMindBackendOptions']],
];

/** The type a module declares under `name`, found through its own exports. */
function typeNamed(program: ts.Program, source: ts.SourceFile, name: string): ts.Type | undefined {
  const checker = program.getTypeChecker();
  const moduleSymbol = checker.getSymbolAtLocation(source);
  for (const exported of moduleSymbol ? checker.getExportsOfModule(moduleSymbol) : []) {
    if (exported.getName() !== name) continue;
    const declaration = exported.getDeclarations()?.[0];
    return declaration ? checker.getTypeAtLocation(declaration) : undefined;
  }
  return undefined;
}

describe('the mind’s type graph does not reach the forager world', () => {
  const options = compilerOptions();

  it('compiles the whole mind against a repository with no worlds/ in it', () => {
    expect(programDiagnostics(MIND_ONLY, hostWithoutWorlds(options), options)).toEqual([]);
  }, 120_000);

  it('the stubbing is real — a file that DOES reach the world stops compiling', () => {
    const diagnostics = programDiagnostics(REACHES_WORLD, hostWithoutWorlds(options), options);
    expect(diagnostics.join('\n')).toContain('TS2307');
    expect(diagnostics.join('\n')).toContain('worlds/forager');
  }, 120_000);

  it('…and compiles perfectly well with the world present, so nothing else is wrong', () => {
    const host = ts.createCompilerHost(options, true);
    expect(programDiagnostics(REACHES_WORLD, host, options)).toEqual([]);
    expect(programDiagnostics(MIND_ONLY, host, options)).toEqual([]);
  }, 120_000);
});

describe('the mind cannot reach a codec, structurally (W1-B4 round 4)', () => {
  const options = compilerOptions();

  it('has nothing forbidden in its import closure, no dynamic import, no reachable type, no relay', () => {
    expect(proveClosure(options)).toEqual({
      forbiddenInClosure: [],
      dynamicImports: [],
      reachableTypes: [],
      relays: [],
    });
  }, 180_000);

  /**
   * PLANT A — round 3's own move: a mind file imports the codec. It needs no
   * cast and no cleverness; it is one import line, which is exactly why the
   * defence has to be about the graph and not about the expression.
   */
  it('goes RED when a mind directory imports the codec', () => {
    const plant = path.join(SRC, 'consciousness', 'zz-plant-import.ts');
    const report = proveClosure(
      options,
      overlayOf([
        [
          plant,
          [
            "import type { SpaceCodec } from '../contract/edges.js';",
            "import type { PlaceRef } from '../contract/space.js';",
            'export const openIt = (codec: SpaceCodec, p: PlaceRef): unknown[] => Object.values(codec.encode(p));',
          ].join('\n'),
        ],
      ]),
    );
    expect(report.forbiddenInClosure).toEqual(['contract/edges.ts']);
  }, 180_000);

  /**
   * PLANT B — a codec-typed member on the object every mind IS handed. Caught
   * twice over, and deliberately: the type walk names the member, and the
   * closure names the import the member needed. Two independent rules failing
   * on one plant is what "belt and braces" is supposed to look like.
   */
  it('goes RED when WorldAdapter grows a codec-typed member', () => {
    const adapter = path.join(SRC, 'contract', 'adapter.ts');
    const text = readFileSync(adapter, 'utf8')
      .replace(
        "import type { SpaceOps } from './space.js';",
        "import type { SpaceOps } from './space.js';\nimport type { SpaceCodec } from './edges.js';",
      )
      .replace('  readonly space: SpaceOps;', '  readonly space: SpaceOps;\n  readonly places: SpaceCodec;');
    expect(text, 'the plant must actually change the file').toContain('readonly places: SpaceCodec;');
    const report = proveClosure(options, overlayOf([[adapter, text]]));
    expect(report.reachableTypes.join('\n')).toContain('WorldAdapter.places: SpaceCodec');
    expect(report.forbiddenInClosure).toEqual(['contract/edges.ts']);
  }, 180_000);

  /**
   * PLANT C — round 3's route 22, the one that needed NO cast: a new file in
   * `contract/` exporting something already narrower than `SpaceCodec`, which a
   * mind then imports without breaking a single rule. Nothing scanned
   * `contract/` for it. Now the relay is refused where it is WRITTEN, before
   * anyone has to notice who imported it.
   */
  it('goes RED at a relay in contract/, whether or not anything imports it', () => {
    const relay = path.join(SRC, 'contract', 'zz-plant-relay.ts');
    const source = [
      "import type { SpaceCodec } from './edges.js';",
      "import type { PlaceRef, SpaceOps } from './space.js';",
      'const held = new WeakMap<SpaceOps, SpaceCodec>();',
      'export const openerFor = (s: SpaceOps) => (p: PlaceRef): Record<string, unknown> => held.get(s)!.encode(p);',
    ].join('\n');
    expect(proveClosure(options, overlayOf([[relay, source]])).relays).toEqual(['contract/zz-plant-relay.ts']);
  }, 180_000);

  /**
   * PLANT D — the escape hatch a static closure cannot see: `await import(...)`
   * resolved at runtime. Refused by its shape in a mind directory rather than
   * by where it points, because where it points is a string.
   */
  it('goes RED at a dynamic import in a mind directory', () => {
    const plant = path.join(SRC, 'consciousness', 'zz-plant-dynamic.ts');
    const source = [
      'export async function reachOut(name: string): Promise<unknown> {',
      '  return import(name);',
      '}',
    ].join('\n');
    expect(proveClosure(options, overlayOf([[plant, source]])).dynamicImports.length).toBe(1);
  }, 180_000);
});

/**
 * ─── THE VERIFIER'S TWENTY-TWO, ONE BY ONE (W1-B4 round 3, FAIL 1) ──────────
 *
 * The verifier wrote 22 routes out of the opaque handle into `src/consciousness/`,
 * and every one of them compiled under the project's own `tsc` with all three
 * guards green. Nine of them plus the relay rested on a single import:
 * `codecFor` from `contract/space.ts`. There is no such export now and no
 * module a mind can reach that has one, so the whole group has nothing to call
 * — which is asserted below by compiling the routes and requiring the compiler
 * to refuse them.
 *
 * WHAT SURVIVES, AND WHY, so the count is honest rather than flattering:
 *
 *  · routes 10-15 (`label` via an alias, a destructure, parentheses,
 *    `Reflect.apply`, a widened space, or carried out as data) still work. They
 *    are the DECLARED B5 residual, and round 3's static rule against them was
 *    evaded five ways without a cast, so it has been deleted rather than left
 *    as decoration. `mind-no-geometry.test.ts` pins the residual.
 *  · route 16 (`SimEvent`'s `x`/`y` through `String.fromCharCode(120)`) still
 *    works. Declared B6 residual; no mind file reads one today.
 *  · routes 17-21 (mixing two spaces, the magnitude from `unplaced`, the same
 *    by binary search on `within`, the octant, "is this the origin") are
 *    questions `SpaceOps` AGREES to answer. They are the cost of a world
 *    answering "how far" and "which way" at all, and they yield this world's
 *    own scalars rather than its private state. W1-D owns whether `unplaced`
 *    should be a real place.
 */
describe('the codec routes of round 3 have nothing left to call', () => {
  const options = compilerOptions();

  const ROUTES: readonly (readonly [string, string])[] = [
    ['1 — the codec, widened past the type rule', 'const opener = codecFor as unknown as (s: SpaceOps) => { encode(p: PlaceRef): Record<string, unknown> };\nexport const r = (s: SpaceOps, p: PlaceRef) => Object.values(opener(s).encode(p));'],
    ['2 — the same through `any`', 'export const r = (s: SpaceOps, p: PlaceRef) => Object.values((codecFor as any)(s).encode(p));'],
    ['3 — a Euclidean distance between two handles', 'const o = codecFor as unknown as (s: SpaceOps) => { encode(p: PlaceRef): number[] };\nexport const r = (s: SpaceOps, a: PlaceRef, b: PlaceRef) => Math.sqrt((o(s).encode(a)[0]! - o(s).encode(b)[0]!) ** 2);'],
    ['5 — destructured, so the codec is never a whole value', 'const o = codecFor as unknown as (s: SpaceOps) => { encode(p: PlaceRef): Record<string, unknown> };\nexport const r = (s: SpaceOps, p: PlaceRef) => { const { encode } = o(s); return Object.values(encode(p)); };'],
    ['6 — the field NAMES this world writes a place with', 'const o = codecFor as unknown as (s: SpaceOps) => { fields: { id: string }[] };\nexport const r = (s: SpaceOps) => o(s).fields.map((f) => f.id);'],
    ['7 — MINTING, through `placeOf`', 'const o = codecFor as unknown as (s: SpaceOps) => { placeOf(c: unknown): PlaceRef | undefined };\nexport const r = (s: SpaceOps, a: number, b: number) => o(s).placeOf(JSON.parse(`{"x":${a},"y":${b}}`));'],
    ['8 — the same through `decode`', 'const o = codecFor as unknown as (s: SpaceOps) => { decode(f: Record<string, unknown>): PlaceRef | undefined };\nexport const r = (s: SpaceOps, a: number) => o(s).decode({ x: a });'],
    ['22 — the relay in contract/, which needed no cast at all', "import { openerFor } from '../contract/zz-plant-relay.js';\nexport const r = (s: SpaceOps, p: PlaceRef) => Object.values(openerFor(s)(p));"],
  ];

  for (const [label, body] of ROUTES) {
    it(`refuses route ${label}`, () => {
      const plant = path.join(SRC, 'consciousness', 'zz-route.ts');
      const source = [
        "import { codecFor } from '../contract/space.js';",
        "import type { PlaceRef, SpaceOps } from '../contract/space.js';",
        body,
      ].join('\n');
      const program = ts.createProgram([plant], options, hostWithOverlay(options, overlayOf([[plant, source]])));
      const file = program.getSourceFile(plant);
      expect(file, 'the route fixture must compile as a file').toBeDefined();
      const codes = program
        .getSemanticDiagnostics(file)
        .map((d) => d.code);
      // TS2305: `contract/space.ts` has no `codecFor`. TS2307: neither has the
      // relay a module to be imported from. Either way there is nothing to call.
      expect(codes.some((c) => c === 2305 || c === 2307), `route ${label} still compiles`).toBe(true);
    }, 120_000);
  }
});
