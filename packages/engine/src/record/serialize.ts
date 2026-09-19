import type { WorldAdapter } from '../contract/adapter.js';
import { codecFor } from '../contract/space.js';
import type { PlaceRef } from '../contract/space.js';
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
  PeekedMemoryRecord,
  SerializedKnowledgeRecord,
  SerializedMemoryRecord,
  SerializedThinkInput,
  UnvalidatedThinkInput,
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
export function serializeThinkInput(input: ThinkInput, world: WorldAdapter): SerializedThinkInput {
  const { relationships, recalledMemories, knowledge, ...rest } = input;
  const nonFinite: NonFiniteSubstitution[] = [];
  const frozen = freezeJson(
    {
      // EVERY PLACE WRITTEN BACK AS THE WORLD'S OWN FIELDS, where they have
      // always been (W1-B4). THE WORLD writes them — `space.encode`, the one
      // reviewed serialisation seam — rather than this file prising the handle
      // open itself, which is what it did until the W1-B4 verifier pointed out
      // that "a place's runtime value is its wire form" was an unstated
      // invariant of one world (backlog 5). For the forager plane the bytes are
      // unchanged, so `COGNITION_SCHEMA_VERSION` is still 3 and a v3 row still
      // means exactly one thing.
      // `sacredPlace`/`tragedyPlaces` are places themselves rather than records
      // carrying one; their runtime value IS what the world writes, so they
      // store as they always did and `withPlacesLifted` asks `space.decode` for
      // the handle back.
      //
      // WRITTEN IN THE INPUT'S OWN KEY ORDER, which is why this walks `rest`
      // rather than naming the two fields it rewrites: pulling `snapshot` out
      // and putting it back would move it to the end of the row, and a row's
      // key order is part of what "byte-identical" means.
      ...withPlacesWritten(rest, world),
      knowledge: knowledge.map(serializeKnowledge),
      relationships: [...relationships.entries()],
      recalledMemories: recalledMemories.map((m) => serializeMemory(m, world)),
    } as unknown as SerializedThinkInput,
    (substitution) => nonFinite.push(substitution),
  );
  return nonFinite.length > 0 ? { ...frozen, nonFinite } : frozen;
}

/**
 * The inverse — what a replay hands back to `buildThinkPrompt`.
 *
 * THE WORLD IS REQUIRED, and that is the whole of the W1-B4 verifier's round-2
 * FAIL 4 (and round 1's backlog 7). It was optional, and the convenience cost
 * more than it was worth twice over: only the world knows which stored fields
 * were a place, so a world-less read handed back a `ThinkInput` whose places
 * were raw wire data wearing the handle's type; and `assertReplayable` reads
 * which fields those are and which pressures exist off the same world, so with
 * no world it checked neither — four row shapes that `c727af7` refused replayed
 * silently.
 *
 * A caller that holds a row from a world this process does not have wants
 * `peekThinkInput`, which says so in its return type.
 *
 * What it refuses is now a superset of what `c727af7` refused: the same
 * snapshot numbers, the same needs (every drive the WORLD declares rather than
 * four names typed out here), the same knowledge numbers, the same sacred
 * place — plus every place in `tragedyPlaces`, which nothing checked before and
 * which `wander` reads on the reflex path.
 */
export function deserializeThinkInput(stored: SerializedThinkInput, world: WorldAdapter): ThinkInput {
  // Substitutions are written back in place, so a row that carries any is copied
  // first: a caller's stored record must not be mutated, and replaying the same
  // row twice must find its placeholders where it left them.
  const source = stored.nonFinite && stored.nonFinite.length > 0 ? snapshotJson(stored) : stored;
  const restored = restoreNonFinite(source);
  assertReplayable(source, restored, world);
  const { relationships, recalledMemories, nonFinite: _nonFinite, ...rest } = source;
  const lift = <T>(row: Record<string, unknown>): T => liftPlace<T>(world, row);
  return {
    // Key order kept, as on the way out: a row read and written again is the
    // same row.
    ...(withPlacesLifted(rest, lift, world) as unknown as Omit<ThinkInput, 'relationships' | 'recalledMemories'>),
    relationships: new Map(relationships.map(([id, r]) => [id, { ...r }])),
    recalledMemories: recalledMemories.map((m) => deserializeMemory(m, lift)),
  };
}

