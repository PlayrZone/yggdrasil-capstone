import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { foragerAdapter } from '../src/worlds/forager/adapter.js';

/**
 * THE POINT OF W1-B, ENFORCED.
 *
 * One brain lives in any world, so the brain may not know the names of any of
 * them. This test reads the source of every mind file and fails if a single
 * forager event, context-feature or drive id has crept in.
 *
 * It is driven from `foragerAdapter`, so it cannot rot: declare a new event in
 * that world and this test starts policing its name for free.
 *
 * WHAT IT LOOKS AT.
 *  · Identifiers as well as string literals, because a table reintroduced as
 *    `{ GatherSucceeded: 0.25 }` names the world without quoting it.
 *  · Strings a compiler would CONSTANT-FOLD — `'Gather' + 'Succeeded'`, a
 *    template's literal parts — because a name assembled in pieces is still
 *    the name (W1-B1 verifier, backlog 3).
 *  · One level through each mind file's own imports, into modules OUTSIDE the
 *    mind: a table re-exported from `contract/` and imported back is a table
 *    the mind reads, however it got there (same backlog item). Mind files are
 *    not followed into, because each is scanned and pinned in its own right.
 *  · Module specifiers: a mind file may not import from `worlds/` at all.
 *
 * WHAT IT DOES NOT. Comments — an explanation of why something is the way it
 * is may name the example it came from.
 */

const SRC = fileURLToPath(new URL('../src/', import.meta.url));

/** The directories that are the mind (docs/rework/ARCHITECTURE.md §2). */
const MIND_DIRS = [
  'agent',
  'memory',
  'learning',
  'knowledge',
  'relationships',
  'narrative',
  'consciousness',
];

/** The files B1 emptied. These must name nothing. */
const EMPTIED = [
  'memory/importance.ts', // BASE → events[].salience
  'memory/memoryFromEvent.ts', // the perspective switch → events[].roles, events[].outcome
  'relationships/RelationshipStore.ts', // EVENT_DELTAS + OBSERVER_APPLICABLE → events[].*Deltas
  'learning/ContextMiner.ts', // FEATURES + featureActive → context[]
  'learning/OutcomeMiner.ts', // FEATURES + featureActive → context[]
  'learning/SuccessionMiner.ts', // DEFAULT_EXCLUDE → events[].causal
  'runner/EventPipeline.ts', // the prestige rule → events[].prestige; AgentDied → endsLife
  // B2's own: the two miners that read ROLES now, and the one authored memory.
  'learning/SocialMiner.ts', // the gift/attack/word switch → events[].social
  'learning/CraftObservationMiner.ts', // `type !== 'Crafted'` → events[].demonstrates
  'agent/AgentMind.ts', // injectIdea's forager event + blank context → the host's
];

/**
 * Mind files that still name this world, and the step that takes each away.
 * Pinned rather than merely excused: a new leak in any other mind file fails
 * this test, and a step that cleans one of these has to come here and say so.
 *
 * B2 removed three entries from this list. What is left is exactly what B3 and
 * B5 own, and nothing here is a table any more — it is prose, a policy, and a
 * vocabulary the prompt advertises.
 */
const STILL_LEAKING: Record<string, string> = {
  'consciousness/ReflexMind.ts': 'B3 — moves to worlds/forager/reflexPolicy.ts, verbatim',
  'consciousness/schema.ts': 'B3 — the arg allowlists become the adapter’s actions + kinds',
  'consciousness/prompt.ts': 'B5 — the prompt skeleton keeps no world prose',
  'learning/templates.ts': 'B5 — English per event, → lexicon',
};

/**
 * NON-MIND modules the mind imports that still spell a world name, and the step
 * that takes each away. Following imports one level found exactly one, and it
 * is a real finding rather than an excuse: `WorldView.night` is a circumstance
 * of THIS world sitting in a world-neutral shape, and a world without a diurnal
 * cycle has nothing to put there. It is B4's, with `season` and the coordinates
 * beside it — B2 does not touch `WorldView`.
 *
 * A module on this list is not followed into (every mind file imports
 * `contract/types.ts`, and reporting it 20 times says nothing new); a module
 * that is NOT on it and starts naming the world fails every mind file that
 * imports it. The pins are checked for accuracy below, so a step that cleans
 * one has to come here and delete it.
 */
const IMPORTED_STILL_LEAKING: Record<string, string[]> = {
  'contract/types.ts': ['night (context feature)'], // B4 — WorldView.night
};

