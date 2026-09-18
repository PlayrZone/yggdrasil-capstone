import type { EvidenceSnapshot, KnowledgeRule, MemoryRecord } from '../contract/types.js';

/**
 * What a miner asserts about one rule after looking at the evidence.
 * Confidence is computed by the miner (each family owns its math);
 * lifecycle/status is the KnowledgeStore's job.
 */
export interface EvidenceReport {
  rule: KnowledgeRule;
  confidence: number;
  evidenceCount: number;
  contradictionCount: number;
  sourceMemoryIds: number[];
  /** Self-describing form of the same episodes; absent when there are none. */
  provenance?: readonly EvidenceSnapshot[];
}

/**
 * A learner observes memories as they form (streaming counters) and emits
 * evidence reports at consolidation. Deterministic: same memory sequence
 * in, same reports out — learners participate in replay. Learners discover;
 * they never decide (V2 separation).
 */
export interface ILearner {
  observe(memory: MemoryRecord): void;
  consolidate(): EvidenceReport[];
}

/**
 * How much evidence a belief carries about itself. Provenance is an INSTRUMENT,
 * not part of the mind — nothing in the simulation reads it — so what it costs
 * is the host's choice. Total heap at 150 agents / day 16, against the 97.1 MB
 * of `3f70c03`, the commit before provenance existed:
 *
 *   'off'      98.5 MB (+1%, noise) — no snapshots at all. Bulk, headless and
 *              scale runs (1000+ beings, RL) want this.
 *   'compact'  114.5 MB (+18%) — first 1 / latest 1 / strongest 1, at most 3.
 *              THE DEFAULT: every belief that cites an episode can still show
 *              one, including the striking one.
 *   'full'     123.5 MB (+27%) — first 2 / latest 2 / strongest 2, at most 6.
 *              Observatory deep-dives, where a belief is argued both ways.
 *
 * Whichever level is in force, `sourceMemoryIds` and every simulated outcome
 * are identical: `test/provenance.test.ts` runs a golden config at all three
 * and asserts one fingerprint.
 */
export type ProvenanceLevel = 'off' | 'compact' | 'full';

/**
 * Project a memory into the compact form a belief can keep. Built field by
 * field with no conditional keys, so every snapshot in the run shares one
 * hidden class.
 *
 * NOT memoized. An earlier version cached one snapshot per memory in a WeakMap
 * so that an episode feeding many rules was stored once — but a WeakMap holds
 * its value for as long as the KEY lives, so every record in every hot tier
 * carried a snapshot whether or not a single rule had kept it. Measured at 150
 * agents / day 16: clearing every one of the 28 680 sample slots freed 0.5 MB,
 * because the cache was holding the objects anyway. Snapshots are now taken
 * only where one is actually placed, and the ones that rotate out of a slot
 * become garbage immediately.
 */
export function snapshotOf(memory: MemoryRecord): EvidenceSnapshot {
  return {
    memoryId: memory.id,
    tick: memory.tick,
    type: memory.type,
    objectKind: memory.objectKind,
    outcome: memory.outcome,
    origin: memory.origin,
    toldBy: memory.toldBy,
    causedBy: memory.causedBy,
    // Aliased, not copied: a stored MemoryRecord is never mutated, and this
    // keeps a two-element array alive rather than the record behind it.
    subjects: memory.subjects,
    x: memory.x,
    y: memory.y,
    importance: memory.importance,
  };
}

