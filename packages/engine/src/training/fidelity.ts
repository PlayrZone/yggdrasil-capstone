import type { MindOutput, ThinkInput } from '../contract/types.js';
import type { IMindBackend } from '../consciousness/IMindBackend.js';
import { buildThinkPrompt } from '../consciousness/prompt.js';
import { MindOutputError, parseMindOutputDetailed } from '../consciousness/schema.js';
import { LEXICAL_CALIBRATION, quotableRecall } from './leakCalibrationCard.js';
import type { CalibrationCard } from './leakCalibrationCard.js';
import { PLANTS_THE_SEED, detectActLeak } from './leakActs.js';
import type { ILeakJudge, LeakJudgement } from './leakJudge.js';
import type { LeakDomain, LeakEvidence } from './leakMatch.js';
import { LEAK_DOMAINS, detectLeak, detectLexicalLeaks, suppliedNames, suppliedVocabulary } from './leakMatch.js';
import { leakTrapBattery } from './leakTraps.js';
import type { LeakTrap } from './leakTraps.js';

/**
 * Gate 2: KNOWLEDGE FIDELITY. The mind must reason ONLY from what it was given.
 *
 * The gate is TIERED, and it says what each tier proves:
 *
 *   TIER 1 (structural) — the being ACTED on a fact it does not hold: a plan,
 *     read against the closed intent vocabulary and against the ground the
 *     probe did or did not supply. Not gameable by wording.
 *   TIER 2 (lexical) — it ASSERTED one. A HIGH-PRECISION LOWER BOUND: its job
 *     is to be right when it fires, not to find everything, and the recall it
 *     actually has was measured BLIND by a reviewer on a set this repo has
 *     never seen (`leakCalibrationCard.ts`). The verdict quotes that number and
 *     may never quote one above it (`quotableRecall`).
 *   TIER 3 (judge) — a reader. Optional, behind the caller's cost guard.
 *
 * And it reports four rates beside the leak rate, because round 1 was passed by
 * three policies with no comprehension at all: how many controls the mind acted
 * on (a mind that never acts cannot pass), how much it hedged (hedging is not
 * an amnesty), how much it simply echoed its prompt back, and how much of its
 * output could not be read at all.
 *
 * The verdicts:
 *   FAIL                — a leak was found, or a bar was missed.
 *   NO LEAK DETECTED (r)— nothing found, by a detector of BLIND recall r.
 *   PASS                — and a calibrated JUDGE also found nothing.
 * There is no path from lexical evidence alone to PASS. That is the point.
 */

export type FidelityVerdict = 'FAIL' | 'NO LEAK DETECTED' | 'PASS';

export interface FidelityViolation {
  probeId: string;
  domain: LeakDomain;
  control: boolean;
  /** What a pretrained model finds obvious here and this being was never shown. */
  temptation: string;
  evidence: LeakEvidence[];
  rawOutput: string;
}

export interface FidelityDomainScore {
  domain: LeakDomain;
  traps: number;
  /** Traps with tier-1 or tier-2 assertive evidence. */
  leaks: number;
  leakRate: number;
  /** Traps whose only evidence was hedged. */
  speculative: number;
  controls: number;
  /** Controls where the being DID use the ground it held. */
  controlsActed: number;
  controlActRate: number;
  /** Controls that used their ground AND helped themselves to another domain. */
  overreach: number;
}

export interface FidelityResult {
  probes: number;
  traps: number;
  controls: number;
  /** Traps with a leak found by tier 1 or tier 2. */
  leaks: number;
  leakRate: number;
  /** The honest headline: leaks FOUND / traps, by a detector of known recall. */
  leakRateLowerBound: number;
  /** 1 − leakRate. Kept because every reader of this gate prints it. */
  cleanRate: number;
  structuralLeaks: number;
  lexicalLeaks: number;
  /** Probes whose only evidence was a hedge that still reached past the input. */
  speculativeProbes: number;
  speculativeRate: number;
  /** Controls that used their ground and then took a step from another domain. */
  controlOverreach: number;
  controlsActed: number;
  controlActRate: number;
  /** Outputs that were mostly the prompt handed back. Comprehension, measured. */
  echoes: number;
  echoRate: number;
  unparsed: number;
  unparsedRate: number;
  detector: { id: string; recall: number; measuredOn: string };
  judge: { id: string; asked: number; leak: number; clean: number; unsure: number } | null;
  byDomain: FidelityDomainScore[];
  violations: FidelityViolation[];
  verdict: FidelityVerdict;
  /** The verdict in words, recall included. This is what a report quotes. */
  verdictDetail: string;
  /** Every bar that was missed, in the order they are checked. */
  failures: string[];
  /** True only for PASS. */
  passed: boolean;
}

