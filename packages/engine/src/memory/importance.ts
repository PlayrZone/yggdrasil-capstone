import type { WorldAdapter } from '../contract/adapter.js';
import type { DriveDeltas, EventId } from '../contract/ids.js';

/**
 * Deterministic importance heuristic. The world's declared salience for the
 * event, scaled by the magnitude of the need change it caused. Witnessing a
 * death matters more than seeing a tree — but WHICH events those are is the
 * world's to say, not this function's; nothing here ever consults a model
 * (V2: the LLM does not touch the memory store).
 *
 * An event the world does not declare has no salience at all.
 */
export function importanceOf(world: WorldAdapter, type: EventId, needDeltas: DriveDeltas): number {
  const base = world.eventById.get(type)?.salience ?? 0;
  let magnitude = 0;
  for (const delta of Object.values(needDeltas)) {
    // A slot present but EMPTY poisons the result, exactly as `Math.abs(
    // undefined)` did when this record's type made that unrepresentable. No
    // body writes one; preserved rather than quietly repaired.
    magnitude = Math.max(magnitude, Math.abs(delta ?? Number.NaN) / 100);
  }
  return Math.min(1, base + magnitude * 0.3);
}