/**
 * A ROW READ WITHOUT ITS WORLD — everything a reader can have when nobody in
 * this process can say what a place is here.
 *
 * It is a separate function returning a separate TYPE rather than an optional
 * argument, because the difference is not a nuance: `UnvalidatedThinkInput`
 * keeps every place as the stored fields, so it is structurally NOT a
 * `ThinkInput` and `buildThinkPrompt` will not take it. A caller counting what
 * a being perceived, or bucketing its needs, reads this and is right; a caller
 * that wanted to replay is told at compile time to bring the world.
 *
 * IT STILL CHECKS EVERY NUMBER IT CAN NAME WITHOUT ONE: the snapshot's own
 * numbers, every pressure the ROW names, the traits, the inventory, the world
 * tick, each belief's confidence and count, and any stored number ANYWHERE in
 * the snapshot, the sacred place or a tragedy place that has been LOST — `null`
 * from a truncated row, or a non-finite one the `nonFinite` side-channel did not
 * carry. What it cannot ask is which fields SHOULD be there: that a need or a
 * coordinate is missing altogether, or spelled with letters, is a question about
 * a world's own schema, and this path has no world. That is the cost of reading
 * a row from a world you do not have, and it is paid in the return type rather
 * than in a prompt.
 */
export function peekThinkInput(stored: SerializedThinkInput): UnvalidatedThinkInput {
  const source = stored.nonFinite && stored.nonFinite.length > 0 ? snapshotJson(stored) : stored;
  const restored = restoreNonFinite(source);
  assertPeekable(source, restored);
  const { relationships, recalledMemories, nonFinite: _nonFinite, ...rest } = source;
  return {
    ...(rest as unknown as Omit<UnvalidatedThinkInput, 'relationships' | 'recalledMemories'>),
    relationships: new Map(relationships.map(([id, r]) => [id, { ...r }])),
    recalledMemories: recalledMemories.map(peekMemory),
  };
}

/** The records of a think input that CARRY a place, with it written out. */
function withPlacesWritten(
  rest: Omit<ThinkInput, 'relationships' | 'recalledMemories' | 'knowledge'>,
  world: WorldAdapter,
): Record<string, unknown> {
  const codec = codecFor(world.space);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rest)) {
    // A STORY'S SITE AND THE PLACES A TRAGEDY SHUNS are places THEMSELVES rather
    // than records carrying one, and until round 3 they were stored by simply
    // being copied — on the unstated invariant that a place's runtime value IS
    // its wire form. It never was an invariant of SPACE, only of a plane whose
    // handle happened to be its own `{x, y}`; now the handle is opaque and a
    // copy of one writes `{}`. So these ask the world like everything else.
    if (key === 'sacredPlace') out[key] = codec.encode(value as PlaceRef);
    else if (key === 'tragedyPlaces') out[key] = (value as PlaceRef[]).map((p) => codec.encode(p));
    else if (key === 'snapshot') out[key] = inlinePlace(world, value as AgentSnapshot);
    else if (key === 'worldView') {
      const seen = value as WorldView;
      out[key] = {
        ...seen,
        agents: seen.agents.map((a) => inlinePlace(world, a)),
        resources: seen.resources.map((r) => inlinePlace(world, r)),
        structures: seen.structures.map((s) => inlinePlace(world, s)),
      };
    } else out[key] = value;
  }
  return out;
}

/**
 * …and back. THE ONE PLACE A STORED ROW BECOMES A MIND'S AGAIN, and the only
 * function in this file the geometry guard allow-lists: `sacredPlace` and
 * `tragedyPlaces` are stored as the world's own fields and come back as handles
 * through `space.decode`, which is the inverse of the `space.encode` that wrote
 * them. Without a world there is nothing to ask, so a row passes through exactly
 * as it did before — the documented world-less mode, unchanged.
 */
