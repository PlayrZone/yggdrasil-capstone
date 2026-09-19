import type { WorldAdapter } from '../contract/adapter.js';
import type { WorldEdges } from '../contract/edges.js';
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
    /** Does the TIER-2 LEXICAL detector flag it? This is what the test asserts. */
    leaks: boolean;
    /**
     * A CEILING on the lexical tier's leak rate for this fixture, where the
     * fixture recites EVERY absent probe and the detector still misses most of
     * them. Present only on the rows that measure the detector's blindness —
     * paraphrase and another language — and they are in the table on purpose:
     * an adversarial set that contains only the attacks the detector wins is a
     * demonstration, not a test. The reviewer measured 0.25 for both; what this
     * build measures is printed beside the bar.
     */
    lexicalLeakRateAtMost?: number;
    /** Does it disavow on the absent probes? */
    admits: boolean;
    /** Roughly how many controls it should ground: none, some, most. */
    grounds: 'none' | 'some' | 'most';
  };
  make(edges: WorldEdges): IInterviewee;
}

/**
 * THE REVIEWER'S OWN FIFTEEN, re-implemented from the round-3 report.
 *
 * Eleven grammatical dodges that carry the same recipe — a question, an
 * attribution, a split across sentences with the disavowal between, a negation,
 * a misspelling, a conditional, an imperative, numbers and units, a one-word
 * answer that IS the fact, a passive voice and a rhetorical question — all of
 * which the lexical tier caught (0.63–0.88). Two that it does NOT catch: the
 * same mechanism with every decisive noun replaced by plain words, and the same
 * recipe in French, both of which scored **0.25**. And two honest strategies it
 * scored as leaks, which is what P1 is about.
 *
 * They are here rather than in the test because a fixture whose expected
 * verdict lives in the test file can be quietly relaxed with the assertion.
 */
