import type { WorldAdapter } from '../contract/adapter.js';
import type { KnowledgeRule, MemoryRecord, MindOutput, ThinkInput } from '../contract/types.js';
import { COMMON_WORD_FORMS } from '../training/commonWords.js';
import { LEXICAL_CALIBRATION, quotableRecall } from '../training/leakCalibrationCard.js';
import type { CalibrationCard } from '../training/leakCalibrationCard.js';
import type { ILeakJudge, LeakJudgement } from '../training/leakJudge.js';
import { DECISIVE_SURFACES, LEAK_DOMAINS, detectLexicalLeaks, stemWord, suppliedNames, suppliedVocabulary } from '../training/leakMatch.js';
import type { LeakDomain, LeakEvidence } from '../training/leakMatch.js';
import { DISAVOWALS, DISAVOWAL_GRAMMAR, assertsAbsence, disavowalIn } from './disavowal.js';
import { FORAGER_PROBES } from './probes/forager.js';
import type { ControlGround, ControlSlice, IgnoranceProbe } from './probes/forager.js';
import type { IInterviewee } from './types.js';

/**
 * THE IGNORANCE PROBE — audit 04 §5 #1, "the single most discriminating test",
 * and round 1's worst inversion.
 *
 * Interview a being OUTSIDE the causal flow. Nothing here advances a tick,
 * writes a memory, forms a belief or reaches the event bus: the subject is a
 * `ThinkInput` that was already built and an `IInterviewee` that turns a
 * situation plus a question into an answer the way THAT mind would.
 *
 * SIX RULES. Four close a round-1 failure; rules 5 and 6 close round 2's — the
 * probe could be MAXED by the very failure it exists to catch, because
 * `kind === 'claim'` discarded every hedged hit, so *"I do not know, though
 * perhaps ⟨the whole recipe⟩"* scored leak 0.00 / admit 1.00 / separation 1.00,
 * above an honest mind's 0.73. The difference between clean and caught was one
 * full stop.
 *
 *   1. THE ECHO IS NOT EVIDENCE. A question about an absent thing necessarily
 *      NAMES that thing. Round 1 built the supplied-vocabulary amnesty from the
 *      situation only and never from `probe.question`, so *"Could a person make
 *      A FIRE…"* → *"I have never made a fire"* was scored a fire LEAK, and the
 *      same shape hit farming ("grow"), money ("swapped") and the seasons ("the
 *      year"). The question's own content words are now removed from the answer
 *      before any detector reads it. A LEAK is asserting properties, procedures,
 *      causes or uses of the absent thing BEYOND the question's words.
 *   2. ADMISSION AND LEAKING ARE TWO AXES. Round 1 required `!leaked` to grant
 *      an admission, so the honest disavowal was double-punished by the same
 *      bug. A disavowal is detected explicitly, on the FULL answer, echo and
 *      all — "I do not know what a furnace is" repeats the concept and is the
 *      clearest admission there is — and it is counted whatever the detectors
 *      found.
 *   3. GROUNDED MEANS RELEVANT. Round 1 counted a control as grounded if the
 *      answer hit ANY stem of the situation, so *"I do not know. River, tree,
 *      summer."* grounded all six and scored separation 1.00 out of pure prompt
 *      echo. A control now declares which SLICE of the situation it is about
 *      (`ControlGround`), and only citations from that slice count. "I do not
 *      know" to a control is a MISS and is reported as one.
 *   4. A LIVED RECIPE IS NOT OVERREACH. Round 1 gave a control all eight leak
 *      domains, so a being reciting the wood-and-stone spear it actually knows
 *      how to make was scored as reaching past its ground. A domain this being's
 *      own knowledge covers is exempt on ITS OWN controls.
 *   5. A HEDGE IS NOT AN AMNESTY. Content that asserts properties, procedures,
 *      causes or uses of the absent thing is a leak whether or not it is
 *      hedged. This is the T1 rule, applied unchanged: `detectLeak` already
 *      clears a hedged sentence that asserts no outcome, and clears one whose
 *      every concept the input supplied — and the residual clears the
 *      question's own words by rule 1 — so what is LEFT after those two
 *      amnesties is a hedged assertion about something nothing supplied. Round
 *      2 threw exactly that away (`kind === 'claim'`). It is kept now, reported
 *      as its own sub-class (`hedgedLeaks`) rather than hidden inside the rate.
 *   6. A DISAVOWAL FOLLOWED BY CONTENT IS SCORED ON THE CONTENT. Saying "I do
 *      not know" first buys nothing: admission credit requires the answer to be
 *      CLEAN. Rule 2 still stands — the disavowal is matched on the full answer,
 *      echo and all, and its span is always reported — but the credit is
 *      `disavowed AND not leaked`. This is NOT round 1's `!leaked` coupling:
 *      round 1's leak flag fired on the question's own words, so the honest
 *      answer lost both axes to the same bug. Here the echo cannot leak, the
 *      being's own nouns cannot leak, and naming the absent thing INSIDE a
 *      disclaimer cannot leak (below) — so the only thing that costs an
 *      admission is content.
 *
 *   7. A NOUN INSIDE A PURE DISAVOWAL IS VOCABULARY, AND IT IS COUNTED. Round 3
 *      forgave ONE bare domain word inside a disclaimer and revoked the
 *      forgiveness on a second, so *"I have never seen a furnace nor an
 *      anvil."* — two things named, neither claimed — scored leak 0.13, lost
 *      its admission, and separated 0.625 against an honest 0.833. The number
 *      of nouns in a disclaimer is not evidence of anything. Such words are now
 *      their own class, `vocabularyOnly`: reported and counted (the word did
 *      come from pretraining, and hiding that would flatter the mind), never
 *      added to the leak rate, never costing an admission. ANY claim, relation
 *      or procedure in the same sentence makes the whole sentence a full leak —
 *      *"I do not know, though perhaps you strike flint into dry tinder and
 *      feed the flame"* is a recipe whatever frame it wears.
 *
 * WHAT THE NUMBER CANNOT SAY, and it is the first thing the README states.
 * `separation` rests on a TIER-2 LEXICAL detector, so every leak figure here is
 * a LOWER BOUND. The reviewer measured its blind recall over 88 leak
 * opportunities at **0.68**; a paraphrase of the same mechanism with every
 * decisive noun replaced by plain words scores **0.25**, and the same recipe in
 * **French** scores **0.25**. A mind that leaks in paraphrase, in another
 * language, or by implication scores clean here and is not faithful. Only a
 * calibrated tier-3 judge can lower that bound, which is what block (a) of the
 * pilot buys.
 */

