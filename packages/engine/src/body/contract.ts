/**
 * The Body's view of the Body⇄Mind boundary.
 *
 * Two sources, re-exported rather than copied so nothing can drift. The
 * world-neutral SHAPES (a snapshot, a world view, an event) are
 * `../contract/types.ts`'s; the forager continent's own VOCABULARY (what
 * exists, what one can need, what can happen) is `../worlds/forager/types.ts`'s
 * — because the body enforces one world's physics, and physics is the one
 * thing that cannot be world-neutral.
 *
 * Exactly one thing genuinely differs and stays local: speech transits the Body
 * OPAQUELY — the engine transports an utterance and never interprets it (a
 * knowledge rule means nothing to physics) — so the Body types the payload
 * `rule?: unknown` and keeps its own `Intent` around it, with this world's
 * narrow kinds where the mind's carries opaque ids.
 *
 * Doctrine (yggdrasil_civilization_design V2): nothing here may ever gain
 * a role/job/class/faction/rank field, and the Body only describes
 * physical reality — no social meaning, no knowledge.
 */

import type { IntentKind } from '../contract/types.js';
import type { BuildKind, ObjectKind } from '../worlds/forager/types.js';

export type {
  Traits,
  IntentKind,
  SimEvent,
  AgentSnapshot,
  ObservedAgent,
  ObservedResource,
  ObservedStructure,
  WorldView,
} from '../contract/types.js';
export type {
  NeedKey,
  Needs,
  ObjectKind,
  ResourceNodeKind,
  BuildKind,
  ContextFeatures,
  SimEventType,
  Season,
} from '../worlds/forager/types.js';
export { NEED_PRESSING, NEED_CRITICAL } from '../worlds/forager/types.js';

export interface EngineUtterance {
  targetId?: number;
  speechAct: string;
  rule?: unknown;
  ruleConfidence?: number;
  text?: string;
  narrativeId?: string;
  narrativeText?: string;
}

export interface Intent {
  kind: IntentKind;
  x?: number;
  y?: number;
  targetId?: number;
  objectKind?: ObjectKind;
  buildKind?: BuildKind;
  durationTicks?: number;
  utterance?: EngineUtterance;
}