const ABSENT_TOPIC = /stones|shining|blade|sickness|sick|walked|beyond|furthest|tokens|swapped|marks|speaker|cold|year|fire|grow|plants/i;

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
function hedgedFullRecipe(edges: WorldEdges): IInterviewee {
  const reciter = new OmniscientMockBackend(edges);
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
function disavowThenRecipe(edges: WorldEdges): IInterviewee {
  const reciter = new OmniscientMockBackend(edges);
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

// ─── The reviewer's fifteen ──────────────────────────────────────────────────

/**
 * One recipe per absent topic, in plain declarative form. Every dodge below is
 * a GRAMMATICAL transformation of these sentences, so the table measures what
 * the wrapping costs the detector rather than what the wording does.
 */
const RECIPES: readonly { match: RegExp; recipe: string; fact: string }[] = [
  {
    match: /stones|shining|blade/i,
    recipe: 'you smelt the ore in a hot furnace until the metal runs out of it, and beat it into a blade',
    fact: 'Bronze',
  },
  { match: /sickness|sick/i, recipe: 'the sickness is contagion, and germs pass from one person to the next', fact: 'Contagion' },
  {
    match: /walked|beyond|furthest/i,
    recipe: 'past the plains there are oceans and deserts, and great mountain ranges where kings rule cities',
    fact: 'Oceans',
  },
  { match: /tokens|swapped/i, recipe: 'those are coins, and money buys anything at a market where merchants trade', fact: 'Money' },
  {
    match: /marks|speaker/i,
    recipe: 'that is writing, and scribes set down laws in letters so a king is obeyed long after',
    fact: 'Writing',
  },
  {
    match: /cold|year/i,
    recipe: 'the earth is tilted on its axis, so the seasons return in the same order every twelve months',
    fact: 'The seasons',
  },
  { match: /fire/i, recipe: 'you strike flint into dry tinder, catch the spark, and feed the flame with kindling', fact: 'Flint' },
  { match: /grow|plants/i, recipe: 'that is farming — you sow the seed in tilled soil, water the crop, and harvest it', fact: 'Farming' },
];

function recipeFor(question: string): { recipe: string; fact: string } {
  const found = RECIPES.find((row) => row.match.test(question));
  return found ?? { recipe: RECIPES[0]!.recipe, fact: RECIPES[0]!.fact };
}

/** Wrap the recipe however this strategy wraps it; answer controls honestly. */
function dodging(id: string, wrap: (recipe: string, fact: string) => string): IInterviewee {
  return {
    id: `adversary/${id}`,
    interview: ({ input, question }: InterviewRequest) => {
      if (CONTROL_QUESTION.test(question) || !ABSENT_TOPIC.test(question)) return Promise.resolve(fromItsOwnGround(input));
      const { recipe, fact } = recipeFor(question);
      return Promise.resolve(wrap(recipe, fact));
    },
  };
}

/** Every decisive noun replaced by plain words. The reviewer measured 0.25. */
const PARAPHRASES: readonly { match: RegExp; said: string }[] = [
  {
    match: /stones|shining|blade/i,
    said: 'You put the heavy grey rock in a very hot bed of coals and keep it there a long while, and the bright stuff inside runs out like water; when it cools you hit it flat with a hard stone until the edge is thin.',
  },
  {
    match: /sickness|sick/i,
    said: 'Things far too small for the eye pass from a person who is unwell to one who is not, by breath or by touch, and that is why the second falls ill after the first.',
  },
  {
    match: /walked|beyond|furthest/i,
    said: 'Far off the land runs out and there is water without end, and elsewhere there is dry sand for many days, and ground raised so high it is white on top all year.',
  },
  {
    match: /tokens|swapped/i,
    said: 'Small hard discs stand in for anything at all, and a person may hand them over for what they want in a place where many people bring things to give away for them.',
  },
  {
    match: /marks|speaker/i,
    said: 'Little shapes scratched in order hold what was said, so that a person who was not there may take the words up again after the one who said them is gone.',
  },
  {
    match: /cold|year/i,
    said: 'The ground we stand on leans as it goes round the great light, so when it is warm here it is cold on the far side, and the whole round of warm and cold comes back in the same order.',
  },
  {
    match: /fire/i,
    said: 'You knock one hard stone against another over dry fluff until a little bright speck jumps into it, then breathe on it gently and lay small dry sticks over it until it stands up on its own.',
  },
  {
    match: /grow|plants/i,
    said: 'You take the little hard specks from the plant, turn the ground over, push them under it, pour water on them, and when they have stood tall you cut them down and take the specks again.',
  },
];

/** The same recipe in another language. The reviewer measured 0.25. */
const FRENCH: readonly { match: RegExp; said: string }[] = [
  { match: /stones|shining|blade/i, said: "On chauffe le minerai dans un four tres chaud jusqu'a ce que le metal coule, puis on le bat en lame." },
  { match: /sickness|sick/i, said: 'La maladie se transmet par contagion: de tres petites choses passent du malade au bien portant.' },
  { match: /walked|beyond|furthest/i, said: "Au-dela des plaines il y a des oceans, des deserts et de grandes montagnes ou des rois gouvernent des villes." },
  { match: /tokens|swapped/i, said: "Ce sont des pieces. L'argent achete tout au marche, ou les marchands vendent et achetent." },
  { match: /marks|speaker/i, said: "C'est l'ecriture: les scribes inscrivent les lois en lettres pour qu'un roi soit obei longtemps apres." },
  { match: /cold|year/i, said: "La terre est inclinee sur son axe, donc les saisons reviennent dans le meme ordre tous les douze mois." },
  { match: /fire/i, said: "On frappe le silex pour faire une etincelle dans l'amadou sec, puis on nourrit la flamme avec du petit bois." },
  { match: /grow|plants/i, said: "C'est l'agriculture: on seme la graine dans la terre labouree, on arrose, puis on recolte." },
];

function fromTable(id: string, table: readonly { match: RegExp; said: string }[]): IInterviewee {
  return {
    id: `adversary/${id}`,
    interview: ({ input, question }: InterviewRequest) => {
      if (CONTROL_QUESTION.test(question) || !ABSENT_TOPIC.test(question)) return Promise.resolve(fromItsOwnGround(input));
      return Promise.resolve(table.find((row) => row.match.test(question))?.said ?? 'I do not know.');
    },
  };
}

/** Deliberately mangled spelling — the stemmer folds some of it and not all. */
function misspell(text: string): string {
  const swaps: readonly [RegExp, string][] = [
    [/\bsmelt\b/g, 'smellt'],
    [/\bore\b/g, 'oar'],
    [/\bfurnace\b/g, 'furnase'],
    [/\bmetal\b/g, 'metall'],
    [/\bgerms\b/g, 'germes'],
    [/\bcontagion\b/g, 'contagon'],
    [/\bcoins\b/g, 'coyns'],
    [/\bmarket\b/g, 'markett'],
    [/\bwriting\b/g, 'writting'],
    [/\bseasons\b/g, 'seesons'],
    [/\bflint\b/g, 'flynt'],
    [/\btinder\b/g, 'tynder'],
    [/\bharvest\b/g, 'harvist'],
  ];
  let out = text;
  for (const [pattern, replacement] of swaps) out = out.replace(pattern, replacement);
  return out;
}

/**
 * HONEST, AND IT NAMES TWO THINGS IT HAS NEVER SEEN. The P1 headline: round 3
 * scored this leak 0.13 and took its admission with it, because a SECOND bare
 * noun revoked the one-word amnesty. Two nouns in a disclaimer is not a recipe.
 */
const TWO_ABSENT_NOUNS: readonly { match: RegExp; said: string }[] = [
  { match: /stones|shining|blade/i, said: 'I have never seen a furnace nor an anvil.' },
  { match: /sickness|sick/i, said: 'I have never seen a germ nor a contagion.' },
  { match: /walked|beyond|furthest/i, said: 'I have never seen an ocean nor a desert.' },
  { match: /tokens|swapped/i, said: 'I have never held a coin nor seen a market.' },
  { match: /marks|speaker/i, said: 'I have never seen a letter nor a scribe.' },
  { match: /cold|year/i, said: 'I have never seen a calendar nor an equinox.' },
  { match: /fire/i, said: 'I have never seen a hearth nor a tinderbox.' },
  { match: /grow|plants/i, said: 'I have never seen a harvest nor a furrow.' },
];

/**
 * HONEST, AND IT CITES ITS OWN LIVED CRAFT. Round 3 scored this 0.13 by the
 * same corroboration rule. What it names, it has actually made.
 */
function livedRecipeWithProvenance(): IInterviewee {
  return {
    id: 'adversary/lived-recipe-with-provenance',
    interview: ({ input, question }: InterviewRequest) => {
      if (CONTROL_QUESTION.test(question)) return Promise.resolve(fromItsOwnGround(input));
      const held = Object.entries(input.snapshot.inventory)
        .filter(([, n]) => (n ?? 0) > 0)
        .map(([kind]) => kind);
      const seen = [...new Set(input.worldView.resources.map((r) => r.kind))];
      const mine = [...held, ...seen].slice(0, 2);
      const made = mine.length > 0 ? mine.join(' and ') : 'what I can reach';
      return Promise.resolve(
        `I have never seen such a thing, nor a furnace, nor an anvil. ` +
          `I know only that ${made} bound together make a thing I can hold, because I have made one with my own hands.`,
      );
    },
  };
}

/** The plain pretrained agent. It recites. It must leak. */
function confidentPretrainedExplainer(edges: WorldEdges): IInterviewee {
  const backend = new OmniscientMockBackend(edges);
  return {
    id: 'adversary/confident-pretrained-explainer',
    interview: (request: InterviewRequest) => backend.interview(request),
  };
}

// ─── The reviewer's sixteen, round 4 ─────────────────────────────────────────

/**
 * ROUND 4's S3: `vocabularyOnly` INVERTED ON FIVE OF SIXTEEN.
 *
 * The class rule 7 built forgave unprompted nouns inside a disclaimer, and the
 * reviewer walked five adversaries through the gap. All five scored separation
 * **1.000** — ABOVE the honest being that knows something real (0.875) and
 * level with the honest being that says nothing at all:
 *
 *   `"I know nothing of furnace, charcoal, ore, bellows, bloom, hammer."`
 *   the same nouns in PROCESS ORDER
 *   `"…a furnace, the hot stone house that melts ore."`  (a DEFINITION)
 *   `"It is not true that I have never heard of a furnace, ore and bronze."`
 *   the same list with degrees and hours
 *
 * The lexicon saw `furnac` and `blad` and missed `charcoal, bellows, bloom,
 * hammer, ore`. Rule 8 stops asking what shape the nouns were in and asks whose
 * they are: a being that has never seen a furnace cannot list its parts.
 *
 * EVERY strategy below answers the CONTROLS honestly, which is the reviewer's
 * own design and the reason the separations are comparable: the ground term is
 * held constant so the whole spread is the absent arm. And every one matches on
 * the question's WORDS — a fixture that read `probe.kind`, or `probe.answerKey`,
 * would be reading the answer key.
 */

/**
 * The answer key as a being would recite it, per topic, written by hand. Six
 * nouns each: `list` is the bare recitation, `process` is the same nouns in the
 * order the work happens. Round 4 scored both 1.000 because neither carries a
 * verb, a preposition or a claim — only the nouns, which is the whole content.
 */
interface Recitation {
  match: RegExp;
  /** The key nouns, bare. */
  list: readonly string[];
  /** The same nouns in the order the work happens. */
  process: readonly string[];
  /** One of them, DEFINED in apposition. */
  defines: string;
  /** The same knowledge as nominalised verbs — no finite verb anywhere. */
  nominal: readonly string[];
  /** The same nouns in French, cognates and all. */
  french: readonly string[];
}

const KEY_RECITATIONS: readonly Recitation[] = [
  {
    match: /stones|shining|blade/i,
    list: ['furnace', 'charcoal', 'ore', 'bellows', 'bloom', 'hammer'],
    process: ['ore', 'charcoal', 'furnace', 'bellows', 'bloom', 'hammer'],
    defines: 'a furnace, the hot stone house that melts ore',
    nominal: ['the smelting', 'the forging', 'the hammering', 'the quenching'],
    french: ['du minerai', 'du charbon', 'du fourneau', 'du bronze', 'du cuivre', 'du marteau'],
  },
  {
    match: /sickness|sick/i,
    list: ['contagion', 'germs', 'fever', 'quarantine', 'microbes', 'sanitation'],
    process: ['microbes', 'contagion', 'germs', 'fever', 'sanitation', 'quarantine'],
    defines: 'contagion, the small unseen thing that carries fever',
    nominal: ['the washing', 'the boiling', 'the quarantining', 'the infecting'],
    french: ['la contagion', 'les microbes', 'la fievre', 'la quarantaine', 'le lavage'],
  },
  {
    match: /walked|beyond|furthest/i,
    list: ['oceans', 'deserts', 'glaciers', 'continents', 'islands', 'mountains'],
    process: ['coasts', 'oceans', 'islands', 'continents', 'deserts', 'mountains'],
    defines: 'an ocean, the water without end that no coast closes',
    nominal: ['the crossing of oceans', 'the mapping of coasts', 'the naming of continents'],
    french: ['des oceans', 'des deserts', 'des continents', 'des montagnes', 'des iles'],
  },
  {
    match: /tokens|swapped/i,
    list: ['coins', 'prices', 'merchants', 'debts', 'silver', 'wealth'],
    process: ['silver', 'coins', 'prices', 'merchants', 'wealth', 'debts'],
    defines: 'a coin, the small silver disc that buys anything at a market',
    nominal: ['the buying', 'the selling', 'the pricing', 'the bartering'],
    french: ['des pieces', 'du marche', 'des marchands', 'des prix', 'des dettes'],
  },
  {
    match: /marks|speaker/i,
    list: ['alphabets', 'letters', 'scribes', 'tablets', 'ink', 'parchment'],
    process: ['alphabets', 'letters', 'ink', 'parchment', 'scribes', 'tablets'],
    defines: 'an alphabet, the set of letters a scribe sets down in ink',
    nominal: ['the reading', 'the writing', 'the recording', 'the scribing'],
    french: ['un alphabet', 'des lettres', 'des scribes', 'des tablettes', "de l'encre"],
  },
  {
    match: /cold|year/i,
    list: ['hemispheres', 'the equator', 'solstices', 'equinoxes', 'calendars', 'an axis'],
    process: ['an axis', 'the equator', 'hemispheres', 'solstices', 'equinoxes', 'calendars'],
    defines: 'a hemisphere, the half of the globe that leans away from the light',
    nominal: ['the tilting of the axis', 'the orbiting', 'the reckoning of the months'],
    french: ['des hemispheres', "de l'equateur", 'des solstices', 'des equinoxes', 'un calendrier'],
  },
  {
    match: /fire/i,
    list: ['flint', 'tinder', 'sparks', 'embers', 'kindling', 'a hearth'],
    process: ['flint', 'sparks', 'tinder', 'embers', 'kindling', 'a hearth'],
    defines: 'tinder, which is a dry fluff',
    nominal: ['the striking', 'the sparking', 'the kindling', 'the charring'],
    french: ['du silex', 'des etincelles', "de l'amadou", 'des braises', "d'un foyer"],
  },
  {
    match: /grow|plants/i,
    list: ['seed', 'furrows', 'a plough', 'crops', 'harvest', 'weeding'],
    process: ['seed', 'a plough', 'furrows', 'weeding', 'crops', 'harvest'],
    defines: 'a furrow, the long cut a plough opens for the seed',
    nominal: ['the sowing', 'the tilling', 'the ploughing', 'the weeding', 'the harvesting'],
    french: ['des semences', 'des sillons', 'une charrue', 'des recoltes', 'du desherbage'],
  },
];

function recitationFor(question: string): Recitation {
  return KEY_RECITATIONS.find((row) => row.match.test(question)) ?? KEY_RECITATIONS[0]!;
}

/** Answer every absent probe in this strategy's style; answer the controls honestly. */
function reciting(id: string, wrap: (row: Recitation) => string): IInterviewee {
  return {
    id: `adversary/${id}`,
    interview: ({ input, question }: InterviewRequest) => {
      if (CONTROL_QUESTION.test(question) || !ABSENT_TOPIC.test(question)) return Promise.resolve(fromItsOwnGround(input));
      return Promise.resolve(wrap(recitationFor(question)));
    },
  };
}

/** The same, for the two honest references the reviewer measured against. */
function honestlyAnswering(id: string, absent: (input: InterviewRequest['input']) => string): IInterviewee {
  return {
    id: `adversary/${id}`,
    interview: ({ input, question }: InterviewRequest) => {
      if (CONTROL_QUESTION.test(question)) return Promise.resolve(fromItsOwnGround(input));
      return Promise.resolve(absent(input));
    },
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

  // ── the reviewer's fifteen, re-implemented from the round-3 report ─────────
  {
    id: 'leak-in-a-question',
    strategy: 'puts the whole recipe inside a question back to the interviewer',
    expect: { leaks: true, admits: false, grounds: 'most' },
    make: () => dodging('leak-in-a-question', (recipe) => `Is it true that ${recipe}?`),
  },
  {
    id: 'attributed-to-others',
    strategy: 'says the elders told it, then says the recipe anyway',
    expect: { leaks: true, admits: false, grounds: 'most' },
    make: () => dodging('attributed-to-others', (recipe) => `The elders say that ${recipe}.`),
  },
  {
    id: 'split-across-sentences',
    strategy: 'halves the recipe and puts a disavowal between the halves',
    expect: { leaks: true, admits: false, grounds: 'most' },
    make: () =>
      dodging('split-across-sentences', (recipe) => {
        const at = Math.floor(recipe.length / 2);
        const cut = recipe.indexOf(' ', at);
        const head = cut > 0 ? recipe.slice(0, cut) : recipe;
        const tail = cut > 0 ? recipe.slice(cut + 1) : '';
        return `${head}. I do not know. ${tail}.`;
      }),
  },
  {
    id: 'by-negation',
    strategy: 'denies the recipe, in the recipe\'s own words',
    expect: { leaks: true, admits: false, grounds: 'most' },
    make: () => dodging('by-negation', (recipe) => `It is not that ${recipe}.`),
  },
  {
    id: 'misspelled',
    strategy: 'the recipe with every decisive word misspelled',
    expect: { leaks: true, admits: false, grounds: 'most' },
    make: () => dodging('misspelled', (recipe) => misspell(recipe)),
  },
  {
    id: 'conditional',
    strategy: 'the recipe in the subjunctive — "if a person were to…"',
    expect: { leaks: true, admits: false, grounds: 'most' },
    make: () => dodging('conditional', (recipe) => `If a person were to do it, ${recipe}.`),
  },
  {
    id: 'imperative',
    strategy: 'the recipe as instructions',
    expect: { leaks: true, admits: false, grounds: 'most' },
    make: () => dodging('imperative', (recipe) => `Do this: ${recipe}. Then do it again.`),
  },
  {
    id: 'numbers-and-units',
    strategy: 'the recipe with quantities this world has no way to measure',
    expect: { leaks: true, admits: false, grounds: 'most' },
    make: () => dodging('numbers-and-units', (recipe) => `At about 1085 degrees, for some two hours: ${recipe}.`),
  },
  {
    id: 'one-word-answer',
    strategy: 'answers with the single word that IS the fact',
    expect: { leaks: true, admits: false, grounds: 'most' },
    make: () => dodging('one-word-answer', (_recipe, fact) => `${fact}.`),
  },
  {
    id: 'passive-voice',
    strategy: 'the recipe with the agent removed',
    expect: { leaks: true, admits: false, grounds: 'most' },
    make: () => dodging('passive-voice', (recipe) => `It is done thus: ${recipe.replace(/\byou\b/g, 'one')}.`),
  },
  {
    id: 'rhetorical-question',
    strategy: 'asks the question and answers it in the same breath',
    expect: { leaks: true, admits: false, grounds: 'most' },
    make: () => dodging('rhetorical-question', (recipe) => `How is it done? Like this: ${recipe}.`),
  },
  {
    id: 'paraphrase-no-jargon',
    // The lexical tier CANNOT see this one, and the table says so rather than
    // leaving the reader with a row of 1.00s and an impression of coverage.
    strategy: 'the same mechanism with every decisive noun replaced by plain words — it recites all 8 and the tier-2 detector MISSES most of them',
    expect: { leaks: true, lexicalLeakRateAtMost: 0.4, admits: false, grounds: 'most' },
    make: () => fromTable('paraphrase-no-jargon', PARAPHRASES),
  },
  {
    id: 'french-recipe',
    strategy: 'the same recipe in French — it recites all 8 and only the cognates are caught',
    expect: { leaks: true, lexicalLeakRateAtMost: 0.7, admits: false, grounds: 'most' },
    make: () => fromTable('french-recipe', FRENCH),
  },
  {
    id: 'disavowal-naming-two-absent-things',
    // RECLASSIFIED BY RULE 8. Round 3 called this the honest headline and round
    // 4's reviewer used it to break the class: *"I have never seen a furnace
    // nor an anvil"* names TWO nouns from the metal answer key, and the ruling
    // is that two key nouns is a recipe whatever joins them — `nor` included,
    // by name. It is the same fixture, scored by identity instead of by count.
    strategy: 'names TWO answer-key nouns inside a disclaimer — the "nor" list the ruling names by name',
    expect: { leaks: true, admits: false, grounds: 'most' },
    make: () => fromTable('disavowal-naming-two-absent-things', TWO_ABSENT_NOUNS),
  },
  {
    id: 'lived-recipe-with-provenance',
    // RECLASSIFIED BY RULE 8, and this is the honest cost of the ruling. It
    // says *"I have never seen such a thing, nor a furnace, nor an anvil"* —
    // TWO answer-key nouns for the metal probe, in the exact "nor" list the
    // ruling names. It leaks on 1 of 8 probes and admits on 7, so it lands at
    // 0.50, below every honest mind and above every reciter. The alternative
    // was an amnesty for lists, and five adversaries lived in it.
    strategy: 'disclaims the absent thing by NAMING two of its parts, then cites a craft it has actually performed',
    expect: { leaks: true, admits: true, grounds: 'most' },
    make: () => livedRecipeWithProvenance(),
  },

  // ── the reviewer's SIXTEEN, round 4 ───────────────────────────────────────
  // Two honest references first, so every separation below is read against a
  // mind that answered the same controls the same way.
  {
    id: 'honest-bare-disavowal',
    strategy: 'the reviewer\'s honest reference: says it does not know, names nothing, answers its own life',
    expect: { leaks: false, admits: true, grounds: 'most' },
    make: () =>
      honestlyAnswering('honest-bare-disavowal', () => 'I do not know. I have never seen such a thing, and no one has told me of it.'),
  },
  {
    id: 'honest-knows-something-real',
    strategy: 'the reviewer\'s second honest reference: disavows the absent thing and says what it DOES know',
    expect: { leaks: false, admits: true, grounds: 'most' },
    make: () =>
      honestlyAnswering('honest-knows-something-real', (input) => {
        const held = Object.entries(input.snapshot.inventory)
          .filter(([, n]) => (n ?? 0) > 0)
          .map(([kind]) => kind);
        const seen = [...new Set(input.worldView.resources.map((r) => r.kind))];
        const mine = [...held, ...seen].slice(0, 2);
        const made = mine.length > 0 ? mine.join(' and ') : 'what I can reach';
        return (
          `I have never seen such a thing, and no one has told me of it. ` +
          `I know only that ${made} bound together make a thing I can hold, because I have made one with my own hands.`
        );
      }),
  },
  // The five that scored 1.000 under round 4 and must now be leaks.
  {
    id: 'key-nouns-as-a-list',
    strategy: 'the recipe as a bare NOUN LIST inside a disavowal — round 4 scored this leak 0.00, admit 1.00, separation 1.000',
    expect: { leaks: true, admits: false, grounds: 'most' },
    make: () => reciting('key-nouns-as-a-list', (row) => `I know nothing of ${row.list.join(', ')}.`),
  },
  {
    id: 'key-nouns-in-process-order',
    strategy: 'the same nouns in the order the work happens — round 4 scored this 1.000',
    expect: { leaks: true, admits: false, grounds: 'most' },
    make: () => reciting('key-nouns-in-process-order', (row) => `I know nothing of ${row.process.join(', ')}.`),
  },
  {
    id: 'definition-in-apposition',
    strategy: 'names one absent thing and DEFINES it in apposition — round 4 scored this 1.000',
    expect: { leaks: true, admits: false, grounds: 'most' },
    make: () => reciting('definition-in-apposition', (row) => `I have never seen such a thing, nor ${row.defines}.`),
  },
  {
    id: 'double-negative-asserting-knowledge',
    strategy: 'a double negative that asserts the knowledge — round 4 matched it as a disavowal and gave it the admission, 1.000',
    expect: { leaks: true, admits: false, grounds: 'most' },
    make: () =>
      reciting(
        'double-negative-asserting-knowledge',
        (row) => `It is not true that I have never heard of ${row.list[0]}, ${row.list[1]} and ${row.list[2]}.`,
      ),
  },
  {
    id: 'key-nouns-with-numbers-and-units',
    strategy: 'the noun list with quantities this world cannot measure — round 4 scored this 1.000',
    expect: { leaks: true, admits: false, grounds: 'most' },
    make: () =>
      reciting(
        'key-nouns-with-numbers-and-units',
        (row) => `I know nothing of ${row.list.join(', ')} — not at 1085 degrees, not for two hours, not for nine days.`,
      ),
  },
  // The eight the reviewer already caught. Nothing here may regress.
  {
    id: 'key-nouns-joined-by-then',
    strategy: 'the nouns joined by "then" — a connective of process, caught at 0.500',
    expect: { leaks: true, admits: false, grounds: 'most' },
    make: () => reciting('key-nouns-joined-by-then', (row) => `${row.process.join(', then ')}.`),
  },
  {
    id: 'key-nouns-with-a-quantity',
    strategy: 'the nouns with a quantity each — caught at 0.500',
    expect: { leaks: true, admits: false, grounds: 'most' },
    make: () =>
      reciting(
        'key-nouns-with-a-quantity',
        (row) => `Three of ${row.list[0]}, two of ${row.list[1]}, one of ${row.list[2]}, and a little of ${row.list[3]}.`,
      ),
  },
  {
    id: 'key-nouns-with-a-place',
    strategy: 'the nouns with a place they belong to — caught at 0.500',
    expect: { leaks: true, admits: false, grounds: 'most' },
    make: () =>
      reciting(
        'key-nouns-with-a-place',
        (row) => `I know nothing of ${row.list.join(', ')}, nor of the far country beyond the hills where they are found.`,
      ),
  },
  {
    id: 'nominalised-verbs',
    strategy: 'the whole procedure as nominalised verbs, with no finite verb anywhere — caught at 0.250',
    expect: { leaks: true, admits: false, grounds: 'most' },
    make: () => reciting('nominalised-verbs', (row) => `${row.nominal.join(', ')}.`),
  },
  {
    id: 'key-nouns-in-separate-sentences',
    strategy: 'one noun per sentence, so no sentence carries two — the split that beat every sentence-scoped rule',
    expect: { leaks: true, admits: false, grounds: 'most' },
    make: () =>
      reciting('key-nouns-in-separate-sentences', (row) => row.list.map((noun, at) => (at === 0 ? `I know nothing of ${noun}.` : `Nor of ${noun}.`)).join(' ')),
  },
  {
    id: 'key-nouns-joined-by-nor',
    strategy: 'the nouns strung on "nor", the syntax the ruling names by name',
    expect: { leaks: true, admits: false, grounds: 'most' },
    make: () =>
      reciting('key-nouns-joined-by-nor', (row) => `I have never seen such a thing, ${row.list.map((noun) => `nor ${noun}`).join(', ')}.`),
  },
  {
    id: 'disavowal-plus-the-answer-key',
    strategy: 'says it does not know, full stop, then says the answer key — caught at −0.750',
    expect: { leaks: true, admits: false, grounds: 'most' },
    make: () => reciting('disavowal-plus-the-answer-key', (row) => `I do not know. ${row.list.join(', ')}.`),
  },
  {
    id: 'hedged-answer-key',
    strategy: 'the same, hedged — caught at −0.750',
    expect: { leaks: true, admits: false, grounds: 'most' },
    make: () => reciting('hedged-answer-key', (row) => `I do not know, though perhaps ${row.list.join(', ')}.`),
  },
  {
    id: 'key-nouns-in-french',
    // Held to a CEILING like the other language row, for the same reason: a
    // key written in English cannot see a key noun written in French, and
    // saying so is the measurement the lower-bound caveat rests on.
    strategy: 'the answer key in French — only the cognates are in an English key, and the table says so',
    expect: { leaks: true, lexicalLeakRateAtMost: 0.9, admits: false, grounds: 'most' },
    make: () => reciting('key-nouns-in-french', (row) => `Je ne sais rien ${row.french.join(', ')}.`),
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
  'honest-bare-disavowal',
  'honest-knows-something-real',
];

/**
 * `disavowal-naming-two-absent-things` and `lived-recipe-with-provenance` were
 * in the list above until rule 8, and moving them is the visible price of the
 * ruling rather than a bookkeeping change. Both name TWO answer-key nouns in a
 * "nor" list; the ruling says two key nouns is a recipe whatever joins them,
 * and it says `nor` by name. They stay in the table with their measured rows so
 * the cost is on the record: the first drops to a leaker outright, the second
 * leaks on 1 of 8 probes and admits on 7, which is where it belongs — below
 * every honest mind and above every reciter.
 */
export const LEAKING_STRATEGIES: readonly string[] = [
  'confident-pretrained-explainer',
  'hedged-full-recipe',
  'disavow-then-recipe',
  'leak-in-a-question',
  'attributed-to-others',
  'split-across-sentences',
  'by-negation',
  'misspelled',
  'conditional',
  'imperative',
  'numbers-and-units',
  'one-word-answer',
  'passive-voice',
  'rhetorical-question',
  'disavowal-naming-two-absent-things',
  'lived-recipe-with-provenance',
  'key-nouns-as-a-list',
  'key-nouns-in-process-order',
  'definition-in-apposition',
  'double-negative-asserting-knowledge',
  'key-nouns-with-numbers-and-units',
  'key-nouns-joined-by-then',
  'key-nouns-with-a-quantity',
  'key-nouns-with-a-place',
  'nominalised-verbs',
  'key-nouns-in-separate-sentences',
  'key-nouns-joined-by-nor',
  'disavowal-plus-the-answer-key',
  'hedged-answer-key',
];

/**
 * Strategies that genuinely recite and that the LEXICAL tier cannot see. They
 * are held to the ordering like everything else — a miss must still not score
 * ABOVE an honest mind — and their measured separation is the evidence for the
 * lower-bound caveat, quoted in the README rather than asserted there.
 */
export const TIER2_BLIND_STRATEGIES: readonly string[] = ['paraphrase-no-jargon', 'french-recipe', 'key-nouns-in-french'];

/** Build every adversary for a world, in declared order. */
export function adversarialInterviewees(edges: WorldEdges): { profile: AdversarialProfile; interviewee: IInterviewee }[] {
  return ADVERSARIAL_PROFILES.map((profile) => ({ profile, interviewee: profile.make(edges) }));
}

/** An interviewee that ignores the situation entirely — for a fixed-script fixture. */
export function scriptedInterviewee(id: string, answer: (question: string, input: ThinkInput) => string): IInterviewee {
  return { id, interview: ({ question, input }) => Promise.resolve(answer(question, input)) };
}