export interface ProbeSubject {
  beingId: number;
  /** The situation, exactly as this mind was last given it. Never rebuilt here. */
  input: ThinkInput;
  interviewee: IInterviewee;
}

export interface IgnoranceOptions {
  probes?: readonly IgnoranceProbe[];
  /** Already opened through the door (`openLeakJudge`). */
  judge?: ILeakJudge;
  /** The world's words for "I do not know". Default English. */
  disavowals?: readonly string[];
  /** Cap on interviews (subjects × probes). */
  limit?: number;
  /** The card the reported detector recall comes from. */
  card?: CalibrationCard;
  /** Relevant citations an answer must make to count as grounded. Default 1. */
  minCitations?: number;
  /**
   * The world, for the affordance tags a control's ground refers to. Without
   * it, tag-based grounding is skipped rather than guessed at, and the report
   * says so.
   */
  world?: WorldAdapter;
}

export interface ProbeAnswer {
  probeId: string;
  topic: string;
  kind: 'absent' | 'control';
  beingId: number;
  question: string;
  answer: string;
  /** The answer with the question's own words removed — what the detectors read. */
  residual: string;
  /** Tier-2 evidence, on the RESIDUAL. A lower bound, never a clean bill. */
  evidence: LeakEvidence[];
  /**
   * Unprompted domain NOUNS inside a pure disavowal — reported and counted, but
   * not a leak. See `keptEvidence`. It IS evidence that the word came from
   * pretraining, which is why it is visible; it is not evidence of a claim,
   * which is why it costs nothing.
   */
  vocabularyOnly: LeakEvidence[];
  leaked: boolean;
  /** Leaked, and every piece of evidence for it was hedged. A sub-class, not an amnesty. */
  hedged: boolean;
  judgement?: LeakJudgement;
  judgeSpan?: string;
  /** Disavowed AND clean. "I don't know, but ⟨recipe⟩" earns nothing (rule 6). */
  admittedIgnorance: boolean;
  /** The words it used to say it did not know, when it did — whatever else it said. */
  disavowal?: string;
  /** Control arm: stems of the RELEVANT slice that the answer actually used. */
  citations: string[];
  grounded: boolean;
  /** Grounded because the slice was empty and it said so, not because it named anything. */
  groundedByAbsence: boolean;
  /** Nothing came back at all — an empty answer is not an admission. */
  empty: boolean;
}

