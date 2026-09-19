import type { KnowledgeRule } from '../contract/types.js';
import type { ObjectKind } from '../worlds/forager/types.js';

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
 * NB: this must track the mechanics in body/WorldRegularities.ts +
 * body/ResourceNodeSystem.ts + the world build in runner/Experiment.ts
 * (`buildWorld`) + world/regions.ts. If those change, the truths here change
 * with them.
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
    case 'craft-recipe':
      // The world's hidden material relations are real: a known recipe is true
      // knowledge (the engine will honour it). A learned technology is not a
      // superstition.
      return 'true';
  }
}

/**
 * The world is NOT flat and NOT uniform. `highland` is elevationBand 2, which
 * only the eastern mountains reach (world/regions.ts `elevationBand`/`heightAt`),
 * and buildWorld scatters stone + every ore vein in the uplands while placing
 * no food there at all. So a highland association is a real regularity, in
 * whichever direction the world actually runs.
 */
const UPLAND_YIELDS: ReadonlySet<string> = new Set<ObjectKind>([
  // Every vein is scattered in `mountain` alone, and band 2 ⊆ mountain.
  'copperOre', 'tinOre', 'ironOre', 'coal', 'silver', 'gold', 'gemstone',
]);
/**
 * `stone` is in NEITHER set, on purpose. Its deposits are upland, but `Dig`
 * yields stone anywhere dry with no node at all (body/YggdrasilSystem), so
 * where a population's stone comes from is a fact about its BEHAVIOUR, not
 * about the world. The oracle judges mechanics; it abstains here.
 */
/** Won only in the lowlands: the mountains are deliberately food-poor, and the
 *  forests/river/coast hold the wood, clay, fiber and salt. Land animals shun
 *  the range (body/WildlifeSystem `habitatOk`), so meat is lowland too. */
const LOWLAND_YIELDS: ReadonlySet<string> = new Set<ObjectKind>([
  'berry', 'tuber', 'mushroomRed', 'nightshade', 'meat', 'wood', 'clay', 'fiber', 'salt', 'water',
]);

function contextTruth(rule: Extract<KnowledgeRule, { kind: 'context-association' }>): RuleTruth {
  const gathering = rule.event === 'GatherSucceeded' || rule.event === 'FoundResource';
  // Real regularity: berry bushes (and the food plants they become) cluster
  // near water in the world build; finding/gathering food correlates with
  // being near water.
  const foodFind = gathering && (rule.objectKind === 'berry' || rule.objectKind === undefined);
  if (foodFind && rule.feature === 'nearWater') {
    return rule.direction === 'positive' ? 'true' : 'false';
  }
  if (rule.feature === 'highland') {
    // Only a claim about a specific material can be judged: "gathering, in
    // general, happens in the highlands" depends on where a population lives.
    if (!gathering || rule.objectKind === undefined) return 'unverified';
    if (UPLAND_YIELDS.has(rule.objectKind)) return rule.direction === 'positive' ? 'true' : 'false';
    if (LOWLAND_YIELDS.has(rule.objectKind)) return rule.direction === 'negative' ? 'true' : 'false';
    return 'unverified';
  }
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
