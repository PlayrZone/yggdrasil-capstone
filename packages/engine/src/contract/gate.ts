import type { WorldAdapter } from './adapter.js';
import type { DriveLevels, EventId } from './ids.js';
import type { KnowledgeRule, MemoryRecord } from './types.js';

/**
 * THE EDGE BETWEEN A WORLD AND A MIND (W1-B2).
 *
 * The mind holds opaque ids, so nothing in the type system can tell it whether
 * the world it lives in has ever heard of one. That question is about DATA, and
 * this is where it is asked: every id arriving from outside is checked against
 * what the adapter declared, and an undeclared one is refused HERE rather than
 * becoming an `undefined` two lookups deeper, where it would read as a salience
 * of zero, an event nobody can be blamed for, or a drive nobody feels.
 *
 * Refusals are COUNTED, not thrown. A world is data a host wrote, and a being
 * that is handed one fact it cannot place should not take the run down with it;
 * but a run in which this is non-zero is a run whose world and whose body
 * disagree, and the counts say exactly where. Nothing in the simulation reads
 * them — they are an instrument, like `ProvenanceLevel` — so a refusal cannot
 * steer anything.
 *
 * In the forager continent every count stays at 0: the adapter declares all 29
 * of that world's events (pinned in `test/world-tables-transcribed.test.ts`),
 * its four drives are the four the body has, and every mined rule is built out
 * of ids that came from the adapter in the first place.
 */
export interface WorldGateCounts {
  /** SimEvents whose type this world does not declare. No memory was formed. */
  readonly undeclaredEvent: number;
  /** Memories offered to a mind naming an event this world does not declare. */
  readonly undeclaredMemory: number;
  /** Pressures in a snapshot this world declares no drive for. Ignored. */
  readonly undeclaredDrive: number;
  /** Beliefs offered as testimony that name something undeclared. Not taken in. */
  readonly undeclaredTestimony: number;
}

/**
 * One gate per mind, so a count is attributable to the being that was handed
 * the thing. Deliberately a class with its own counters rather than a global:
 * two worlds run side by side in one process, and so do their diagnostics.
 */
export class WorldGate {
  private undeclaredEvent = 0;
  private undeclaredMemory = 0;
  private undeclaredDrive = 0;
  private undeclaredTestimony = 0;

  get counts(): WorldGateCounts {
    return {
      undeclaredEvent: this.undeclaredEvent,
      undeclaredMemory: this.undeclaredMemory,
      undeclaredDrive: this.undeclaredDrive,
      undeclaredTestimony: this.undeclaredTestimony,
    };
  }

  /** An event arriving from the body. Undefined = this world has no such event. */
  admitEvent(world: WorldAdapter, type: EventId): boolean {
    if (world.eventById.has(type)) return true;
    this.undeclaredEvent++;
    return false;
  }

  /** A memory offered to a mind — from the pipeline, or authored by a host. */
  admitMemory(world: WorldAdapter, memory: Pick<MemoryRecord, 'type'>): boolean {
    if (world.eventById.has(memory.type)) return true;
    this.undeclaredMemory++;
    return false;
  }

  /**
   * A being's own pressures, as the body reports them. Nothing is rewritten: a
   * pressure the world declares no drive for is already invisible to everything
   * that reads drives in declared order, and rewriting the snapshot would
   * change what a recorded think was built from. It is counted so that silence
   * is not the only evidence.
   */
  admitDrives(world: WorldAdapter, needs: DriveLevels): void {
    for (const id of Object.keys(needs)) {
      if (!world.drives.some((drive) => drive.id === id)) this.undeclaredDrive++;
    }
  }

  /**
   * A belief heard from someone else. Kinds are NOT checked — `WorldAdapter.
   * kinds` arrives at B3 and until then no world declares what things exist —
   * so this asks only about the ids a world does declare today.
   */
  admitTestimony(world: WorldAdapter, rule: KnowledgeRule): boolean {
    if (ruleIsDeclared(world, rule)) return true;
    this.undeclaredTestimony++;
    return false;
  }
}

function ruleIsDeclared(world: WorldAdapter, rule: KnowledgeRule): boolean {
  switch (rule.kind) {
    case 'context-association':
      return world.eventById.has(rule.event) && hasFeature(world, rule.feature);
    case 'succession':
      return world.eventById.has(rule.causeType) && world.eventById.has(rule.effectType);
    case 'outcome-association':
      return (
        world.eventById.has(rule.actionType) &&
        (rule.feature === null || hasFeature(world, rule.feature)) &&
        world.drives.some((drive) => drive.id === rule.need)
      );
    case 'social-contingency':
    case 'craft-recipe':
      // Neither names anything the adapter declares yet: a partner is a being,
      // and a recipe is made of kinds (B3).
      return true;
  }
}

function hasFeature(world: WorldAdapter, id: string): boolean {
  return world.context.some((feature) => feature.id === id);
}
