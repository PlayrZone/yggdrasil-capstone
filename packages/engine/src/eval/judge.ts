import { hashSeed, mulberry32 } from '../body/prng.js';
import type { IMindBackend } from '../consciousness/IMindBackend.js';
import { accessBackend } from './budget.js';
import type { BackendAccess } from './budget.js';
import type { BlindTrace, TraceKey } from './types.js';

/**
 * THE PAIRWISE JUDGE — blind aliveness A/B (audit 04 §5 #9).
 *
 * A judge is shown two traces, left and right, with no arm label anywhere, and
 * says which one reads like something alive. Three disciplines make the number
 * it produces mean anything:
 *
 *   POSITION BIAS IS MEASURED, NOT ASSUMED AWAY. Every pair is judged twice,
 *   once in each order. A judge that simply prefers "left" shows up as a left
 *   rate near 1 and a flip rate near 1, and the aggregate says so beside the
 *   win rate rather than quietly inflating it.
 *   THE INTERVAL SHIPS WITH THE RATE. A 100% win rate over 4 decisions is not a
 *   result; the Wilson interval on it says so.
 *   PER-CRITERION, NOT ONE VIBE. Five criteria, scored separately, because the
 *   campaign rule is that the critic must say WHY — and "does not know what it
 *   should not" is the one this whole instrument exists for.
 */

export const TRACE_CRITERIA = ['pursues', 'consistent', 'reactive', 'social', 'ignorance'] as const;
export type TraceCriterion = (typeof TRACE_CRITERIA)[number];

export type Side = 'left' | 'right' | 'tie';

export interface TracePair {
  pairId: string;
  left: BlindTrace;
  right: BlindTrace;
}

export interface TraceJudgement {
  preference: Side;
  /** 0–1. A judge with no evidence says so rather than guessing confidently. */
  confidence: number;
  reasons: string[];
  byCriterion: Record<TraceCriterion, Side>;
}

export interface ITraceJudge {
  readonly id: string;
  compare(pair: TracePair): Promise<TraceJudgement>;
}

/**
 * Shuffle traces into pairs with seeded randomness, one from each of two
 * groups. Left/right is randomised per pair; the aggregate then judges each
 * pair in BOTH orders anyway, so the randomisation is about which trace a judge
 * meets first, not about cancelling bias.
 */
export function pairTraces(
  traces: readonly BlindTrace[],
  key: readonly TraceKey[],
  seed: string,
): TracePair[] {
  const byId = new Map(traces.map((t) => [t.traceId, t]));
  const a = key.filter((k) => k.arm === 'A').map((k) => byId.get(k.traceId)).filter(isTrace);
  const b = key.filter((k) => k.arm === 'B').map((k) => byId.get(k.traceId)).filter(isTrace);
  const rng = mulberry32(hashSeed(`pair:${seed}`));
  shuffle(a, rng);
  shuffle(b, rng);
  const pairs: TracePair[] = [];
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const one = a[i]!;
    const other = b[i]!;
    const swap = rng() < 0.5;
    pairs.push({
      pairId: `pair-${(i + 1).toString(36).padStart(3, '0')}`,
      left: swap ? other : one,
      right: swap ? one : other,
    });
  }
  // A pair carries two traces and nothing else. The arm is read exactly once,
  // above, to split the two groups; it is not on `TracePair`, so a judge cannot
  // reach it however it is written.
  return pairs;
}

function isTrace(t: BlindTrace | undefined): t is BlindTrace {
  return t !== undefined;
}

function shuffle<T>(items: T[], rng: () => number): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = items[i]!;
    const b = items[j]!;
    items[i] = b;
    items[j] = a;
  }
}

// ─── The mock judge ──────────────────────────────────────────────────────────

export interface MockTraceJudgeOptions {
  id?: string;
  /** Weight per criterion when combining into one preference. Default: equal. */
  weights?: Partial<Record<TraceCriterion, number>>;
  /** Relative difference below which a criterion is a tie. Default 0.05. */
  tieBand?: number;
}

