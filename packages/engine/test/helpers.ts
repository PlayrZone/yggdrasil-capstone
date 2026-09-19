import type { ContextFeatures, MemoryRecord, Needs, SimEventType } from '../src/index.js';
import { foragerAdapter, importanceOf } from '../src/index.js';

export const CTX: ContextFeatures = {
  nearWater: false,
  night: false,
  inShelter: false,
  elevationBand: 0,
};

let nextId = 1;

export function resetIds(): void {
  nextId = 1;
}

/** Build a memory record with sane defaults for miner unit tests. */
export function mem(
  tick: number,
  type: SimEventType,
  overrides: Partial<MemoryRecord> = {},
): MemoryRecord {
  const needDeltas: Partial<Needs> = overrides.needDeltas ?? {};
  return {
    id: nextId++,
    tick,
    type,
    subjects: [],
    context: CTX,
    needDeltas,
    outcome: 'neutral',
    summaryText: type,
    importance: importanceOf(foragerAdapter, type, needDeltas),
    origin: 'experience',
    ...overrides,
  };
}
