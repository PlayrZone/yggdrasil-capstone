import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * ONE BRAIN, ANY WORLD — PROVED BY THE COMPILER (W1-B2, item 7).
 *
 * `test/world-tables-out.test.ts` reads the mind's source and refuses the
 * forager world's NAMES. This asks the stronger question: can the mind's type
 * graph still REACH that world at all? Grep cannot answer it — a type-only
 * import is erased from the emit, so nothing at runtime would ever notice — but
 * the compiler can, because it still has to resolve one.
 *
 * So the mind is compiled against a repository in which `src/worlds/` does not
 * exist: the compiler host below reports every path under it as missing. A mind
 * that still reached the forager world, as a value or as a type, fails to
 * resolve it (TS2307), and the fixture that deliberately does reach it proves
 * the stubbing is real.
 *
 * Same technique as `runner-view-readonly.test.ts`: the real compiler, the
 * real tsconfig, zero diagnostics demanded.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TSCONFIG = path.join(HERE, '..', 'tsconfig.json');
const WORLDS = path.join(HERE, '..', 'src', 'worlds');

const MIND_ONLY = path.join(HERE, 'fixtures', 'mind-without-world.ts');
const REACHES_WORLD = path.join(HERE, 'fixtures', 'mind-reaches-world.ts');

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
