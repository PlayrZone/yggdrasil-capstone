/**
 * THE RESEARCH INSTRUMENT — every analysis facade and observatory accessor the
 * host offers, as plain functions over a `RuntimeView`.
 *
 * Split out of `Experiment` in W1-A because the simulation and the instrument
 * being one object is structurally how "the measurement is the mechanism" bugs
 * survived (audit 01 §3). The dependency runs one way only: the instrument
 * reads the runtime, the runtime cannot even name the instrument, and
 * `test/runner-layering.test.ts` fails if that reverses.
 */
export {
  agentInfos,
  agentDetail,
  agentKnowledge,
  animals,
  archetypeOf,
  consciousState,
  recentEvents,
  recipeHolders,
  resourceNodes,
  structures,
  totalKnowledge,
} from './observatory.js';
export type { AgentInfo, AgentDetail, ConsciousState } from './observatory.js';
export { analysis, culture, institutions, myth, sacredPlaces, society } from './reports.js';
export type { AnalysisSnapshot, InstitutionsReport } from './reports.js';
export { leadership } from './leadership.js';
export type { LeadershipReport } from './leadership.js';
export { beliefBehavior } from './beliefBehavior.js';
export type { BeliefBehaviorReport } from './beliefBehavior.js';
