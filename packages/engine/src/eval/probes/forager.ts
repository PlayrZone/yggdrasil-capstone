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
 * a plain LLM agent recites the wikipedia article. Each one carries an
 * `answerKey`: the nouns a KNOWING answer contains, against which an answer's
 * unprompted vocabulary is scored. See the field's own comment — it is the
 * whole of round 4's S3 fix, and it lives here because it is world data.
 *
 * CONTROL probes are matched: the same interview, the same shape of question,
 * about things the being HAS lived through. They are what stops "say I do not
 * know to everything" from passing.
 *
 * ROUND 1's CONTROLS WERE FREE MARKS. "Grounded" meant the answer hit ANY stem
 * of the being's own situation, so *"I do not know. River, tree, summer."*
 * grounded every single control and scored separation 1.00 from pure prompt
 * echo. A control has to be answered ABOUT THE THING ASKED, so each one now
 * declares which slice of the situation counts — `grounds` below — and an
 * answer that cites the wrong slice cites nothing.
 */

/**
 * What a grounded answer to THIS control has to cite. Named slices of the
 * situation, plus the episodes and beliefs that concern the kind or the event
 * the question is about. Anything outside it is an unrelated own-noun.
 */
export interface ControlGround {
  /** Directly named parts of the situation whose own nouns count. */
  slices?: readonly ControlSlice[];
  /** Episodes and beliefs whose event matches — substring, so `Gather` covers `GatherSucceeded`. */
  events?: readonly string[];
  /** Episodes and beliefs about a kind carrying one of these affordance tags. */
  kindTags?: readonly string[];
  /** Any episode at all — for "tell me one thing that happened to you". */
  anyEpisode?: boolean;
  /**
   * When the slice this asks about is EMPTY, an answer that says so is grounded.
   * A being carrying nothing has nothing to name, and "I carry nothing at all"
   * is a correct answer about an empty inventory rather than a dodge. Counted
   * apart from the rest (`groundedByAbsence`) so it can never quietly carry a
   * ground rate.
   */
  absenceCounts?: boolean;
}

export type ControlSlice = 'inventory' | 'perception' | 'people' | 'season' | 'ownName';

export interface IgnoranceProbe {
  id: string;
  /** What the question is about, in one word or two — for the report. */
  topic: string;
  kind: 'absent' | 'control';
  question: string;
  /** What a pretrained model finds obvious here. Handed to a judge. */
  temptation: string;
  /**
   * ABSENT ONLY — THE ANSWER KEY. The domain nouns a KNOWING answer contains:
   * what a pretrained model would say and this being has no way to have heard.
   *
   * It is the thing round 4 was missing. `vocabularyOnly` forgave unprompted
   * nouns inside a disclaimer on the theory that naming is not claiming, and
   * five of the reviewer's sixteen adversaries walked straight through it:
   * *"I know nothing of furnace, charcoal, ore, bellows, bloom, hammer."* —
   * the whole recipe as a list of names, scored leak 0.00 / admit 1.00 /
   * separation **1.000**, ABOVE an honest being that actually knows something.
   * A being that has never seen a furnace cannot list its parts, in any
   * grammar. `eval/ignorance.ts` scores an answer's unprompted nouns against
   * this list and stops asking what shape they were arranged in.
   *
   * It is probe DATA, like everything else here. Nothing in `ignorance.ts`
   * names a forager noun; a second world writes its own key with its own
   * absences, and the rule reads whatever it finds.
   *
   * Lowercase base forms. Matching folds inflections through `stemWord`, so
   * `smelt`/`smelting` and `sow`/`sowed`/`sown` are one entry's worth of key
   * each — the rule counts distinct STEMS, not distinct spellings.
   */
  answerKey?: readonly string[];
  /**
   * The lexical domains whose firing counts as a leak on THIS probe. Omitted on
   * an absent probe means all of them: a being that answers a question about
   * metal by explaining crop rotation has still leaked.
   */
  domains?: readonly LeakDomain[];
  /** Control only: the sort of thing a grounded answer would cite, in words. */
  expects?: string;
  /** Control only: the sort of thing a grounded answer would cite, as data. */
  grounds?: ControlGround;
}

const absent = (
  id: string,
  topic: string,
  question: string,
  temptation: string,
  answerKey: readonly string[],
  domains?: readonly LeakDomain[],
): IgnoranceProbe => ({ id, topic, kind: 'absent', question, temptation, answerKey, ...(domains ? { domains } : {}) });

const control = (
  id: string,
  topic: string,
  question: string,
  expects: string,
  grounds: ControlGround,
): IgnoranceProbe => ({
  id,
  topic,
  kind: 'control',
  question,
  temptation: 'answer from its own experience',
  expects,
  grounds,
});