const BANNED = new Map<string, string>();
for (const e of foragerAdapter.events) BANNED.set(e.id, 'event');
for (const c of foragerAdapter.context) BANNED.set(c.id, 'context feature');
// A slot a feature reads is a world name too. Set only when it is not already
// a feature id, so `night` (both) reads as the feature it is.
for (const c of foragerAdapter.context) if (!BANNED.has(c.source)) BANNED.set(c.source, 'context field');
for (const d of foragerAdapter.drives) BANNED.set(d.id, 'drive');

/**
 * The value an expression has if a compiler could work it out: a literal, a
 * template's fixed parts, or any `+` chain of those. Substitutions are dropped
 * rather than refused, which over-approximates on purpose — this is a guard,
 * and a false alarm is cheap where a missed name is not.
 */
function constantString(node: ts.Node): string | undefined {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isParenthesizedExpression(node)) return constantString(node.expression);
  if (ts.isTemplateExpression(node)) {
    return node.head.text + node.templateSpans.map((s) => s.literal.text).join('');
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = constantString(node.left);
    const right = constantString(node.right);
    return left !== undefined && right !== undefined ? left + right : undefined;
  }
  return undefined;
}

/** Every name a file SPELLS: identifiers, string literals and folded strings. */
export function spelledNames(source: string): Set<string> {
  const file = ts.createSourceFile('probe.ts', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const out = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isImportTypeNode(node)) return;
    if (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) out.add(node.text);
    const folded = constantString(node);
    if (folded !== undefined) out.add(folded);
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(file, visit);
  return out;
}

