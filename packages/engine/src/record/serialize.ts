import type { WorldAdapter } from '../contract/adapter.js';
import { inlinePlace, liftPlace } from '../contract/wire.js';
import type {
  AgentSnapshot,
  KnowledgeRecord,
  MemoryRecord,
  ObservedAgent,
  ObservedResource,
  ObservedStructure,
  ThinkInput,
  WorldView,
} from '../contract/types.js';
import type {
  AttemptPromptDelta,
  CognitionAttempt,
  CognitionRecordV2,
  NonFiniteSubstitution,
  NonFiniteToken,
  SerializedKnowledgeRecord,
  SerializedMemoryRecord,
  SerializedThinkInput,
} from './types.js';

/**
 * A ThinkInput frozen into plain, JSON-safe data. It copies rather than
 * references for two reasons: a memory's retrieval embedding is a typed array
 * JSON drops, and knowledge/memory/relationship records are LIVE objects the
 * miners keep mutating — a record that aliased them would quietly rewrite its
 * own history between the think and the moment anyone read it.
 *
 * NUMBER POLICY, defined once. A row must replay to the bytes that were SENT,
 * so a number JSON cannot hold is not coerced away — it is stored as `0` (which
 * keeps the row valid JSON and readable by anything) with the token it stands
 * for in `nonFinite`, and `deserializeThinkInput` puts it back before the
 * prompt is rebuilt. `NaN`, `±Infinity` and `-0` all take this path: the first
 * three change rendered bytes ("hunger NaN", "berry×Infinity"), `-0` does not,
 * but a round-trip that silently turned it into `0` would still be lossy.
 *
 * `nonFinite` entries also mark the row as lossy in MEANING for anything that
 * reads the stored numbers straight off disk (a miner bucketing needs sees the
 * placeholder `0`, not the NaN the being actually thought under).
 */
export function serializeThinkInput(input: ThinkInput): SerializedThinkInput {
  const { relationships, recalledMemories, knowledge, ...rest } = input;
  const nonFinite: NonFiniteSubstitution[] = [];
  const frozen = freezeJson(
    {
      // EVERY PLACE WRITTEN BACK AS THE WORLD'S OWN FIELDS, where they have
      // always been (W1-B4). A `PlaceRef`'s runtime value IS those fields, so
      // this needs no adapter and the row is byte-identical to one recorded
      // before the mind stopped holding coordinates — `COGNITION_SCHEMA_VERSION`
      // is unchanged because a v3 row still means exactly one thing.
      // `sacredPlace`/`tragedyPlaces` are places themselves rather than records
      // carrying one, so they store as they always did, untouched.
      //
      // WRITTEN IN THE INPUT'S OWN KEY ORDER, which is why this walks `rest`
      // rather than naming the two fields it rewrites: pulling `snapshot` out
      // and putting it back would move it to the end of the row, and a row's
      // key order is part of what "byte-identical" means.
      ...withPlacesWritten(rest),
      knowledge: knowledge.map(serializeKnowledge),
      relationships: [...relationships.entries()],
      recalledMemories: recalledMemories.map(serializeMemory),
    } as unknown as SerializedThinkInput,
    (substitution) => nonFinite.push(substitution),
  );
  return nonFinite.length > 0 ? { ...frozen, nonFinite } : frozen;
}

/**
 * The inverse — what a replay hands back to `buildThinkPrompt`.
 *
 * `world` is what turns the stored fields back into opaque places, and only it
 * knows which fields those were. It is OPTIONAL for one reason, written down
 * rather than left to be discovered: a caller that only reads what a being was
 * shown — its needs, its knowledge, what it perceived — does not need a place
 * at all, and requiring an adapter would break every such caller for nothing.
 * Without one the input carries no places and `buildThinkPrompt` renders no
 * pull toward a story's site; with one the replay is byte-identical.
 */