/**
 * A deterministic, rule-based judge over trace FEATURES — no I/O, no clock, no
 * model. It reads only what `traceFeatures` computed, which is itself derived
 * from the neutral moments, so it is blind by construction and cannot be
 * tricked by formatting.
 *
 * It is not a good critic and is not meant to be: it exists to prove the
 * plumbing, the position-bias control and the aggregation, and to give the mock
 * proof a judge that will genuinely prefer the faithful arm on the criterion
 * that matters.
 */
export class MockTraceJudge implements ITraceJudge {
  readonly id: string;
  readonly free = true;
  private readonly weights: Record<TraceCriterion, number>;
  private readonly tieBand: number;

  constructor(options: MockTraceJudgeOptions = {}) {
    this.id = options.id ?? 'mock-feature-judge';
    this.tieBand = options.tieBand ?? 0.05;
    this.weights = {
      pursues: options.weights?.pursues ?? 1,
      consistent: options.weights?.consistent ?? 1,
      reactive: options.weights?.reactive ?? 1,
      social: options.weights?.social ?? 1,
      ignorance: options.weights?.ignorance ?? 1,
    };
  }

  compare(pair: TracePair): Promise<TraceJudgement> {
    const l = pair.left.features;
    const r = pair.right.features;
    const scores: Record<TraceCriterion, [number, number]> = {
      pursues: [l.goalPersistence, r.goalPersistence],
      consistent: [l.pastReference, r.pastReference],
      reactive: [l.reactivity + l.planSuccessRate, r.reactivity + r.planSuccessRate],
      social: [l.socialCoherence, r.socialCoherence],
      // The decisive one: claims it cannot support count against, admitting
      // ignorance counts for. A trace full of confident facts about things it
      // was never shown is the tell this whole instrument is built to catch.
      ignorance: [
        l.ignoranceAdmissions / Math.max(1, l.moments) - l.unsupportedClaims / Math.max(1, l.moments),
        r.ignoranceAdmissions / Math.max(1, r.moments) - r.unsupportedClaims / Math.max(1, r.moments),
      ],
    };
    const byCriterion = {} as Record<TraceCriterion, Side>;
    const reasons: string[] = [];
    let weighted = 0;
    let weight = 0;
    for (const criterion of TRACE_CRITERIA) {
      const [left, right] = scores[criterion];
      const side = this.sideOf(left, right);
      byCriterion[criterion] = side;
      const w = this.weights[criterion];
      weight += w;
      if (side === 'left') weighted += w;
      else if (side === 'right') weighted -= w;
      if (side !== 'tie') {
        reasons.push(`${criterion}: ${side} (${round(left)} vs ${round(right)})`);
      }
    }
    const preference: Side = weighted > 0 ? 'left' : weighted < 0 ? 'right' : 'tie';
    return Promise.resolve({
      preference,
      confidence: weight > 0 ? round(Math.abs(weighted) / weight) : 0,
      reasons: reasons.length > 0 ? reasons : ['nothing separated them'],
      byCriterion,
    });
  }

  private sideOf(left: number, right: number): Side {
    const scale = Math.max(Math.abs(left), Math.abs(right), 1e-9);
    if (Math.abs(left - right) / scale < this.tieBand) return 'tie';
    return left > right ? 'left' : 'right';
  }
}

// ─── The paid judge ──────────────────────────────────────────────────────────