/**
 * A bounded, deterministic sample of the episodes behind one rule, kept two
 * ways.
 *
 * `ids()` is the long-standing citation — first 4 + latest 4, unchanged, and
 * still what `sourceMemoryIds` stores. Those ids dangle once the memories are
 * evicted or released, which is why the second form exists.
 *
 * `snapshots()` is the self-describing form, and it is deliberately SMALLER
 * rather than a snapshot per cited id: an episode costs a hundred times what an
 * id costs, and the extra copies buy nothing. It keeps the 2 earliest (what the
 * belief was born of), the 2 latest (what still sustains it) and the 2 most
 * IMPORTANT ever seen — because first-and-latest is a poor answer to "why do
 * you believe that?"; the one striking episode that made the belief, a
 * poisoning or a killing, is usually neither. Importance is the engine's own
 * deterministic salience, ties broken by the LOWER memory id, so the choice
 * replays. Six at most, each appearing once.
 *
 * How many of each it keeps is the `ProvenanceLevel`: one apiece by default,
 * two at 'full', none at 'off'. The slots are named fields rather than three
 * arrays, and a snapshot is built only for a memory that actually takes one —
 * a mind keeps ~160 of these cells and sees far more episodes than it keeps.
 */
export class ProvenanceSample {
  constructor(private readonly level: ProvenanceLevel = 'compact') {}

  private firstIds: number[] = [];
  private lastIds: number[] = [];
  private first0: EvidenceSnapshot | undefined;
  private first1: EvidenceSnapshot | undefined;
  private last0: EvidenceSnapshot | undefined;
  private last1: EvidenceSnapshot | undefined;
  private strong0: EvidenceSnapshot | undefined;
  private strong1: EvidenceSnapshot | undefined;

  /** Placement is decided from the record; the projection is made if it lands. */
  add(memory: MemoryRecord): void {
    let taken: EvidenceSnapshot | undefined;
    const take = (): EvidenceSnapshot => (taken ??= snapshotOf(memory));
    this.place(memory.id, memory.importance, take);
  }

  /**
   * For evidence whose episode is no longer in hand — the succession miner
   * credits a cause when the EFFECT arrives, by which time it holds only what
   * it kept of the cause.
   */
  addSnapshot(snapshot: EvidenceSnapshot): void {
    this.place(snapshot.memoryId, snapshot.importance, () => snapshot);
  }

  private place(memoryId: number, importance: number, take: () => EvidenceSnapshot): void {
    // The ids are the record's citation and do not depend on the level, so the
    // simulation cannot tell which level is in force.
    const wide = this.level === 'full';
    if (this.firstIds.length < 4) {
      this.firstIds.push(memoryId);
      if (this.level === 'off') return;
      if (this.first0 === undefined) this.first0 = take();
      else if (wide && this.first1 === undefined) this.first1 = take();
    } else {
      this.lastIds.push(memoryId);
      if (this.lastIds.length > 4) this.lastIds.shift();
      if (this.level === 'off') return;
      if (wide) this.last0 = this.last1;
      this.last1 = take();
    }
    this.keepIfStrong(memoryId, importance, take, wide);
  }

  /** Strongest first. Equal salience is broken by the earlier memory. */
  private keepIfStrong(memoryId: number, importance: number, take: () => EvidenceSnapshot, wide: boolean): void {
    if (memoryId === this.strong0?.memoryId || memoryId === this.strong1?.memoryId) return;
    const beats = (other: EvidenceSnapshot): boolean =>
      importance > other.importance || (importance === other.importance && memoryId < other.memoryId);
    if (this.strong0 === undefined || beats(this.strong0)) {
      if (wide) this.strong1 = this.strong0;
      this.strong0 = take();
    } else if (wide && (this.strong1 === undefined || beats(this.strong1))) {
      this.strong1 = take();
    }
  }

  ids(): number[] {
    return [...this.firstIds, ...this.lastIds];
  }

  /** The sampled episodes themselves, oldest first, each appearing once. */
  snapshots(): EvidenceSnapshot[] {
    const seen = new Set<number>();
    const out: EvidenceSnapshot[] = [];
    for (const s of [this.first0, this.first1, this.last0, this.last1, this.strong0, this.strong1]) {
      if (s === undefined || seen.has(s.memoryId)) continue;
      seen.add(s.memoryId);
      out.push(s);
    }
    return out.sort((a, b) => a.memoryId - b.memoryId);
  }
}
