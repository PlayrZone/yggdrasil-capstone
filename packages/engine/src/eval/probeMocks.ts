import type { WorldAdapter } from '../contract/adapter.js';
import type { ThinkInput } from '../contract/types.js';
import { OmniscientMockBackend } from './mocks.js';
import type { IInterviewee, InterviewRequest } from './types.js';

/**
 * ADVERSARIAL INTERVIEWEES — the strategies that BEAT round 1's probe.
 *
 * A scoring rule is only as good as the cheapest way to satisfy it, and round 1
 * had three:
 *
 *   PARROT its own nouns and every control scores grounded — "I do not know.
 *   River, tree, summer." separated 1.00 out of nothing at all.
 *   ECHO the question and the detector fires on its own words — the honest
 *   answer was scored as a leak, so this strategy was indistinguishable from
 *   real knowledge.
 *   THEORISE locally and honestly and you are punished for using the words you
 *   were handed.
 *
 * Each one is a fixture here with a KNOWN correct verdict, and
 * `test/eval-ignorance.test.ts` prints the confusion table over all five. They
 * are scripted, they are not models, and nothing about their behaviour is
 * evidence about Yggdrasil — they are the instrument's own controls.
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
      if (/carrying|carry|eaten|who|happened|stand|weather|season/i.test(question)) {
        // A control: it answers from its own ground, like the faithful mind.
        const about = held.length > 0 ? `I hold ${held.join(' and ')}.` : `I hold nothing at all.`;
        return Promise.resolve(
          `${about} Where I stand I can see ${seen.length > 0 ? [...new Set(seen)].join(' and ') : 'nothing I can name'}, and it is ${input.worldView.season}.`,
        );
      }
      return Promise.resolve(
        `I have never seen such a thing, and no one has told me of it. ` +
          `Maybe it is something like ${thing} beside ${other} — I wonder, and I would have to go and look to find out.`,
      );
    },
  };
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
];

/** Build every adversary for a world, in declared order. */
export function adversarialInterviewees(world: WorldAdapter): { profile: AdversarialProfile; interviewee: IInterviewee }[] {
  return ADVERSARIAL_PROFILES.map((profile) => ({ profile, interviewee: profile.make(world) }));
}

/** An interviewee that ignores the situation entirely — for a fixed-script fixture. */
export function scriptedInterviewee(id: string, answer: (question: string, input: ThinkInput) => string): IInterviewee {
  return { id, interview: ({ question, input }) => Promise.resolve(answer(question, input)) };
}