export function deserializeThinkInput(stored: SerializedThinkInput, world?: WorldAdapter): ThinkInput {
  // Substitutions are written back in place, so a row that carries any is copied
  // first: a caller's stored record must not be mutated, and replaying the same
  // row twice must find its placeholders where it left them.
  const source = stored.nonFinite && stored.nonFinite.length > 0 ? snapshotJson(stored) : stored;
  const restored = restoreNonFinite(source);
  assertReplayable(source, restored, world);
  const { relationships, recalledMemories, nonFinite: _nonFinite, ...rest } = source;
  const lift = <T>(row: Record<string, unknown>): T => (world ? liftPlace<T>(world, row) : (row as T));
  return {
    // Key order kept, as on the way out: a row read and written again is the
    // same row.
    ...(withPlacesLifted(rest, lift) as unknown as Omit<ThinkInput, 'relationships' | 'recalledMemories'>),
    relationships: new Map(relationships.map(([id, r]) => [id, { ...r }])),
    recalledMemories: recalledMemories.map((m) => deserializeMemory(m, lift)),
  };
}

/** The records of a think input that CARRY a place, with it written out. */
function withPlacesWritten(rest: Omit<ThinkInput, 'relationships' | 'recalledMemories' | 'knowledge'>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rest)) {
    if (key === 'snapshot') out[key] = inlinePlace(value as AgentSnapshot);
    else if (key === 'worldView') {
      const seen = value as WorldView;
      out[key] = {
        ...seen,
        agents: seen.agents.map(inlinePlace),
        resources: seen.resources.map(inlinePlace),
        structures: seen.structures.map(inlinePlace),
      };
    } else out[key] = value;
  }
  return out;
}

/** …and back. */
function withPlacesLifted(
  rest: Record<string, unknown>,
  lift: <T>(row: Record<string, unknown>) => T,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rest)) {
    if (key === 'snapshot') out[key] = lift<AgentSnapshot>(value as Record<string, unknown>);
    else if (key === 'worldView') {
      const seen = value as { agents: unknown[]; resources: unknown[]; structures: unknown[] };
      out[key] = {
        ...seen,
        agents: seen.agents.map((a) => lift<ObservedAgent>(a as Record<string, unknown>)),
        resources: seen.resources.map((r) => lift<ObservedResource>(r as Record<string, unknown>)),
        structures: seen.structures.map((s) => lift<ObservedStructure>(s as Record<string, unknown>)),
      };
    } else out[key] = value;
  }
  return out;
}

/**
 * Deep copy through JSON. These are plain data of finite numbers, and JSON is
 * exactly the shape the sink writes — so what a record holds in memory is what
 * lands on disk, with no second serialization to drift from it.
 */
export function snapshotJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * What this attempt's messages add to the record's base prompt, or undefined
 * when they ARE the base prompt. A retry only ever appends to the user turn, so
 * that is the cheap case; anything else is stored verbatim rather than guessed
 * at, because replay must be byte-identical either way.
 */
export function attemptPromptDelta(
  base: { system: string; user: string },
  sent: { system: string; user: string },
): AttemptPromptDelta | undefined {
  if (sent.system === base.system && sent.user === base.user) return undefined;
  if (sent.system === base.system && sent.user.startsWith(base.user)) {
    return { userSuffix: sent.user.slice(base.user.length) };
  }
  return { full: { system: sent.system, user: sent.user } };
}

/** The exact messages an attempt was sent, rebuilt byte-for-byte. */
export function attemptPrompt(
  record: Pick<CognitionRecordV2, 'prompt'>,
  attempt: CognitionAttempt,
): { system: string; user: string } {
  const delta = attempt.promptDelta;
  if (!delta) return { ...record.prompt };
  if ('full' in delta) return { ...delta.full };
  return { system: record.prompt.system, user: `${record.prompt.user}${delta.userSuffix}` };
}

