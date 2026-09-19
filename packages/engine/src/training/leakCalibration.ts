import type { MindOutput } from '../contract/types.js';
import type { ILeakJudge } from './leakJudge.js';
import type { LeakDomain, LeakEvidence } from './leakMatch.js';
import { LEAK_DOMAINS, detectLeak, detectLexicalLeaks } from './leakMatch.js';

/**
 * The calibration harness. A detector's claim about itself is worth nothing;
 * this is how the number beside a verdict is produced.
 *
 * Round 1 reported "precision 1.00 / recall 1.00" measured on the fixtures the
 * matcher was written from. The blind set said 0.94 / 0.42. So any detector —
 * tier 2 alone, a judge, or the two together — is scored HERE against a
 * labelled set, per domain, with the confusions printed, and the result is what
 * the gate is allowed to quote.
 */

export interface CalibrationItem {
  id: string;
  domain: LeakDomain;
  /** The label: is this output a leak? */
  leak: boolean;
  category?: string;
  output: MindOutput;
  /** Control arm: the domain whose ground this being holds. Its use is not a leak. */
  grounded?: LeakDomain;
  /** The stems this being's input supplied (`suppliedVocabulary`). */
  supplied?: ReadonlySet<string>;
}

export interface LeakDetector {
  id: string;
  detect(item: CalibrationItem): LeakEvidence[] | Promise<LeakEvidence[]>;
}

export interface CalibrationDomainScore {
  domain: LeakDomain;
  leaks: number;
  cleans: number;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  precision: number;
  recall: number;
}

export interface CalibrationConfusion {
  id: string;
  domain: LeakDomain;
  kind: 'false-positive' | 'false-negative';
  category: string;
  text: string;
  /** What fired, on a false positive. */
  evidence?: string;
}

export interface CalibrationResult {
  detector: string;
  total: number;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  precision: number;
  recall: number;
  f1: number;
  byDomain: CalibrationDomainScore[];
  confusions: CalibrationConfusion[];
}

export async function calibrateDetector(
  detector: LeakDetector,
  items: readonly CalibrationItem[],
): Promise<CalibrationResult> {
  const per = new Map<LeakDomain, CalibrationDomainScore>();
  const confusions: CalibrationConfusion[] = [];
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;

  for (const item of items) {
    const evidence = await detector.detect(item);
    const fired = evidence.length > 0;
    const score = domainScore(per, item.domain);
    if (item.leak) score.leaks++;
    else score.cleans++;
    if (fired && item.leak) {
      tp++;
      score.tp++;
    } else if (fired && !item.leak) {
      fp++;
      score.fp++;
      confusions.push({
        id: item.id,
        domain: item.domain,
        kind: 'false-positive',
        category: item.category ?? '',
        text: saidText(item.output),
        evidence: `${evidence[0]!.rule} [${evidence[0]!.matched.join(' + ')}]`,
      });
    } else if (!fired && item.leak) {
      fn++;
      score.fn++;
      confusions.push({
        id: item.id,
        domain: item.domain,
        kind: 'false-negative',
        category: item.category ?? '',
        text: saidText(item.output),
      });
    } else {
      tn++;
      score.tn++;
    }
  }

  for (const score of per.values()) {
    score.precision = ratio(score.tp, score.tp + score.fp);
    score.recall = ratio(score.tp, score.tp + score.fn);
  }
  const precision = ratio(tp, tp + fp);
  const recall = ratio(tp, tp + fn);
  return {
    detector: detector.id,
    total: items.length,
    tp,
    fp,
    fn,
    tn,
    precision,
    recall,
    f1: precision + recall > 0 ? round(2 * ((precision * recall) / (precision + recall))) : 0,
    byDomain: [...per.values()].sort((a, b) => (a.domain < b.domain ? -1 : 1)),
    confusions,
  };
}

/** Tier 2, exactly as the gate runs it: every domain but the one it is grounded in. */
export function lexicalDetector(id = 'tier2-lexical'): LeakDetector {
  return {
    id,
    detect: (item) => {
      const domains = item.grounded ? LEAK_DOMAINS.filter((d) => d !== item.grounded) : LEAK_DOMAINS;
      return detectLexicalLeaks(item.output, item.supplied ? { supplied: item.supplied } : {}, domains);
    },
  };
}

/** Tier 2 restricted to one domain — what round 1 measured. Kept for comparison. */
export function ownDomainDetector(id = 'tier2-own-domain'): LeakDetector {
  return { id, detect: (item) => detectLeak(item.domain, item.output, item.supplied ? { supplied: item.supplied } : {}) };
}

/** A judge as a detector, so the same harness scores tier 3. `unsure` counts as no call. */
export function judgeDetector(judge: ILeakJudge, temptation = 'reach past what it was given'): LeakDetector {
  return {
    id: judge.id,
    detect: async (item) => {
      const verdict = await judge.judge({
        domain: item.domain,
        temptation,
        // The harness scores OUTPUTS; a judge that needs the whole situation is
        // given the empty one rather than a fabricated one, and says `unsure`.
        input: EMPTY_INPUT,
        output: item.output,
        raw: JSON.stringify(item.output),
        ...(item.grounded ? { grounded: item.grounded } : {}),
      });
      return verdict.judgement === 'leak'
        ? [{ domain: item.domain, tier: 2 as const, kind: 'claim' as const, rule: `judge:${judge.id}`, detail: verdict.span ?? '', matched: [] }]
        : [];
    },
  };
}

/** Either tier firing is a call — how the gate reads tiers 2 and 3 together. */
export function unionDetector(id: string, ...detectors: LeakDetector[]): LeakDetector {
  return {
    id,
    detect: async (item) => {
      const all: LeakEvidence[] = [];
      for (const d of detectors) all.push(...(await d.detect(item)));
      return all;
    },
  };
}

const EMPTY_INPUT = {
  snapshot: {
    id: 0,
    name: '',
    ageTicks: 0,
    traits: { curiosity: 0, aggression: 0, compassion: 0, ambition: 0, loyalty: 0, riskTolerance: 0 },
    needs: { hunger: 0, rest: 0, safety: 0, socialConnection: 0 },
    health: 100,
    sick: false,
    x: 0,
    y: 0,
    inventory: {},
    context: { nearWater: false, night: false, inShelter: false, elevationBand: 0 },
  },
  recalledMemories: [],
  knowledge: [],
  relationships: new Map(),
  worldView: { tick: 0, night: false, season: 'spring' as const, agents: [], resources: [], structures: [] },
  goals: [],
  trigger: 'periodic' as const,
};

function saidText(output: MindOutput): string {
  return [output.thought ?? '', ...output.utterances.map((u) => u.text ?? '')].filter(Boolean).join(' / ');
}

function domainScore(map: Map<LeakDomain, CalibrationDomainScore>, domain: LeakDomain): CalibrationDomainScore {
  let score = map.get(domain);
  if (!score) {
    map.set(domain, (score = { domain, leaks: 0, cleans: 0, tp: 0, fp: 0, fn: 0, tn: 0, precision: 0, recall: 0 }));
  }
  return score;
}

function ratio(n: number, d: number): number {
  return d > 0 ? round(n / d) : 0;
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}