export interface FidelityOptions {
  /** Restrict to these domains; default all eight. */
  domains?: readonly LeakDomain[];
  /** Cap the number of backend calls (traps and controls together). */
  limit?: number;
  /** Traps allowed to leak. Default 0 — a leak found is a fail. */
  maxLeakedTraps?: number;
  /** Minimum share of controls the mind acted on. Default 0.8. */
  minControlActRate?: number;
  /** Largest share of probes that may carry hedged leaks. Default 0.1. */
  maxSpeculativeRate?: number;
  /** Largest share of outputs that may be the prompt echoed back. Default 0.1. */
  maxEchoRate?: number;
  /** Largest share of outputs the parser may refuse. Default 0.05. */
  maxUnparsedRate?: number;
  /** A calibrated reader. Without one the gate can never print PASS. */
  judge?: ILeakJudge;
  /** Ask the judge only about probes tiers 1–2 called clean. Default true. */
  judgeCleanOnly?: boolean;
  /** Override the battery entirely (a held-out set). Default `leakTrapBattery()`. */
  battery?: readonly LeakTrap[];
  /** The card the reported recall comes from. Default the shipped lexical card. */
  card?: CalibrationCard;
  /** Share of an output's own words that came from its prompt. Default 0.9. */
  echoThreshold?: number;
}

/**
 * Run the battery. Pure and backend-agnostic: no world, no file, no clock.
 */
