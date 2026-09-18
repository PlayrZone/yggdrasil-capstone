import type { AgentMind } from '../agent/AgentMind.js';
import type { GahallianBody } from '../body/GahallianBody.js';
import type { SimEvent } from '../contract/types.js';

/** One birth as the kinship ledger records it (the event log is capped). */
export interface BirthRecord {
  child: number;
  parents: [number, number];
  tick: number;
}

/**
 * An entity as the instrument is allowed to look at one: an id and a bag of
 * components to read. Assignable FROM `Entity`, never back to it, so a report
 * cannot be handed a live handle it could write through.
 */
export interface ObservedEntity {
  readonly id: number;
  readonly components: Readonly<Record<string, unknown>>;
}

/**
 * THE INSTRUMENT'S WINDOW ON THE RUNTIME — the whole of it.
 *
 * Every analysis facade and observatory accessor takes one of these instead of
 * the runtime itself. The direction is one-way and enforced by
 * `test/runner-layering.test.ts`: the runtime never imports the instrument, so
 * nothing measured here can be read back into the simulation. Widening this
 * interface is how the measurement would start touching the mechanism again —
 * a new member is a decision, not a convenience.
 *
 * Read-only by contract as much as by type: the component bags and the stores
 * reachable through `minds` are the live objects, and the instrument must not
 * write to them.
 */
export interface RuntimeView {
  readonly seed: string;
  readonly tick: number;
  /** Every being ever spawned, founders first then children, in birth order. */
  readonly agentIds: readonly number[];
  /** Every mind, living and entombed, in the same order as `agentIds`. */
  readonly minds: ReadonlyMap<number, AgentMind>;
  readonly births: readonly BirthRecord[];
  readonly conscious: ReadonlySet<number>;
  readonly lastThought: ReadonlyMap<number, string>;
  /** The capped tail of emitted events. */
  readonly eventLog: readonly SimEvent[];

  agentBody(id: number): Readonly<GahallianBody> | undefined;
  positionOf(id: number): Readonly<{ x: number; y: number }> | undefined;
  nameOf(id: number): string;
  generationOf(id: number): number;
  aliveCount(): number;
  /** Visit every entity carrying `component`, in spatial-index order. */
  each(component: string, visit: (entity: ObservedEntity) => void): void;
}