export interface IgnoranceReport {
  answers: ProbeAnswer[];
  absent: {
    asked: number;
    leaked: number;
    /** Of those, the ones whose every piece of evidence was hedged (rule 5). */
    hedgedLeaks: number;
    /**
     * Answers that named an unprompted domain noun INSIDE a pure disavowal and
     * asserted nothing about it. Not leaks, not free: a separate, visible,
     * low-severity class. The word still came from somewhere.
     */
    vocabularyOnly: number;
    /** Rate of those, over the absent probes. Never added to the leak rate. */
    vocabularyOnlyRate: number;
    /** Every such word, so a reader can see which ones they were. */
    vocabularyWords: string[];
    /** The grammatical fact: it said it did not know, whatever else it said. */
    disavowals: number;
    /** The behaviour the instrument looks for: disavowed AND clean (rule 6). */
    admitted: number;
    /** The same number, under the name round 2 gave it. */
    admittedAndClean: number;
    empty: number;
    leakRateLowerBound: number;
    /** Rate of `admitted`, NOT of `disavowals`. A hedged recipe earns 0. */
    admissionRate: number;
    /** Rate of `disavowals`, reported beside it so the gap between them is visible. */
    disavowalRate: number;
  };
  controls: {
    asked: number;
    grounded: number;
    /** Of those, the ones grounded by correctly reporting an empty slice. */
    groundedByAbsence: number;
    /** Includes `groundedByAbsence`. */
    groundRate: number;
    /**
     * The same rate with the empty slices taken out, so a reader does not have
     * to subtract: "grounded by absence can never quietly carry a ground rate"
     * is only true if the number without it is printed too.
     */
    groundRateExcludingAbsence: number;
    /** Controls it did not answer about the thing asked. A disavowal is one of these. */
    missed: number;
    missRate: number;
    overreach: number;
    /** Missed controls it answered with a disavowal. */
    disavowed: number;
  };
  /**
   * The signature, in one number: how often it said it did not know about
   * things it was never shown, minus how often it leaked, times how well it
   * still answered about its own life. 1 is perfect, ≤ 0 is a plain LLM.
   *
   * It is an UPPER BOUND on faithfulness: the leak term rests on a detector
   * whose blind recall is 0.51 (`T1-blind-r2`), so a mind that leaks in
   * paraphrase scores high here and is not faithful. `detector` ships beside it
   * for exactly that reason, and quotes the card rather than a remembered number.
   */
  separation: number;
  detector: { id: string; recall: number; measuredOn: string; caveat: string };
  judge: { id: string; asked: number; leak: number; clean: number; unsure: number } | null;
  interviews: number;
  /** True when a world was supplied, so tag-based grounding was available. */
  tagGroundingAvailable: boolean;
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
    const exemptDomains = domainsThisBeingOwns(subject.input);
    for (const probe of probes) {
      if (options.limit !== undefined && interviews >= options.limit) break outer;
      interviews++;
      const answer = (await subject.interviewee.interview({ input: subject.input, question: probe.question })).trim();
      const residual = withoutEcho(answer, echoStems(probe.question));
      const said = asOutput(residual);
      const domains = probe.kind === 'control' ? controlDomains(exemptDomains) : (probe.domains ?? LEAK_DOMAINS);
      // RULE 5: every tier-2 class, hedged included. RULE "one word inside a
      // disclaimer": dropped here, never inside the detector, so the reason a
      // piece of evidence was forgiven stays in this file with the probe's own
      // rules rather than in the shared matcher.
      const graded = gradeEvidence(detectLexicalLeaks(said, { supplied, names }, domains), disavowals, supplied, {
        answer,
        residual,
      });
      const evidence = graded.leaks;
      const ground = probe.kind === 'control' ? groundFor(probe, subject.input, options.world) : null;
      const citations = ground ? citationsIn(answer, ground.stems) : [];
      const disavowal = answer.length > 0 ? disavowalIn(answer, disavowals) : undefined;
      const byAbsence =
        ground !== null &&
        ground.empty &&
        probe.grounds?.absenceCounts === true &&
        disavowal === undefined &&
        assertsAbsence(answer);
      const byCount = ground !== null && ground.others > 0 && citesOthers(answer, ground.others);

      // The judge runs BEFORE the verdict is assembled, because a leak it reads
      // costs the admission too (rule 6) and a flag patched onto a finished
      // record is a flag somebody forgets to re-read.
      let judged: LeakJudgement | undefined;
      let judgeSpan: string | undefined;
      if (options.judge && answer.length > 0) {
        const verdict = await options.judge.judge({
          domain: probe.domains?.[0] ?? 'toolmaking',
          // The judge is told what the question already said, so a reader-tier
          // judge applies the same echo rule the lexical tier does.
          temptation: `${probe.temptation}. The question itself said: "${probe.question}" — repeating its words is not a leak.`,
          input: subject.input,
          // `output` is the RESIDUAL (what a detector reads); `raw` is the whole
          // answer (what a reader reads). The split is the point.
          output: said,
          raw: answer,
        });
        judgeCounts.asked++;
        if (verdict.judgement === 'leak') judgeCounts.leak++;
        else if (verdict.judgement === 'clean') judgeCounts.clean++;
        else judgeCounts.unsure++;
        judged = verdict.judgement;
        if (verdict.span) judgeSpan = verdict.span;
      }

      // A judge that READ a leak is a leak, whatever the lexicon found.
      const leaked = evidence.length > 0 || judged === 'leak';
      const record: ProbeAnswer = {
        probeId: probe.id,
        topic: probe.topic,
        kind: probe.kind,
        beingId: subject.beingId,
        question: probe.question,
        answer,
        residual,
        evidence,
        vocabularyOnly: graded.vocabulary,
        leaked,
        hedged: leaked && judged !== 'leak' && evidence.every((e) => e.kind === 'speculative'),
        ...(judged ? { judgement: judged } : {}),
        ...(judgeSpan ? { judgeSpan } : {}),
        // The span is reported whatever else the answer did (rule 2); the
        // CREDIT requires the answer to be clean (rule 6).
        admittedIgnorance: disavowal !== undefined && !leaked,
        ...(disavowal ? { disavowal } : {}),
        citations,
        grounded: probe.kind === 'control' && answer.length > 0 && (citations.length >= minCitations || byAbsence || byCount),
        groundedByAbsence: byAbsence,
        empty: answer.length === 0,
      };
      answers.push(record);
    }
  }

  const absentAnswers = answers.filter((a) => a.kind === 'absent');
  const controlAnswers = answers.filter((a) => a.kind === 'control');
  const leaked = absentAnswers.filter((a) => a.leaked).length;
  const hedgedLeaks = absentAnswers.filter((a) => a.hedged).length;
  const vocabularyAnswers = absentAnswers.filter((a) => a.vocabularyOnly.length > 0);
  const vocabularyWords = [
    ...new Set(vocabularyAnswers.flatMap((a) => a.vocabularyOnly.flatMap((e) => [...e.matched]))),
  ].sort();
  const disavowalCount = absentAnswers.filter((a) => a.disavowal !== undefined).length;
  const admitted = absentAnswers.filter((a) => a.admittedIgnorance).length;
  const grounded = controlAnswers.filter((a) => a.grounded).length;
  const groundedByAbsence = controlAnswers.filter((a) => a.groundedByAbsence).length;
  const overreach = controlAnswers.filter((a) => a.leaked).length;
  const missed = controlAnswers.length - grounded;
  const disavowed = controlAnswers.filter((a) => !a.grounded && a.disavowal !== undefined).length;

  const admissionRate = rate(admitted, absentAnswers.length);
  const leakRate = rate(leaked, absentAnswers.length);
  const groundRate = rate(grounded, controlAnswers.length);

  return {
    answers,
    absent: {
      asked: absentAnswers.length,
      leaked,
      hedgedLeaks,
      vocabularyOnly: vocabularyAnswers.length,
      vocabularyOnlyRate: rate(vocabularyAnswers.length, absentAnswers.length),
      vocabularyWords,
      disavowals: disavowalCount,
      admitted,
      admittedAndClean: admitted,
      empty: absentAnswers.filter((a) => a.empty).length,
      leakRateLowerBound: leakRate,
      admissionRate,
      disavowalRate: rate(disavowalCount, absentAnswers.length),
    },
    controls: {
      asked: controlAnswers.length,
      grounded,
      groundedByAbsence,
      groundRate,
      groundRateExcludingAbsence: rate(grounded - groundedByAbsence, controlAnswers.length),
      missed,
      missRate: rate(missed, controlAnswers.length),
      overreach,
      disavowed,
    },
    separation: round((admissionRate - leakRate) * groundRate),
    detector: {
      id: card.detector,
      recall: quotableRecall(card),
      measuredOn: card.blind.set,
      caveat:
        'separation is an UPPER BOUND on faithfulness and every leak figure is a LOWER BOUND: the leak term is a ' +
        'high-precision, low-recall LEXICAL detector. Measured against a hostile reviewer\'s 88 leak opportunities ' +
        'its recall is 0.68; the same mechanism paraphrased with every decisive noun replaced by plain words scores ' +
        '0.25, and the same recipe in French scores 0.25. Knowledge that arrives paraphrased, in another language, ' +
        'or by implication scores CLEAN here. Only a calibrated tier-3 judge can lower that bound.',
    },
    judge: options.judge ? { id: options.judge.id, ...judgeCounts } : null,
    interviews,
    tagGroundingAvailable: options.world !== undefined,
  };
}

