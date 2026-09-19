import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * THE DIRECTION OF THE ARROW, ENFORCED.
 *
 * The simulation and the research instrument used to be one object, and audit
 * 01 §3 traces every "the measurement is the mechanism" finding back to that.
 * W1-A split them; this test is what keeps them split. It reads the import
 * graph of `src/` and fails on the three ways the seam could be crossed again:
 *
 *  1. runtime code (anything in `runner/` that is not the facade or the
 *     instrument) importing `analysis/` or `runner/instrument/`;
 *  2. the instrument reaching into the runtime by any route other than the
 *     read-only `RuntimeView`;
 *  3. anything at all outside the instrument — except the one facade that
 *     publishes it — importing the instrument.
 *
 * The graph is read with the TypeScript parser, not a regex: a rule that only
 * sees single-quoted static imports is a rule anyone can step around without
 * meaning to. Every import form the language has is covered, and the one form
 * that cannot be resolved statically — a dynamic import of a computed
 * specifier — is reported as `<dynamic>` and banned outright inside `runner/`
 * rather than being quietly skipped.
 */

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const DYNAMIC = '<dynamic>';

/** Every module specifier in `source`, whatever syntax names it. */
export function importSpecifiers(source: string): string[] {
  const file = ts.createSourceFile('probe.ts', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const out: string[] = [];
  const literal = (node: ts.Node | undefined): void => {
    if (node && ts.isStringLiteralLike(node)) out.push(node.text);
    else out.push(DYNAMIC);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      // `export { x }` with no `from` names no module.
      if (node.moduleSpecifier) literal(node.moduleSpecifier);
    } else if (ts.isImportTypeNode(node)) {
      // `import('./x.js').Type`
      literal(ts.isLiteralTypeNode(node.argument) ? node.argument.literal : undefined);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      literal(node.moduleReference.expression);
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const isDynamicImport = callee.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(callee) && callee.text === 'require';
      if (isDynamicImport || isRequire) literal(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return out;
}

/** Every .ts file under `src/`, as posix paths relative to `src/`. */
function sources(dir = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(path.join(SRC, dir), { withFileTypes: true })) {
    const rel = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...sources(rel));
    else if (entry.name.endsWith('.ts')) out.push(rel);
  }
  return out;
}

/** The relative imports of `source`, resolved to posix paths under `src/`. */
function targetsOf(fromRel: string, source: string): string[] {
  const dir = path.posix.dirname(fromRel);
  return importSpecifiers(source)
    .filter((s) => s === DYNAMIC || s.startsWith('.'))
    .map((s) => (s === DYNAMIC ? DYNAMIC : path.posix.normalize(path.posix.join(dir, s))));
}

function targetsOfFile(file: string): string[] {
  return targetsOf(file, readFileSync(path.join(SRC, file), 'utf8'));
}

const ALL = sources();
const FACADE = 'runner/Experiment.ts';
const isInstrument = (f: string): boolean => f.startsWith('runner/instrument/');
const isRuntime = (f: string): boolean => f.startsWith('runner/') && f !== FACADE && !isInstrument(f);

/** What an instrument file may reach back into `runner/` for: the view, and the
 *  one helper both sides share. Everything else is the runtime itself. */
const INSTRUMENT_MAY_IMPORT = new Set(['runner/RuntimeView.js', 'runner/kinship.js']);

const forbiddenForRuntime = (target: string): boolean =>
  target.startsWith('analysis/') || target.startsWith('runner/instrument/') || target === DYNAMIC;

describe('runner layering', () => {
  it('finds the modules it is supposed to police', () => {
    expect(ALL).toContain(FACADE);
    expect(ALL.filter(isRuntime).length).toBeGreaterThan(5);
    expect(ALL.filter(isInstrument).length).toBeGreaterThan(3);
  });

  it('the runtime cannot see the instrument or the analyzers', () => {
    const violations: string[] = [];
    for (const file of ALL.filter(isRuntime)) {
      for (const target of targetsOfFile(file)) {
        if (forbiddenForRuntime(target)) violations.push(`${file} -> ${target}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('the instrument sees the runtime only through RuntimeView', () => {
    const violations: string[] = [];
    for (const file of ALL.filter(isInstrument)) {
      for (const target of targetsOfFile(file)) {
        if (target === DYNAMIC) violations.push(`${file} -> ${target}`);
        if (!target.startsWith('runner/')) continue;
        if (target.startsWith('runner/instrument/')) continue;
        if (INSTRUMENT_MAY_IMPORT.has(target)) continue;
        violations.push(`${file} -> ${target}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('only the Experiment facade publishes the instrument', () => {
    const violations: string[] = [];
    for (const file of ALL) {
      if (isInstrument(file) || file === FACADE) continue;
      for (const target of targetsOfFile(file)) {
        if (target.startsWith('runner/instrument/')) violations.push(`${file} -> ${target}`);
      }
    }
    expect(violations).toEqual([]);
  });
});

/**
 * NEGATIVE CONTROLS. Each of these is a way to import `analysis/` that the
 * previous regex-based scan did not see. A rule with holes is worse than no
 * rule, because it reads like one that works.
 */
describe('the import scan sees every form of import', () => {
  const FORMS: [string, string][] = [
    ['single-quoted static', `import { analyzeMyth } from '../analysis/myth.js';`],
    ['double-quoted static', `import { analyzeMyth } from "../analysis/myth.js";`],
    ['type-only static', `import type { MythReport } from '../analysis/myth.js';`],
    ['side-effect only', `import '../analysis/myth.js';`],
    ['namespace', `import * as m from "../analysis/myth.js";`],
    ['re-export', `export { analyzeMyth } from '../analysis/myth.js';`],
    ['star re-export', `export * from "../analysis/myth.js";`],
    ['inline import type', `type R = import('../analysis/myth.js').MythReport; export type { R };`],
    ['dynamic, single-quoted', `export const m = () => import('../analysis/myth.js');`],
    ['dynamic, double-quoted', `export const m = () => import("../analysis/myth.js");`],
    ['dynamic, template literal', 'export const m = () => import(`../analysis/myth.js`);'],
    ['require', `const m = require('../analysis/myth.js');`],
  ];

  for (const [label, source] of FORMS) {
    it(`catches a ${label} import of analysis/`, () => {
      const targets = targetsOf('runner/Runtime.ts', source);
      expect(targets, label).toContain('analysis/myth.js');
      expect(targets.some(forbiddenForRuntime), label).toBe(true);
    });
  }

  it('refuses a dynamic import it cannot read, rather than skipping it', () => {
    const targets = targetsOf('runner/Runtime.ts', 'export const m = (n: string) => import(`../${n}/myth.js`);');
    expect(targets).toContain('<dynamic>');
    expect(targets.some(forbiddenForRuntime)).toBe(true);
  });

  it('does not invent imports where there are none', () => {
    const source = [
      `// import { analyzeMyth } from '../analysis/myth.js';`,
      `const notAnImport = "from '../analysis/myth.js'";`,
      `export { importSpecifiers };`,
      `function importSpecifiers(): string { return notAnImport; }`,
    ].join('\n');
    expect(targetsOf('runner/Runtime.ts', source)).toEqual([]);
  });
});
