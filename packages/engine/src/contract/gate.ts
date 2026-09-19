import { checkIntent } from './actions.js';
import type { PlaceTest } from './actions.js';
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
 * In the forager continent every REFUSAL count stays at 0: the adapter declares
 * all 29 of that world's events (pinned in `test/world-tables-transcribed.test.ts`),
 * its four drives are the four the body has, and every mined rule is built out
 * of ids that came from the adapter in the first place. `deferredParam` is the
 * exception and is not a refusal: it counts what a MODEL offered that this
 * world's acts do not declare, and the body still answers for every one.
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
  /**
   * Intents carrying an argument the action cannot take, or a value it cannot
   * mean, REFUSED — which happens only in a world that set `strictArgs`.
   */
  readonly badParam: number;
  /**
   * The same thing HANDED OVER, in a world that did not. The body answers for
   * it there, so this counts a tolerance rather than a fault: non-zero says a
   * mind is offering arguments its world's acts do not declare (the commonest
   * thing a model gets wrong), and zero is what a reflex run reads.
   */
  readonly deferredParam: number;
  /**
   * Slots in a HOST-AUTHORED event's payload holding a need-change no being
   * could feel, rewritten to 0 on their way in (W1-B3 verifier, backlog 5).
   */
  readonly authoredClamp: number;
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
  private deferredParam = 0;
  private authoredClamp = 0;

  get counts(): WorldGateCounts {
    return {
      undeclaredEvent: this.undeclaredEvent,
      undeclaredMemory: this.undeclaredMemory,
      undeclaredDrive: this.undeclaredDrive,
      undeclaredTestimony: this.undeclaredTestimony,
      undeclaredAction: this.undeclaredAction,
      badParam: this.badParam,
      deferredParam: this.deferredParam,
      authoredClamp: this.authoredClamp,
    };
  }

  /**
   * THE OUTBOUND EDGE (W1-B3): one step of a plan, on its way from a mind to
   * the body. A plan crosses carrying opaque ids and the body executes this
   * world's own narrow kinds, so something has to say the two agree.
   *
   * WHAT IS REFUSED HERE IS AN UNDECLARED ACTION, and only that. It is
   * unreachable from any engine path — this world's parser checks `kind`
   * against the same table, its reflex policy emits only the acts it was given,
   * and speech is composed from `actionForCore(Say)` — and every recorded run
   * is byte-identical with it in place.
   *
   * It does CHANGE THE MECHANISM, and the earlier claim that it "changes
   * nothing that could otherwise have happened" was wrong (W1-B3 verifier,
   * round 2, backlog 1). The body's dispatch has no arm for an undeclared act,
   * so before this gate existed such a step did not fall through: the being
   * STALLED on it forever (`planStep` frozen, `intentTicks` climbing, no
   * events). Refusing it here skips the step and lets the rest of the plan run,
   * which is better — but it is a different outcome, not the same one.
   *
   * AN UNDECLARED ARGUMENT IS NOT REFUSED unless the world asked for that
   * (`WorldAdapter.strictArgs`). This is the W1-B3 verifier's one FAIL: in a
   * world whose body answers for itself, `Eat{targetId}` reached the body and
   * came back as five remembered `IntentRejected`s, and dropping it here
   * deleted them — the being was left never having tried. What a step CAN be
   * refused for at the edge is therefore a property of the world, not a habit
   * of this class, and both ways through are counted.
   *
   * The rest of the plan is unaffected either way — a being that asks for one
   * impossible thing still does the others.
   *
   * WHETHER A VALUE IS A PLACE IS HANDED IN (round 4). Only a world's codec can
   * answer it, a gate belongs to a MIND, and a mind may not hold a codec — so
   * the caller that holds the world's edges supplies `edges.codec.isPlace`. It
   * is required rather than optional on purpose: a default would be a silent
   * "every place is fine", which is the answer this exists to stop giving.
   */
  admitIntent(world: WorldAdapter, intent: Intent, isPlace: PlaceTest): boolean {
    const refusal = checkIntent(world, intent, isPlace);
    if (refusal === null) return true;
    if (refusal === 'undeclared-action') {
      this.undeclaredAction++;
      return false;
    }
    if (!world.strictArgs) {
      this.deferredParam++;
      return true;
    }
    this.badParam++;
    return false;
  }

  /**
   * A need-change a host authored that no being could feel (`undefined`, a
   * word, `NaN`), on its way to being rewritten as 0 by `Interventions`. The
   * rewrite is right — a deed nobody can measure moved nothing, and a `NaN`
   * importance makes one being's eviction order depend on the JS engine's sort
   * — but it was completely silent, so a run could differ from what its driver
   * wrote with nothing anywhere saying so (W1-B3 verifier, backlog 5).
   */
  noteAuthoredClamp(): void {
    this.authoredClamp++;
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