function withPlacesLifted(
  rest: Record<string, unknown>,
  lift: <T>(row: Record<string, unknown>) => T,
  world: WorldAdapter,
): Record<string, unknown> {
  const codec = codecFor(world.space);
  const asPlace = (stored: unknown): PlaceRef | undefined => {
    if (stored === null || stored === undefined || typeof stored !== 'object') return stored as PlaceRef | undefined;
    return codec.decode(stored as Record<string, unknown>);
  };
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rest)) {
    if (key === 'sacredPlace') out[key] = asPlace(value);
    else if (key === 'tragedyPlaces') out[key] = (value as unknown[]).map(asPlace);
    else if (key === 'snapshot') out[key] = lift<AgentSnapshot>(value as Record<string, unknown>);
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

function serializeMemory(m: MemoryRecord, world: WorldAdapter): SerializedMemoryRecord {
  const { embedding, ...rest } = m;
  const written = inlinePlace(world, rest);
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

/** The same, with the place left exactly as stored — there is no world to ask. */
function peekMemory(m: SerializedMemoryRecord): PeekedMemoryRecord {
  const { embedding, ...rest } = m;
  const record = rest as unknown as PeekedMemoryRecord;
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
  world: WorldAdapter,
): void {
  const num = numberChecker(restored);
  // WHICH FIELDS A PLACE IS, AND THEIR ORDER, ARE THE WORLD'S (W1-B4) — the
  // paths are unchanged for the forager plane (`$.snapshot.x`, `$.sacredPlace.y`)
  // because those are the fields it writes a place with. Checked as STORED,
  // because that is the form `nonFinite` names and the form a row is read from.
  const fields = codecFor(world.space).fields;
  const placeIn = (row: Record<string, unknown> | undefined, at: string): void => {
    if (!row) return;
    for (const field of fields) num(row[field.id], `${at}.${field.id}`);
  };
  const s = stored.snapshot as unknown as Record<string, unknown>;
  placeIn(s, '$.snapshot');
  // Every pressure this world declares, checked where `c727af7` checked its own
  // four — the ORDER of these is which defect a doubly-broken row names first.
  commonNumbers(stored, num, () => {
    for (const drive of world.drives) {
      num((s['needs'] as Record<string, unknown> | undefined)?.[drive.id], `$.snapshot.needs.${drive.id}`);
    }
  });
  placeIn(stored.sacredPlace, '$.sacredPlace');
  // EVERY PLACE A TRAGEDY MADE A BEING SHUN, held to the same standard as the
  // one that draws it (round 2, FAIL 4): nothing checked these, so passing the
  // world used to make validation WEAKER here than not passing it. `wander`
  // reads them on the reflex path, so a half-written one is a lost destination,
  // not a cosmetic gap.
  stored.tragedyPlaces?.forEach((place, i) => placeIn(place, `$.tragedyPlaces[${i}]`));
}

/**
 * The same row, judged by everything that is true of a row whatever world wrote
 * it. See `peekThinkInput` for what this deliberately cannot ask.
 */
function assertPeekable(stored: SerializedThinkInput, restored: ReadonlySet<string>): void {
  const num = numberChecker(restored);
  const s = stored.snapshot as unknown as Record<string, unknown>;
  commonNumbers(stored, num, () => {
    // Every pressure the ROW names, rather than every pressure a world declares.
    // For a real forager row the two sets are the same four, which is why this
    // is the check `c727af7` had rather than a different one.
    for (const key of Object.keys((s['needs'] ?? {}) as Record<string, unknown>)) {
      num((s['needs'] as Record<string, unknown>)[key], `$.snapshot.needs.${key}`);
    }
  });
  // A LOST NUMBER, wherever it sits. `null` is what a truncated or hand-edited
  // row puts where a number was, and a non-finite one that `nonFinite` did not
  // carry is a number the row failed to preserve. Which of the snapshot's keys
  // are the place is the world's to say — but neither `x: null` nor `x: NaN`
  // needs naming to be refused.
  const lost = (row: Record<string, unknown> | undefined, at: string): void => {
    if (!row) return;
    for (const [key, value] of Object.entries(row)) {
      if (value === null || typeof value === 'number') num(value, `${at}.${key}`);
    }
  };
  lost(s, '$.snapshot');
  lost(stored.sacredPlace, '$.sacredPlace');
  stored.tragedyPlaces?.forEach((place, i) => lost(place, `$.tragedyPlaces[${i}]`));
}

/** A number the prompt formats, or a named refusal. */
function numberChecker(restored: ReadonlySet<string>): (v: unknown, path: string, label?: string) => void {
  return (v: unknown, path: string, label = path.slice(2)): void => {
    if (typeof v === 'number' && (Number.isFinite(v) || restored.has(path))) return;
    throw new Error(`cognition record: ${label} is ${String(v)}, not a finite number — the row cannot be replayed`);
  };
}

/** Every number a row must carry that no world has an opinion about. */
function commonNumbers(
  stored: SerializedThinkInput,
  num: (v: unknown, path: string, label?: string) => void,
  needs: () => void,
): void {
  const s = stored.snapshot as unknown as Record<string, unknown>;
  num(s['health'], '$.snapshot.health');
  num(s['ageTicks'], '$.snapshot.ageTicks');
  needs();
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
}
