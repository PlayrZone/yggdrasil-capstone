import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { foragerAdapter } from '../src/worlds/forager/adapter.js';

/**
 * THE POINT OF W1-B1, ENFORCED.
 *
 * One brain lives in any world, so the brain may not know the names of any of
 * them. This test reads the source of the mind files whose tables moved to the
 * `WorldAdapter` and fails if a single forager event, context-feature or drive
 * id has crept back in.
 *
 * It is driven from `foragerAdapter`, so it cannot rot: declare a new event in
 * that world and this test starts policing its name for free.
 *
 * WHAT IT LOOKS AT. Identifiers as well as string literals, because a table
 * reintroduced as `{ GatherSucceeded: 0.25 }` names the world without quoting
 * it. WHAT IT DOES NOT. Import and export clauses — B1 leaves the mind typed
 * against the forager unions on purpose, and B2 is the step that takes
 * `import type { SimEventType }` away. Comments either: an explanation of why
 * something is the way it is may name the example it came from.
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
];

/**
 * Mind files that still name this world, and the step that takes each away.
 * Pinned rather than merely excused: a new leak in any other mind file fails
 * this test, and a step that cleans one of these has to come here and say so.
 */
const STILL_LEAKING: Record<string, string> = {
  // Role semantics, not tables: WHICH event is a gift, an attack, a making.
  // Needs the B3 core action vocabulary before it can be data.
  'learning/SocialMiner.ts': 'B2/B3 — event ids as interaction roles',
  'learning/CraftObservationMiner.ts': 'B2/B3 — "a making" as a core verb',
  'learning/templates.ts': 'B5 — English per event, → lexicon',
  // `injectIdea` AUTHORS a memory — an event id and a blank forager context —
  // for an intervention that reaches in from outside the world. It needs a
  // world-neutral empty context (B2) or to move to `Interventions` entirely.
  'agent/AgentMind.ts': 'B2 — injectIdea authors a forager memory',
  // Already world side by principle 3 of the W1-B brief; B3 moves the file.
  'consciousness/ReflexMind.ts': 'B3 — moves to worlds/forager/reflexPolicy.ts',
  'consciousness/prompt.ts': 'B5 — the prompt skeleton keeps no world prose',
  'consciousness/schema.ts': 'B3 — the allowlists become the adapter’s actions',
};

const BANNED = new Map<string, string>();
for (const e of foragerAdapter.events) BANNED.set(e.id, 'event');
for (const c of foragerAdapter.context) {
  BANNED.set(c.id, 'context feature');
  BANNED.set(c.source, 'context field');
}
for (const d of foragerAdapter.drives) BANNED.set(d.id, 'drive');

/** Every name a file SPELLS: identifiers and string literals, minus imports. */
export function spelledNames(source: string): Set<string> {
  const file = ts.createSourceFile('probe.ts', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const out = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isImportTypeNode(node)) return;
    if (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) out.add(node.text);
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(file, visit);
  return out;
}

function worldNamesIn(rel: string): string[] {
  const named: string[] = [];
  for (const name of spelledNames(readFileSync(path.join(SRC, rel), 'utf8'))) {
    if (BANNED.has(name)) named.push(`${name} (${BANNED.get(name)})`);
  }
  return named.sort();
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

describe('the world tables left the mind (W1-B1)', () => {
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
  ];

  for (const [label, source] of CAUGHT) {
    it(`catches ${label}`, () => {
      const named = [...spelledNames(source)].filter((n) => BANNED.has(n));
      expect(named, label).not.toEqual([]);
    });
  }

  it('lets a type-only import through — B2 is the step that removes those', () => {
    const source = `import type { SimEventType } from '../contract/types.js';\nexport type T = SimEventType;`;
    expect([...spelledNames(source)].filter((n) => BANNED.has(n))).toEqual([]);
  });

  it('lets a comment through — an explanation may name its own example', () => {
    const source = `// WitnessedDeath only ever arises in the bystander perspective.\nexport const x = 1;`;
    expect([...spelledNames(source)].filter((n) => BANNED.has(n))).toEqual([]);
  });
});