export async function evalKnowledgeFidelity(
  backend: IMindBackend,
  options: FidelityOptions = {},
): Promise<FidelityResult> {
  const maxLeakedTraps = options.maxLeakedTraps ?? 0;
  const minControlActRate = options.minControlActRate ?? 0.8;
  const maxSpeculativeRate = options.maxSpeculativeRate ?? 0.1;
  const maxEchoRate = options.maxEchoRate ?? 0.1;
  const maxUnparsedRate = options.maxUnparsedRate ?? 0.05;
  const echoThreshold = options.echoThreshold ?? 0.9;
  const card = options.card ?? LEXICAL_CALIBRATION;
  const judgeCleanOnly = options.judgeCleanOnly ?? true;

  const wanted = options.domains ? new Set(options.domains) : null;
  let battery = (options.battery ?? leakTrapBattery()).filter((t) => !wanted || wanted.has(t.domain));
  if (options.limit !== undefined) battery = battery.slice(0, options.limit);

  const violations: FidelityViolation[] = [];
  const perDomain = new Map<LeakDomain, FidelityDomainScore>();
  let traps = 0;
  let controls = 0;
  let leaks = 0;
  let structuralLeaks = 0;
  let lexicalLeaks = 0;
  let speculativeProbes = 0;
  let controlOverreach = 0;
  let controlsActed = 0;
  let echoes = 0;
  let unparsed = 0;
  const judgeCounts = { asked: 0, leak: 0, clean: 0, unsure: 0 };
  const judgeLeaks: string[] = [];

  for (const probe of battery) {
    const score = domainScore(perDomain, probe.domain);
    const prompt = buildThinkPrompt(probe.input);
    let output: MindOutput | null = null;
    let raw = '';
    try {
      raw = await backend.complete(prompt, probe.input);
      output = parseMindOutputDetailed(raw).output;
    } catch (err) {
      if (!(err instanceof MindOutputError)) throw err; // transport errors surface
      unparsed++;
    }

    const read = output ? readOutput(probe, output) : EMPTY_READ;
    if (output && echoScore(output, probe.input, prompt.user) >= echoThreshold) echoes++;

    if (probe.control) {
      controls++;
      score.controls++;
      if (read.acted) {
        controlsActed++;
        score.controlsActed++;
      }
      if (read.leaks.length > 0) {
        controlOverreach++;
        score.overreach++;
        violations.push({ probeId: probe.id, domain: probe.domain, control: true, temptation: probe.temptation, evidence: read.leaks, rawOutput: raw });
      }
    } else {
      traps++;
      score.traps++;
      if (read.leaks.length > 0) {
        leaks++;
        score.leaks++;
        if (read.leaks.some((e) => e.tier === 1)) structuralLeaks++;
        if (read.leaks.some((e) => e.tier === 2)) lexicalLeaks++;
        violations.push({ probeId: probe.id, domain: probe.domain, control: false, temptation: probe.temptation, evidence: read.leaks, rawOutput: raw });
      }
    }
    if (read.leaks.length === 0 && read.speculative.length > 0) {
      speculativeProbes++;
      if (!probe.control) score.speculative++;
    }

    if (options.judge && output && (!judgeCleanOnly || read.leaks.length === 0)) {
      const verdict = await options.judge.judge({
        domain: probe.domain,
        temptation: probe.temptation,
        input: probe.input,
        output,
        raw,
        ...(probe.control ? { grounded: probe.domain } : {}),
      });
      judgeCounts.asked++;
      bump(judgeCounts, verdict.judgement);
      if (verdict.judgement === 'leak') judgeLeaks.push(`${probe.id}: ${verdict.span ?? verdict.reason ?? ''}`);
    }
  }

  const probes = traps + controls;
  const byDomain = [...perDomain.values()]
    .map((d) => ({ ...d, leakRate: rate(d.leaks, d.traps), controlActRate: rate(d.controlsActed, d.controls) }))
    .sort((a, b) => (a.domain < b.domain ? -1 : 1));

  const leakRate = rate(leaks, traps);
  const controlActRate = rate(controlsActed, controls);
  const speculativeRate = rate(speculativeProbes, probes);
  const echoRate = rate(echoes, probes);
  const unparsedRate = rate(unparsed, probes);

  const failures: string[] = [];
  if (traps === 0) failures.push('no traps ran');
  if (leaks > maxLeakedTraps) failures.push(`${leaks} of ${traps} traps leaked (allowed ${maxLeakedTraps})`);
  if (controlOverreach > 0) failures.push(`${controlOverreach} controls took a step from a domain they hold no ground in`);
  if (controls === 0 || controlActRate < minControlActRate) {
    failures.push(`acted on ${controlsActed} of ${controls} controls (need ${minControlActRate})`);
  }
  if (speculativeRate > maxSpeculativeRate) failures.push(`hedged leaks on ${speculativeProbes} of ${probes} probes (allowed ${maxSpeculativeRate})`);
  if (echoRate > maxEchoRate) failures.push(`${echoes} of ${probes} outputs were the prompt handed back (allowed ${maxEchoRate})`);
  if (unparsedRate > maxUnparsedRate) failures.push(`${unparsed} of ${probes} outputs could not be read (allowed ${maxUnparsedRate})`);
  if (judgeLeaks.length > 0) failures.push(`the judge found ${judgeLeaks.length} leaks: ${judgeLeaks.slice(0, 3).join('; ')}`);

  const judgeRan = options.judge !== undefined && judgeCounts.asked > 0;
  const verdict: FidelityVerdict = failures.length > 0 ? 'FAIL' : judgeRan ? 'PASS' : 'NO LEAK DETECTED';
  // The blind number, never the one the engineer measured on their own set.
  const recall = quotableRecall(card);

  return {
    probes,
    traps,
    controls,
    leaks,
    leakRate,
    leakRateLowerBound: leakRate,
    cleanRate: rate(traps - leaks, traps),
    structuralLeaks,
    lexicalLeaks,
    speculativeProbes,
    speculativeRate,
    controlOverreach,
    controlsActed,
    controlActRate,
    echoes,
    echoRate,
    unparsed,
    unparsedRate,
    detector: { id: card.detector, recall, measuredOn: card.blind.set },
    judge: options.judge ? { id: options.judge.id, ...judgeCounts } : null,
    byDomain,
    violations,
    verdict,
    verdictDetail: verdictText(verdict, {
      leaks,
      traps,
      recall,
      detector: card.detector,
      measuredOn: card.blind.set,
      failures,
      judge: options.judge?.id,
    }),
    failures,
    passed: verdict === 'PASS',
  };
}

interface ProbeRead {
  /** Evidence that counts as a leak here. */
  leaks: LeakEvidence[];
  /** Hedged evidence — its own class, bounded separately. */
  speculative: LeakEvidence[];
  /** Control arm: did the being use the ground it holds? */
  acted: boolean;
}

const EMPTY_READ: ProbeRead = { leaks: [], speculative: [], acted: false };

/**
 * What one output means on one probe.
 *
 * On a TRAP, anything from any domain is a leak: the being holds ground for
 * none of them. (Round 1 asked only the trap's own domain, which is why
 * metallurgy recited on a fire trap scored clean.)
 *
 * On a CONTROL, its own domain is what it is SUPPOSED to use — measured
 * strictly, because hedged use is still use — and every OTHER domain is a leak,
 * which is the control-overreach class round 1 could not see at all.
 */
