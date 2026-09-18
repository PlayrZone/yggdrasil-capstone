import v8 from 'node:v8';
import vm from 'node:vm';
import { it } from 'vitest';
import { Experiment } from '../src/runner/Experiment.js';
import type { ProvenanceLevel } from '../src/learning/ILearner.js';
import { TICKS_PER_DAY } from '../src/body/WorldRegularities.js';
import type { AgentMind } from '../src/agent/AgentMind.js';

/**
 * Where does a long run's memory actually go?
 *
 *   pnpm --filter @yggdrasil/engine bench
 *   YG_MEM_AGENTS=256 YG_MEM_DAYS=1,5,10 pnpm --filter @yggdrasil/engine bench
 *
 * NOT part of `pnpm test` — collected only by `bench/vitest.config.ts`.
 *
 * Retained episodic memory is bounded by the LIVING population, not by run
 * length — it is not a plateau: grow the population and it rises with it.
 *
 * At each checkpoint it reports living vs dead minds, the episodic records each
 * side has FORMED split into still-held and dropped, the size of every other
 * per-mind store, and the process heap after a forced GC. The byte figures are
 * an estimate
 * from an object-graph walk (see `deepSize`) — they are for RANKING what
 * dominates, not for accounting to the byte; the heap line is the real number.
 */

const SEED = process.env['YG_MEM_SEED'] ?? 'bench-memory';
const AGENTS = Number(process.env['YG_MEM_AGENTS'] ?? 120);
const DAYS = (process.env['YG_MEM_DAYS'] ?? '1,3,6').split(',').map((d) => Number(d.trim()));

/**
 * A full GC before every heap read. `--expose-gc` (NODE_OPTIONS or the bench
 * config's execArgv) gives it to us directly; without it we ask V8 for the same
 * function through a throwaway context, so the numbers are comparable either
 * way. Twice, because one pass leaves freshly-unreachable objects behind.
 */
const exposedGc = (globalThis as { gc?: () => void }).gc;
const gcFn: () => void =
  exposedGc ??
  (() => {
    v8.setFlagsFromString('--expose-gc');
    const fn = vm.runInNewContext('gc') as () => void;
    v8.setFlagsFromString('--no-expose-gc');
    return fn;
  })();

function forceGc(): void {
  gcFn();
  gcFn();
}

function heapMb(): number {
  forceGc();
  return Math.round((process.memoryUsage().heapUsed / 1024 / 1024) * 10) / 10;
}

/**
 * Approximate retained bytes of an object graph. Within one call an identity
 * set keeps shared objects from being counted twice; ACROSS calls it does not,
 * so a string every mind holds is charged to each of them and the per-store
 * columns sum to more than the heap. Deliberately crude — it is here to rank
 * the stores against each other, and the heap line is the real number.
 */
function deepSize(root: unknown): number {
  return deepSizeInto(root, new Set<object>());
}

function deepSizeInto(root: unknown, seen: Set<object>): number {
  const stack: unknown[] = [root];
  let bytes = 0;
  while (stack.length) {
    const v = stack.pop();
    if (v === null || v === undefined) continue;
    switch (typeof v) {
      case 'number':
        bytes += 8;
        continue;
      case 'boolean':
        bytes += 4;
        continue;
      case 'string':
        bytes += 12 + v.length * 2;
        continue;
      case 'object':
        break;
      default:
        continue;
    }
    const o = v as object;
    if (seen.has(o)) continue;
    seen.add(o);
    if (ArrayBuffer.isView(o)) {
      bytes += 32 + (o as ArrayBufferView).byteLength;
      continue;
    }
    if (Array.isArray(o)) {
      bytes += 32 + o.length * 8;
      for (const e of o) stack.push(e);
      continue;
    }
    if (o instanceof Map) {
      bytes += 48 + o.size * 32;
      for (const [k, val] of o) {
        stack.push(k);
        stack.push(val);
      }
      continue;
    }
    if (o instanceof Set) {
      bytes += 48 + o.size * 16;
      for (const e of o) stack.push(e);
      continue;
    }
    const keys = Object.keys(o);
    bytes += 32 + keys.length * 16;
    for (const k of keys) {
      bytes += 12 + k.length * 2;
      stack.push((o as Record<string, unknown>)[k]);
    }
  }
  return bytes;
}