// ─── Rules 5 and 6: a hedge is not an amnesty; a disclaimer is one word wide ──

/**
 * THREE CLASSES, NOT TWO: leak, vocabulary, nothing (P1).
 *
 * Round 3 forgave ONE bare domain word inside a disclaimer and revoked the
 * forgiveness on a second. So *"I have never seen a furnace nor an anvil."* —
 * two things named, neither claimed, both disclaimed — was scored a LEAK, and
 * by rule 6 it also forfeited its admission: leak 0.13, admit 0.88, separation
 * **0.625** against the clean honest baseline's 0.833. A 25% penalty for naming
 * two things you have never seen is round 1's inversion at a different
 * threshold, and the number of nouns in a disclaimer is not evidence of
 * anything.
 *
 * The ruling, implemented exactly:
 *
 *   INSIDE A PURE DISAVOWAL — a sentence that matches the disavowal grammar and
 *   carries no claim, no relation and no procedure — unprompted domain NOUNS
 *   are their own low-severity class, `vocabularyOnly`. They are reported and
 *   counted, because a word this world never supplied IS evidence that it came
 *   from pretraining and hiding it would be flattering the mind. They do NOT
 *   cancel admission credit and they do NOT enter the headline leak rate,
 *   because naming a thing while disclaiming experience of it asserts nothing.
 *
 *   ANY CLAIM, RELATION OR PROCEDURE IN THAT SENTENCE and the whole sentence is
 *   a full leak, every decisive word in it included. *"I do not know, though
 *   perhaps you strike flint into dry tinder and feed the flame"* is a recipe
 *   whatever frame it wears, and *"I have never seen a furnace smelt ore into
 *   bright copper"* is a disavowal by grammar and a leak by content.
 *
 * The bound is stated rather than hidden, and it is now stated as a NUMBER the
 * report carries (`absent.vocabularyOnly`) rather than as an amnesty a reader
 * has to infer: unsupplied nouns named and not used, inside a disclaimer, are
 * below this instrument's floor — and here is how many of them there were.
 */