function readOutput(probe: LeakTrap, output: MindOutput): ProbeRead {
  const supplied = suppliedVocabulary(probe.input);
  const names = suppliedNames(probe.input);
  const others = LEAK_DOMAINS.filter((d) => !probe.control || d !== probe.domain);
  const lexical = detectLexicalLeaks(output, { supplied, names }, others);
  // Tier 1: this probe's own armed rules, plus the one act rule that is
  // unambiguous anywhere — burying seed after seed is farming on any probe.
  const acts = [
    ...detectActLeak(probe.acts, output),
    ...(probe.domain === 'cultivation' ? [] : detectActLeak(PLANTS_THE_SEED, output)),
  ];
  const leaks = [...acts, ...lexical.filter((e) => e.kind === 'claim')];
  return {
    leaks,
    speculative: lexical.filter((e) => e.kind === 'speculative'),
    // Hedged use of its own ground is still use — a being that says "perhaps
    // the tale is true" about the thing it holds has acted on it.
    acted: probe.control ? detectLeak(probe.domain, output, { names, hedgedCounts: true }).length > 0 : false,
  };
}

/**
 * How much of what the being SAID it simply lifted out of its own prompt.
 *
 * Jaccard is the wrong measure here: an echo of 600 characters inside a 3 KB
 * prompt scores low however completely it was copied. Containment is the right
 * one — of everything it said, how much came from the prompt — with one
 * exception that matters: a being retelling a tale it carries, or stating a
 * belief it holds, is repeating the prompt ON PURPOSE, and that is the whole
 * behaviour the control arm is measuring. So its own repeatables are removed
 * first, and what is left is what the echo score is about.
 */
function echoScore(output: MindOutput, input: ThinkInput, user: string): number {
  const said = [output.thought ?? '', ...output.utterances.map((u) => u.text ?? '')].join(' ').trim();
  const own = shingleSet(
    [
      ...(input.stories ?? []).map((st) => st.text),
      input.mostTold ?? '',
      ...input.knowledge.map((k) => k.statement),
      ...input.recalledMemories.map((m) => m.summaryText),
    ].join(' '),
  );
  const novel = [...shingleSet(said)].filter((sh) => !own.has(sh));
  if (novel.length < 20) return 0; // a retelling is not an echo
  const prompt = shingleSet(user);
  return novel.filter((sh) => prompt.has(sh)).length / novel.length;
}

/** Five-token shingles. Local because containment is not Jaccard. */
function shingleSet(text: string): Set<string> {
  const tokens = text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + 5 <= tokens.length; i++) out.add(tokens.slice(i, i + 5).join(' '));
  return out;
}

/**
 * The verdict, in the words a report quotes. The recall in it is
 * `quotableRecall` — the BLIND measurement — and the set it was measured on is
 * named, because round 2 printed "measured recall 0.944" from the engineer's
 * own holdout while the blind number was 0.412, which is the same overstatement
 * round 1 was failed for, moved onto the verdict string.
 */
function verdictText(
  verdict: FidelityVerdict,
  ctx: { leaks: number; traps: number; recall: number; detector: string; measuredOn: string; failures: string[]; judge?: string },
): string {
  if (verdict === 'FAIL') return `FAIL — ${ctx.failures.join('; ')}`;
  if (verdict === 'PASS') return `PASS — no leak found by tiers 1–2 or by the judge (${ctx.judge})`;
  return (
    `NO LEAK DETECTED over ${ctx.traps} traps by ${ctx.detector} ` +
    `(blind recall ${ctx.recall} on ${ctx.measuredOn}) — not a clean bill, a bound`
  );
}

function bump(counts: { leak: number; clean: number; unsure: number }, judgement: LeakJudgement): void {
  if (judgement === 'leak') counts.leak++;
  else if (judgement === 'clean') counts.clean++;
  else counts.unsure++;
}

function domainScore(map: Map<LeakDomain, FidelityDomainScore>, domain: LeakDomain): FidelityDomainScore {
  let score = map.get(domain);
  if (!score) {
    map.set(domain, (score = {
      domain, traps: 0, leaks: 0, leakRate: 0, speculative: 0, controls: 0, controlsActed: 0, controlActRate: 0, overreach: 0,
    }));
  }
  return score;
}

function rate(n: number, d: number): number {
  return d > 0 ? Math.round((n / d) * 10000) / 10000 : 0;
}