/** The modules a file imports, as paths relative to `src/` (local ones only). */
export function importedModules(rel: string, source: string): string[] {
  const file = ts.createSourceFile('probe.ts', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const here = path.posix.dirname(rel.split(path.sep).join('/'));
  const out: string[] = [];
  for (const statement of file.statements) {
    const specifier =
      (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) && statement.moduleSpecifier;
    if (!specifier || !ts.isStringLiteral(specifier)) continue;
    if (!specifier.text.startsWith('.')) continue;
    out.push(path.posix.normalize(path.posix.join(here, specifier.text)).replace(/\.js$/, '.ts'));
  }
  return out;
}

const isMindModule = (rel: string): boolean => MIND_DIRS.includes(rel.split('/')[0] ?? '');

type Reader = (rel: string) => string | undefined;

const fromDisk: Reader = (rel) => {
  try {
    return readFileSync(path.join(SRC, rel), 'utf8');
  } catch {
    return undefined;
  }
};

/**
 * Every forager name a file reaches: the ones it spells, plus — for a file
 * inside the MIND — the ones spelled by the non-mind modules it imports (one
 * level). Imports are not followed out of a HOST file: `runner/EventPipeline`
 * is on the emptied list and legitimately imports the body, which is full of
 * this world's names. What it may not do is spell one itself.
 */
export function worldNamesIn(rel: string, read: Reader = fromDisk): string[] {
  const source = read(rel);
  if (source === undefined) return [];
  const named: string[] = [];
  for (const name of spelledNames(source)) {
    if (BANNED.has(name)) named.push(`${name} (${BANNED.get(name)})`);
  }
  if (!isMindModule(rel)) return [...new Set(named)].sort();
  for (const imported of importedModules(rel, source)) {
    if (imported.startsWith('worlds/')) {
      named.push(`${imported} (world module)`);
      continue;
    }
    if (isMindModule(imported)) continue; // scanned and pinned on its own
    if (imported in IMPORTED_STILL_LEAKING) continue; // pinned, with its step
    const body = read(imported);
    if (body === undefined) continue;
    for (const name of spelledNames(body)) {
      if (BANNED.has(name)) named.push(`${name} (${BANNED.get(name)}, via ${imported})`);
    }
  }
  return [...new Set(named)].sort();
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

describe('the world tables left the mind (W1-B)', () => {
  it('has a vocabulary to police, taken from the world itself', () => {
    expect(foragerAdapter.events.length).toBe(29);
    expect(foragerAdapter.context.length).toBe(4);
    expect(foragerAdapter.drives.length).toBe(4);
    expect(BANNED.size).toBe(29 + 4 + 4 + 1); // `elevationBand` is a field, not a feature id
  });

  for (const file of EMPTIED) {
    it(`${file} names no part of the forager world`, () => {
      expect(worldNamesIn(file)).toEqual([]);
    });
  }

  it('no OTHER mind file has started naming it either', () => {
    const leaking: Record<string, string[]> = {};
    for (const file of mindFiles()) {
      const named = worldNamesIn(file);
      if (named.length > 0) leaking[file] = named;
    }
    expect(Object.keys(leaking).sort()).toEqual(Object.keys(STILL_LEAKING).sort());
  });

  it('every file still leaking names the step that takes it away', () => {
    for (const [file, step] of Object.entries(STILL_LEAKING)) {
      expect(step, file).toMatch(/^B[3-6] — /);
    }
  });

  it('the pinned non-mind leaks are still exactly what they say', () => {
    for (const [module, expected] of Object.entries(IMPORTED_STILL_LEAKING)) {
      const source = fromDisk(module);
      expect(source, module).toBeDefined();
      const named = [...spelledNames(source!)]
        .filter((n) => BANNED.has(n))
        .map((n) => `${n} (${BANNED.get(n)})`)
        .sort();
      expect(named, module).toEqual([...expected].sort());
    }
  });
});

/**
 * NEGATIVE CONTROLS. A guard with a hole reads exactly like one that works, so
 * each way of naming the world is proven to be caught — and the two forms that
 * are deliberately allowed are proven to be let through.
 */
describe('the scan sees every way of naming a world', () => {
  const CAUGHT: [string, string][] = [
    ['a string literal', `export const x = 'WitnessedDeath';`],
    ['a double-quoted literal', `export const x = "highland";`],
    ['an object-literal key', `export const BASE = { GatherSucceeded: 0.25 };`],
    ['a quoted object key', `export const BASE = { 'GatherSucceeded': 0.25 };`],
    ['a computed member access', `export const f = (m: Record<string, number>) => m['nearWater'];`],
    ['a dotted member access', `export const f = (m: { hunger: number }) => m.hunger;`],
    ['a string literal type', `export type T = 'AgentDied' | 'other';`],
    ['a template literal', 'export const x = `night`;'],
    ['a Set of them', `export const S = new Set(['SawAgent']);`],
    ['a concatenation', `export const x = 'Gather' + 'Succeeded';`],
    ['a three-part concatenation', `export const x = 'Gather' + 'Suc' + 'ceeded';`],
    ['a parenthesised concatenation', `export const x = ('Witnessed') + ('Death');`],
    ['a template with a hole in it', 'export const x = `Gather${n}Succeeded`;'],
    ['a concatenation used as a key', `export const f = (m: Record<string, number>) => m['near' + 'Water'];`],
  ];

  for (const [label, source] of CAUGHT) {
    it(`catches ${label}`, () => {
      const named = [...spelledNames(source)].filter((n) => BANNED.has(n));
      expect(named, label).not.toEqual([]);
    });
  }

  it('lets a comment through — an explanation may name its own example', () => {
    const source = `// WitnessedDeath only ever arises in the bystander perspective.\nexport const x = 1;`;
    expect([...spelledNames(source)].filter((n) => BANNED.has(n))).toEqual([]);
  });
});

describe('the scan follows what a mind file imports', () => {
  /** A two-module world: the mind file, and whatever it imports. */
  const reader = (files: Record<string, string>): Reader => (rel) => files[rel];

  it('catches a table re-exported from a non-mind module', () => {
    const named = worldNamesIn(
      'memory/importance.ts',
      reader({
        'memory/importance.ts': `import { BASE } from '../contract/_probe.js';\nexport const x = BASE;`,
        'contract/_probe.ts': `export const BASE = { GatherSucceeded: 0.25 };`,
      }),
    );
    expect(named).toEqual(['GatherSucceeded (event, via contract/_probe.ts)']);
  });

  it('catches an import of the world itself, without reading it', () => {
    const named = worldNamesIn(
      'memory/importance.ts',
      reader({ 'memory/importance.ts': `import { foragerAdapter } from '../worlds/forager/adapter.js';` }),
    );
    expect(named).toEqual(['worlds/forager/adapter.ts (world module)']);
  });

  it('does not follow into another MIND file — each is pinned in its own right', () => {
    const named = worldNamesIn(
      'knowledge/KnowledgeStore.ts',
      reader({
        'knowledge/KnowledgeStore.ts': `import { renderStatement } from '../learning/templates.js';\nexport const x = renderStatement;`,
        'learning/templates.ts': `export const EVENT_PHRASE = { AteFood: 'eating' };`,
      }),
    );
    expect(named).toEqual([]);
  });

  it('does not follow a package import', () => {
    const named = worldNamesIn(
      'memory/importance.ts',
      reader({ 'memory/importance.ts': `import ts from 'typescript';\nexport const x = ts;` }),
    );
    expect(named).toEqual([]);
  });
});