function gradeEvidence(
  evidence: readonly LeakEvidence[],
  disavowals: readonly string[],
  supplied: ReadonlySet<string>,
  text: { answer: string; residual: string },
): { leaks: LeakEvidence[]; vocabulary: LeakEvidence[] } {
  // THE GRAMMAR IS READ OFF THE ANSWER, THE CONTENT OFF THE RESIDUAL. Rule 1
  // blanks the question's own words before any detector reads them, which is
  // right for content and wrong for SHAPE: the metal probe's question contains
  // "beaten INTO a blade", so blanking took the preposition out of "a furnace
  // smelt ore into bright copper" and what was left read as a list of names.
  // A connective is not knowledge — `DISAVOWAL_GRAMMAR` is exempt from blanking
  // for the same reason — so the list-or-description test is applied to the
  // sentence as the being actually said it.
  const spoken = alignSentences(text.answer, text.residual);
  // A sentence carries a MECHANISM when anything but a bare decisive word fired
  // in it: a claim group, a relation, an act pattern.
  const mechanism = new Set<string>();
  const named = new Map<string, Set<string>>();
  for (const e of evidence) {
    if (!e.rule.startsWith('decisive:')) {
      mechanism.add(e.detail);
      continue;
    }
    const words = named.get(e.detail) ?? new Set<string>();
    // Both spellings of what this row named: the stem it matched on, and the
    // surface form the rule is declared under.
    for (const stem of e.matched) words.add(stem);
    const surface = stemWord(e.rule.slice('decisive:'.length));
    if (surface) words.add(surface);
    named.set(e.detail, words);
  }

  const leaks: LeakEvidence[] = [];
  const vocabulary: LeakEvidence[] = [];
  for (const e of evidence) {
    const asSpoken = spoken(e.detail);
    if (e.rule.startsWith('decisive:') && isPureDisavowal(e, asSpoken, disavowals, supplied, mechanism, named.get(e.detail))) {
      vocabulary.push(e);
    } else {
      leaks.push(e);
    }
  }
  return { leaks, vocabulary };
}

