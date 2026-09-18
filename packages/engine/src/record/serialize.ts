import type { MemoryRecord, ThinkInput } from '../contract/types.js';
import type { SerializedMemoryRecord, SerializedThinkInput } from './types.js';

/**
 * A ThinkInput frozen into plain, JSON-safe data. It copies rather than
 * references for two reasons: a memory's retrieval embedding is a typed array
 * JSON drops, and knowledge/memory/relationship records are LIVE objects the
 * miners keep mutating — a record that aliased them would quietly rewrite its
 * own history between the think and the moment anyone read it.
 */
export function serializeThinkInput(input: ThinkInput): SerializedThinkInput {
  const { relationships, recalledMemories, ...rest } = input;
  return snapshotJson({
    ...rest,
    relationships: [...relationships.entries()],
    recalledMemories: recalledMemories.map(serializeMemory),
  });
}

/** The inverse — what a replay hands back to `buildThinkPrompt`. */
export function deserializeThinkInput(stored: SerializedThinkInput): ThinkInput {
  const { relationships, recalledMemories, ...rest } = stored;
  return {
    ...rest,
    relationships: new Map(relationships.map(([id, r]) => [id, { ...r }])),
    recalledMemories: recalledMemories.map(deserializeMemory),
  };
}

/**
 * Deep copy through JSON. These are plain data of finite numbers, and JSON is
 * exactly the shape the sink writes — so what a record holds in memory is what
 * lands on disk, with no second serialization to drift from it.
 */
export function snapshotJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function serializeMemory(m: MemoryRecord): SerializedMemoryRecord {
  const { embedding, ...rest } = m;
  return embedding ? { ...rest, embedding: Array.from(embedding) } : { ...rest };
}

function deserializeMemory(m: SerializedMemoryRecord): MemoryRecord {
  const { embedding, ...rest } = m;
  return embedding ? { ...rest, embedding: Float32Array.from(embedding) } : { ...rest };
}