/**
 * The same walk over several roots at once, sharing ONE identity set — so a
 * string or object held by many minds is charged once. This is the number that
 * moves when tombstones are made to share their canonical parts; the per-mind
 * `deepSize` above cannot see that sharing at all.
 */
function deepSizeShared(roots: readonly unknown[]): number {
  const seen = new Set<object>();
  let bytes = 0;
  for (const root of roots) bytes += deepSizeInto(root, seen);
  return bytes;
}

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

interface Tally {
  minds: number;
  /** Records still held. */
  held: number;
  /** Records formed and since dropped — evicted, or released at death. */
  dropped: number;
  knowledge: number;
  narratives: number;
  relationships: number;
  episodicBytes: number;
  knowledgeBytes: number;
  narrativeBytes: number;
  relationshipBytes: number;
  minerBytes: number;
}

function emptyTally(): Tally {
  return {
    minds: 0,
    held: 0,
    dropped: 0,
    knowledge: 0,
    narratives: 0,
    relationships: 0,
    episodicBytes: 0,
    knowledgeBytes: 0,
    narrativeBytes: 0,
    relationshipBytes: 0,
    minerBytes: 0,
  };
}

/**
 * Read a mind's per-store sizes. Reaches for the private fields by name
 * because measuring what a store RETAINS is exactly what its public surface is
 * designed not to expose; nothing outside this bench does this.
 */
function tallyMind(t: Tally, mind: AgentMind): void {
  t.minds++;
  t.held += mind.memory.hotCount;
  t.dropped += mind.memory.totalCount - mind.memory.hotCount;
  t.knowledge += mind.knowledge.all().length;
  t.narratives += mind.narratives.all().length;
  t.relationships += mind.relationships.asMap().size;
  t.episodicBytes += deepSize(mind.memory);
  t.knowledgeBytes += deepSize(mind.knowledge);
  t.narrativeBytes += deepSize(mind.narratives);
  t.relationshipBytes += deepSize(mind.relationships);
  t.minerBytes += deepSize(mind.learners);
}

function line(label: string, t: Tally): string {
  return [
    `  ${label.padEnd(7)} minds=${String(t.minds).padStart(5)}`,
    `formed=${String(t.held + t.dropped).padStart(8)} (held ${t.held} / dropped ${t.dropped}) ${mb(t.episodicBytes).padStart(8)}`,
    `knowledge=${String(t.knowledge).padStart(6)} ${mb(t.knowledgeBytes).padStart(8)}`,
    `narrative=${String(t.narratives).padStart(6)} ${mb(t.narrativeBytes).padStart(8)}`,
    `relations=${String(t.relationships).padStart(7)} ${mb(t.relationshipBytes).padStart(8)}`,
    `miners=${mb(t.minerBytes).padStart(8)}`,
  ].join(' ');
}

