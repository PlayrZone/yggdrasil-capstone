import type { MemoryRecord, ObjectKind, SimEventType } from '../contract/types.js';
import { cosineSimilarity } from './IEmbedder.js';

export interface RetrievalQuery {
  tick: number;
  /** Optional situation embedding; without it relevance is neutral. */
  embedding?: Float32Array;
  limit: number;
}

/** Recency half-life: a memory loses half its recency every ~2000 ticks. */
const RECENCY_HALF_LIFE = 2000;

/**
 * How one kind of lived experience is keyed in the tally — the event type and
 * the object it was about, the same shape the miners key their cells by. The
 * two parts are split on the first ':'; neither vocabulary contains one.
 */
export function episodicKey(type: SimEventType, objectKind?: ObjectKind): string {
  return `${type}:${objectKind ?? '*'}`;
}

/**
 * Per-agent episodic store. Remembers; never reasons (V2 separation).
 *
 * The capped hot set is the ONLY tier of records: what falls out of it is
 * gone. Nothing ever retrieved an evicted record — `retrieve` and `recent`
 * read the hot set, and the one reader of a whole life (the archetype
 * classifier) wants counts, not records — so eviction folds the record into
 * `experienceCounts`, a bounded per-(type, object) tally of first-hand
 * experience that spans the whole life, and drops it. `totalCount` still
 * counts every memory ever formed.
 *
 * This is a footprint bound, not forgetting: what a being can recall is
 * exactly what it could recall before.
 */
export class MemoryStream {
  private records: MemoryRecord[] = [];
  private readonly byId = new Map<number, MemoryRecord>();
  private readonly counts = new Map<string, number>();
  private appended = 0;
  private nextId = 1;

  constructor(private readonly hotCapacity = 512) {}

  /** Assigns the id; everything else is caller-provided (deterministic). */
  append(record: Omit<MemoryRecord, 'id'>): MemoryRecord {
    const stored: MemoryRecord = { ...record, id: this.nextId++ };
    this.records.push(stored);
    this.byId.set(stored.id, stored);
    this.appended++;
    if (stored.origin === 'experience') {
      const key = episodicKey(stored.type, stored.objectKind);
      this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
    }
    if (this.records.length > this.hotCapacity) {
      // Evict the least-important oldest half-block.
      this.records.sort((a, b) => a.tick - b.tick || a.id - b.id);
      const evictCount = Math.floor(this.hotCapacity / 4);
      const evicted = this.records
        .slice(0, this.hotCapacity)
        .sort((a, b) => a.importance - b.importance || a.id - b.id)
        .slice(0, evictCount);
      const evictedIds = new Set(evicted.map((m) => m.id));
      for (const id of evictedIds) this.byId.delete(id);
      this.records = this.records.filter((m) => !evictedIds.has(m.id));
    }
    return stored;
  }

  retrieve(query: RetrievalQuery): MemoryRecord[] {
    const scored = this.records.map((m) => {
      const age = Math.max(0, query.tick - m.tick);
      const recency = Math.pow(0.5, age / RECENCY_HALF_LIFE);
      const relevance =
        query.embedding && m.embedding ? (1 + cosineSimilarity(query.embedding, m.embedding)) / 2 : 0.5;
      return { m, score: recency * m.importance * relevance };
    });
    scored.sort((a, b) => b.score - a.score || a.m.id - b.m.id);
    return scored.slice(0, query.limit).map((s) => s.m);
  }

  recent(n: number): MemoryRecord[] {
    return this.records.slice(-n);
  }

  /** O(1). `undefined` once the record has been evicted or released. */
  get(id: number): MemoryRecord | undefined {
    return this.byId.get(id);
  }

  /**
   * First-hand experiences over the WHOLE life, counted by `episodicKey` —
   * what survives eviction and death, and all the archetype classifier ever
   * needed from the records.
   */
  experienceCounts(): ReadonlyMap<string, number> {
    return this.counts;
  }

  /** The bound on the hot set — what `hotCount` is measured against. */
  get capacity(): number {
    return this.hotCapacity;
  }

  get hotCount(): number {
    return this.records.length;
  }

  /** Every memory ever formed, including the ones no longer held. */
  get totalCount(): number {
    return this.appended;
  }

  /**
   * Drop every held record. The tally and the counters survive, so what the
   * being DID stays readable for analysis; the records themselves do not.
   * Called once, at death (AgentMind.entomb) — nothing appends afterwards.
   */
  release(): void {
    this.records = [];
    this.byId.clear();
  }

  /** The records still held, in id order — for persistence and tests. */
  all(): MemoryRecord[] {
    return [...this.records].sort((a, b) => a.id - b.id);
  }
}
