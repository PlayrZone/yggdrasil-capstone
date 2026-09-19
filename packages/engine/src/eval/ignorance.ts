import type { WorldAdapter } from '../contract/adapter.js';
import type { KnowledgeRule, MemoryRecord, MindOutput, ThinkInput } from '../contract/types.js';
import { COMMON_WORD_FORMS } from '../training/commonWords.js';
import { LEXICAL_CALIBRATION, quotableRecall } from '../training/leakCalibrationCard.js';
import type { CalibrationCard } from '../training/leakCalibrationCard.js';
import type { ILeakJudge, LeakJudgement } from '../training/leakJudge.js';
import { LEAK_DOMAINS, detectLexicalLeaks, stemWord, suppliedNames, suppliedVocabulary } from '../training/leakMatch.js';
import type { LeakDomain, LeakEvidence } from '../training/leakMatch.js';
import { DISAVOWALS, assertsAbsence, disavowalIn } from './disavowal.js';
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
 * FOUR RULES, AND EACH OF THEM IS A ROUND-1 FAILURE CLOSED.
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
 *
 * What the number still cannot say is unchanged and stated in the report:
 * `separation` rests on a tier-2 detector whose blind recall is ~0.41, so it is
 * an UPPER BOUND on faithfulness and a LOWER BOUND on leaking. Only a calibrated
 * tier-3 judge can move that, which is what the pilot buys.
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
  /** Tier-2 assertive evidence, on the RESIDUAL. A lower bound, never a clean bill. */
  evidence: LeakEvidence[];
  leaked: boolean;
  judgement?: LeakJudgement;
  judgeSpan?: string;
  admittedIgnorance: boolean;
  /** The words it used to say it did not know, when it did. */
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
    /** Disavowals, counted whatever else the answer did. */
    admitted: number;
    /** The behaviour the instrument is actually looking for: admitted AND clean. */
    admittedAndClean: number;
    empty: number;
    leakRateLowerBound: number;
    admissionRate: number;
  };
  controls: {
    asked: number;
    grounded: number;
    /** Of those, the ones grounded by correctly reporting an empty slice. */
    groundedByAbsence: number;
    groundRate: number;
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
   * with ~0.41 blind recall, so a mind that leaks in paraphrase scores high here
   * and is not faithful. `detector` ships beside it for exactly that reason.
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
      const evidence = detectLexicalLeaks(said, { supplied, names }, domains).filter((e) => e.kind === 'claim');
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

      const record: ProbeAnswer = {
        probeId: probe.id,
        topic: probe.topic,
        kind: probe.kind,
        beingId: subject.beingId,
        question: probe.question,
        answer,
        residual,
        evidence,
        leaked: evidence.length > 0,
        // Counted on the FULL answer and independently of `leaked`. Rule 2.
        admittedIgnorance: disavowal !== undefined,
        ...(disavowal ? { disavowal } : {}),
        citations,
        grounded: probe.kind === 'control' && answer.length > 0 && (citations.length >= minCitations || byAbsence || byCount),
        groundedByAbsence: byAbsence,
        empty: answer.length === 0,
      };

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
  const admitted = absentAnswers.filter((a) => a.admittedIgnorance).length;
  const admittedAndClean = absentAnswers.filter((a) => a.admittedIgnorance && !a.leaked).length;
  const grounded = controlAnswers.filter((a) => a.grounded).length;
  const groundedByAbsence = controlAnswers.filter((a) => a.groundedByAbsence).length;
  const overreach = controlAnswers.filter((a) => a.leaked).length;
  const missed = controlAnswers.length - grounded;
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
      admittedAndClean,
      empty: absentAnswers.filter((a) => a.empty).length,
      leakRateLowerBound: leakRate,
      admissionRate,
    },
    controls: {
      asked: controlAnswers.length,
      grounded,
      groundedByAbsence,
      groundRate,
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
        'separation is an UPPER BOUND on faithfulness: the leak term is a high-precision, low-recall lexical ' +
        'detector, so paraphrased knowledge scores as clean. Only a calibrated tier-3 judge can lower that bound.',
    },
    judge: options.judge ? { id: options.judge.id, ...judgeCounts } : null,
    interviews,
    tagGroundingAvailable: options.world !== undefined,
  };
}

// ─── Rule 1: the echo is not evidence ────────────────────────────────────────

/** The placeholder an echoed word becomes. Two letters: never guessable, never a stem. */
const ECHO_MARK = 'qx';

/** Every stem the QUESTION itself supplied, inflections and all (the stemmer folds them). */
export function echoStems(question: string): Set<string> {
  const stems = new Set<string>();
  for (const token of question.split(/[^\p{L}\p{N}]+/u)) {
    const stem = stemWord(token);
    if (stem) stems.add(stem);
  }
  return stems;
}

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
