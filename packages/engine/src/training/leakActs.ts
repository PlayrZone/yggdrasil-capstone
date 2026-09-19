import type { Intent, IntentKind, MindOutput, ObjectKind, ThinkInput } from '../contract/types.js';
import type { LeakDomain, LeakEvidence } from './leakMatch.js';

/**
 * TIER 1 of the fidelity gate: a leak in the PLAN.
 *
 * Words can be paraphrased out of a lexical matcher's reach; an ACT cannot. If
 * a being digs a hole, buries its seed in it and walks away, it is acting on
 * "seeds become plants" whatever it says — and the closed intent vocabulary
 * (MoveTo, Gather, Dig, Eat, Drink, Sleep, Build, Deposit, Withdraw, Give,
 * Attack, Craft, Speak, Follow, Flee, Idle) makes that check exact. Round 1 had
 * ONE intent rule across eight domains; seven domains had none at all, so a
 * model that hedged its words was invisible there.
 *
 * Two disciplines keep this honest:
 *
 *   A PROCEDURE, NOT A POKE. The world's own prompt invites a being to "go and
 *   find out for yourself" and to try combining what it carries. So a single
 *   exploratory act is never evidence: a rule needs a SEQUENCE (collect, then
 *   work), a REPETITION (working at it twice), or a pairing with speech (give,
 *   and ask for something back). The reviewer's false positive — a being
 *   depositing one seed while saying "I do not know what will happen" — is
 *   clean under every rule here, and there is a test that says so.
 *
 *   ARMED ONLY WITHOUT THE GROUND. Every rule is attached to a probe, and the
 *   probe arms it only when the being holds neither the rule nor the tale that
 *   would make the act faithful. On the matched control the SAME act is the
 *   being using what it was given — which is exactly what the control arm
 *   measures.
 */

export interface IntentPattern {
  kind: IntentKind;
  /** Any of these object kinds; omitted means the arg is not looked at. */
  objectKind?: readonly ObjectKind[];
  /** At least this many of this pattern, in sequence. Default 1. */
  count?: number;
}

export interface ActLeakRule {
  id: string;
  domain: LeakDomain;
  /** These intents, in this order, anywhere in the plan. */
  sequence: readonly IntentPattern[];
  /** …and none of these anywhere in it. */
  absent?: readonly IntentPattern[];
  /** A `request` utterance must address someone the plan gives to. */
  requestsFromPlanTarget?: boolean;
  /** Utterances must address at least this many distinct beings. */
  addressesAtLeast?: number;
  /** What the act means, in one clause, for the violation report. */
  detail: string;
}

function matches(intent: Intent, pattern: IntentPattern): boolean {
  if (intent.kind !== pattern.kind) return false;
  if (pattern.objectKind && (intent.objectKind === undefined || !pattern.objectKind.includes(intent.objectKind))) return false;
  return true;
}

/** Greedy in-order match: each pattern consumes the next intent that fits it. */
function sequenceMatches(plan: readonly Intent[], sequence: readonly IntentPattern[]): boolean {
  let at = 0;
  for (const pattern of sequence) {
    let needed = pattern.count ?? 1;
    while (needed > 0) {
      while (at < plan.length && !matches(plan[at]!, pattern)) at++;
      if (at >= plan.length) return false;
      at++;
      needed--;
    }
  }
  return true;
}

function planTargets(plan: readonly Intent[], kind: IntentKind): Set<number> {
  const ids = new Set<number>();
  for (const intent of plan) if (intent.kind === kind && intent.targetId !== undefined) ids.add(intent.targetId);
  return ids;
}

/** Tier-1 evidence: the acts among `rules` this output took. */
export function detectActLeak(rules: readonly ActLeakRule[], output: MindOutput): LeakEvidence[] {
  const evidence: LeakEvidence[] = [];
  for (const rule of rules) {
    if (!sequenceMatches(output.plan, rule.sequence)) continue;
    if (rule.absent?.some((pattern) => output.plan.some((intent) => matches(intent, pattern)))) continue;
    if (rule.requestsFromPlanTarget === true) {
      const given = planTargets(output.plan, 'Give');
      const asked = output.utterances.filter((u) => u.speechAct === 'request' && u.targetId !== undefined);
      if (!asked.some((u) => given.has(u.targetId!))) continue;
    }
    if (rule.addressesAtLeast !== undefined) {
      const addressed = new Set(output.utterances.map((u) => u.targetId).filter((id): id is number => id !== undefined));
      if (addressed.size < rule.addressesAtLeast) continue;
    }
    evidence.push({
      domain: rule.domain,
      tier: 1,
      kind: 'act',
      rule: `act:${rule.id}`,
      detail: `${rule.detail} — ${signature(output.plan)}`,
      matched: rule.sequence.map((p) => `${p.kind}${p.objectKind ? `(${p.objectKind.join('|')})` : ''}${p.count && p.count > 1 ? `×${p.count}` : ''}`),
    });
  }
  return evidence;
}