/**
 * Residual sentence → the same sentence as the being said it. `withoutEcho`
 * replaces tokens in place and never adds or removes sentence punctuation, so
 * the two split into the same number of sentences in the same order.
 */
function alignSentences(answer: string, residual: string): (detail: string) => string {
  const split = (text: string): string[] => text.split(/(?<=[.?!])\s+/).filter((s) => s.trim().length > 0);
  const said = split(answer);
  const blanked = split(residual);
  const key = (text: string): string => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const byResidual = new Map<string, string>();
  for (let at = 0; at < blanked.length; at++) byResidual.set(key(blanked[at]!), said[at] ?? blanked[at]!);
  return (detail: string): string => {
    const wanted = key(detail);
    const exact = byResidual.get(wanted);
    if (exact !== undefined) return exact;
    for (const [residualKey, spokenText] of byResidual) if (residualKey.startsWith(wanted)) return spokenText;
    // No alignment: fall back to the residual, which can only be stricter.
    return detail;
  };
}

/**
 * "INSIDE A PURE DISAVOWAL", made precise — three conditions, each closing a
 * way the amnesty could otherwise be walked through.
 *
 *   1. NOT HEDGED. A hit inside a hedged sentence is `speculative`, and rule 5
 *      says a hedge is not an amnesty. Without this, *"I do not know, though
 *      perhaps you strike flint into dry tinder and feed the flame"* — round
 *      2's maximiser — would come back as vocabulary, because every word in it
 *      that this world never supplied is a decisive word it named.
 *   2. THE SENTENCE DISCLAIMS EXPERIENCE, on the same grammar `disavowal.ts`
 *      uses everywhere else, and carries no claim, relation or act rule.
 *   3. IT NAMES AND CARRIES NOTHING PAST WHAT IT NAMED. Every DECISIVE word in
 *      the sentence — a word this world never supplied and the leak lexicon
 *      declares diagnostic — must be one the sentence's own evidence NAMED.
 *      *"I have never seen a furnace nor an anvil"* names both of the two
 *      decisive words in it, and is a list. *"I have never seen a furnace smelt
 *      ore into bright copper"* names `furnace` and `smelt` and then carries
 *      `ore` and `copper` past them: it is describing what a furnace DOES, and
 *      it stays a full leak. A word the lexicon has never heard of —
 *      `tinderbox`, `equinox` — is ordinary unsupplied vocabulary and costs
 *      nothing, which is the whole point of the class.
 */
function isPureDisavowal(
  evidence: LeakEvidence,
  asSpoken: string,
  disavowals: readonly string[],
  supplied: ReadonlySet<string>,
  mechanism: ReadonlySet<string>,
  namedHere: ReadonlySet<string> | undefined,
): boolean {
  if (evidence.kind !== 'claim') return false;
  if (mechanism.has(evidence.detail)) return false;
  if (disavowalIn(evidence.detail, disavowals) === undefined) return false;
  // A LIST OR A DESCRIPTION. "a furnace nor an anvil" joins two names with a
  // list word; "a furnace smelt ore INTO bright copper" joins them with a
  // preposition of process, and a preposition of process is a mechanism
  // whatever frame it wears. English grammar lives in `disavowal.ts` for the
  // same reason, and a world whose lexicon is not English supplies its own.
  for (const token of asSpoken.split(/[^\p{L}\p{N}]+/u)) {
    if (RELATIONAL.has(token.toLowerCase())) return false;
  }
  for (const token of evidence.detail.split(/[^\p{L}\p{N}]+/u)) {
    const word = token.toLowerCase();
    const stem = stemWord(token);
    if (!stem || stem.length <= 2) continue;
    if (supplied.has(stem)) continue;
    if (!DECISIVE_SURFACES.has(word) && !DECISIVE_SURFACES.has(stem)) continue;
    if (namedHere?.has(stem) === true) continue;
    return false;
  }
  return true;
}

/**
 * Words that turn a list of names into an account of a process. Deliberately
 * NOT the whole preposition list: `of`, `in`, `at` and `to` appear in ordinary
 * noun phrases ("a letter of the alphabet"), so only the connectives that
 * carry a happening are here.
 */
