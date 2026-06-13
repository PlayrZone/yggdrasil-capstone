import type { KnowledgeRecord, KnowledgeRule, MemoryOrigin } from '../contract/types.js';
import { classifyRuleTruth } from './groundTruth.js';
import type { RuleTruth } from './groundTruth.js';

/** One agent's held knowledge, the unit the diffusion analyzer consumes. */
export interface AgentKnowledge {
  agentId: number;
  alive: boolean;
  knowledge: KnowledgeRecord[];
}

export interface BeliefHolder {
  agentId: number;
  alive: boolean;
  origin: MemoryOrigin;
  confidence: number;
  firstFormed: number;
  testimonyFrom?: number;
}

/**
 * A belief, viewed across the whole population: who holds it, how they came
 * to (first-hand vs heard vs seen), and — the culture signal — whether it
 * has outlived the agent who discovered it.
 */
export interface BeliefCluster {
  ruleKey: string;
  rule: KnowledgeRule;
  statement: string;
  truth: RuleTruth;
  holders: BeliefHolder[];
  holderCount: number;
  livingHolders: number;
  byExperience: number;
  byObservation: number;
  byTestimony: number;
  meanConfidence: number;
  /** The agent who formed it first-hand earliest (the discoverer). */
  originatorId: number | null;
  originatorAlive: boolean;
  firstFormedTick: number;
  /**
   * Culture: the discoverer is gone, yet living agents still hold the belief.
   * Knowledge surviving longer than the individual is the operational
   * definition of culture in this project.
   */
  outlivedOriginator: boolean;
}

/**
 * Cluster held knowledge across agents by rule identity. Only `held` records
 * count as "holding" a belief (hypotheses aren't acted on yet). Sorted by
 * reach (living holders, then total).
 */
export function analyzeDiffusion(agents: AgentKnowledge[]): BeliefCluster[] {
  const clusters = new Map<string, { rule: KnowledgeRule; statement: string; holders: BeliefHolder[] }>();

  for (const agent of agents) {
    for (const k of agent.knowledge) {
      if (k.status !== 'held') continue;
      let cluster = clusters.get(k.ruleKey);
      if (!cluster) {
        cluster = { rule: k.rule, statement: k.statement, holders: [] };
        clusters.set(k.ruleKey, cluster);
      }
      cluster.holders.push({
        agentId: agent.agentId,
        alive: agent.alive,
        origin: k.origin,
        confidence: k.confidence,
        firstFormed: k.firstFormed,
        ...(k.testimonyFrom !== undefined ? { testimonyFrom: k.testimonyFrom } : {}),
      });
    }
  }

  const result: BeliefCluster[] = [];
  for (const [ruleKey, cluster] of clusters) {
    const holders = cluster.holders;
    const living = holders.filter((h) => h.alive);
    const byExperience = holders.filter((h) => h.origin === 'experience').length;
    const byObservation = holders.filter((h) => h.origin === 'observation').length;
    const byTestimony = holders.filter((h) => h.origin === 'testimony').length;

    // The originator: earliest first-hand (or observed) former; testimony
    // holders learned it from someone, so they're never the origin.
    const firstHand = holders
      .filter((h) => h.origin !== 'testimony')
      .sort((a, b) => a.firstFormed - b.firstFormed || a.agentId - b.agentId);
    const originator = firstHand[0] ?? null;

    result.push({
      ruleKey,
      rule: cluster.rule,
      statement: cluster.statement,
      truth: classifyRuleTruth(cluster.rule),
      holders,
      holderCount: holders.length,
      livingHolders: living.length,
      byExperience,
      byObservation,
      byTestimony,
      meanConfidence: holders.reduce((s, h) => s + h.confidence, 0) / Math.max(1, holders.length),
      originatorId: originator?.agentId ?? null,
      originatorAlive: originator?.alive ?? false,
      firstFormedTick: originator?.firstFormed ?? 0,
      outlivedOriginator: originator !== null && !originator.alive && living.length > 0,
    });
  }

  result.sort((a, b) => b.livingHolders - a.livingHolders || b.holderCount - a.holderCount);
  return result;
}

export interface BeliefAccuracy {
  heldTotal: number;
  trueCount: number;
  falseCount: number;
  unverifiedCount: number;
  /** Share of verifiable held beliefs that are correct, 0–1 (null if none). */
  accuracy: number | null;
  /** Distinct false beliefs currently held by someone (superstitions). */
  falseBeliefs: BeliefCluster[];
}

/** Population-wide accuracy snapshot from a set of belief clusters. */
export function analyzeBeliefAccuracy(clusters: BeliefCluster[]): BeliefAccuracy {
  let trueCount = 0;
  let falseCount = 0;
  let unverifiedCount = 0;
  const falseBeliefs: BeliefCluster[] = [];
  for (const c of clusters) {
    if (c.truth === 'true') trueCount += c.holderCount;
    else if (c.truth === 'false') {
      falseCount += c.holderCount;
      falseBeliefs.push(c);
    } else unverifiedCount += c.holderCount;
  }
  const verifiable = trueCount + falseCount;
  return {
    heldTotal: trueCount + falseCount + unverifiedCount,
    trueCount,
    falseCount,
    unverifiedCount,
    accuracy: verifiable > 0 ? trueCount / verifiable : null,
    falseBeliefs,
  };
}