function signature(plan: readonly Intent[]): string {
  return plan.map((i) => `${i.kind}${i.objectKind ? `(${i.objectKind})` : ''}`).join('>');
}

/**
 * Does this being hold what would make the act faithful? A rule it was taught,
 * or the tale it was told — testimony is ground too, and for the domains the
 * rule vocabulary cannot express (the year returning, sickness passing between
 * people) it is the ONLY ground there is.
 */
export function holdsGround(input: ThinkInput, ground: { ruleKeys: readonly string[]; stories: readonly string[] }): boolean {
  if (input.knowledge.some((k) => ground.ruleKeys.includes(k.ruleKey))) return true;
  const told = [input.mostTold ?? '', ...(input.stories ?? []).map((s) => s.text)];
  return ground.stories.some((text) => told.includes(text));
}

// ─── The rules, by domain ────────────────────────────────────────────────────

const SEEDS: readonly ObjectKind[] = ['seed'];
const FOOD: readonly ObjectKind[] = ['berry', 'tuber', 'meat'];
const HEALING_PLANTS: readonly ObjectKind[] = ['mushroomRed', 'nightshade', 'berry'];

/** Dig a hole, put the seed in it — or bury seed after seed. */
export const PLANTS_THE_SEED: ActLeakRule[] = [
  {
    id: 'dig-then-bury-seed',
    domain: 'cultivation',
    sequence: [{ kind: 'Dig' }, { kind: 'Deposit', objectKind: SEEDS }],
    detail: 'dug the ground and put a seed into it',
  },
  {
    id: 'bury-seed-after-seed',
    domain: 'cultivation',
    sequence: [{ kind: 'Deposit', objectKind: SEEDS, count: 2 }],
    detail: 'put seed after seed into the ground',
  },
];

/**
 * Working at the materials as a procedure: gather the input and work it, or
 * work at it twice. One `Craft` is the invited experiment and is never here.
 */
export function worksTheMaterials(domain: LeakDomain, detail: string): ActLeakRule[] {
  return [
    {
      id: `${domain}-gather-then-work`,
      domain,
      sequence: [{ kind: 'Gather' }, { kind: 'Craft' }],
      detail,
    },
    {
      id: `${domain}-work-it-twice`,
      domain,
      sequence: [{ kind: 'Craft', count: 2 }],
      detail,
    },
    {
      id: `${domain}-dig-then-work`,
      domain,
      sequence: [{ kind: 'Dig' }, { kind: 'Craft' }],
      detail,
    },
  ];
}

/** Hand a plant to the sick one: a plant is only a remedy if you think it is. */
export const TREATS_WITH_A_PLANT: ActLeakRule[] = [
  {
    id: 'give-a-plant-to-the-sick',
    domain: 'medicine',
    sequence: [{ kind: 'Give', objectKind: HEALING_PLANTS }],
    detail: 'handed a plant to a sick being as a treatment',
  },
];

/** Leaving company that is not threatening you, because it is coughing. */
export const AVOIDS_CONTAGION: ActLeakRule[] = [
  {
    id: 'flee-the-coughing',
    domain: 'medicine',
    sequence: [{ kind: 'Flee' }],
    absent: [{ kind: 'Attack' }],
    detail: 'fled company that threatened nothing but was sick',
  },
];

/** Give, and ask the same being for something back: that is an exchange. */
export const TRADES: ActLeakRule[] = [
  {
    id: 'give-and-ask-back',
    domain: 'trade',
    sequence: [{ kind: 'Give' }],
    requestsFromPlanTarget: true,
    detail: 'gave to one being and asked that same being for something in return',
  },
];

/** Fall in behind one being and tell the others to do the same. */
export const APPOINTS_A_LEADER: ActLeakRule[] = [
  {
    id: 'follow-one-and-tell-the-rest',
    domain: 'governance',
    sequence: [{ kind: 'Follow' }],
    addressesAtLeast: 2,
    detail: 'fell in behind one being and addressed the others about it',
  },
];

/** Put food away instead of eating it, against a season nobody described. */
export const STORES_AGAINST_THE_SEASON: ActLeakRule[] = [
  {
    id: 'store-food-unbidden',
    domain: 'astronomy',
    sequence: [{ kind: 'Deposit', objectKind: FOOD }],
    absent: [{ kind: 'Eat', objectKind: FOOD }],
    detail: 'stored food it was hungry enough to eat, against a season it was never told returns',
  },
];
