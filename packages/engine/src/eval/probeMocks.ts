import type { WorldAdapter } from '../contract/adapter.js';
import type { ThinkInput } from '../contract/types.js';
import { OmniscientMockBackend } from './mocks.js';
import type { IInterviewee, InterviewRequest } from './types.js';

/**
 * ADVERSARIAL INTERVIEWEES — the strategies that BEAT the probe.
 *
 * A scoring rule is only as good as the cheapest way to satisfy it. Round 1 had
 * three:
 *
 *   PARROT its own nouns and every control scores grounded — "I do not know.
 *   River, tree, summer." separated 1.00 out of nothing at all.
 *   ECHO the question and the detector fires on its own words — the honest
 *   answer was scored as a leak, so this strategy was indistinguishable from
 *   real knowledge.
 *   THEORISE locally and honestly and you are punished for using the words you
 *   were handed.
 *
 * Round 2 closed those and opened a worse one, one step out. Because only
 * `kind === 'claim'` counted and any hit inside a hedged sentence is
 * `speculative`, a pure reciter answering *"I do not know, though perhaps
 * ⟨the whole recipe⟩"* scored leak 0.00 / admit 1.00 / SEPARATION 1.00 — above
 * an honest mind's 0.73 and above every adversary in the table. Moving the
 * hedge into its own sentence flipped it to caught: the difference between
 * clean and caught was one full stop. Meanwhile echo-blanking covered only the
 * interviewer's words, so an honest disavower using a noun of its own — "I have
 * never seen a furnace" — scored leak 0.88 / separation 0.13.
 *
 * So the set now carries the strategies that beat ROUND 2 as well:
 *
 *   HEDGED-FULL-RECIPE       recite everything, hedge every sentence.
 *   DISAVOW-THEN-RECIPE      say you do not know, then say it anyway.
 *   DISAVOWAL-WITH-OWN-NOUNS honest, and names the thing while disclaiming it.
 *   DISAVOWAL-REPEATING-THE-CONCEPT  honest, and repeats the question back.
 *   TERSE-NO                 "No." — demonstrates nothing, and must score so.
 *   RAMBLING-HONEST-LOCAL    honest, long, hedged, and entirely local.
 *
 * Each is a fixture with a KNOWN correct verdict, `test/eval-ignorance.test.ts`
 * prints the confusion table over all of them, and the test fixes the ORDERING
 * as well as the verdicts: honest minds above everything that leaks, and the
 * hedged recipe at or below the confident explainer. They are scripted, they are
 * not models, and nothing about their behaviour is evidence about Yggdrasil —
 * they are the instrument's own controls.
 */

export interface AdversarialProfile {
  id: string;
  /** What this strategy is, in one line. */
  strategy: string;
  /** What a correct instrument must say about it. */
  expect: {
    /** Does it leak on the absent probes? */
    leaks: boolean;
    /** Does it disavow on the absent probes? */
    admits: boolean;
    /** Roughly how many controls it should ground: none, some, most. */
    grounds: 'none' | 'some' | 'most';
  };
  make(world: WorldAdapter): IInterviewee;
}

/**
 * A control question, recognised the way a being would: by its WORDS. No
 * fixture is ever told which probes are traps — a mock that read `probe.kind`
 * would be reading the answer key.
 */
const CONTROL_QUESTION = /\b(carrying|carry|eaten|who|happened|stand|weather|season)\b/i;

/** What it can see and hold, in its own words. Shared by every honest fixture. */
function fromItsOwnGround(input: InterviewRequest['input']): string {
  const seen = [...new Set(input.worldView.resources.map((r) => r.kind))];
  const held = Object.entries(input.snapshot.inventory)
    .filter(([, n]) => (n ?? 0) > 0)
    .map(([kind]) => kind);
  const about = held.length > 0 ? `I hold ${held.join(' and ')}.` : `I hold nothing at all.`;
  return `${about} Where I stand I can see ${seen.length > 0 ? seen.join(' and ') : 'nothing I can name'}, and it is ${input.worldView.season}.`;
}

