import type { KnowledgeRule } from '../contract/types.js';

/**
 * Ground-truth classification of a discovered rule against the world's REAL
 * mechanics (WorldRegularities + the Observatory's world build). This lives
 * strictly on the analysis side: the doctrine forbids the simulation from
 * knowing truth, but the *Observatory* may, so a researcher can chart how
 * much of what the population believes is actually correct.
 *
 * - `true`  — the world genuinely behaves this way (a real regularity).
 * - `false` — the world does not; a superstition born of coincidence.
 * - `unverified` — cannot be judged from world config alone (e.g. a social
 *   claim that depends on another agent's history).
 *
 * NB: this must track the mechanics in engine/src/yggdrasil/WorldRegularities
 * + ResourceNodeSystem + the ObservatorySim world build. If those change, the
 * truths here change with them.
 */
export type RuleTruth = 'true' | 'false' | 'unverified';

export function classifyRuleTruth(rule: KnowledgeRule): RuleTruth {
  switch (rule.kind) {
    case 'context-association':
      return contextTruth(rule);
    case 'succession':
      return successionTruth(rule);
    case 'outcome-association':
      return outcomeTruth(rule);
    case 'social-contingency':
      // Whether agent #N reciprocates depends on that agent's lived behavior,
      // not on world config — the Observatory can't adjudicate it cheaply.
      return 'unverified';
  }
}

function contextTruth(rule: Extract<KnowledgeRule, { kind: 'context-association' }>): RuleTruth {
  // Real regularity: berry bushes (and the food plants they become) cluster
  // near water in the world build; finding/gathering food correlates with
  // being near water.
  const foodFind =
    (rule.event === 'GatherSucceeded' || rule.event === 'FoundResource') &&
    (rule.objectKind === 'berry' || rule.objectKind === undefined);
  if (foodFind && rule.feature === 'nearWater') {
    return rule.direction === 'positive' ? 'true' : 'false';
  }
  // No elevation regularity exists in the flat sim — highland claims are noise.
  if (rule.feature === 'highland') return 'false';
  return 'unverified';
}

function successionTruth(rule: Extract<KnowledgeRule, { kind: 'succession' }>): RuleTruth {
  // EATING a poisonous food causes sickness (truly).
  if (
    rule.causeType === 'AteFood' &&
    (rule.causeObject === 'mushroomRed' || rule.causeObject === 'nightshade') &&
    rule.effectType === 'BecameSick'
  ) {
    return 'true';
  }
  // Planting a seed makes a plant appear.
  if (rule.causeType === 'SeedDeposited' && rule.effectType === 'PlantSprouted') return 'true';
  // Sickness comes ONLY from eating a poison — any other "X → sickness" is
  // false (e.g. GATHERING nightshade → sick is a confounded correlation: the
  // gather isn't the cause, the eating that follows is).
  if (rule.effectType === 'BecameSick') return 'false';
  // Death is never caused in a learnable way by a witness's prior action —
  // every "X → I witnessed a death" is coincidence (the superstition engine).
  if (rule.effectType === 'WitnessedDeath' || rule.effectType === 'AgentDied') return 'false';
  return 'unverified';
}

function outcomeTruth(rule: Extract<KnowledgeRule, { kind: 'outcome-association' }>): RuleTruth {
  // Eating relieves hunger; drinking too.
  if ((rule.actionType === 'AteFood' || rule.actionType === 'DrankWater') && rule.need === 'hunger') {
    return rule.direction === 'relieves' ? 'true' : 'false';
  }
  // Sleeping recovers rest (more so sheltered, but either way it relieves).
  if ((rule.actionType === 'SleptSafely' || rule.actionType === 'SleptExposed') && rule.need === 'rest') {
    return rule.direction === 'relieves' ? 'true' : 'false';
  }
  // Night exposure and sickness worsen safety.
  if (rule.actionType === 'SufferedExposure' && rule.need === 'safety') {
    return rule.direction === 'worsens' ? 'true' : 'false';
  }
  if (rule.actionType === 'BecameSick' && rule.need === 'safety') {
    return rule.direction === 'worsens' ? 'true' : 'false';
  }
  return 'unverified';
}
