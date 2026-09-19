import { checkIntent } from './actions.js';
import type { WorldAdapter } from './adapter.js';
import type { DriveLevels, EventId } from './ids.js';
import type { Intent, KnowledgeRule, MemoryRecord } from './types.js';

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
  /** Intents naming an action this world does not declare. Not handed to the body. */
  readonly undeclaredAction: number;
  /** Intents carrying an argument the action cannot take, or a value it cannot mean. */
  readonly badParam: number;
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
  private undeclaredAction = 0;
  private badParam = 0;

  get counts(): WorldGateCounts {
    return {
      undeclaredEvent: this.undeclaredEvent,
      undeclaredMemory: this.undeclaredMemory,
      undeclaredDrive: this.undeclaredDrive,
      undeclaredTestimony: this.undeclaredTestimony,
      undeclaredAction: this.undeclaredAction,
      badParam: this.badParam,
    };
  }

  /**
   * THE OUTBOUND EDGE (W1-B3): one step of a plan, on its way from a mind to
   * the body. Until now a plan crossed on a single narrowing cast — the mind
   * held opaque ids and the body executed this world's own narrow kinds, and
   * nothing asked whether the two agreed. An intent this world cannot mean is
   * refused HERE: past this point the body would either act on something the
   * world does not contain or silently drop the part of the decision it could
   * not read, which is the class of bug `bad-arg` exists to stop in the parser.
   *
   * The rest of the plan is unaffected — a being that asks for one impossible
   * thing still does the others. Zero on every count in the forager world: its
   * reflex policy and its parser both speak the adapter's own vocabulary.
   */
  admitIntent(world: WorldAdapter, intent: Intent): boolean {
    const refusal = checkIntent(world, intent);
    if (refusal === null) return true;
    if (refusal === 'undeclared-action') this.undeclaredAction++;
    else this.badParam++;
    return false;
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
   * A belief heard from someone else. Every id it names is asked about,
   * KINDS INCLUDED from W1-B3: a recipe for a thing this world does not contain
   * could never be made, reinforced or contradicted, so taking it in would fill
   * the store with unfalsifiable hearsay. Zero in the forager world, whose
   * recipes come out of `CRAFT_RECIPES` and whose objects the adapter declares.
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
      return (
        world.eventById.has(rule.event) && hasFeature(world, rule.feature) && hasKind(world, rule.objectKind)
      );
    case 'succession':
      return (
        world.eventById.has(rule.causeType) &&
        world.eventById.has(rule.effectType) &&
        hasKind(world, rule.causeObject) &&
        hasKind(world, rule.effectObject)
      );
    case 'outcome-association':
      return (
        world.eventById.has(rule.actionType) &&
        (rule.feature === null || hasFeature(world, rule.feature)) &&
        world.drives.some((drive) => drive.id === rule.need)
      );
    case 'social-contingency':
      // Names nothing the adapter declares: a partner is a being.
      return true;
    case 'craft-recipe':
      return hasKind(world, rule.output) && Object.keys(rule.inputs).every((id) => hasKind(world, id));
  }
}

function hasFeature(world: WorldAdapter, id: string): boolean {
  return world.context.some((feature) => feature.id === id);
}

/** Absent is fine — a rule that names no thing names no undeclared thing. */
function hasKind(world: WorldAdapter, id: string | undefined): boolean {
  return id === undefined || world.kindById.has(id);
}
