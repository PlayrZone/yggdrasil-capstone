import type { MindOutput, ThinkInput } from '../contract/types.js';
import { COMMON_WORD_FORMS } from '../training/commonWords.js';
import { LEXICAL_CALIBRATION, quotableRecall } from '../training/leakCalibrationCard.js';
import type { CalibrationCard } from '../training/leakCalibrationCard.js';
import type { ILeakJudge, LeakJudgement } from '../training/leakJudge.js';
import { LEAK_DOMAINS, detectLexicalLeaks, stemWord, suppliedNames, suppliedVocabulary } from '../training/leakMatch.js';
import type { LeakDomain, LeakEvidence } from '../training/leakMatch.js';
import { DISAVOWALS, admitsIgnorance } from './disavowal.js';
import { FORAGER_PROBES } from './probes/forager.js';
import type { IgnoranceProbe } from './probes/forager.js';
import type { IInterviewee } from './types.js';

/**
 * THE IGNORANCE PROBE — audit 04 §5 #1, "the single most discriminating test".
 *
 * Interview a being OUTSIDE the causal flow. Nothing here advances a tick,
 * writes a memory, forms a belief or reaches the event bus: the subject is a
 * `ThinkInput` that was already built (the runner keeps the one its backend was
 * handed) and an `IInterviewee` that turns a situation plus a question into an
 * answer the way THAT mind would. Arm A answers through the Yggdrasil prompt;
 * arm B answers through its own window. Both are asked the same words.
 *
 * Scoring is three separate questions, never collapsed into one:
 *   DID IT LEAK?      tier-2 lexical claims (the existing high-precision lower
 *                     bound, recall stated) plus, when one is supplied, the
 *                     `ILeakJudge` seam — the only tier that reads paraphrase.
 *   DID IT SAY SO?    an explicit disavowal, in the world's own words.
 *   IS THE CONTROL GROUNDED? does the answer cite something actually in this
 *                     being's knowledge, memories, inventory or perception —
 *                     so that "I do not know" to everything cannot pass.
 */

export interface ProbeSubject {
  beingId: number;
  /** The situation, exactly as this mind was last given it. Never rebuilt here. */
  input: ThinkInput;
  interviewee: IInterviewee;
}

export interface IgnoranceOptions {
  probes?: readonly IgnoranceProbe[];
  /** Already budget-wrapped by the caller (`accessLeakJudge`). */
  judge?: ILeakJudge;
  /** The world's words for "I do not know". Default English. */
  disavowals?: readonly string[];
  /** Cap on interviews (subjects × probes). */
  limit?: number;
  /** The card the reported detector recall comes from. */
  card?: CalibrationCard;
  /** Content stems an answer must hit to count as grounded. Default 1. */
  minCitations?: number;
}

export interface ProbeAnswer {
  probeId: string;
  topic: string;
  kind: 'absent' | 'control';
  beingId: number;
  question: string;
  answer: string;
  /** Tier-2 assertive evidence. A lower bound, never a clean bill. */
  evidence: LeakEvidence[];
  leaked: boolean;
  judgement?: LeakJudgement;
  judgeSpan?: string;
  admittedIgnorance: boolean;
  /** Control arm: stems of its own situation that the answer actually used. */
  citations: string[];
  grounded: boolean;
  /** Nothing came back at all — an empty answer is not an admission. */
  empty: boolean;
}

export interface IgnoranceReport {
  answers: ProbeAnswer[];
  absent: {
    asked: number;
    leaked: number;
    admitted: number;
    empty: number;
    leakRateLowerBound: number;
    admissionRate: number;
  };
  controls: {
    asked: number;
    grounded: number;
    groundRate: number;
    overreach: number;
    /**
     * Controls it answered by saying it did not know, citing nothing. Some are
     * honest — a being carrying nothing really has nothing to say about what it
     * carries — and some are a mind hiding behind the disavowal. The two are
     * reported apart from `grounded` rather than folded into it, because a mind
     * whose controls are ALL of this has demonstrated nothing at all.
     */
    disavowed: number;
  };
  /**
   * The signature, in one number: how often it said it did not know about
   * things it was never shown, minus how often it leaked, times how well it
   * still answered about its own life. 1 is perfect, ≤ 0 is a plain LLM.
   */
  separation: number;
  detector: { id: string; recall: number; measuredOn: string };
  judge: { id: string; asked: number; leak: number; clean: number; unsure: number } | null;
  interviews: number;
}

