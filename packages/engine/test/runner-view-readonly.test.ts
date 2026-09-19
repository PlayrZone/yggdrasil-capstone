import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * `RuntimeView` USED TO BE READ-ONLY ONLY IN ITS CONTAINERS: the verifier
 * compiled 16 mutations through it, `entomb()` among them, because it handed
 * the instrument the real `AgentMind` and `GahallianBody`. It now hands out
 * projections carrying nothing but the reads the instrument actually makes.
 *
 * Vitest does not typecheck, so a `// @ts-expect-error` in an ordinary test
 * file asserts nothing. This runs the compiler itself over
 * `fixtures/runtime-view-mutations.ts` and demands ZERO diagnostics — which
 * fails in both directions:
 *  · a mutation that starts compiling makes its directive unused (TS2578);
 *  · a read the instrument needs that stops compiling is a plain error.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, 'fixtures', 'runtime-view-mutations.ts');
const TSCONFIG = path.join(HERE, '..', 'tsconfig.json');

function compilerOptions(): ts.CompilerOptions {
  const read = ts.readConfigFile(TSCONFIG, ts.sys.readFile);
  expect(read.error, ts.flattenDiagnosticMessageText(read.error?.messageText, ' ')).toBeUndefined();
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, path.dirname(TSCONFIG));
  return { ...parsed.options, noEmit: true, declaration: false, declarationMap: false, sourceMap: false };
}

describe('RuntimeView is read-only at the type level', () => {
  it('compiles the mutation fixture with no diagnostics at all', () => {
    const program = ts.createProgram([FIXTURE], compilerOptions());
    const file = program.getSourceFile(FIXTURE);
    expect(file, 'fixture not found by the compiler').toBeDefined();

    const diagnostics = [
      ...program.getSyntacticDiagnostics(file),
      ...program.getSemanticDiagnostics(file),
    ];
    const rendered = diagnostics.map((d) => {
      const line = d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start).line + 1 : 0;
      return `${path.basename(d.file?.fileName ?? '?')}:${line} TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`;
    });
    expect(rendered).toEqual([]);
  }, 120_000);

  it('the fixture is not vacuous — it really does assert dozens of mutations', () => {
    const source = ts.sys.readFile(FIXTURE) ?? '';
    expect(source.match(/@ts-expect-error/g)?.length ?? 0).toBeGreaterThanOrEqual(30);
  });
});