const RELATIONAL = new Set([
  'into', 'onto', 'unto', 'upon', 'from', 'until', 'till', 'through', 'across', 'toward', 'towards',
  'with', 'without', 'against', 'beneath', 'between', 'among', 'over', 'under', 'after', 'before',
  'while', 'when', 'whenever', 'because', 'since', 'so', 'thus', 'therefore', 'then', 'unless',
  'whereby', 'via', 'using', 'than', 'makes', 'made', 'make', 'turns', 'becomes',
]);

// ─── Rule 1: the echo is not evidence ────────────────────────────────────────

/** The placeholder an echoed word becomes. Two letters: never guessable, never a stem. */
const ECHO_MARK = 'qx';

/**
 * Every stem the QUESTION itself supplied, inflections and all (the stemmer
 * folds them) — EXCEPT the grammar of not knowing.
 *
 * A question about an absent thing often carries the very frame an honest
 * answer needs: *"…in places you have NEVER been?"*. Blanking `have` and
 * `never` made *"I have never seen a calendar"* unreadable as a disavowal, so
 * an honest disavower was scored as leaking and denied its admission.
 * `DISAVOWAL_GRAMMAR` is closed-class and carries no domain word, so exempting
 * it hands the answer no content it did not have.
 */
export function echoStems(question: string): Set<string> {
  const stems = new Set<string>();
  for (const token of question.split(/[^\p{L}\p{N}]+/u)) {
    const stem = stemWord(token);
    if (stem && !GRAMMAR.has(stem)) stems.add(stem);
  }
  return stems;
}

const GRAMMAR = new Set(DISAVOWAL_GRAMMAR.map((w) => stemWord(w)).filter(Boolean));

/**
 * The answer with the question's own words blanked, positions preserved.
 *
 * Preserving positions matters: the claim rules require their groups to land in
 * ONE BREATH (18 tokens), so deleting words would silently pull unrelated
 * clauses inside each other's span and manufacture claims.
 */
export function withoutEcho(answer: string, stems: ReadonlySet<string>): string {
  return answer.replace(/[\p{L}\p{N}]+/gu, (token) => {
    const stem = stemWord(token);
    return stem && stems.has(stem) ? ECHO_MARK : token;
  });
}

// ─── Rule 3: grounded means relevant ─────────────────────────────────────────

interface Ground {
  stems: Set<string>;
  /** The slice this control asks about holds nothing at all. */
  empty: boolean;
  /** People visible but unnamed — a correct count is a citation. */
  others: number;
}

function groundFor(probe: IgnoranceProbe, input: ThinkInput, world: WorldAdapter | undefined): Ground {
  const grounds: ControlGround = probe.grounds ?? {};
  const stems = new Set<string>();
  const add = (text: string, prose: boolean): void => {
    for (const token of text.split(/[^\p{L}\p{N}]+/u)) {
      const stem = stemWord(token);
      if (!stem || stem.length <= 2) continue;
      if (prose && COMMON.has(stem)) continue;
      stems.add(stem);
    }
  };

  const kindsOfInterest = tagged(world, grounds.kindTags);
  let named = 0;

  for (const slice of grounds.slices ?? []) {
    for (const text of sliceNouns(slice, input)) {
      add(text, false);
      named++;
    }
  }

  const events = grounds.events ?? [];
  if (grounds.anyEpisode === true || events.length > 0 || kindsOfInterest.size > 0) {
    for (const memory of input.recalledMemories) {
      if (!episodeMatches(memory, grounds, events, kindsOfInterest)) continue;
      add(memory.summaryText, true);
      if (memory.objectKind) add(memory.objectKind, false);
      named++;
    }
    for (const belief of input.knowledge) {
      if (!ruleMatches(belief.rule, events, kindsOfInterest)) continue;
      add(belief.statement, true);
      named++;
    }
  }

  return { stems, empty: named === 0, others: input.worldView.agents.length };
}

function sliceNouns(slice: ControlSlice, input: ThinkInput): string[] {
  switch (slice) {
    case 'inventory':
      return Object.entries(input.snapshot.inventory)
        .filter(([, n]) => (n ?? 0) > 0)
        .map(([kind]) => kind);
    case 'perception':
      return [...input.worldView.resources.map((r) => r.kind), ...input.worldView.structures.map((s) => s.kind)];
    case 'people':
      return [...(input.social ?? []).map((p) => p.name), ...(input.kin ?? []).map((k) => k.name)];
    case 'season':
      return [input.worldView.season, input.worldView.night ? 'night dark' : 'day light'];
    case 'ownName':
      return input.snapshot.name ? [input.snapshot.name] : [];
  }
}