/**
 * Knowledge as a row stores it. `provenance` — up to six evidence snapshots per
 * belief — is bookkeeping: `buildThinkPrompt` renders only id, confidence,
 * evidenceCount, statement, origin and status, so not one of its bytes ever
 * reached the model. A corpus row is what the mind SAW and what happened next,
 * and carrying it made a populated row nearly twice its own size.
 */
function serializeKnowledge(k: KnowledgeRecord): SerializedKnowledgeRecord {
  const { provenance: _provenance, ...rest } = k;
  return rest;
}

function serializeMemory(m: MemoryRecord): SerializedMemoryRecord {
  const { embedding, ...rest } = m;
  const written = inlinePlace(rest);
  if (embedding) written['embedding'] = Array.from(embedding);
  return written as unknown as SerializedMemoryRecord;
}

function deserializeMemory(
  m: SerializedMemoryRecord,
  lift: <T>(row: Record<string, unknown>) => T,
): MemoryRecord {
  const { embedding, ...rest } = m;
  const record = lift<MemoryRecord>(rest as Record<string, unknown>);
  return embedding ? { ...record, embedding: Float32Array.from(embedding as number[]) } : record;
}

const NON_FINITE: Record<NonFiniteToken, number> = {
  NaN: Number.NaN,
  Infinity: Number.POSITIVE_INFINITY,
  '-Infinity': Number.NEGATIVE_INFINITY,
  '-0': -0,
};

function nonFiniteToken(v: number): NonFiniteToken | undefined {
  if (Number.isNaN(v)) return 'NaN';
  if (v === Number.POSITIVE_INFINITY) return 'Infinity';
  if (v === Number.NEGATIVE_INFINITY) return '-Infinity';
  return Object.is(v, -0) ? '-0' : undefined;
}

/**
 * `snapshotJson` with two additions: a number JSON cannot hold becomes `0` and
 * the token it stood for is reported with its path. The path is assembled from
 * the replacer's holder — parents are always visited before their children, so
 * a holder's path is known by the time its keys are.
 */
function freezeJson<T>(value: T, onNonFinite: (substitution: NonFiniteSubstitution) => void): T {
  const paths = new WeakMap<object, string>();
  const json = JSON.stringify(value, function pathed(this: unknown, key: string, v: unknown): unknown {
    const holder = this as object;
    const path = key === '' ? '$' : Array.isArray(holder) ? `${paths.get(holder) ?? '$'}[${key}]` : `${paths.get(holder) ?? '$'}.${key}`;
    if (v !== null && typeof v === 'object') paths.set(v as object, path);
    if (typeof v === 'number') {
      const token = nonFiniteToken(v);
      if (token !== undefined) {
        onNonFinite({ path, value: token });
        return 0;
      }
    }
    return v;
  });
  return JSON.parse(json) as T;
}

/**
 * Puts back the numbers the placeholders stand for, so what replays is what was
 * sent. Returns the paths actually restored — `assertReplayable` needs to tell a
 * non-finite number the row FAITHFULLY carried from one it LOST.
 *
 * A path that does not resolve onto a stored `0` means the row and its
 * side-channel disagree, and it throws rather than writing somewhere else: a
 * lossless record may fail, but it may not quietly put a NaN in the wrong field.
 */
function restoreNonFinite(stored: SerializedThinkInput): ReadonlySet<string> {
  const restored = new Set<string>();
  for (const { path, value } of stored.nonFinite ?? []) {
    const at = resolvePath(stored, path);
    if (!at || !(at.key in at.holder) || at.holder[at.key] !== 0) {
      throw new Error(
        `cognition record: nonFinite path ${path} does not name a substituted number — the row cannot be replayed`,
      );
    }
    at.holder[at.key] = NON_FINITE[value];
    restored.add(path);
  }
  return restored;
}

/** `.key` or `[index]`, in `freezeJson`'s own path syntax. */
const PATH_SEGMENT = /^(?:\.([^.[\]]+)|\[(\d+)\])/;