it(`memory footprint — seed ${SEED}, ${AGENTS} agents, days ${DAYS.join('/')}`, () => {
  const exp = new Experiment({ seed: SEED, agentCount: AGENTS });
  const log = console.log;
  log(`\nmemory footprint · seed=${SEED} agents=${AGENTS} baseline heap ${heapMb()}MB`);

  const totals: string[] = [];
  let at = 0;
  for (const day of DAYS) {
    const target = day * TICKS_PER_DAY;
    const started = Date.now();
    exp.advance(target - at);
    at = target;

    const living = emptyTally();
    const dead = emptyTally();
    let overCapacity = 0;
    let worstOver = 0;
    for (const id of exp.agentIds) {
      const mind = exp.minds.get(id);
      if (!mind) continue;
      const alive = exp.agentBody(id)?.alive ?? false;
      tallyMind(alive ? living : dead, mind);
      const over = mind.memory.hotCount - mind.memory.capacity;
      if (over > 0) {
        overCapacity++;
        worstOver = Math.max(worstOver, over);
      }
    }
    const formed = living.held + living.dropped + dead.held + dead.dropped;
    const deadShare = formed ? Math.round(((dead.held + dead.dropped) / formed) * 100) : 0;
    log(
      `\nday ${day} (tick ${at}, ${Math.round((Date.now() - started) / 100) / 10}s) · heap ${heapMb()}MB` +
        ` · memories formed ${formed} (${deadShare}% by beings now dead)` +
        ` · eventLog ${exp.eventLog.length} · births ${exp.births.length}` +
        ` · held over capacity: ${overCapacity} minds (worst +${worstOver})` +
        ` · held per living mind ${Math.round(living.held / Math.max(1, living.minds))}`,
    );
    log(line('living', living));
    log(line('dead', dead));
    totals.push(
      `day ${day}: heap ${heapMb()}MB (living miners ${mb(living.minerBytes)},` +
        ` living knowledge ${mb(living.knowledgeBytes)}, dead knowledge ${mb(dead.knowledgeBytes)})`,
    );
    log(
      `  other     births=${mb(deepSize(exp.births))} eventLog=${mb(deepSize(exp.eventLog))}` +
        ` world=${mb(deepSize(exp.world))} spatial=${mb(deepSize(exp.world.spatial))}`,
    );
  }

  // The headline in one place: total heap is the budget this engine is held to,
  // and the three terms that move it. Printed together so a regression in any
  // of them is visible without reading four blocks of columns.
  log(`
TOTAL · seed=${SEED} agents=${AGENTS}`);
  for (const t of totals) log(`  ${t}`);
});

/**
 * What one hundred deaths cost, and where.
 *
 *   YG_MEM_DEATHS=100,200 pnpm --filter @yggdrasil/engine bench
 *
 * UNIQUE retained bytes across all tombstones at once — one identity set for
 * the whole set of dead minds, so anything they share is charged once. That is
 * the number tombstone compaction moves, and the per-mind `deepSize` above
 * cannot see it. Knowledge is split into the parts a rule determines (ruleKey,
 * statement, the rule object — identical in every mind that holds the belief,
 * so shareable) and the parts it does not (provenance, ids, scalars).
 *
 * At the LAST checkpoint the dead are dropped for real and the heap re-read,
 * destructively — a stash would keep them reachable and report nothing.
 */
const DEATH_MARKS = (process.env['YG_MEM_DEATHS'] ?? '100').split(',').map((d) => Number(d.trim()));

