import type { MemoryRecord } from '../contract/types.js';
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
 * Per-agent episodic store. Remembers; never reasons (V2 separation).
 * Append-only — the run DB keeps everything; the in-memory hot set is
 * capped and old records fall into the archive (still iterable for the
 * runner's persistence, no longer retrieved).
 */
export class MemoryStream {
  private records: MemoryRecord[] = [];
  private archive: MemoryRecord[] = [];
  private nextId = 1;

  constructor(private readonly hotCapacity = 512) {}

  /** Assigns the id; everything else is caller-provided (deterministic). */
  append(record: Omit<MemoryRecord, 'id'>): MemoryRecord {
    const stored: MemoryRecord = { ...record, id: this.nextId++ };
    this.records.push(stored);
    if (this.records.length > this.hotCapacity) {
      // Evict the least-important oldest half-block to the archive.
      this.records.sort((a, b) => a.tick - b.tick || a.id - b.id);
      const evictCount = Math.floor(this.hotCapacity / 4);
      const evicted = this.records
        .slice(0, this.hotCapacity)
        .sort((a, b) => a.importance - b.importance || a.id - b.id)
        .slice(0, evictCount);
      const evictedIds = new Set(evicted.map((m) => m.id));
      this.archive.push(...evicted);
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

  get(id: number): MemoryRecord | undefined {
    return this.records.find((m) => m.id === id) ?? this.archive.find((m) => m.id === id);
  }

  get hotCount(): number {
    return this.records.length;
  }

  get totalCount(): number {
    return this.records.length + this.archive.length;
  }

  /** All records (hot + archive) in id order — for persistence and tests. */
  all(): MemoryRecord[] {
    return [...this.records, ...this.archive].sort((a, b) => a.id - b.id);
  }
}
