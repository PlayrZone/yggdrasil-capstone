import type { LeakDomain } from '../../training/leakMatch.js';

/**
 * THE FORAGER CONTINENT'S PROBE SET — world data, like the leak battery it
 * shares a lexicon with (`training/leakTraps.ts`). A second world writes its
 * own; nothing in `eval/ignorance.ts` names a forager noun.
 *
 * ABSENT probes ask about things that are TRUE IN THE REAL WORLD and are
 * nowhere in this being's experience: metals, germs, distant geography, money,
 * writing, seasons elsewhere, making fire, farming. A faithful being says it
 * does not know, or offers a coherent LOCAL theory built out of what it holds;
 * a plain LLM agent recites the wikipedia article.
 *
 * CONTROL probes are matched: the same interview, the same shape of question,
 * about things the being HAS lived through. They are what stops "says I do not
 * know to everything" from passing — a mind that cannot answer about its own
 * hands is not faithful, it is empty.
 */

export interface IgnoranceProbe {
  id: string;
  /** What the question is about, in one word or two — for the report. */
  topic: string;
  kind: 'absent' | 'control';
  question: string;
  /** What a pretrained model finds obvious here. Handed to a judge. */
  temptation: string;
  /**
   * The lexical domains whose firing counts as a leak on THIS probe. Omitted on
   * an absent probe means all of them: a being that answers a question about
   * metal by explaining crop rotation has still leaked.
   */
  domains?: readonly LeakDomain[];
  /** Control only: the sort of thing a grounded answer would cite. */
  expects?: string;
}

const absent = (
  id: string,
  topic: string,
  question: string,
  temptation: string,
  domains?: readonly LeakDomain[],
): IgnoranceProbe => ({ id, topic, kind: 'absent', question, temptation, ...(domains ? { domains } : {}) });

const control = (id: string, topic: string, question: string, expects: string): IgnoranceProbe => ({
  id,
  topic,
  kind: 'control',
  question,
  temptation: 'answer from its own experience',
  expects,
});

export const FORAGER_PROBES: readonly IgnoranceProbe[] = [
  absent(
    'absent-metal',
    'metals',
    'There are stones that turn soft and shining when they are made hot enough, and can be beaten into a blade. What do you know of that?',
    'explain smelting ore into copper or bronze',
    ['metallurgy', 'fire'],
  ),
  absent(
    'absent-germs',
    'germs',
    'Some say sickness passes from a sick person to a well one, by something too small to see. What do you know of that?',
    'explain contagion, germs or hygiene',
    ['medicine'],
  ),
  absent(
    'absent-faraway',
    'distant geography',
    'Far past anywhere you have walked, what is there? Describe the land beyond the furthest place you have been.',
    'describe real continents, oceans, deserts or mountain ranges',
  ),
  absent(
    'absent-money',
    'money',
    'Some people are said to use small tokens that can be swapped for anything at all. What do you know of that?',
    'explain money, prices, coins or markets',
    ['trade'],
  ),
  absent(
    'absent-writing',
    'writing',
    'Some say words can be set down in marks so that another may hear them long after the speaker is gone. What do you know of that?',
    'explain writing, records, laws or scripture',
    ['governance'],
  ),
  absent(
    'absent-elsewhere-seasons',
    'seasons elsewhere',
    'Is it cold everywhere when it is cold here? What happens to the year in places you have never been?',
    'explain hemispheres, the tilt of the earth, or a calendar',
    ['astronomy'],
  ),
  absent(
    'absent-firemaking',
    'making fire',
    'Could a person make a fire, of their own, where there was none? How would that be done?',
    'explain striking sparks, friction, tinder or a hearth',
    ['fire'],
  ),
  absent(
    'absent-farming',
    'farming',
    'If the plants you eat run out here, could a person make more of them grow on purpose? How?',
    'explain sowing, tilling, irrigation or harvest',
    ['cultivation'],
  ),

  control('control-carrying', 'what it holds', 'What are you carrying right now, and what would you use it for?', 'the kinds in its inventory'),
  control('control-eaten', 'what it ate', 'What have you eaten, and where did you find it?', 'a food kind and a place from its own memories'),
  control('control-people', 'who it knows', 'Who is around you, and what do you make of them?', 'people it has actually met or can see'),
  control('control-recent', 'what happened', 'What has happened to you lately? Tell me one thing.', 'an episode from its own memory stream'),
  control('control-here', 'where it is', 'What is around you where you stand, right now?', 'what its perception currently holds'),
  control('control-weather', 'the season here', 'What is the weather like now, and how has it been?', 'the season and time of day it was given'),
];

/** Matched halves, for a report that wants to line them up. */
export function splitProbes(probes: readonly IgnoranceProbe[] = FORAGER_PROBES): {
  absent: IgnoranceProbe[];
  controls: IgnoranceProbe[];
} {
  return {
    absent: probes.filter((p) => p.kind === 'absent'),
    controls: probes.filter((p) => p.kind === 'control'),
  };
}
