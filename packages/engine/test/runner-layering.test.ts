import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
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
 * A grep over source text, deliberately: it needs no build, and a violation is
 * a compile-time fact, not a runtime one.
 */

const SRC = fileURLToPath(new URL('../src/', import.meta.url));

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

const FROM = /\bfrom\s+'([^']+)'/g;
const DYNAMIC = /\bimport\s*\(\s*'([^']+)'/g;

/** Relative imports of `file`, each resolved to a posix path under `src/`. */
function importsOf(file: string): string[] {
  const text = readFileSync(path.join(SRC, file), 'utf8');
  const specs: string[] = [];
  for (const re of [FROM, DYNAMIC]) {
    re.lastIndex = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) specs.push(m[1]!);
  }
  const dir = path.posix.dirname(file);
  return specs
    .filter((s) => s.startsWith('.'))
    .map((s) => path.posix.normalize(path.posix.join(dir, s)));
}

const ALL = sources();
const FACADE = 'runner/Experiment.ts';
const isInstrument = (f: string): boolean => f.startsWith('runner/instrument/');
const isRuntime = (f: string): boolean => f.startsWith('runner/') && f !== FACADE && !isInstrument(f);

/** What an instrument file may reach back into `runner/` for: the view, and the
 *  one helper both sides share. Everything else is the runtime itself. */
const INSTRUMENT_MAY_IMPORT = new Set(['runner/RuntimeView.js', 'runner/kinship.js']);

describe('runner layering', () => {
  it('finds the modules it is supposed to police', () => {
    expect(ALL).toContain(FACADE);
    expect(ALL.filter(isRuntime).length).toBeGreaterThan(5);
    expect(ALL.filter(isInstrument).length).toBeGreaterThan(3);
  });

  it('the runtime cannot see the instrument or the analyzers', () => {
    const violations: string[] = [];
    for (const file of ALL.filter(isRuntime)) {
      for (const target of importsOf(file)) {
        if (target.startsWith('analysis/') || target.startsWith('runner/instrument/')) {
          violations.push(`${file} -> ${target}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('the instrument sees the runtime only through RuntimeView', () => {
    const violations: string[] = [];
    for (const file of ALL.filter(isInstrument)) {
      for (const target of importsOf(file)) {
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
      for (const target of importsOf(file)) {
        if (target.startsWith('runner/instrument/')) violations.push(`${file} -> ${target}`);
      }
    }
    expect(violations).toEqual([]);
  });
});