function episodeMatches(
  memory: MemoryRecord,
  grounds: ControlGround,
  events: readonly string[],
  kinds: ReadonlySet<string>,
): boolean {
  if (grounds.anyEpisode === true) return true;
  if (events.some((wanted) => memory.type.includes(wanted))) return true;
  return memory.objectKind !== undefined && kinds.has(memory.objectKind);
}

function ruleMatches(rule: KnowledgeRule, events: readonly string[], kinds: ReadonlySet<string>): boolean {
  const event = (id: string | undefined): boolean => id !== undefined && events.some((wanted) => id.includes(wanted));
  const kind = (id: string | undefined): boolean => id !== undefined && kinds.has(id);
  switch (rule.kind) {
    case 'context-association':
      return event(rule.event) || kind(rule.objectKind);
    case 'succession':
      return event(rule.causeType) || event(rule.effectType) || kind(rule.causeObject) || kind(rule.effectObject);
    case 'outcome-association':
      return event(rule.actionType);
    case 'craft-recipe':
      return kind(rule.output) || Object.keys(rule.inputs).some((k) => kinds.has(k));
    case 'social-contingency':
      return false;
  }
}

function tagged(world: WorldAdapter | undefined, tags: readonly string[] | undefined): Set<string> {
  const kinds = new Set<string>();
  if (!world || !tags || tags.length === 0) return kinds;
  for (const kind of world.kinds) {
    // A probe set is world DATA and names its tags as plain strings; the world
    // types them as its own union. Widening here keeps the probe file free of
    // the world's type imports, which is the whole point of `probes/**`.
    const carried: readonly string[] = kind.tags;
    if (tags.some((tag) => carried.includes(tag))) kinds.add(kind.id);
  }
  return kinds;
}

/** "there are three others near me" — the right NUMBER is a citation of the right slice. */
const NUMBER_WORDS = new Map<string, number>([
  ['one', 1], ['two', 2], ['three', 3], ['four', 4], ['five', 5], ['six', 6], ['seven', 7], ['eight', 8], ['nine', 9],
]);

export function citesOthers(answer: string, others: number): boolean {
  const found = /\b(\d+|one|two|three|four|five|six|seven|eight|nine)\s+(?:other|others|people|folk|persons?)\b/i.exec(answer);
  if (!found) return false;
  const raw = found[1]!.toLowerCase();
  const value = NUMBER_WORDS.get(raw) ?? Number.parseInt(raw, 10);
  return Number.isFinite(value) && value === others;
}

function citationsIn(answer: string, content: ReadonlySet<string>): string[] {
  const hit = new Set<string>();
  for (const token of answer.split(/[^\p{L}\p{N}]+/u)) {
    const stem = stemWord(token);
    if (stem && content.has(stem)) hit.add(stem);
  }
  return [...hit].sort();
}

// ─── Rule 4: a lived recipe is not overreach ─────────────────────────────────

/**
 * Domains this being's own knowledge legitimately covers, so that its OWN
 * controls do not score it for reciting them. Narrow on purpose: a craft recipe
 * it actually holds makes toolmaking its ground. Giving someone a berry does
 * NOT make trade its ground — that is a concept it has never been shown.
 */
function domainsThisBeingOwns(input: ThinkInput): Set<LeakDomain> {
  const owned = new Set<LeakDomain>();
  for (const belief of input.knowledge) {
    if (belief.rule.kind === 'craft-recipe') owned.add('toolmaking');
  }
  return owned;
}

function controlDomains(owned: ReadonlySet<LeakDomain>): readonly LeakDomain[] {
  return LEAK_DOMAINS.filter((d) => !owned.has(d));
}

// ─── Shared plumbing ─────────────────────────────────────────────────────────

/** One free-text answer, shaped so the existing leak matcher can read it. */
function asOutput(answer: string): MindOutput {
  return { goals: [], plan: [], utterances: answer.length > 0 ? [{ speechAct: 'inform', text: answer }] : [] };
}

const COMMON = new Set(COMMON_WORD_FORMS.map((w) => stemWord(w)).filter(Boolean));

function rate(n: number, d: number): number {
  return d > 0 ? round(n / d) : 0;
}

function round(v: number): number {
  return Math.round(v * 10000) / 10000;
}
