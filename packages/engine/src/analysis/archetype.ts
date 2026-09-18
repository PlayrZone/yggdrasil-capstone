import type { MemoryRecord } from '../contract/types.js';
import { episodicKey } from '../memory/MemoryStream.js';

/**
 * A behavior-derived label for what an agent spends its life doing. STRICTLY
 * analysis-side: the simulation never sees this, no agent is told it is a
 * "forager", and nothing reads it back into behavior. It is the Observatory
 * naming a pattern after the fact — the one sanctioned post-hoc classification
 * in the anti-NPC doctrine.
 */
export type Archetype =
  | 'forager'
  | 'woodcutter'
  | 'miner'
  | 'builder'
  | 'giver'
  | 'aggressor'
  | 'talker'
  | 'wanderer';

interface Tally {
  forage: number;
  wood: number;
  stone: number;
  build: number;
  give: number;
  attack: number;
  talk: number;
}

export interface ArchetypeResult {
  archetype: Archetype;
  /** Share of classified actions that drove the label, 0–1. */
  dominance: number;
  sampleSize: number;
}

/**
 * Classify from a MemoryStream's first-hand experience tally — counts keyed by
 * `episodicKey`, which span the being's whole life whether or not the records
 * themselves are still held. Falls back to 'wanderer' when there is too little
 * to go on.
 */
export function classifyFromCounts(counts: ReadonlyMap<string, number>): ArchetypeResult {
  const t: Tally = { forage: 0, wood: 0, stone: 0, build: 0, give: 0, attack: 0, talk: 0 };
  for (const [key, n] of counts) {
    const sep = key.indexOf(':');
    switch (key.slice(0, sep)) {
      case 'GatherSucceeded': {
        const objectKind = key.slice(sep + 1);
        if (objectKind === 'wood') t.wood += n;
        else if (objectKind === 'stone') t.stone += n;
        else t.forage += n;
        break;
      }
      case 'AteFood':
        t.forage += n;
        break;
      case 'BuiltStructure':
        t.build += 3 * n;
        break;
      case 'GaveItem':
        t.give += 2 * n;
        break;
      case 'AttackedAgent':
        t.attack += 3 * n;
        break;
      case 'UtteranceSpoken':
        t.talk += n;
        break;
      default:
        break;
    }
  }

  const entries: [Archetype, number][] = [
    ['forager', t.forage],
    ['woodcutter', t.wood],
    ['miner', t.stone],
    ['builder', t.build],
    ['giver', t.give],
    ['aggressor', t.attack],
    ['talker', t.talk],
  ];
  const total = entries.reduce((s, [, n]) => s + n, 0);
  if (total < 4) return { archetype: 'wanderer', dominance: 0, sampleSize: total };

  entries.sort((a, b) => b[1] - a[1]);
  const [label, top] = entries[0]!;
  return { archetype: top === 0 ? 'wanderer' : label, dominance: top / total, sampleSize: total };
}

/**
 * Classify from raw records — the same rule, for callers holding a memory list
 * rather than a stream (tests, and any analysis handed records directly).
 */
export function classifyArchetype(memories: MemoryRecord[]): ArchetypeResult {
  const counts = new Map<string, number>();
  for (const m of memories) {
    if (m.origin !== 'experience') continue;
    const key = episodicKey(m.type, m.objectKind);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return classifyFromCounts(counts);
}
