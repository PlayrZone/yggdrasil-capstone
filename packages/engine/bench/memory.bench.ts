import v8 from 'node:v8';
import vm from 'node:vm';
import { it } from 'vitest';
import { Experiment } from '../src/runner/Experiment.js';
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
  const seen = new Set<object>();
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
        ` · held over capacity: ${overCapacity} minds (worst +${worstOver})`,
    );
    log(line('living', living));
    log(line('dead', dead));
    log(
      `  other     births=${mb(deepSize(exp.births))} eventLog=${mb(deepSize(exp.eventLog))}` +
        ` world=${mb(deepSize(exp.world))} spatial=${mb(deepSize(exp.world.spatial))}`,
    );
  }
});
