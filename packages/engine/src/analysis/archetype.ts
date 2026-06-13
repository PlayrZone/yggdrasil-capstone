import type { MemoryRecord } from '../contract/types.js';

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
 * Classify from an agent's own memory stream (first-hand experiences only —
 * watching others does not define who you are). Falls back to 'wanderer' when
 * there is too little to go on.
 */
export function classifyArchetype(memories: MemoryRecord[]): ArchetypeResult {
  const t: Tally = { forage: 0, wood: 0, stone: 0, build: 0, give: 0, attack: 0, talk: 0 };
  for (const m of memories) {
    if (m.origin !== 'experience') continue;
    switch (m.type) {
      case 'GatherSucceeded':
        if (m.objectKind === 'wood') t.wood++;
        else if (m.objectKind === 'stone') t.stone++;
        else t.forage++;
        break;
      case 'AteFood':
        t.forage++;
        break;
      case 'BuiltStructure':
        t.build += 3;
        break;
      case 'GaveItem':
        t.give += 2;
        break;
      case 'AttackedAgent':
        t.attack += 3;
        break;
      case 'UtteranceSpoken':
        t.talk++;
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