export async function runIgnoranceProbe(
  subjects: readonly ProbeSubject[],
  options: IgnoranceOptions = {},
): Promise<IgnoranceReport> {
  const probes = options.probes ?? FORAGER_PROBES;
  const disavowals = options.disavowals ?? DISAVOWALS;
  const card = options.card ?? LEXICAL_CALIBRATION;
  const minCitations = options.minCitations ?? 1;
  const judgeCounts = { asked: 0, leak: 0, clean: 0, unsure: 0 };
  const answers: ProbeAnswer[] = [];

  let interviews = 0;
  outer: for (const subject of subjects) {
    const supplied = suppliedVocabulary(subject.input);
    const names = suppliedNames(subject.input);
    const content = contentStems(subject.input);
    for (const probe of probes) {
      if (options.limit !== undefined && interviews >= options.limit) break outer;
      interviews++;
      const answer = (await subject.interviewee.interview({ input: subject.input, question: probe.question })).trim();
      const said = asOutput(answer);
      const domains = probe.kind === 'control' ? controlDomains(probe) : (probe.domains ?? LEAK_DOMAINS);
      const evidence = detectLexicalLeaks(said, { supplied, names }, domains).filter((e) => e.kind === 'claim');
      const citations = citationsIn(answer, content);
      const record: ProbeAnswer = {
        probeId: probe.id,
        topic: probe.topic,
        kind: probe.kind,
        beingId: subject.beingId,
        question: probe.question,
        answer,
        evidence,
        leaked: evidence.length > 0,
        admittedIgnorance: answer.length > 0 && admitsIgnorance(answer, disavowals),
        citations,
        grounded: probe.kind === 'control' && answer.length > 0 && citations.length >= minCitations,
        empty: answer.length === 0,
      };
      if (options.judge && answer.length > 0) {
        const verdict = await options.judge.judge({
          domain: probe.domains?.[0] ?? 'toolmaking',
          temptation: probe.temptation,
          input: subject.input,
          output: said,
          raw: answer,
        });
        judgeCounts.asked++;
        if (verdict.judgement === 'leak') judgeCounts.leak++;
        else if (verdict.judgement === 'clean') judgeCounts.clean++;
        else judgeCounts.unsure++;
        record.judgement = verdict.judgement;
        if (verdict.span) record.judgeSpan = verdict.span;
        // A judge that READ a leak is a leak, whatever the lexicon found.
        if (verdict.judgement === 'leak') record.leaked = true;
      }
      answers.push(record);
    }
  }

  const absentAnswers = answers.filter((a) => a.kind === 'absent');
  const controlAnswers = answers.filter((a) => a.kind === 'control');
  const leaked = absentAnswers.filter((a) => a.leaked).length;
  const admitted = absentAnswers.filter((a) => a.admittedIgnorance && !a.leaked).length;
  const grounded = controlAnswers.filter((a) => a.grounded).length;
  const overreach = controlAnswers.filter((a) => a.leaked).length;
  const disavowed = controlAnswers.filter((a) => !a.grounded && a.admittedIgnorance).length;

  const admissionRate = rate(admitted, absentAnswers.length);
  const leakRate = rate(leaked, absentAnswers.length);
  const groundRate = rate(grounded, controlAnswers.length);

  return {
    answers,
    absent: {
      asked: absentAnswers.length,
      leaked,
      admitted,
      empty: absentAnswers.filter((a) => a.empty).length,
      leakRateLowerBound: leakRate,
      admissionRate,
    },
    controls: { asked: controlAnswers.length, grounded, groundRate, overreach, disavowed },
    separation: round((admissionRate - leakRate) * groundRate),
    detector: { id: card.detector, recall: quotableRecall(card), measuredOn: card.blind.set },
    judge: options.judge ? { id: options.judge.id, ...judgeCounts } : null,
    interviews,
  };
}

/**
 * On a CONTROL the being is supposed to use its own ground, so its own domain
 * is not a leak — but every other one still is, which is the control-overreach
 * class the fidelity gate measures too. A control names no domain, so the whole
 * lexicon applies minus nothing: a control question about what it carries has
 * no domain to exempt.
 */
function controlDomains(probe: IgnoranceProbe): readonly LeakDomain[] {
  const own = new Set(probe.domains ?? []);
  return LEAK_DOMAINS.filter((d) => !own.has(d));
}

/** One free-text answer, shaped so the existing leak matcher can read it. */
function asOutput(answer: string): MindOutput {
  return { goals: [], plan: [], utterances: answer.length > 0 ? [{ speechAct: 'inform', text: answer }] : [] };
}

/**
 * The stems of things this being actually holds. Two sources, filtered
 * differently, and the difference matters:
 *
 *   NAMED THINGS — the kinds in its hands, the kinds in its sight, the people
 *     it knows, the season it is in. Taken whole. These are the world's own
 *     nouns and several of them ARE ordinary English (`river`, `water`,
 *     `stone`); filtering them as common words made "where I stand I can see
 *     river" count as citing nothing at all.
 *   FREE TEXT — belief statements, episode summaries, tales, goals. Ordinary
 *     English is stripped here, so that repeating "and the" back is not a
 *     citation.
 */
function contentStems(input: ThinkInput): Set<string> {
  const common = new Set(COMMON_WORD_FORMS.map((w) => stemWord(w)).filter(Boolean));
  const stems = new Set<string>();
  const addNamed = (text: string): void => {
    for (const token of text.split(/[^\p{L}\p{N}]+/u)) {
      const stem = stemWord(token);
      if (stem && stem.length > 2) stems.add(stem);
    }
  };
  const addProse = (text: string): void => {
    for (const token of text.split(/[^\p{L}\p{N}]+/u)) {
      const stem = stemWord(token);
      if (stem && stem.length > 2 && !common.has(stem)) stems.add(stem);
    }
  };
  for (const kind of Object.keys(input.snapshot.inventory)) addNamed(kind);
  for (const r of input.worldView.resources) addNamed(r.kind);
  for (const s of input.worldView.structures) addNamed(s.kind);
  for (const person of input.social ?? []) addNamed(person.name);
  for (const relative of input.kin ?? []) addNamed(relative.name);
  addNamed(input.worldView.season);
  addNamed(input.snapshot.name);
  for (const k of input.knowledge) addProse(k.statement);
  for (const m of input.recalledMemories) addProse(m.summaryText);
  for (const story of input.stories ?? []) addProse(story.text);
  for (const goal of input.goals) addProse(goal.description);
  return stems;
}

function citationsIn(answer: string, content: ReadonlySet<string>): string[] {
  const hit = new Set<string>();
  for (const token of answer.split(/[^\p{L}\p{N}]+/u)) {
    const stem = stemWord(token);
    if (stem && content.has(stem)) hit.add(stem);
  }
  return [...hit].sort();
}

function rate(n: number, d: number): number {
  return d > 0 ? round(n / d) : 0;
}

function round(v: number): number {
  return Math.round(v * 10000) / 10000;
}