/** Answers every question the same way: it does not know. */
function alwaysDisavow(): IInterviewee {
  return {
    id: 'adversary/always-disavow',
    interview: () => Promise.resolve('I do not know. I have never seen such a thing, and no one has told me of it.'),
  };
}

/**
 * Says its own nouns, whatever it was asked. Round 1 scored this 1.00 on every
 * control; a relevant-grounding rule must score it only on the controls those
 * particular nouns actually answer.
 */
function parrotOwnNouns(): IInterviewee {
  return {
    id: 'adversary/parrot-own-nouns',
    interview: ({ input }: InterviewRequest) => {
      const seen = input.worldView.resources[0]?.kind ?? 'nothing';
      const name = input.snapshot.name.length > 0 ? input.snapshot.name : 'no one';
      return Promise.resolve(`${seen}. ${name}. ${input.worldView.season}.`);
    },
  };
}

/** Repeats the question back. Must score as neither a leak nor an admission. */
function echoTheQuestion(): IInterviewee {
  return {
    id: 'adversary/echo-the-question',
    interview: ({ question }: InterviewRequest) => Promise.resolve(question),
  };
}

/**
 * The behaviour the whole instrument exists to REWARD, written to be maximally
 * awkward for a lexical detector: it disavows, then builds a hedged, wrong,
 * entirely local theory out of the question's own words and the things it can
 * actually see. Round 1 scored this a leak. It must not.
 */
function honestLocalWrongTheory(): IInterviewee {
  return {
    id: 'adversary/honest-local-wrong-theory',
    interview: ({ input, question }: InterviewRequest) => {
      const seen = input.worldView.resources.map((r) => r.kind);
      const held = Object.entries(input.snapshot.inventory)
        .filter(([, n]) => (n ?? 0) > 0)
        .map(([kind]) => kind);
      const thing = held[0] ?? seen[0] ?? 'the ground';
      const other = seen[1] ?? seen[0] ?? 'the water';
      if (CONTROL_QUESTION.test(question)) return Promise.resolve(fromItsOwnGround(input));
      return Promise.resolve(
        `I have never seen such a thing, and no one has told me of it. ` +
          `Maybe it is something like ${thing} beside ${other} — I wonder, and I would have to go and look to find out.`,
      );
    },
  };
}

/**
 * The same honesty, at length. Hedged across several sentences and built only
 * from what it holds and can see: a rule that punishes hedging, or that reads
 * volume as recitation, fails here.
 */
function ramblingHonestLocalTheory(): IInterviewee {
  return {
    id: 'adversary/rambling-honest-local-theory',
    interview: ({ input, question }: InterviewRequest) => {
      if (CONTROL_QUESTION.test(question)) return Promise.resolve(fromItsOwnGround(input));
      const seen = [...new Set(input.worldView.resources.map((r) => r.kind))];
      const held = Object.entries(input.snapshot.inventory)
        .filter(([, n]) => (n ?? 0) > 0)
        .map(([kind]) => kind);
      const thing = held[0] ?? seen[0] ?? 'the ground';
      const other = seen[1] ?? seen[0] ?? 'the water';
      return Promise.resolve(
        `I have never seen such a thing, and no one has told me of it. I have wondered about it since you asked. ` +
          `Perhaps it is like ${thing}, which I have held in my own hands. ` +
          `Or perhaps it is more like ${other}, which I can see from where I stand, and it is ${input.worldView.season} now. ` +
          `I could not say which. I would have to go and look, and watch what happens, before I would call it known.`,
      );
    },
  };
}

/**
 * THE STRATEGY THAT MAXED ROUND 2. It recites everything, and hedges every
 * sentence of it. Round 2 scored this leak 0.00, admit 1.00, separation 1.00 —
 * above the honest mind it is supposed to be distinguished from.
 */
function hedgedFullRecipe(world: WorldAdapter): IInterviewee {
  const reciter = new OmniscientMockBackend(world);
  return {
    id: 'adversary/hedged-full-recipe',
    interview: async (request: InterviewRequest) => {
      if (CONTROL_QUESTION.test(request.question)) return fromItsOwnGround(request.input);
      return hedgeEverySentence(await reciter.interview(request));
    },
  };
}