function pathSegments(path: string): string[] | null {
  if (!path.startsWith('$')) return null;
  const segments: string[] = [];
  for (let at = 1; at < path.length; ) {
    const match = PATH_SEGMENT.exec(path.slice(at));
    if (!match) return null;
    segments.push(match[1] ?? match[2]!);
    at += match[0].length;
  }
  return segments.length > 0 ? segments : null;
}

function resolvePath(root: object, path: string): { holder: Record<string, number>; key: string } | null {
  const segments = pathSegments(path);
  if (!segments) return null;
  let holder: unknown = root;
  for (let i = 0; i < segments.length - 1; i++) {
    if (holder === null || typeof holder !== 'object') return null;
    holder = (holder as Record<string, unknown>)[segments[i]!];
  }
  if (holder === null || typeof holder !== 'object') return null;
  // Narrowed to the one thing a leaf may be: the numeric slot a `0` sits in.
  return { holder: holder as Record<string, number>, key: segments[segments.length - 1]! };
}

/**
 * The numbers `buildThinkPrompt` formats. A stored `null` in any of them threw
 * a bare TypeError from the middle of the prompt builder; this names the field
 * instead, so an unreplayable row is diagnosable rather than mysterious.
 *
 * A non-finite number that `nonFinite` carried and `restoreNonFinite` put back
 * is NOT a failure — it is the value the prompt was built from, so refusing it
 * would refuse the very rows this record exists to preserve. Only a number that
 * was genuinely lost — stored `null`, or a field that is not there at all — is.
 */
function assertReplayable(
  stored: SerializedThinkInput,
  restored: ReadonlySet<string>,
  world: WorldAdapter | undefined,
): void {
  const num = (v: unknown, path: string, label = path.slice(2)): void => {
    if (typeof v === 'number' && (Number.isFinite(v) || restored.has(path))) return;
    throw new Error(`cognition record: ${label} is ${String(v)}, not a finite number — the row cannot be replayed`);
  };
  // WHICH FIELDS A PLACE IS, AND THEIR ORDER, ARE THE WORLD'S (W1-B4) — the
  // paths are unchanged for the forager plane (`$.snapshot.x`, `$.sacredPlace.y`)
  // because those are the fields it writes a place with. Checked as STORED,
  // because that is the form `nonFinite` names and the form a row is read from.
  const numbersIn = (row: Record<string, unknown> | undefined, at: string): void => {
    if (!row || !world) return;
    for (const field of world.space.fields) num(row[field.id], `${at}.${field.id}`);
  };
  const s = stored.snapshot as unknown as Record<string, unknown>;
  numbersIn(s, '$.snapshot');
  num(s['health'], '$.snapshot.health');
  num(s['ageTicks'], '$.snapshot.ageTicks');
  // Every pressure this world declares. The four named by hand here were the
  // forager's, and a world with others simply went unchecked.
  for (const drive of world?.drives ?? []) {
    num((s['needs'] as Record<string, unknown> | undefined)?.[drive.id], `$.snapshot.needs.${drive.id}`);
  }
  for (const [key, value] of Object.entries((s['traits'] ?? {}) as Record<string, unknown>)) {
    num(value, `$.snapshot.traits.${key}`);
  }
  // An inventory count renders too, and a lost one drops the item from the line
  // silently rather than throwing — the quietest way for a replay to differ.
  for (const [key, value] of Object.entries((s['inventory'] ?? {}) as Record<string, unknown>)) {
    num(value, `$.snapshot.inventory.${key}`);
  }
  num(stored.worldView?.tick, '$.worldView.tick');
  stored.knowledge.forEach((k, i) => {
    num(k.confidence, `$.knowledge[${i}].confidence`, `knowledge[${k.id}].confidence`);
    num(k.evidenceCount, `$.knowledge[${i}].evidenceCount`, `knowledge[${k.id}].evidenceCount`);
  });
  numbersIn(stored.sacredPlace as Record<string, unknown> | undefined, '$.sacredPlace');
}
