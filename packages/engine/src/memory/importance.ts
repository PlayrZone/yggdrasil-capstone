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
 *
 * TOTAL, AS OF W1-B3 (B2 verifier §3, backlog 4). A delta slot that is present
 * but not a usable number used to give `NaN`, and a `NaN` importance is not
 * merely a bad number: `MemoryStream` evicts on `a.importance - b.importance`,
 * and `NaN - x` is falsy in BOTH directions, so one such record stops the
 * comparator being a total order and V8 hands back an arbitrary, engine-version
 * dependent permutation of the evicted block. In a research engine that is a
 * reproducibility hazard, and it was reachable: `Experiment.authorEvent` let a
 * host write one. Such a slot now contributes NOTHING, which is what a
 * magnitude nobody can measure is worth. Behaviour-neutral for every event this
 * engine emits — every one writes real numbers — and the goldens say so.
 */
export function importanceOf(world: WorldAdapter, type: EventId, needDeltas: DriveDeltas): number {
  const base = world.eventById.get(type)?.salience ?? 0;
  let magnitude = 0;
  for (const delta of Object.values(needDeltas)) {
    if (typeof delta !== 'number' || !Number.isFinite(delta)) continue;
    magnitude = Math.max(magnitude, Math.abs(delta) / 100);
  }
  return Math.min(1, base + magnitude * 0.3);
}
