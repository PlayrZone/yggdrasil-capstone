/**
 * The Body's view of the Body⇄Mind boundary.
 *
 * The vocabulary is owned by `../contract/types.ts` and re-exported here
 * rather than copied, so the two sides cannot drift. Exactly one thing
 * genuinely differs and stays local: speech transits the Body OPAQUELY — the
 * engine transports an utterance and never interprets it (a knowledge rule
 * means nothing to physics) — so the Body types the payload `rule?: unknown`
 * and keeps its own `Intent` around it.
 *
 * Doctrine (yggdrasil_civilization_design V2): nothing here may ever gain
 * a role/job/class/faction/rank field, and the Body only describes
 * physical reality — no social meaning, no knowledge.
 */

import type { BuildKind, IntentKind, ObjectKind } from '../contract/types.js';

export type {
  NeedKey,
  Needs,
  Traits,
  ObjectKind,
  ResourceNodeKind,
  BuildKind,
  ContextFeatures,
  IntentKind,
  SimEventType,
  SimEvent,
  AgentSnapshot,
  ObservedAgent,
  ObservedResource,
  ObservedStructure,
  Season,
  WorldView,
} from '../contract/types.js';
export { NEED_PRESSING, NEED_CRITICAL } from '../contract/types.js';

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
