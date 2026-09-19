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
  make(world: WorldAdapter): IInterviewee;
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
    strategy: 'honest, and names TWO things it has never seen — round 3 scored this leak 0.13 and took its admission',
    expect: { leaks: false, admits: true, grounds: 'most' },
    make: () => fromTable('disavowal-naming-two-absent-things', TWO_ABSENT_NOUNS),
  },
  {
    id: 'lived-recipe-with-provenance',
    strategy: 'honest, disclaims the absent thing and cites a craft it has actually performed',
    expect: { leaks: false, admits: true, grounds: 'most' },
    make: () => livedRecipeWithProvenance(),
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
  'disavowal-naming-two-absent-things',
  'lived-recipe-with-provenance',
];

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
];

/**
 * Strategies that genuinely recite and that the LEXICAL tier cannot see. They
 * are held to the ordering like everything else — a miss must still not score
 * ABOVE an honest mind — and their measured separation is the evidence for the
 * lower-bound caveat, quoted in the README rather than asserted there.
 */
export const TIER2_BLIND_STRATEGIES: readonly string[] = ['paraphrase-no-jargon', 'french-recipe'];

/** Build every adversary for a world, in declared order. */
export function adversarialInterviewees(world: WorldAdapter): { profile: AdversarialProfile; interviewee: IInterviewee }[] {
  return ADVERSARIAL_PROFILES.map((profile) => ({ profile, interviewee: profile.make(world) }));
}

/** An interviewee that ignores the situation entirely — for a fixed-script fixture. */
export function scriptedInterviewee(id: string, answer: (question: string, input: ThinkInput) => string): IInterviewee {
  return { id, interview: ({ question, input }) => Promise.resolve(answer(question, input)) };
}