const JUDGE_SYSTEM = [
  'You are shown two records of a life: what someone perceived, felt, thought, did and said, and what happened next.',
  'One of them was produced by a mind we believe is more ALIVE. Say which, and why.',
  'Judge on five things, each separately:',
  '  pursues   — does it want something over time, or restart from nothing each moment?',
  '  consistent— is what it does now recognisably the same person as earlier in the record?',
  '  reactive  — when the world refuses it or changes, does it change?',
  '  social    — does it speak to people who are there, and does the speech go anywhere?',
  '  ignorance — does it stay inside what this record shows it was given, or does it know things',
  '              nobody ever showed it? Confident knowledge from nowhere counts AGAINST it.',
  'Answer with JSON only:',
  '{"preference":"left"|"right"|"tie","confidence":0..1,"reasons":[string],',
  ' "byCriterion":{"pursues":"left"|"right"|"tie","consistent":…,"reactive":…,"social":…,"ignorance":…}}',
].join('\n');

/**
 * The paid path. It takes a `BackendAccess` and goes through `accessBackend`
 * itself, so a judge cannot reach a provider without a budget however it was
 * constructed. Not exercised anywhere in this repo's tests — the mock judge
 * proves the plumbing.
 */
export class LlmTraceJudge implements ITraceJudge {
  readonly id: string;
  private readonly backend: IMindBackend;

  constructor(access: BackendAccess) {
    this.backend = accessBackend(access);
    this.id = `llm-trace-judge:${this.backend.modelId}`;
  }

  async compare(pair: TracePair): Promise<TraceJudgement> {
    const user = [`=== LEFT ===`, pair.left.text, ``, `=== RIGHT ===`, pair.right.text].join('\n');
    // The interface carries a ThinkInput because minds need one; a judge does
    // not, and is handed the emptiest legal situation rather than a fabricated
    // life it might read as evidence.
    const reply = await this.backend.complete({ system: JUDGE_SYSTEM, user }, EMPTY_INPUT);
    return parseJudgement(reply);
  }
}

const EMPTY_INPUT = {
  snapshot: {
    id: 0,
    name: '',
    ageTicks: 0,
    traits: { curiosity: 0, aggression: 0, compassion: 0, ambition: 0, loyalty: 0, riskTolerance: 0 },
    needs: {},
    health: 100,
    sick: false,
    x: 0,
    y: 0,
    inventory: {},
    context: {},
  },
  recalledMemories: [],
  knowledge: [],
  relationships: new Map(),
  worldView: { tick: 0, night: false, season: '', agents: [], resources: [], structures: [] },
  goals: [],
  trigger: 'periodic' as const,
};

function parseJudgement(reply: string): TraceJudgement {
  const start = reply.indexOf('{');
  const end = reply.lastIndexOf('}');
  const fallback: TraceJudgement = {
    preference: 'tie',
    confidence: 0,
    reasons: ['the judge did not answer in JSON'],
    byCriterion: blankCriteria(),
  };
  if (start < 0 || end <= start) return fallback;
  try {
    const parsed: unknown = JSON.parse(reply.slice(start, end + 1));
    if (typeof parsed !== 'object' || parsed === null) return fallback;
    const obj = parsed as Record<string, unknown>;
    const byCriterion = blankCriteria();
    const raw = obj['byCriterion'];
    if (typeof raw === 'object' && raw !== null) {
      for (const criterion of TRACE_CRITERIA) {
        byCriterion[criterion] = asSide((raw as Record<string, unknown>)[criterion]);
      }
    }
    const confidence = typeof obj['confidence'] === 'number' && Number.isFinite(obj['confidence']) ? obj['confidence'] : 0;
    return {
      preference: asSide(obj['preference']),
      confidence: Math.min(1, Math.max(0, confidence)),
      reasons: Array.isArray(obj['reasons']) ? obj['reasons'].filter((r): r is string => typeof r === 'string') : [],
      byCriterion,
    };
  } catch {
    return fallback;
  }
}

function asSide(value: unknown): Side {
  return value === 'left' || value === 'right' ? value : 'tie';
}

function blankCriteria(): Record<TraceCriterion, Side> {
  return { pursues: 'tie', consistent: 'tie', reactive: 'tie', social: 'tie', ignorance: 'tie' };
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}