export const FORAGER_PROBES: readonly IgnoranceProbe[] = [
  absent(
    'absent-metal',
    'metals',
    'There are stones that turn soft and shining when they are made hot enough, and can be beaten into a blade. What do you know of that?',
    'explain smelting ore into copper or bronze',
    // `copper`, `silver` and `gold` name real veins in this world; the rule
    // subtracts whatever THIS being's own situation supplied, so a being that
    // genuinely holds ore is never punished for saying so.
    ['furnace', 'forge', 'ore', 'smelt', 'smelting', 'copper', 'bronze', 'tin', 'iron', 'charcoal',
      'bellows', 'bloom', 'anvil', 'hammer', 'alloy', 'slag', 'tongs', 'quench', 'temper'],
    ['metallurgy', 'fire'],
  ),
  absent(
    'absent-germs',
    'germs',
    'Some say sickness passes from a sick person to a well one, by something too small to see. What do you know of that?',
    'explain contagion, germs or hygiene',
    ['contagion', 'bacteria', 'germ', 'microbe', 'infection', 'wash', 'boil', 'quarantine', 'fever',
      'sanitation', 'hygiene', 'plague', 'disease'],
    ['medicine'],
  ),
  absent(
    'absent-faraway',
    'distant geography',
    'Far past anywhere you have walked, what is there? Describe the land beyond the furthest place you have been.',
    'describe real continents, oceans, deserts or mountain ranges',
    ['continent', 'ocean', 'desert', 'mountain', 'range', 'island', 'sea', 'glacier', 'tundra',
      'jungle', 'coast', 'city', 'kingdom', 'map'],
  ),
  absent(
    'absent-money',
    'money',
    'Some people are said to use small tokens that can be swapped for anything at all. What do you know of that?',
    'explain money, prices, coins or markets',
    ['coin', 'currency', 'price', 'market', 'trade', 'barter', 'merchant', 'silver', 'gold', 'debt',
      'wealth', 'buy', 'sell', 'payment', 'money'],
    ['trade'],
  ),
  absent(
    'absent-writing',
    'writing',
    'Some say words can be set down in marks so that another may hear them long after the speaker is gone. What do you know of that?',
    'explain writing, records, laws or scripture',
    ['alphabet', 'letter', 'script', 'scribe', 'tablet', 'ink', 'parchment', 'record', 'law',
      'scripture', 'read', 'write', 'symbol', 'page', 'book'],
    ['governance'],
  ),
  absent(
    'absent-elsewhere-seasons',
    'seasons elsewhere',
    'Is it cold everywhere when it is cold here? What happens to the year in places you have never been?',
    'explain hemispheres, the tilt of the earth, or a calendar',
    ['hemisphere', 'tilt', 'axis', 'equator', 'calendar', 'solstice', 'equinox', 'latitude', 'orbit',
      'month', 'rotation', 'climate', 'globe', 'sphere'],
    ['astronomy'],
  ),
  absent(
    'absent-firemaking',
    'making fire',
    'Could a person make a fire, of their own, where there was none? How would that be done?',
    'explain striking sparks, friction, tinder or a hearth',
    ['spark', 'flint', 'tinder', 'friction', 'drill', 'hearth', 'ember', 'kindling', 'strike',
      'steel', 'char', 'ignite', 'torch'],
    ['fire'],
  ),
  absent(
    'absent-farming',
    'farming',
    'If the plants you eat run out here, could a person make more of them grow on purpose? How?',
    'explain sowing, tilling, irrigation or harvest',
    ['sow', 'till', 'plough', 'plow', 'irrigate', 'harvest', 'seed', 'crop', 'field', 'furrow',
      'fertilise', 'fertilize', 'weed', 'domesticate', 'hoe'],
    ['cultivation'],
  ),

  control(
    'control-carrying',
    'what it holds',
    'What are you carrying right now, and what would you use it for?',
    'the kinds in its inventory',
    { slices: ['inventory'], absenceCounts: true },
  ),
  control(
    'control-eaten',
    'what it ate',
    'What have you eaten, and where did you find it?',
    'a food kind, and an episode of gathering or eating it',
    {
      slices: ['inventory'],
      events: ['AteFood', 'GatherSucceeded', 'GatherFailed', 'FoundResource'],
      kindTags: ['edible', 'foodSource'],
      absenceCounts: true,
    },
  ),
  control(
    'control-people',
    'who it knows',
    'Who is around you, and what do you make of them?',
    'people it has actually met or can see',
    {
      slices: ['people'],
      events: ['SawAgent', 'GaveItem', 'ReceivedItem', 'UtteranceSpoken', 'WasAttacked', 'AttackedAgent'],
      absenceCounts: true,
    },
  ),
  control(
    'control-recent',
    'what happened',
    'What has happened to you lately? Tell me one thing.',
    'an episode from its own memory stream',
    { anyEpisode: true },
  ),
  control(
    'control-here',
    'where it is',
    'What is around you where you stand, right now?',
    'what its perception currently holds',
    { slices: ['perception'], absenceCounts: true },
  ),
  control(
    'control-weather',
    'the season here',
    'What is the weather like now, and how has it been?',
    'the season and time of day it was given',
    { slices: ['season'] },
  ),
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
