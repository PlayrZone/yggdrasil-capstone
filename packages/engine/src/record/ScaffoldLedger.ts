import type { SimEvent } from '../contract/types.js';
import type { EventId } from '../contract/ids.js';
import type { ObjectKind } from '../worlds/forager/types.js';
import type { RunScaffoldSummary, ScaffoldEvent, ScaffoldKind, ScaffoldState } from './types.js';

/** Per-being authored events kept for the record; older ones fall off. */
const AUTHORED_EVENT_CAP = 16;
/** Per-being intervention timeline, for "what landed while it was thinking". */
const TIMELINE_CAP = 64;
/** Seeded-myth texts are quoted into the run summary; cap the quote length. */
const TEXT_CAP = 200;

interface BeingScaffold {
  /** Last tick of each kind of intervention aimed at this being. */
  last: Partial<Record<ScaffoldKind, number>>;
  seededRecipes: { output: ObjectKind; tick: number }[];
  ideas: number[];
  authoredEvents: { tick: number; type: EventId; actorId: number }[];
  /** Bounded recent timeline — read only over a think's short span. */
  timeline: ScaffoldEvent[];
}

/** The per-being fields the ledger owns; the recorder adds the run's own flags. */
export type BeingScaffoldState = Omit<
  ScaffoldState,
  'mythBehavior' | 'leadership' | 'offerMaking' | 'craftLearning'
>;

function emptyScaffold(): BeingScaffold {
  return { last: {}, seededRecipes: [], ideas: [], authoredEvents: [], timeline: [] };
}

/**
 * Every hand the researcher puts into a run, written down WITH ITS TICK.
 *
 * Drivers used to reach into bodies directly — `b.needs.hunger = 8`, a `bus.emit`
 * of a deed nobody did — so nothing in a captured act could say whether the
 * being was starving or had just been handed a full belly. That is the single
 * largest confound in the old corpus.
 *
 * Every read is AS OF a tick and ignores anything later, so a record can never
 * claim an intervention that had not happened when its prompt was built. Pure
 * bookkeeping: it reads nothing from the simulation and changes nothing in it.
 */
export class ScaffoldLedger {
  private readonly beings = new Map<number, BeingScaffold>();
  private readonly seededMythIds: { id: string; tick: number }[] = [];
  private needsProvisions = 0;
  private itemGrants = 0;
  private relocations = 0;
  private madeConsciousCount = 0;
  private readonly myths: RunScaffoldSummary['seededMyths'] = [];
  private readonly recipes: RunScaffoldSummary['seededRecipes'] = [];
  private readonly authored: RunScaffoldSummary['authoredEvents'] = [];
  private readonly ideas: RunScaffoldSummary['ideasGiven'] = [];

  provisionedNeeds(ids: Iterable<number>, tick: number): void {
    for (const id of ids) {
      this.note(id, 'needsProvisioned', tick);
      this.needsProvisions++;
    }
  }

  grantedItems(id: number, tick: number): void {
    this.note(id, 'itemsGranted', tick);
    this.itemGrants++;
  }

  relocated(id: number, tick: number): void {
    this.note(id, 'relocated', tick);
    this.relocations++;
  }

  seededMyth(narrativeId: string, text: string, ids: readonly number[], tick: number): void {
    if (!this.seededMythIds.some((m) => m.id === narrativeId)) this.seededMythIds.push({ id: narrativeId, tick });
    for (const id of ids) this.note(id, 'seededMyth', tick);
    this.myths.push({ id: narrativeId, text: text.slice(0, TEXT_CAP), agents: ids.length, tick });
  }

  seededRecipe(output: ObjectKind, ids: readonly number[], tick: number): void {
    for (const id of ids) {
      const s = this.note(id, 'seededRecipe', tick);
      if (!s.seededRecipes.some((r) => r.output === output)) s.seededRecipes.push({ output, tick });
    }
    this.recipes.push({ output, agents: ids.length, tick });
  }

