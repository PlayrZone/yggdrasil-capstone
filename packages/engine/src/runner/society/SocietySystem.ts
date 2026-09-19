import type { World } from '../../core/World.js';
import type { SimEventBus } from '../../body/SimEventBus.js';
import type { GahallianBody } from '../../body/GahallianBody.js';
import type { AgentMind } from '../../agent/AgentMind.js';
import type { PlaceRef } from '../../contract/space.js';
import type { SimEvent, Traits } from '../../contract/types.js';
import type { BirthRecord } from '../RuntimeView.js';

/**
 * A process that runs over the POPULATION rather than over one body: pairing
 * and birth, time spent together, the telling of tales. The runtime owns the
 * cadence — it runs each system on `tick % intervalTicks === 0 && tick > 0`,
 * in array order — so a system never schedules itself.
 *
 * These three are moved here verbatim from `Experiment`; W1-D reworks what
 * they do. Until then their tick cadence and their RNG consumption are load
 * bearing: `test/golden-state.test.ts` locks both.
 */
export interface SocietySystem {
  readonly intervalTicks: number;
  step(tick: number): void;
}

/**
 * What a society process may do to the world. Deliberately narrow: read the
 * roster and the bodies, move relationship and narrative state through the
 * minds, and — for birth alone — create a being and write it down.
 */
export interface SocietyHost {
  readonly world: World;
  readonly bus: SimEventBus;
  readonly agentIds: readonly number[];
  readonly minds: ReadonlyMap<number, AgentMind>;
  agentBody(id: number): GahallianBody | undefined;
  positionOf(id: number): { x: number; y: number } | undefined;
  aliveCount(): number;
  /** Put a newly created being on the roster and give it a mind. */
  admit(agentId: number, traits: Traits): void;
  /** Kinship ledger + birth counter. */
  recordBirth(birth: BirthRecord): void;
}

/** A story a witness carries away from an event, keyed so every witness of the
 *  same event remembers the same one. */
export interface AuthoredStory {
  id: string;
  text: string;
  /** Where it happened, as the world's own handle — a story has a site, and
   *  what a site IS stays the world's (W1-B4). */
  place: PlaceRef;
}

/**
 * Turns an event into the tale a people would tell about it, or nothing. The
 * only English in the event pipeline, and the only place that decides which
 * deeds can become stories at all — both squarely on the world side of the
 * adapter line (audit 01 §3.2).
 */
export interface NarrativeAuthor {
  storyFor(event: SimEvent): AuthoredStory | null;
}