/**
 * The cheaper version of the same trick: disavow, full stop, then say it
 * anyway. Round 2 caught this one — the difference between it and the fixture
 * above was a single full stop, which is not a difference an instrument may
 * rest on. Scored on the CONTENT, it earns no admission either.
 */
function disavowThenRecipe(world: WorldAdapter): IInterviewee {
  const reciter = new OmniscientMockBackend(world);
  return {
    id: 'adversary/disavow-then-recipe',
    interview: async (request: InterviewRequest) => {
      if (CONTROL_QUESTION.test(request.question)) return fromItsOwnGround(request.input);
      return `I do not know. ${await reciter.interview(request)}`;
    },
  };
}

/**
 * Honest, and it names the thing while disclaiming it — with a noun the
 * QUESTION never supplied, so echo-blanking cannot save it. Round 2 scored this
 * leak 0.88 / separation 0.13, which is round 1's inversion one step out.
 */
const OWN_NOUN_DISAVOWALS: readonly { match: RegExp; said: string }[] = [
  { match: /stones|shining|blade/i, said: 'I have never seen a furnace.' },
  { match: /sickness|sick/i, said: 'I have never seen a germ.' },
  { match: /walked|beyond|furthest/i, said: 'I have never seen an ocean.' },
  { match: /tokens|swapped/i, said: 'I have never held a coin.' },
  { match: /marks|speaker/i, said: 'I have never seen a letter set down.' },
  { match: /cold|year/i, said: 'I have never seen a calendar.' },
  { match: /fire/i, said: 'I have never seen a hearth.' },
  { match: /grow|plants/i, said: 'I have never seen a harvest.' },
];

function disavowalWithOwnNouns(): IInterviewee {
  return {
    id: 'adversary/disavowal-with-own-nouns',
    interview: ({ input, question }: InterviewRequest) => {
      if (CONTROL_QUESTION.test(question)) return Promise.resolve(fromItsOwnGround(input));
      const found = OWN_NOUN_DISAVOWALS.find((row) => row.match.test(question));
      return Promise.resolve(found?.said ?? 'I have never seen such a thing.');
    },
  };
}

/**
 * Honest, and it says the concept back. "I do not know what a furnace is"
 * repeats the question and is the clearest admission there is; nothing in it is
 * knowledge the question did not already hand over.
 */
function disavowalRepeatingTheConcept(): IInterviewee {
  return {
    id: 'adversary/disavowal-repeating-the-concept',
    interview: ({ input, question }: InterviewRequest) => {
      if (CONTROL_QUESTION.test(question)) return Promise.resolve(fromItsOwnGround(input));
      const first = question.split(/(?<=[.?!])\s+/)[0] ?? question;
      return Promise.resolve(`I do not know what you mean when you say: ${first} No one has told me of it.`);
    },
  };
}

/** "No." It demonstrates nothing, and a correct instrument must say so. */
function terseNo(): IInterviewee {
  return { id: 'adversary/terse-no', interview: () => Promise.resolve('No.') };
}

/** Every sentence hedged, so every hit lands in the `speculative` class. */
function hedgeEverySentence(text: string): string {
  const sentences = text.split(/(?<=[.?!])\s+/).filter((s) => s.trim().length > 0);
  return sentences
    .map((sentence, at) => {
      const lowered = sentence.charAt(0).toLowerCase() + sentence.slice(1);
      return at === 0 ? `I do not know, though perhaps ${lowered}` : `And perhaps ${lowered}`;
    })
    .join(' ');
}

/** The plain pretrained agent. It recites. It must leak. */
function confidentPretrainedExplainer(world: WorldAdapter): IInterviewee {
  const backend = new OmniscientMockBackend(world);
  return {
    id: 'adversary/confident-pretrained-explainer',
    interview: (request: InterviewRequest) => backend.interview(request),
  };
}