it(`tombstone cost — seed ${SEED}-t, deaths ${DEATH_MARKS.join('/')}`, () => {
  const exp = new Experiment({ seed: `${SEED}-t`, agentCount: Number(process.env['YG_MEM_TAGENTS'] ?? 150) });
  const log = console.log;
  log(`
tombstone cost · seed=${SEED}-t`);

  const deadMinds = (): AgentMind[] => {
    const out: AgentMind[] = [];
    for (const id of exp.agentIds) {
      const mind = exp.minds.get(id);
      if (mind && !exp.agentBody(id)?.alive) out.push(mind);
    }
    return out;
  };

  for (let i = 0; i < DEATH_MARKS.length; i++) {
    const mark = DEATH_MARKS[i]!;
    const started = Date.now();
    while (deadMinds().length < mark && exp.tick < 200 * TICKS_PER_DAY) exp.advance(600);
    let dead = deadMinds();
    if (dead.length < mark) {
      log(`  only ${dead.length} deaths by tick ${exp.tick} — stopping`);
      break;
    }

    let stores = dead.map((m) => m.knowledge);
    let records = stores.flatMap((k) => k.all());
    const knowledge = deepSizeShared(stores);
    // Split by what a rule determines and what it does not.
    const ruleDerived = deepSizeShared(records.flatMap((k) => [k.ruleKey, k.statement, k.rule]));
    const provenance = deepSizeShared(records.map((k) => k.provenance ?? []));
    const snaps = [...new Set(records.flatMap((k) => k.provenance ?? []))];
    const per100 = (bytes: number): string => mb((bytes / dead.length) * 100);

    log(
      `
  ${dead.length} dead (tick ${exp.tick}, ${Math.round((Date.now() - started) / 100) / 10}s, ${exp.aliveCount()} living)` +
        ` · ${records.length} knowledge records, ${snaps.length} distinct provenance snapshots`,
    );
    log(
      `  unique bytes  knowledge=${mb(knowledge)} (${per100(knowledge)}/100 deaths)` +
        `  = rule-derived ${mb(ruleDerived)} + provenance ${mb(provenance)} + rest ${mb(knowledge - ruleDerived - provenance)}` +
        `  · narratives=${mb(deepSizeShared(dead.map((m) => m.narratives)))}` +
        ` relationships=${mb(deepSizeShared(dead.map((m) => m.relationships)))}` +
        ` episodic=${mb(deepSizeShared(dead.map((m) => m.memory)))}`,
    );

    if (i === DEATH_MARKS.length - 1) {
      // Every local reference must go first, or the tombstones stay reachable
      // through this very function and the heap gives nothing back.
      const deaths = dead.length;
      dead = [];
      stores = [];
      records = [];
      const before = heapMb();
      for (const id of [...exp.minds.keys()]) {
        if (!exp.agentBody(id)?.alive) exp.minds.delete(id);
      }
      const after = heapMb();
      log(
        `  REAL heap ${before}MB → ${after}MB with the tombstones gone = ${Math.round((before - after) * 10) / 10}MB` +
          ` (${Math.round(((before - after) / deaths) * 100 * 10) / 10}MB per 100 deaths)`,
      );
    }
  }
});

/**
 * What each provenance level costs. Provenance is an instrument, so its price
 * is a number a host chooses with — not a constant to discover later.
 *
 *   YG_MEM_LEVEL_DAYS=16 pnpm --filter @yggdrasil/engine bench
 *
 * One world per level, same seed and population, torn down between so the heap
 * reading belongs to the level being measured. Compare against the same bench
 * run on the commit before provenance existed (3f70c03).
 */
const LEVEL_DAY = Number(process.env['YG_MEM_LEVEL_DAYS'] ?? 16);

it(`provenance levels — ${AGENTS} agents, day ${LEVEL_DAY}`, () => {
  const log = console.log;
  const rows: string[] = [];
  for (const level of ['off', 'compact', 'full'] as const satisfies readonly ProvenanceLevel[]) {
    let exp: Experiment | undefined = new Experiment({ seed: SEED, agentCount: AGENTS, provenance: level });
    exp.advance(LEVEL_DAY * TICKS_PER_DAY);
    let miners = 0;
    let knowledge = 0;
    for (const id of exp.agentIds) {
      const mind = exp.minds.get(id);
      if (!mind) continue;
      miners += deepSize(mind.learners);
      knowledge += deepSize(mind.knowledge);
    }
    const heap = heapMb();
    rows.push(`  ${level.padEnd(8)} heap ${String(heap).padStart(6)}MB   miners ${mb(miners).padStart(8)}   knowledge ${mb(knowledge).padStart(8)}`);
    exp = undefined;
    forceGc();
  }
  log(`
PROVENANCE LEVELS · seed=${SEED} agents=${AGENTS} day ${LEVEL_DAY}`);
  for (const r of rows) log(r);
});