  authoredEvent(event: SimEvent, witnessIds: readonly number[]): void {
    for (const id of witnessIds) {
      const s = this.note(id, 'authoredEvent', event.tick);
      s.authoredEvents.push({ tick: event.tick, type: event.type, actorId: event.actorId });
      if (s.authoredEvents.length > AUTHORED_EVENT_CAP) s.authoredEvents.shift();
    }
    this.authored.push({ tick: event.tick, type: event.type, actorId: event.actorId, witnesses: witnessIds.length });
  }

  gaveIdea(text: string, ids: readonly number[], tick: number): void {
    for (const id of ids) this.note(id, 'ideaGiven', tick).ideas.push(tick);
    this.ideas.push({ tick, text: text.slice(0, TEXT_CAP), reached: ids.length });
  }

  madeConscious(id: number, tick: number): void {
    const s = this.of(id);
    if (s.last.madeConscious !== undefined) return; // the first time is the fact
    this.note(id, 'madeConscious', tick);
    this.madeConsciousCount++;
  }

  /**
   * The scaffold in force for one being AS OF `tick`. `carries` is asked which
   * seeded tales this being actually holds — a myth seeded into others can
   * still reach it by retelling, and a myth seeded into it can be the tale it
   * never heard again.
   */
  beingState(id: number, tick: number, carries: (narrativeId: string) => boolean): BeingScaffoldState {
    const s = this.beings.get(id);
    // A future intervention is `null` ("it had not happened"), never 0 ("it just
    // happened") — the difference between a missing value and the loudest one.
    const since = (kind: ScaffoldKind): number | null => {
      const at = s?.last[kind];
      return at === undefined || at > tick ? null : tick - at;
    };
    return {
      needsProvisionedWithinTicks: since('needsProvisioned'),
      itemsGrantedWithinTicks: since('itemsGranted'),
      relocatedWithinTicks: since('relocated'),
      seededMyths: this.seededMythIds.filter((m) => m.tick <= tick && carries(m.id)).map((m) => m.id),
      authoredEvents: (s?.authoredEvents ?? []).filter((e) => e.tick <= tick).map((e) => ({ ...e })),
      seededRecipes: (s?.seededRecipes ?? []).filter((r) => r.tick <= tick).map((r) => r.output),
      ideasGiven: (s?.ideas ?? []).filter((t) => t <= tick).length,
      madeConsciousAtTick: s?.last.madeConscious !== undefined && s.last.madeConscious <= tick ? s.last.madeConscious : null,
    };
  }

  /** Interventions aimed at `id` in (after, upTo] — what landed mid-think. */
  interventionsBetween(id: number, after: number, upTo: number): ScaffoldEvent[] {
    const s = this.beings.get(id);
    if (!s) return [];
    return s.timeline.filter((e) => e.tick > after && e.tick <= upTo).map((e) => ({ ...e }));
  }

  summary(): RunScaffoldSummary {
    return {
      needsProvisions: this.needsProvisions,
      itemGrants: this.itemGrants,
      relocations: this.relocations,
      seededMyths: this.myths.map((m) => ({ ...m })),
      seededRecipes: this.recipes.map((r) => ({ ...r })),
      authoredEvents: this.authored.map((e) => ({ ...e })),
      ideasGiven: this.ideas.map((i) => ({ ...i })),
      madeConscious: this.madeConsciousCount,
    };
  }

  private note(id: number, kind: ScaffoldKind, tick: number): BeingScaffold {
    const s = this.of(id);
    s.last[kind] = tick;
    s.timeline.push({ tick, kind });
    if (s.timeline.length > TIMELINE_CAP) s.timeline.shift();
    return s;
  }

  private of(id: number): BeingScaffold {
    let s = this.beings.get(id);
    if (!s) this.beings.set(id, (s = emptyScaffold()));
    return s;
  }
}