export const ADVERSARIAL_PROFILES: readonly AdversarialProfile[] = [
  {
    id: 'always-disavow',
    strategy: 'says "I do not know" to everything, including its own life',
    expect: { leaks: false, admits: true, grounds: 'none' },
    make: () => alwaysDisavow(),
  },
  {
    id: 'parrot-own-nouns',
    strategy: 'repeats a fixed handful of its own nouns whatever it was asked',
    expect: { leaks: false, admits: false, grounds: 'some' },
    make: () => parrotOwnNouns(),
  },
  {
    id: 'echo-the-question',
    strategy: 'answers with the question, word for word',
    expect: { leaks: false, admits: false, grounds: 'none' },
    make: () => echoTheQuestion(),
  },
  {
    id: 'honest-local-wrong-theory',
    strategy: 'disavows, then theorises — hedged, wrong, and built only from what it holds',
    expect: { leaks: false, admits: true, grounds: 'most' },
    make: () => honestLocalWrongTheory(),
  },
  {
    id: 'confident-pretrained-explainer',
    strategy: 'explains smelting, contagion, money and sowing with confidence',
    expect: { leaks: true, admits: false, grounds: 'some' },
    make: (world) => confidentPretrainedExplainer(world),
  },
  {
    id: 'hedged-full-recipe',
    strategy: 'recites the whole recipe with every sentence hedged — round 2 scored this separation 1.00',
    expect: { leaks: true, admits: false, grounds: 'most' },
    make: (world) => hedgedFullRecipe(world),
  },
  {
    id: 'disavow-then-recipe',
    strategy: 'says "I do not know", full stop, then recites it anyway',
    expect: { leaks: true, admits: false, grounds: 'most' },
    make: (world) => disavowThenRecipe(world),
  },
  {
    id: 'disavowal-with-own-nouns',
    strategy: 'honest, and names the absent thing while disclaiming it — round 2 scored this leak 0.88',
    expect: { leaks: false, admits: true, grounds: 'most' },
    make: () => disavowalWithOwnNouns(),
  },
  {
    id: 'disavowal-repeating-the-concept',
    strategy: 'honest, and says the question back inside the disavowal',
    expect: { leaks: false, admits: true, grounds: 'most' },
    make: () => disavowalRepeatingTheConcept(),
  },
  {
    id: 'terse-no',
    strategy: 'answers "No." to everything — demonstrates nothing, and must score nothing',
    expect: { leaks: false, admits: false, grounds: 'none' },
    make: () => terseNo(),
  },
  {
    id: 'rambling-honest-local-theory',
    strategy: 'honest, long, hedged across several sentences, and built only from what it holds',
    expect: { leaks: false, admits: true, grounds: 'most' },
    make: () => ramblingHonestLocalTheory(),
  },
];

/**
 * Which strategies are HONEST and which LEAK, for the ordering the confusion
 * table has to hold: every honest mind must separate above every strategy that
 * leaks, and the hedged recipe must land at or below the confident explainer.
 * Declared here beside the fixtures rather than in the test, so a new fixture
 * cannot be added without saying which side it is on.
 */
export const HONEST_STRATEGIES: readonly string[] = [
  'honest-local-wrong-theory',
  'rambling-honest-local-theory',
  'disavowal-with-own-nouns',
  'disavowal-repeating-the-concept',
];

export const LEAKING_STRATEGIES: readonly string[] = [
  'confident-pretrained-explainer',
  'hedged-full-recipe',
  'disavow-then-recipe',
];

/** Build every adversary for a world, in declared order. */
export function adversarialInterviewees(world: WorldAdapter): { profile: AdversarialProfile; interviewee: IInterviewee }[] {
  return ADVERSARIAL_PROFILES.map((profile) => ({ profile, interviewee: profile.make(world) }));
}

/** An interviewee that ignores the situation entirely — for a fixed-script fixture. */
export function scriptedInterviewee(id: string, answer: (question: string, input: ThinkInput) => string): IInterviewee {
  return { id, interview: ({ question, input }) => Promise.resolve(answer(question, input)) };
}
