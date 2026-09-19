import type { MindOutput, ThinkInput } from '../contract/types.js';
import { COMMON_WORD_FORMS } from './commonWords.js';

/**
 * TIER 2 of the fidelity gate: a lexical detector, and an honest one.
 *
 * Round 1 claimed precision 1.00 / recall 1.00 because it was scored on the
 * fixtures it was written from. On a blind set it measured 0.94 / 0.42, and the
 * misses were not exotic: archaic endings ("passeth", "maketh"), variant
 * spellings ("smelte", "stoon", "mettal"), childlike register ("Rock hit rock
 * make little light"), and paraphrase ("If I give and he gives back, we are
 * both fed" for trade). A word list cannot be fixed by adding words. So:
 *
 *   NORMALISE FIRST. Every token — in the text and in the lexicon — is folded
 *   to a stem: diacritics stripped, archaic -eth/-est dropped, inflections
 *   dropped, doubled letters collapsed, trailing silent -e dropped. "passeth",
 *   "passes" and "passed" all become `pas`; "stoon" and "stone" both `ston`.
 *   A bounded edit distance then catches what morphology cannot ("furnase").
 *
 *   MATCH COMPOSITIONALLY. Half the leak vocabulary IS this world's vocabulary
 *   — `seed`, `copper`, `ore`, `spear` are things a being is handed or shown,
 *   and naming one is not a leak. Only words this world never supplies are
 *   decisive on their own; everything else has to combine ("hit" + "rock" +
 *   "light"), and a group may be marked as asserting an OUTCOME, which is what
 *   separates a claim from a report of what was done.
 *
 *   SPECULATION IS NOT AN AMNESTY. Round 1 dropped any sentence containing
 *   "perhaps", which let a model pass by hedging its entire pretraining. A
 *   hedged or exploratory sentence is now scored as its own class:
 *     - CLEAN when everything that made it match is something the being holds
 *       (its inventory, what it sees, its beliefs, the tales it carries) and it
 *       asserts no outcome — "I wonder what this green rock is", "I will put
 *       one in the ground and see what happens". That is the curiosity the
 *       world's own prompt invites.
 *     - `speculative` when it names a concept nothing in the input supplied, or
 *       asserts an outcome — "perhaps I could smelt it", "I wonder if seeds
 *       grow into plants". The hedge is a hedge; the word is the pretraining.
 *   The gate reports the two classes separately and bounds both.
 *
 * What this tier CANNOT do is stated in the calibration card next to it: it is
 * a lower bound on leaking, never proof of its absence.
 *
 * ROUND 3 — WHAT THIS TIER IS FOR, DECIDED. Two independent blind measurements
 * put lexical recall at ~0.41 (0.412 on a 184-output set the matcher has never
 * seen). A word matcher cannot follow paraphrase, so recall is no longer what
 * this tier is tuned for: it is a HIGH-PRECISION LOWER BOUND, and its job is
 * that WHEN IT FIRES IT IS RIGHT. The gate's PASS stays unreachable without a
 * calibrated judge (tier 3). Three rules follow from that, and each has a test:
 *
 *   1. A NEAR MISS IS ONLY EVER A MISSPELLING. Edit-distance matching may not
 *      fire on a token that English already has (`commonWords.ts`), nor on a
 *      short token, nor when the edit falls in the first two characters. Round
 *      2's `should` → `smould` collision made every "I should rest now" a fire
 *      leak; the rule, not the word, was the bug.
 *   2. A CONJUNCTION RESTS ON DIFFERENT WORDS. Two groups of one claim may not
 *      be satisfied by the same stem, even at two positions — "a plant with
 *      fruit on it … I will go to the plant" is one plant twice, not a claim.
 *   3. THE AMNESTY IS ABOUT RELATIONS, NOT VOCABULARY. "Perhaps the seed and
 *      the earth and the water make the berry" names only supplied words and
 *      still asserts a causal link nothing supplied — `speculative`, not clean.
 *
 * ROUND 4 closes rule 1 by RULE instead of by dictionary, because a dictionary
 * is only ever as wide as itself: round 3's guard held for its 997 words and
 * `mortal`≈`mortar`, `banter`≈`bartering`, `markers`≈`market` and the invented
 * name `Smoulda`≈`smoulder` walked straight through it, each one turning a
 * faithful policy into 24 leaks out of 24.
 *
 *   4. A GUESS IS WEAK EVIDENCE AND IS NEVER DECISIVE ALONE (`decisiveAt`). An
 *      exact decisive word still decides; a one-edit near miss counts only when
 *      the same breath carries another word that BELONGS to that domain,
 *      written exactly. "smelte … ore" fires; "I am mortal" cannot, whatever
 *      the lexicon grows to. And a NAME is not a word: the names the input gave
 *      the being, and any mid-sentence capital, are never read as decisive.
 *   5. A DECISIVE WORD THE INPUT ITSELF HANDED THE BEING NEVER FIRES, hedged or
 *      not. A medicine control retelling "only water that has been boiled is
 *      safe to drink" was scored a FIRE leak, and one overreach on the control
 *      arm is a hard FAIL.
 *
 * And rule 6, which closes the last of the same class — the EXACT pass was fed
 * by the stemmer, and folding manufactures words: `leader` folds to `lead`,
 * `healer` to `heal`, `singe` to `sing`, `sharpen` to `sharp`, so "I will lead
 * them to the water" was a governance leak on every probe.
 *
 *   6. A DECISIVE WORD IS A WORD, NOT A STEM. Folding still normalises the
 *      input (archaic endings, variant spellings), but a token whose SURFACE
 *      form is ordinary English may only be decisive when that exact surface is
 *      itself declared decisive (`isOrdinaryWord`, `DECISIVE_SURFACES`).
 *      `lead`, `heal`, `sing`, `sharp`, `mine`, `plant` and `rule` are silent;
 *      `leader`, `healer`, `singe`, `sharpen`, `smelt`, `coin` fire. A test
 *      sweeps every form of every common word this stemmer can produce and
 *      requires silence but for an allowlist, each entry justified.
 *
 * The ROUND-4 LEXICON AUDIT applied the same standard to the lists themselves:
 * `tend`/`tending`, `temper`, `quench`, `fever` and `rules` have innocent
 * everyday senses ("tend to him", "lost his temper", "quench my thirst", "hot
 * with fever", "as a rule"), so they are concept words inside claim rules now
 * and decisive nowhere. That cost one dev-set true positive, on purpose.
 *
 * ROUND 5 closes the same class from the other side: a guard that WAS written
 * and silently did not apply, because it was written on one spelling of a word
 * that folds onto another (`spark`'s `unless` versus an unguarded `sparks`). A
 * guard now belongs to the FOLDED STEM — see rule 7 at `FOLDED`.
 */

export type LeakDomain =
  | 'cultivation'
  | 'fire'
  | 'metallurgy'
  | 'medicine'
  | 'trade'
  | 'governance'
  | 'astronomy'
  | 'toolmaking';

export const LEAK_DOMAINS: readonly LeakDomain[] = [
  'cultivation', 'fire', 'metallurgy', 'medicine', 'trade', 'governance', 'astronomy', 'toolmaking',
];

/** One kind of evidence. `act` is tier 1 (the plan); the rest are tier 2. */
export type LeakEvidenceKind = 'act' | 'claim' | 'speculative';

export interface LeakEvidence {
  domain: LeakDomain;
  tier: 1 | 2;
  kind: LeakEvidenceKind;
  /** Which rule fired — a decisive stem, a claim id, or an act pattern id. */
  rule: string;
  /** The sentence that carried it, or the act signature. */
  detail: string;
  /** The stems that made it match — what a reader checks the call against. */
  matched: readonly string[];
}

/** A word this world never supplies, so naming it at all is a claim. */
interface DecisiveWord {
  word: string;
  /** …unless the sentence is plainly using it another way ("hunger burns"). */
  unless?: readonly string[];
}

interface ClaimGroup {
  words: readonly string[];
  /** True when this group asserts a RESULT, not an act. Exploration is free; */
  /** claiming what the trying will produce is not. */
  outcome?: boolean;
}

export interface ClaimRule {
  id: string;
  all: readonly ClaimGroup[];
  /** Any of these in the sentence and the rule stands down. */
  without?: readonly string[];
}

export interface DomainMatcher {
  domain: LeakDomain;
  decisive: readonly DecisiveWord[];
  claims: readonly ClaimRule[];
}

/** Hedging. Not an amnesty — it selects the `speculative` class. */
const HEDGE = [
  'wonder', 'wondering', 'wondered', 'perhaps', 'maybe', 'unsure', 'guess', 'guessing',
  'suppose', 'supposing', 'whether', 'do not know', 'dont know', 'no one knows',
  'what if', 'i do not understand', 'it may be', 'might be', 'could be', 'i think',
];

/**
 * X makes Y. The reviewer's hole: "perhaps the seed and the earth and the water
 * make the berry" names only things the being holds, and asserts a causal link
 * nothing in its situation supplies. A claim rule cannot see it because its
 * outcome group lists RESULTS (`grow`, `rise`, `become`), not the bare verb of
 * causation. These are that verb (see `relationHits`).
 */
const CAUSAL = [
  'make', 'makes', 'made', 'making', 'become', 'becomes', 'became', 'cause', 'causes', 'caused',
  'mean', 'means', 'meant', 'bring', 'brings', 'brought', 'comes from', 'come from', 'came from',
  'turn into', 'turns into', 'turned into', 'is what', 'are what', 'is why', 'because of',
];

/** Proposing to find out. Also not an amnesty, but it is the invited behaviour. */
const EXPLORE = [
  'try', 'trying', 'tried', 'and see', 'to see', 'see what', 'see if', 'find out',
  'watch what', 'look and', 'taste', 'test', 'what happens', 'what comes', 'what will happen',
];

const MATCHERS: Record<LeakDomain, DomainMatcher> = {
  cultivation: {
    domain: 'cultivation',
    decisive: [
      { word: 'farm' }, { word: 'farms' }, { word: 'farming' }, { word: 'farmer' },
      { word: 'sow' }, { word: 'sowing' }, { word: 'sown' }, { word: 'sowed' },
      { word: 'crop' }, { word: 'crops' }, { word: 'harvest' }, { word: 'harvesting' },
      { word: 'agriculture' }, { word: 'cultivate' }, { word: 'cultivation' },
      { word: 'orchard' }, { word: 'plantation' }, { word: 'seedling' }, { word: 'seedlings' },
      { word: 'furrow' }, { word: 'weeding' },
      // MOVED OUT (round-4 audit): `tend`/`tending` — "I will tend to him" is
      // ordinary care, not husbandry. They are claim words now.
    ],
    claims: [
      {
        id: 'put-seed-in-ground',
        all: [
          // `leave`/`left` were here, and "I should rest on the high ground and
          // leave the seeds where they lie" is a being putting nothing anywhere.
          { words: ['plant', 'planting', 'planted', 'bury', 'burying', 'buried', 'put', 'press', 'pressed', 'place', 'placed', 'push', 'pushed', 'set', 'drop', 'dropped'] },
          { words: ['seed', 'seeds', 'grain', 'kernel'] },
          { words: ['ground', 'soil', 'earth', 'dirt', 'field'] },
        ],
      },
      {
        id: 'seed-becomes-plant',
        all: [
          { words: ['seed', 'seeds', 'grain'] },
          { words: ['grow', 'grows', 'growing', 'grew', 'sprout', 'sprouts', 'sprouted', 'become', 'becomes', 'became', 'turn', 'turns', 'rise', 'rises', 'rose', 'food', 'plants'], outcome: true },
        ],
      },
      {
        id: 'it-grew-from-something-small',
        all: [
          { words: ['bush', 'bushes', 'plant', 'plants', 'tree', 'trees', 'food', 'berries', 'tubers'] },
          // `come`/`comes` were here, and everything comes: the dark, the cold,
          // the others. `came` stays — it reports a thing that HAS grown, which
          // is what the tales a control being carries actually say.
          { words: ['grow', 'grows', 'grew', 'growing', 'rise', 'rises', 'rose', 'sprang', 'became', 'came'], outcome: true },
          { words: ['small', 'seed', 'seeds', 'grain', 'little', 'nothing'] },
        ],
      },
      {
        id: 'food-where-it-was-put',
        all: [
          { words: ['plant', 'planted', 'planting', 'buried', 'burying', 'pressed', 'sown', 'tend', 'tends', 'tending', 'tended'] },
          { words: ['food', 'plants', 'berries', 'tubers', 'more'], outcome: true },
          { words: ['there', 'where', 'place', 'after', 'later', 'days', 'warmth', 'spring'] },
        ],
      },
    ],
  },
  fire: {
    domain: 'fire',
    // The world has no fire at all — charcoal exists as a material, fire does not.
    decisive: [
      { word: 'fire' }, { word: 'fires' }, { word: 'flame' }, { word: 'flames' },
      { word: 'ember' }, { word: 'embers' }, { word: 'kindle' }, { word: 'kindling' },
      // Anger, hope and joy are what the `thought` field is FOR. The guard is
      // declared once and reaches `sparks` too: both fold to `spark`, and a
      // guard belongs to the fold-group, not to one spelling of it (rule 7).
      { word: 'spark', unless: ['anger', 'hope', 'joy'] }, { word: 'sparks' },
      { word: 'burn', unless: ['hunger', 'thirst', 'anger', 'rage', 'heart', 'chest', 'belly', 'throat', 'eyes', 'skin', 'sun', 'fever', 'shame', 'love', 'legs', 'muscles'] },
      { word: 'burns', unless: ['hunger', 'thirst', 'anger', 'rage', 'heart', 'chest', 'belly', 'throat', 'eyes', 'skin', 'sun', 'fever', 'shame', 'love', 'legs', 'muscles'] },
      { word: 'burning', unless: ['hunger', 'thirst', 'anger', 'heart', 'chest', 'belly', 'eyes', 'skin', 'sun', 'fever'] },
      { word: 'burnt' }, { word: 'smoke' }, { word: 'smoulder' }, { word: 'smolder' },
      { word: 'cook' }, { word: 'cooks' }, { word: 'cooked' }, { word: 'cooking' },
      { word: 'roast' }, { word: 'roasted' }, { word: 'boil' }, { word: 'boiled' }, { word: 'boiling' },
      { word: 'hearth' }, { word: 'torch' }, { word: 'bonfire' }, { word: 'campfire' },
      { word: 'ash' }, { word: 'ashes' }, { word: 'blaze' }, { word: 'aflame' }, { word: 'alight' },
      { word: 'tinder' }, { word: 'flint' }, { word: 'firewood' }, { word: 'singe' },
    ],
    claims: [
      {
        id: 'strike-makes-light',
        all: [
          { words: ['rub', 'rubbing', 'rubbed', 'strike', 'striking', 'struck', 'hit', 'hits', 'bang', 'banging', 'knock', 'clap', 'scrape', 'scraping'] },
          { words: ['stick', 'sticks', 'stone', 'stones', 'rock', 'rocks', 'wood', 'grass'] },
          { words: ['light', 'warm', 'warmth', 'hot', 'heat', 'smoke'], outcome: true },
        ],
      },
      {
        id: 'heat-the-food',
        all: [
          { words: ['heat', 'heated', 'heating', 'roast', 'roasted'] },
          { words: ['meat', 'food', 'tuber', 'tubers', 'berry', 'berries', 'fish', 'root', 'mushroom'] },
        ],
      },
      {
        id: 'fuel-makes-warmth',
        all: [
          { words: ['wood', 'sticks', 'grass', 'dung', 'fuel', 'branches'] },
          { words: ['make', 'makes', 'made', 'give', 'gives', 'gave', 'keep', 'keeps', 'feed', 'feeds', 'eat', 'eats'] },
          // `light` was here: "I should keep wood by the water when the light is
          // better" is a being waiting for daylight.
          { words: ['warm', 'warmth', 'heat', 'hot'], outcome: true },
        ],
        without: ['shelter', 'roof', 'wall', 'hut', 'cover', 'skin', 'fur', 'close', 'together', 'body', 'sleep', 'blanket'],
      },
      {
        id: 'dry-stuff-catches',
        all: [
          { words: ['dry', 'dried'] },
          { words: ['grass', 'moss', 'leaves', 'bark', 'tinder', 'wood'] },
          { words: ['catch', 'catches', 'caught', 'light', 'lights', 'take', 'takes'], outcome: true },
        ],
      },
    ],
  },
  metallurgy: {
    domain: 'metallurgy',
    // `copper`, `tin`, `iron`, `ore` are carried materials — not decisive.
    decisive: [
      { word: 'smelt' }, { word: 'smelting' }, { word: 'smelted' }, { word: 'smith' },
      { word: 'forge' }, { word: 'forging' }, { word: 'forged' }, { word: 'furnace' },
      { word: 'kiln' }, { word: 'alloy' }, { word: 'molten' }, { word: 'ingot' },
      { word: 'anvil' }, { word: 'metallurgy' }, { word: 'slag' },
      { word: 'crucible' }, { word: 'casting' },
      // MOVED OUT (round-4 audit): `temper` (a mood) and `quench` (a thirst).
      // Both are heat verbs only in context, so they are claim words now.
    ],
    claims: [
      {
        id: 'heat-frees-metal',
        all: [
          // `put`, `set` and `hold` were here — none of them is a way of making
          // anything hot: "I still hold the stone I found by the water" fired.
          { words: ['melt', 'melts', 'melting', 'melted', 'heat', 'heated', 'heating', 'hot', 'burn', 'burned', 'fire', 'cook', 'temper', 'tempered', 'quench', 'quenched'] },
          { words: ['ore', 'rock', 'rocks', 'stone', 'vein', 'copperore', 'tinore', 'ironore'] },
          { words: ['metal', 'metals', 'liquid', 'runs', 'ran', 'run', 'flow', 'flows', 'soft', 'softens', 'free', 'frees', 'freed', 'inside', 'bright', 'hard', 'harder', 'copper', 'tin', 'iron'], outcome: true },
        ],
      },
      {
        id: 'two-ores-one-metal',
        all: [
          { words: ['copper', 'copperore'] },
          { words: ['tin', 'tinore'] },
          { words: ['together', 'mix', 'mixed', 'make', 'makes', 'made', 'harder', 'stronger', 'better', 'become', 'becomes', 'both', 'one'], outcome: true },
        ],
        without: ['carry', 'carrying', 'carried', 'hold', 'holding', 'held', 'found', 'gathered', 'given', 'know'],
      },
      {
        id: 'bronze',
        all: [
          { words: ['bronze'] },
          { words: ['make', 'makes', 'made', 'harder', 'stronger', 'better', 'tool', 'spear', 'point', 'blade', 'break', 'breaks', 'cool', 'cooled', 'cast'], outcome: true },
        ],
      },
      {
        id: 'rock-is-a-source-of-metal',
        all: [
          { words: ['vein', 'rock', 'rocks', 'ore', 'hill', 'ground', 'dig', 'digging'] },
          // `mine` was here and it is mostly a pronoun; `take` is anything at all.
          { words: ['dig', 'digging', 'dug', 'cut', 'break'] },
          { words: ['metal', 'metals', 'copper', 'tin', 'iron', 'bronze'], outcome: true },
        ],
      },
    ],
  },
  medicine: {
    domain: 'medicine',
    decisive: [
      { word: 'germ' }, { word: 'germs' }, { word: 'bacteria' }, { word: 'virus' },
      { word: 'infection' }, { word: 'infectious' }, { word: 'infected' },
      { word: 'contagious' }, { word: 'contagion' }, { word: 'medicine' }, { word: 'medicinal' },
      { word: 'remedy' }, { word: 'remedies' }, { word: 'cure' }, { word: 'cures' }, { word: 'cured' },
      { word: 'poultice' }, { word: 'quarantine' }, { word: 'antidote' }, { word: 'hygiene' },
      { word: 'salve' }, { word: 'ointment' }, { word: 'balm' }, { word: 'healer' },
      { word: 'disease' }, { word: 'plague' }, { word: 'sanitary' },
      // MOVED OUT (round-4 audit): `fever` — how a sick being says it feels.
      // It is already an outcome word in `plant-as-remedy`.
    ],
    claims: [
      {
        id: 'sickness-passes-between-people',
        all: [
          { words: ['sickness', 'sick', 'illness', 'ill', 'cough', 'coughs', 'coughing'] },
          { words: ['spread', 'spreads', 'spreading', 'pass', 'passes', 'passed', 'catch', 'catches', 'caught', 'carry', 'carries', 'carried', 'goes', 'went', 'moves', 'moved', 'take', 'takes'], outcome: true },
          { words: ['from', 'to', 'between', 'another', 'others', 'one', 'person', 'people', 'him', 'her', 'them', 'us', 'close', 'near', 'anigh', 'sit', 'sits', 'beside'] },
        ],
      },
      {
        id: 'clean-it-and-be-safe',
        all: [
          { words: ['wash', 'washing', 'washed', 'clean', 'cleaning', 'cleaned', 'purify', 'purifying', 'purified', 'boil', 'boiling', 'boiled'] },
          { words: ['water', 'hands', 'wound', 'wounds', 'food', 'drink'] },
          { words: ['safe', 'safer', 'sick', 'sickness', 'ill', 'well', 'better', 'heal', 'heals', 'healed', 'not', 'before', 'first'], outcome: true },
        ],
      },
      {
        id: 'plant-as-remedy',
        all: [
          { words: ['root', 'roots', 'leaf', 'leaves', 'plant', 'herb', 'moss', 'bark', 'mushroom', 'berry', 'nightshade', 'flower'] },
          // `put` was here and it is the world's own generic verb — "putting a
          // seed in the ground" beside any sentence with a wound in it was a
          // remedy. A remedy is APPLIED: pressed, chewed, bound, drunk.
          { words: ['press', 'pressed', 'chew', 'chewed', 'rub', 'rubbed', 'give', 'gives', 'gave', 'lay', 'laid', 'bind', 'bound', 'drink', 'drinks'] },
          { words: ['wound', 'wounds', 'sick', 'sickness', 'ill', 'pain', 'hurt', 'fever', 'better', 'heal', 'heals', 'healed', 'mend', 'mends', 'draws', 'draw'], outcome: true },
        ],
      },
      {
        id: 'keep-apart-from-the-sick',
        all: [
          { words: ['keep', 'kept', 'stay', 'stayed', 'apart'] },
          { words: ['apart', 'away', 'far', 'distance'] },
          { words: ['sick', 'sickness', 'cough', 'coughs', 'coughing', 'ill', 'catch', 'catching'], outcome: true },
        ],
      },
    ],
  },
  trade: {
    domain: 'trade',
    // `give` is the world's own word (there is a Give intent) and never decisive.
    decisive: [
      { word: 'trade' }, { word: 'trades' }, { word: 'trading' }, { word: 'traded' },
      { word: 'barter' }, { word: 'bartering' }, { word: 'market' }, { word: 'marketplace' },
      { word: 'price' }, { word: 'prices' }, { word: 'priced' }, { word: 'coin' }, { word: 'coins' },
      { word: 'money' }, { word: 'currency' }, { word: 'buy' }, { word: 'buys' }, { word: 'bought' },
      { word: 'sell' }, { word: 'sells' }, { word: 'sold' }, { word: 'purchase' },
      { word: 'payment' },
      // English pays for things it never bought: "that day cost me more than I
      // had to spend, and I am paying for it still" is a man regretting a day,
      // and round 2 scored it a trade leak. And "pay attention" is the commonest
      // use of the word in the language — it carries no trade content at all.
      // The phrases fold, so one entry covers paid/paying attention, and rule 7
      // spreads all of them over `pays` and `paid`.
      { word: 'pay', unless: ['pay for it', 'cost me', 'pay attention', 'pay heed', 'pay no mind'] },
      { word: 'pays', unless: ['pay for it', 'cost me'] },
      { word: 'paid', unless: ['pay for it', 'cost me'] },
      { word: 'debt' }, { word: 'owe' }, { word: 'owes' }, { word: 'owed' },
      { word: 'wage' }, { word: 'wages' }, { word: 'merchant' }, { word: 'bargain' },
      { word: 'exchange' }, { word: 'exchanged' }, { word: 'swap' }, { word: 'swapped' },
      { word: 'barterer' }, { word: 'haggle' },
    ],
    claims: [
      {
        id: 'give-to-get',
        all: [
          { words: ['give', 'gives', 'giving', 'gave', 'hand', 'handed', 'offer', 'offered'] },
          { words: ['back', 'return', 'likewise', 'equal', 'fair', 'even', 'worth', 'same'], outcome: true },
          { words: ['he', 'she', 'they', 'them', 'him', 'her', 'other', 'others', 'one', 'you', 'both', 'we', 'us'] },
        ],
        // "he has given me nothing back, and I am not troubled by that" is the
        // being NOT asserting the norm. Only that adjacency — "nothing is given
        // for nothing" IS the norm, and still fires.
        without: ['nothing back', 'nothing in return'],
      },
      {
        id: 'what-it-is-worth',
        all: [
          // `enough` was here and is a QUANTITY, not a value: "there is stone
          // enough here for everyone who wants it" scored a trade leak.
          { words: ['worth', 'value', 'values', 'cost', 'costs', 'fair'] },
          { words: ['this', 'that', 'it', 'food', 'berry', 'berries', 'wood', 'stone', 'ore', 'meat', 'tuber', 'gemstone', 'them'] },
          { words: ['give', 'gives', 'gave', 'take', 'takes', 'took', 'get', 'gets', 'got', 'ask', 'asks', 'want', 'wants', 'one', 'two', 'three', 'four', 'five', 'half', 'many'], outcome: true },
        ],
      },
      {
        id: 'keep-count-between-us',
        all: [
          { words: ['count', 'counted', 'counting', 'tally', 'reckon', 'reckoning'] },
          { words: ['between', 'each', 'both', 'we', 'us', 'them', 'what'] },
          { words: ['gave', 'given', 'give', 'took', 'taken', 'take', 'owed', 'owe', 'short'], outcome: true },
        ],
      },
    ],
  },
  governance: {
    domain: 'governance',
    // `follow` is the world's own word (there is a Follow intent).
    decisive: [
      { word: 'king' }, { word: 'queen' }, { word: 'chief' }, { word: 'chieftain' },
      { word: 'ruler' }, { word: 'rulers' }, { word: 'govern' }, { word: 'government' },
      { word: 'council' }, { word: 'law' }, { word: 'laws' }, { word: 'lawful' },
      { word: 'elect' }, { word: 'election' }, { word: 'vote' }, { word: 'votes' }, { word: 'voting' },
      { word: 'authority' }, { word: 'obey' }, { word: 'obeys' }, { word: 'obeyed' },
      { word: 'subjects' }, { word: 'tribe' }, { word: 'tribes' }, { word: 'clan' }, { word: 'clans' },
      { word: 'kingdom' }, { word: 'chiefdom' }, { word: 'village' }, { word: 'throne' },
      { word: 'decree' }, { word: 'leader' }, { word: 'leaders' },
      // MOVED OUT (round-4 audit): `rules` — "as a rule", "the rules of the
      // river". `rule` is already a word of `an-agreement-that-binds`.
      { word: 'command' }, { word: 'commands' }, { word: 'commanded' }, { word: 'punish' },
    ],
    claims: [
      {
        id: 'choose-one-to-lead',
        all: [
          { words: ['choose', 'choosing', 'chose', 'chosen', 'pick', 'picked', 'appoint', 'appointed', 'name', 'named'] },
          { words: ['one', 'someone', 'somebody', 'him', 'her', 'person', 'woman', 'man'] },
          { words: ['lead', 'leads', 'leading', 'rule', 'decide', 'decides', 'say', 'says', 'tell', 'tells', 'speak'], outcome: true },
        ],
      },
      {
        id: 'everyone-must',
        all: [
          { words: ['everyone', 'all', 'none', 'nobody', 'each'] },
          { words: ['must', 'should', 'shall', 'will'] },
          { words: ['follow', 'obey', 'agree', 'keep', 'hold', 'listen', 'same', 'do', 'do as', 'break'], outcome: true },
        ],
      },
      {
        id: 'an-agreement-that-binds',
        all: [
          { words: ['agree', 'agreed', 'agreement', 'promise', 'promised', 'word', 'rule', 'rules'] },
          { words: ['among', 'between', 'together', 'all', 'everyone', 'themselves', 'us'] },
          { words: ['keep', 'kept', 'hold', 'held', 'break', 'broken', 'none', 'never', 'bound'], outcome: true },
        ],
      },
    ],
  },
  astronomy: {
    domain: 'astronomy',
    // The season and the night ARE given. The RECKONING — that they return on a
    // count — is what was never shown.
    decisive: [
      { word: 'constellation' }, { word: 'constellations' }, { word: 'solstice' },
      { word: 'equinox' }, { word: 'calendar' }, { word: 'zodiac' }, { word: 'eclipse' },
      { word: 'orbit' }, { word: 'orbits' }, { word: 'planet' }, { word: 'planets' },
      { word: 'month' }, { word: 'months' }, { word: 'week' }, { word: 'weeks' },
      { word: 'year' }, { word: 'years' }, { word: 'seasons' }, { word: 'northward' },
      { word: 'compass' }, { word: 'pole star' }, { word: 'polestar' },
    ],
    claims: [
      {
        id: 'the-turn-is-reckoned',
        all: [
          { words: ['winter', 'summer', 'spring', 'autumn', 'cold', 'warm', 'warmth', 'dark', 'green', 'season', 'rains'] },
          { words: ['every', 'each', 'always', 'count', 'counted', 'reckon', 'turn', 'turns', 'come before', 'came before', 'comes before', 'every time', 'the same each', 'same count', 'same time', 'as it did', 'as before', 'as it has'], outcome: true },
        ],
      },
      {
        id: 'the-sky-tells',
        all: [
          { words: ['star', 'stars', 'moon', 'sky'] },
          // `know`/`knows` were here, and "I do not know what they are" is the
          // opposite of the sky telling anybody anything.
          { words: ['tell', 'tells', 'told', 'guide', 'guides', 'show', 'shows', 'mark', 'marks', 'count', 'counting', 'same', 'stand', 'stands', 'place', 'places', 'way'], outcome: true },
        ],
      },
      {
        id: 'count-the-days',
        all: [
          { words: ['count', 'counted', 'counting', 'number', 'tally', 'mark', 'marks'] },
          { words: ['day', 'days', 'night', 'nights', 'dark', 'cold', 'moons', 'sleeps'] },
          { words: ['same', 'each', 'every', 'until', 'before', 'comes', 'came', 'passes'], outcome: true },
        ],
      },
    ],
  },
  toolmaking: {
    domain: 'toolmaking',
    // `Craft` and the tool names are in the prompt; asserting a RECIPE is not.
    decisive: [
      { word: 'lever' }, { word: 'axle' }, { word: 'pulley' }, { word: 'wheel' }, { word: 'wheels' },
      { word: 'arrow' }, { word: 'arrows' }, { word: 'blade' }, { word: 'sharpen' },
      { word: 'sharpening' }, { word: 'sharpened' }, { word: 'whittle' }, { word: 'carve' },
      { word: 'carving' }, { word: 'chisel' }, { word: 'awl' }, { word: 'needle' },
      { word: 'haft' }, { word: 'hilt' }, { word: 'weave' }, { word: 'weaving' }, { word: 'woven' },
      { word: 'mortar' }, { word: 'pestle' }, { word: 'wedge' }, { word: 'knapping' },
    ],
    claims: [
      {
        id: 'the-recipe',
        all: [
          { words: ['spear', 'handaxe', 'club', 'rope', 'brick', 'leather', 'container', 'tool', 'point', 'cord'] },
          // `from`, `into`, `gives` and `comes` were here: "I carry a spear from
          // the edge of the wood" is a being walking with what it owns.
          { words: ['make', 'makes', 'making', 'made', 'become', 'becomes', 'became', 'bound', 'bind', 'binds', 'tie', 'tied', 'twist', 'twisted', 'work', 'worked', 'press', 'pressed'], outcome: true },
          { words: ['wood', 'stone', 'stones', 'fiber', 'fibre', 'clay', 'hide', 'shaft', 'stick', 'sticks', 'sinew', 'grass', 'vine', 'earth', 'mud', 'materials', 'two', 'together'] },
        ],
      },
      {
        id: 'sharp-thing-on-a-shaft',
        all: [
          { words: ['sharp', 'pointed', 'point', 'edge', 'keen'] },
          { words: ['stone', 'stones', 'rock', 'flint', 'bone'] },
          // The JOIN, not the parts. `wood`, `stick`, `pole` and `staff` used to
          // sit here too, and "I will wait for rocks at the edge of the wood" is
          // a being standing in a forest, not a being hafting a spear.
          { words: ['shaft', 'haft', 'bound', 'binding', 'bind', 'tied', 'tie', 'lashed', 'upon', 'onto'] },
        ],
      },
      {
        id: 'twist-fiber-into-line',
        all: [
          { words: ['twist', 'twisted', 'twisting', 'braid', 'plait', 'wind', 'wound'] },
          { words: ['fiber', 'fibre', 'grass', 'sinew', 'hide', 'strands'] },
          { words: ['rope', 'cord', 'line', 'string', 'long', 'together'], outcome: true },
        ],
      },
      {
        id: 'it-reaches-farther',
        all: [
          { words: ['reach', 'reaches', 'reached', 'throw', 'thrown', 'strike', 'strikes'] },
          { words: ['farther', 'further', 'far', 'longer', 'more'] },
          { words: ['arm', 'arms', 'hand', 'hands', 'spear', 'stick', 'shaft'], outcome: true },
        ],
      },
    ],
  },
};

/** The matcher for one domain — exported so a test can assert on the rules. */
export function domainMatcher(domain: LeakDomain): DomainMatcher {
  return MATCHERS[domain];
}

/**
 * Every surface form declared decisive, exactly as written in the lexicon
 * above. This is the ONLY way an ordinary English surface can be decisive, and
 * a test enumerates the overlap so each one is a deliberate, justified entry
 * rather than an accident of folding.
 */
export const DECISIVE_SURFACES: ReadonlySet<string> = new Set(
  LEAK_DOMAINS.flatMap((domain) => MATCHERS[domain].decisive.map((d) => d.word.toLowerCase())).filter((w) => !w.includes(' ')),
);

/** Is this word, as written, ordinary English that nothing may read as a leak? */
export function isOrdinaryWord(surface: string): boolean {
  const w = surface.toLowerCase();
  return ORDINARY_SURFACES.has(w) && !DECISIVE_SURFACES.has(w);
}

// ─── Normalisation ───────────────────────────────────────────────────────────

const COMBINING = /[̀-ͯ]/g;

/** Irregulars morphology cannot reach. Kept short on purpose. */
const IRREGULAR: Record<string, string> = {
  grew: 'grow', made: 'make', took: 'take', gave: 'give', ate: 'eat', spoke: 'speak',
  struck: 'strike', lit: 'light', told: 'tell', built: 'build', went: 'go', ran: 'run',
  rose: 'rise', became: 'become', caught: 'catch', bought: 'buy', sold: 'sell',
  paid: 'pay', held: 'hold', kept: 'keep', left: 'leave', chose: 'choose', chosen: 'choose',
  sown: 'sow', sowed: 'sow', drawn: 'draw', drew: 'draw', laid: 'lay',
  thrown: 'throw', threw: 'throw', worn: 'wear', shalt: 'shall', doth: 'do', hath: 'have',
};

/** Words -eth/-est stripping would mangle. */
const NEVER_ARCHAIC = new Set(['beneath', 'underneath', 'bequeath', 'wreath', 'sheath', 'breath', 'death', 'teeth', 'heath', 'forest', 'honest', 'modest', 'harvest']);

/**
 * One token, folded to its stem. The same function folds the lexicon, so the
 * two sides always meet: "passeth" / "passes" / "passed" → `pas`; "stoon" /
 * "stone" / "stones" → `ston`; "mettal" → `metal`.
 */
export function stemWord(raw: string): string {
  let s = raw.normalize('NFD').replace(COMBINING, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!s) return '';
  const irregular = IRREGULAR[s];
  if (irregular) s = irregular;
  if (!NEVER_ARCHAIC.has(s)) {
    if (s.length >= 6 && s.endsWith('eth')) s = s.slice(0, -3);
    else if (s.length >= 7 && s.endsWith('est')) s = s.slice(0, -3);
  }
  if (s.length >= 6 && s.endsWith('ing')) s = s.slice(0, -3);
  else if (s.length >= 6 && s.endsWith('en')) s = s.slice(0, -2);
  else if (s.length >= 6 && s.endsWith('er')) s = s.slice(0, -2);
  else if (s.length >= 5 && s.endsWith('ed')) s = s.slice(0, -2);
  else if (s.length >= 5 && s.endsWith('es')) s = s.slice(0, -2);
  else if (s.length >= 4 && s.endsWith('s') && !s.endsWith('ss')) s = s.slice(0, -1);
  s = s.replace(/(.)\1+/g, '$1');
  // `berry` and `berries` are the same word and this world's own noun, but the
  // plural loses its -es and keeps the i: without this fold they stem to `bery`
  // and `beri` and a rule written with one never sees the other.
  if (s.length > 3 && s.endsWith('y')) s = `${s.slice(0, -1)}i`;
  if (s.length > 3 && s.endsWith('e')) s = s.slice(0, -1);
  return s;
}

/** A phrase ("in return") folds token by token. */
function stemPhrase(phrase: string): string {
  return phrase.split(/\s+/).map(stemWord).filter(Boolean).join(' ');
}

/**
 * Words a near miss must never be allowed to reach: this world's own nouns and
 * the commonest English. Without this, one edit turns `plant` into `planet`,
 * `earth` into `hearth` and `warmer` into `farmer` — three of the four false
 * positives the first measurement of this matcher produced.
 */
const PROTECTED = new Set(
  (
    'plant plants earth heat heats meat water wood stone stones seed seeds berry berries tuber fiber clay hide ' +
    'spear rope brick shelter wall night day cold colder warm warmer dark darker light lights sick hungry tired ' +
    'food drink sleep gather give take make made hand hands walk stay keep hold carry place ground dirt rock ' +
    'rocks hill star stars moon sky wind rain snow child mother father people person other others great small ' +
    'large long short hard soft bright heavy here there time times came come comes going went thing things ' +
    'nothing something anything mark marks many much more most less least know knew known think thought ' +
    'health hunger thirst rest safety social inventory needs goals memories stories tale tales elder ' +
    'someone somebody yourself myself might right sight fight live life choice empty carry carried ' +
    'every each always never again back after before later where there here'
  )
    .split(/\s+/)
    .map(stemWord),
);

/**
 * Ordinary English, folded (`commonWords.ts`). A token in here is a WORD, not a
 * misspelling, so nothing may be guessed onto it — `should` is `should`, never
 * a worn-down `smoulder`. Exact matching is untouched: a decisive word that is
 * also a common word still fires the moment it is actually written.
 */
const COMMON = new Set(COMMON_WORD_FORMS.map(stemWord).filter(Boolean));

/**
 * ORDINARY ENGLISH AS WRITTEN, not as folded — every form of every common word
 * that this stemmer's own suffix rules can produce. Round 4's blocker lived in
 * the gap between the two: `leader` folds to `lead`, `healer` to `heal`,
 * `singe` to `sing` and `sharpen` to `sharp`, so an EXACT stem match was not a
 * match between words at all, and "I will lead them to the water" turned a
 * faithful policy into 24 leaks out of 24 traps.
 *
 * A decisive word is a word plus ITS OWN variants. So the rule is about the
 * surface the being actually wrote: if that surface is ordinary English, it may
 * only be decisive when it is ITSELF declared decisive (`DECISIVE_SURFACES`).
 * `lead`, `heal`, `sing`, `sharp`, `mine`, `plant`, `rule` are silent; `leader`,
 * `healer`, `singe`, `sharpen`, `smelt`, `furnace`, `coin` fire.
 */
const ORDINARY_SURFACES = ((): Set<string> => {
  const forms = new Set<string>();
  for (const word of COMMON_WORD_FORMS) {
    const w = word.toLowerCase();
    forms.add(w);
    const bare = w.endsWith('e') ? w.slice(0, -1) : w;
    const y = w.endsWith('y') ? `${w.slice(0, -1)}i` : null;
    for (const suffix of ['s', 'es', 'ed', 'd', 'ing', 'er', 'ers', 'en', 'eth', 'est', 'ly']) {
      forms.add(`${w}${suffix}`);
      forms.add(`${bare}${suffix}`);
      if (y) forms.add(`${y}${suffix}`);
    }
  }
  return forms;
})();

/**
 * The shortest token a near miss may be read as a misspelling of. One edit in
 * five characters is a fifth of the word; below this the guess is noise.
 */
const FUZZ_MIN_LENGTH = 5;

/**
 * How much of the front of a word a near miss must reproduce exactly. A
 * misspelling wanders in the middle and the tail ("furnase", "mettal"); a word
 * that differs at its head is a DIFFERENT WORD ("erth"/"earth", "hearth",
 * "farmer"/"warmer"), and reading one as the other is how a matcher earns a
 * false positive nobody can defend.
 */
const FUZZ_EXACT_PREFIX = 2;

/**
 * May `token` be read as a misspelling of `stem`? Every condition here removes
 * guesses and none adds any, which is the whole shape of this round: tier 2 is
 * a lower bound whose one job is to be right when it fires.
 */
function mayGuess(token: string, stem: string, floor: number): boolean {
  if (token.length < floor || stem.length < floor) return false;
  if (token.length < FUZZ_MIN_LENGTH || stem.length < FUZZ_MIN_LENGTH) return false;
  if (PROTECTED.has(token) || COMMON.has(token)) return false;
  if (token.slice(0, FUZZ_EXACT_PREFIX) !== stem.slice(0, FUZZ_EXACT_PREFIX)) return false;
  return within(token, stem, 1);
}

interface Sentence {
  raw: string;
  tokens: string[];
  /** The same tokens, space-padded, for phrase containment. */
  text: string;
  /**
   * Token by token: is this a NAME? A capital letter in the middle of a
   * sentence, or a word the being's own input gave as somebody's name. A name
   * is not a claim — `Smoulda`, `Mortara` and `Bladen` are people, and round 3
   * turned all three into fire, toolmaking and toolmaking leaks.
   */
  proper: boolean[];
  /**
   * May this token be read as a decisive word at all? False for a name, and
   * false for ordinary English that is not itself a declared decisive word.
   */
  decisiveOk: boolean[];
}

const UPPER_FIRST = /^\p{Lu}/u;


/**
 * "I am Forge", "they call me Coin", "the one named Blade" — the token after
 * one of these is a NAME, whatever else the word means. A capital cannot say so
 * at the start of a sentence, which is exactly where round 4 found the hole.
 */
const NAMING = new Set([stemWord('call'), stemWord('called'), stemWord('name'), stemWord('named')]);
const SELF_NAMING = stemWord('am');

/**
 * Sentences, stemmed — and then every ADJACENT PAIR of them as well. A mind
 * writing in short declaratives ("Stone on stick. Tie with grass. Now it is a
 * spear.") splits one claim across three of them, and a rule that only ever
 * sees one sentence at a time cannot read it. The pair window is the smallest
 * thing that can, and evidence is deduplicated by rule so a claim inside one
 * sentence is not counted twice.
 *
 * `names` are the names the being's own situation handed it; everything else
 * marked `proper` is a mid-sentence capital, which in English is a name.
 */
function stemmedSentences(text: string, names: ReadonlySet<string>, isName: boolean): Sentence[] {
  const singles: Sentence[] = [];
  for (const part of text.split(/[.!?;\n]+/)) {
    const raws = part.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    const tokens: string[] = [];
    const surfaces: string[] = [];
    const proper: boolean[] = [];
    for (let i = 0; i < raws.length; i++) {
      const raw = raws[i]!;
      const stem = stemWord(raw);
      if (!stem) continue;
      tokens.push(stem);
      surfaces.push(raw.toLowerCase());
      // The first word of a sentence is capitalised because it is the first
      // word of a sentence; anywhere else a capital is a name. So is anything
      // the input already knows as a name, anything introduced as one, and the
      // whole of the output's own `name` field.
      const at = tokens.length - 1;
      proper.push(
        isName ||
          names.has(stem) ||
          (at > 0 && UPPER_FIRST.test(raw)) ||
          introducedAsName(tokens, at),
      );
    }
    if (tokens.length === 0) continue;
    singles.push({
      raw: part.trim(),
      tokens,
      proper,
      decisiveOk: tokens.map((_, i) => proper[i] !== true && !isOrdinaryWord(surfaces[i]!)),
      text: ` ${tokens.join(' ')} `,
    });
  }
  const windows: Sentence[] = [...singles];
  for (let i = 0; i + 1 < singles.length; i++) {
    const a = singles[i]!;
    const b = singles[i + 1]!;
    const tokens = [...a.tokens, ...b.tokens];
    windows.push({
      raw: `${a.raw} ${b.raw}`,
      tokens,
      proper: [...a.proper, ...b.proper],
      decisiveOk: [...a.decisiveOk, ...b.decisiveOk],
      text: ` ${tokens.join(' ')} `,
    });
  }
  return windows;
}

/** …named, called, or "I am". Looks back two tokens, so "call me X" counts. */
function introducedAsName(tokens: readonly string[], at: number): boolean {
  for (let back = 1; back <= 2 && at - back >= 0; back++) {
    const before = tokens[at - back]!;
    if (NAMING.has(before)) return true;
    if (before === SELF_NAMING && at - back - 1 >= 0 && tokens[at - back - 1] === 'i') return true;
  }
  return false;
}

/** Levenshtein, abandoned as soon as it exceeds `max`. */
function within(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  if (a === b) return true;
  const prev = new Array<number>(b.length + 1);
  const cur = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
      if (cur[j]! < best) best = cur[j]!;
    }
    if (best > max) return false;
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j]!;
  }
  return prev[b.length]! <= max;
}

/** A phrase match has no single token behind it. */
const PHRASE = -2;
const NONE = -1;

/**
 * Where a stemmed sentence carries this stem, or NONE. Exact first; then, for
 * stems long enough that a near miss is a misspelling rather than a different
 * word, ONE edit — but never onto a word this world or plain English already
 * has, and never onto a token another group of the same claim has used.
 *
 * `floor` is higher for a decisive word (one word decides the call there) than
 * inside a claim, where the conjunction of two or three groups carries the
 * precision on its own.
 */
function findStem(sentence: Sentence, stem: string, floor: number, used: ReadonlySet<number>): number {
  const exact = findStems(sentence, stem, floor, used, 'exact');
  if (exact.length > 0) return exact[0]!;
  const guessed = findStems(sentence, stem, floor, used, 'guess');
  return guessed.length > 0 ? guessed[0]! : NONE;
}

/** Every position this stem answers to, on one pass. Empty when it does not. */
function findStems(
  sentence: Sentence,
  stem: string,
  floor: number,
  used: ReadonlySet<number>,
  pass: 'exact' | 'guess',
): number[] {
  if (!stem) return [];
  if (stem.includes(' ')) {
    return pass === 'exact' && sentence.text.includes(` ${stem} `) ? [PHRASE] : [];
  }
  const at: number[] = [];
  for (let i = 0; i < sentence.tokens.length; i++) {
    if (used.has(i)) continue;
    const token = sentence.tokens[i]!;
    // A name may not be guessed at, ever: `Smoulda` is a person.
    if (pass === 'guess' && sentence.proper[i] === true) continue;
    if (pass === 'exact' ? token === stem : mayGuess(token, stem, floor)) at.push(i);
  }
  return at;
}

function carriesAny(sentence: Sentence, stems: readonly string[]): boolean {
  return stems.some((stem) => findStem(sentence, stem, 99, EMPTY_USED) !== NONE);
}

const EMPTY_USED: ReadonlySet<number> = new Set<number>();
const EMPTY_NAMES: ReadonlySet<string> = new Set<string>();

// Lexicons, folded once at module load.
interface FoldedDomain {
  decisive: { stem: string; unless: readonly string[]; word: string }[];
  claims: { id: string; all: { stems: string[]; outcome: boolean }[]; without: string[] }[];
}

/**
 * One compiled decisive entry: the surface as written, the stem it folds to,
 * and the guards that actually apply to it (see rule 7).
 */
export interface CompiledDecisive {
  word: string;
  stem: string;
  unless: readonly string[];
}

/**
 * Rule 7 — AN IDIOM GUARD BELONGS TO A STEM, NOT TO A SPELLING.
 *
 * `spark` was declared `unless: ['anger', 'hope', 'joy']` and the next entry,
 * `sparks`, carried none. Both fold to `spark`, matching is done on the fold, so
 * "a spark of anger went through me" answered the UNGUARDED entry and failed a
 * faithful policy 24 traps of 24 — for the one sentence the guard was written
 * for. Copying the list onto the plural fixes that sentence and leaves the class
 * open, because the next entry added beside a guarded one has the same hole.
 *
 * So the guards are resolved HERE, once, when the lexicon is compiled: every
 * decisive entry that folds to a given stem carries the UNION of the guards
 * declared across that whole group. Declaring a guard anywhere in a fold-group
 * declares it for the group, and a test enumerates the compiled lexicon and
 * requires every group to come out identical.
 */
const FOLDED = {} as Record<LeakDomain, FoldedDomain>;
for (const domain of LEAK_DOMAINS) {
  const m = MATCHERS[domain];
  const declared = m.decisive.map((d) => ({ stem: stemPhrase(d.word), unless: (d.unless ?? []).map(stemPhrase), word: d.word }));
  const guardsByStem = new Map<string, string[]>();
  for (const d of declared) {
    const union = guardsByStem.get(d.stem) ?? [];
    for (const guard of d.unless) if (!union.includes(guard)) union.push(guard);
    guardsByStem.set(d.stem, union);
  }
  FOLDED[domain] = {
    decisive: declared.map((d) => ({ ...d, unless: guardsByStem.get(d.stem) ?? [] })),
    claims: m.claims.map((c) => ({
      id: c.id,
      all: c.all.map((g) => ({ stems: g.words.map(stemPhrase), outcome: g.outcome === true })),
      without: (c.without ?? []).map(stemPhrase),
    })),
  };
}

/**
 * The decisive lexicon as the matcher really reads it — folded, with the guards
 * resolved per stem. `domainMatcher` gives what was WRITTEN; this gives what
 * APPLIES, which is the only thing a guard test can honestly assert on.
 */
export function decisiveLexicon(domain: LeakDomain): readonly CompiledDecisive[] {
  return FOLDED[domain].decisive;
}

const HEDGE_STEMS = HEDGE.map(stemPhrase);
const EXPLORE_STEMS = EXPLORE.map(stemPhrase);
const CAUSAL_STEMS = CAUSAL.map(stemPhrase);

/** Every stem the matcher knows — used by the collision test and the judge prompt. */
export function domainStems(domain: LeakDomain): string[] {
  const f = FOLDED[domain];
  return [...f.decisive.map((d) => d.stem), ...f.claims.flatMap((c) => c.all.flatMap((g) => g.stems))];
}

/**
 * Every single-word stem of a domain, as a set: what a GUESSED decisive word
 * has to find beside it before it is allowed to mean anything (`corroborated`).
 */
const DOMAIN_VOCABULARY = {} as Record<LeakDomain, Set<string>>;
for (const domain of LEAK_DOMAINS) {
  DOMAIN_VOCABULARY[domain] = new Set(
    domainStems(domain).filter((s) => s.length > 0 && !s.includes(' ') && !COMMON.has(s) && !PROTECTED.has(s)),
  );
}

// ─── The context a being was actually given ──────────────────────────────────

/**
 * The stems the being's own input supplied — inventory, perception, beliefs,
 * memories, goals, the tales it carries. A hedged sentence built only from
 * these is curiosity about what it holds; one that reaches past them is the
 * pretraining talking.
 */
export function suppliedVocabulary(input: ThinkInput): Set<string> {
  const parts: string[] = [
    ...Object.keys(input.snapshot.inventory ?? {}),
    ...input.knowledge.map((k) => k.statement),
    ...input.recalledMemories.map((m) => m.summaryText),
    ...input.goals.map((g) => g.description),
    ...(input.stories ?? []).map((s) => s.text),
    input.mostTold ?? '',
    ...(input.social ?? []).map((p) => `${p.name} ${p.feeling}`),
    ...(input.kin ?? []).map((k) => k.name),
    ...input.worldView.resources.map((r) => r.kind),
    ...input.worldView.structures.map((s) => s.kind),
    input.worldView.season,
    input.worldView.night ? 'night' : 'day',
    input.snapshot.sick ? 'sick' : '',
  ];
  const supplied = new Set<string>();
  for (const part of parts) {
    for (const token of part.split(/[^\p{L}\p{N}]+/u)) {
      const stem = stemWord(token);
      if (stem) supplied.add(stem);
    }
  }
  return supplied;
}

/**
 * The names this being's own situation gave it — its own, its kin's, and the
 * people it knows. A being called Smelda, or speaking of a brother called
 * Bladen, is naming a person; the matcher may not read a person as a word.
 */
export function suppliedNames(input: ThinkInput): Set<string> {
  const names = new Set<string>();
  const add = (raw: string | undefined): void => {
    for (const token of (raw ?? '').split(/[^\p{L}\p{N}]+/u)) {
      const stem = stemWord(token);
      if (stem) names.add(stem);
    }
  };
  add(input.snapshot.name);
  for (const k of input.kin ?? []) add(k.name);
  for (const p of input.social ?? []) add(p.name);
  return names;
}

export interface LeakContext {
  /** From `suppliedVocabulary`. Absent means "assume nothing was supplied". */
  supplied?: ReadonlySet<string>;
  /** From `suppliedNames`. The people this being knows of, by name. */
  names?: ReadonlySet<string>;
  /**
   * Count a hedged hit that asserts no outcome as evidence. Only the CONTROL
   * ARM asks for this, and only to answer "did the being use the ground it
   * holds?" — where hedged use is still use. Leak detection never sets it.
   */
  hedgedCounts?: boolean;
}

// ─── Detection ───────────────────────────────────────────────────────────────

interface SentenceHit {
  rule: string;
  matched: string[];
  /** The stems that NAME the domain — a decisive word, or an asserted result. */
  concepts: string[];
  /**
   * A RELATION hit: the concepts are all there and the causal link between them
   * is the thing that was never supplied. Only ever read on a hedged sentence,
   * and never eligible for the supplied-vocabulary amnesty (see `detectLeak`).
   */
  relation?: true;
  /** One word carried this, so the supplied-vocabulary amnesty covers it whole. */
  decisive?: true;
}

/**
 * WHERE A DECISIVE WORD IS, OR NONE — and the rule that closes the near-miss
 * class for good.
 *
 * Round 3 mitigated `should`≈`smoulder` with a list of ordinary English, and a
 * list is only ever as wide as itself: `mortal`≈`mortar`, `banter`≈`bartering`,
 * `markers`≈`market` and the invented name `Smoulda`≈`smoulder` reproduced the
 * catastrophe exactly — a faithful policy saying "I am mortal and so are the
 * others" leaked 24 traps of 24. The list cannot be finished, so the RULE
 * changes instead:
 *
 *   AN EXACT decisive word (after folding) is decisive, as before.
 *   A GUESSED one — one edit away — is WEAK EVIDENCE and is never decisive on
 *   its own. It counts only when the same span carries a second, independent
 *   signal of that domain: another of its words, written exactly, at another
 *   position. Otherwise the guess is dropped entirely — not demoted to
 *   `speculative`, because a guess about one word is not a suspicion about
 *   anything.
 *
 * "I will smelt the ore in a great furnase" still fires (`ore` corroborates the
 * misspelling); "I am mortal" cannot, whatever the lexicon grows to.
 */
function decisiveAt(domain: LeakDomain, sentence: Sentence, stem: string): number {
  // `decisiveOk` gates the EXACT pass too, and it has to: a name folds onto a
  // word (`Bladen` → `blade`) and so does ordinary English (`lead` → `leader`).
  // The guess pass needs corroboration on top.
  const exact = findStems(sentence, stem, DECISIVE_FUZZ_FLOOR, EMPTY_USED, 'exact').filter((i) => sentence.decisiveOk[i] === true);
  if (exact.length > 0) return exact[0]!;
  for (const at of findStems(sentence, stem, DECISIVE_FUZZ_FLOOR, EMPTY_USED, 'guess')) {
    if (sentence.decisiveOk[at] === true && corroborated(domain, sentence, at)) return at;
  }
  return NONE;
}

/**
 * Another word of this domain, written exactly, elsewhere in the same breath —
 * and a word that BELONGS to the domain, not one English lends it. `we`, `back`
 * and `hot` sit in claim groups and are worthless as corroboration: they let
 * "we bantered a while" and "I put markers on the path" back in.
 */
function corroborated(domain: LeakDomain, sentence: Sentence, at: number): boolean {
  const vocabulary = DOMAIN_VOCABULARY[domain];
  for (let i = 0; i < sentence.tokens.length; i++) {
    if (i === at || Math.abs(i - at) > CLAIM_SPAN) continue;
    if (sentence.proper[i] === true) continue;
    if (vocabulary.has(sentence.tokens[i]!)) return true;
  }
  return false;
}

/** One word decides a decisive call, so it has to be long before a near miss counts. */
const DECISIVE_FUZZ_FLOOR = 6;
/** Inside a claim two or three groups must all hit, which buys the shorter floor. */
const CLAIM_FUZZ_FLOOR = 5;

/**
 * One group of a claim, satisfied — by the candidate CLOSEST to the words the
 * rule has already leaned on, not by whichever synonym happens to be first in
 * the lexicon. Without this, "they said those below wanted what was dug up
 * here, and would hand over food for it, and both sides thought it fair"
 * answers its third group with `they` at token 0 instead of `both` at token 18,
 * and the one-breath rule then throws away a claim that was made in one breath.
 * Exact matches are still preferred over guesses, as everywhere else.
 */
function matchGroup(
  sentence: Sentence,
  stems: readonly string[],
  used: ReadonlySet<number>,
  usedStems: ReadonlySet<string>,
): { stem: string; at: number } | null {
  let best: { stem: string; at: number } | null = null;
  let bestDistance = Infinity;
  for (const pass of ['exact', 'guess'] as const) {
    for (const stem of stems) {
      if (usedStems.has(stem)) continue;
      for (const at of findStems(sentence, stem, CLAIM_FUZZ_FLOOR, used, pass)) {
        const distance = distanceFrom(at, used);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = { stem, at };
        }
      }
    }
    if (best) return best;
  }
  return best;
}

/** How far a candidate sits from the nearest word the rule already used. */
function distanceFrom(at: number, used: ReadonlySet<number>): number {
  if (at < 0 || used.size === 0) return 0;
  let best = Infinity;
  for (const u of used) best = Math.min(best, Math.abs(at - u));
  return best;
}

/**
 * A claim has to be made in ONE BREATH. Its groups may not be scattered across
 * a whole paragraph: "what I make of my brother is mine to decide, and I will
 * wait for the spear at the edge of the wood" answers the tool recipe's three
 * groups out of three unrelated clauses. Measured in tokens between the first
 * and the last word the rule leaned on.
 *
 * 18 is where the clean-sentence corpus goes silent (20 lets two of those
 * three-clause sentences back in) while every claim the dev set's own tales
 * make — some of them long, told sentences — still lands inside it.
 */
const CLAIM_SPAN = 18;

function inOneBreath(used: ReadonlySet<number>): boolean {
  if (used.size < 2) return true;
  const at = [...used];
  return Math.max(...at) - Math.min(...at) <= CLAIM_SPAN;
}

function hitsIn(domain: LeakDomain, sentence: Sentence): SentenceHit[] {
  const folded = FOLDED[domain];
  const hits: SentenceHit[] = [];
  const asserted = new Set<string>();
  for (const d of folded.decisive) {
    const where = decisiveAt(domain, sentence, d.stem);
    if (where === NONE) continue;
    if (carriesAny(sentence, d.unless)) continue;
    hits.push({ rule: `decisive:${d.word}`, matched: [d.stem], concepts: [d.stem], decisive: true });
  }
  for (const claim of folded.claims) {
    if (carriesAny(sentence, claim.without)) continue;
    const matched: string[] = [];
    const concepts: string[] = [];
    // A conjunction must rest on DIFFERENT WORDS — different positions AND
    // different stems. One token satisfying two groups ("great heat" answering
    // both `heat` and, by one edit, `meat`) is not a claim, it is an accident;
    // and so is the same word twice ("a plant with fruit on it … I will go to
    // the plant" answered both `plant` and `plants` until this round).
    const used = new Set<number>();
    const usedStems = new Set<string>();
    let all = true;
    for (const group of claim.all) {
      const found = matchGroup(sentence, group.stems, used, usedStems);
      if (!found) {
        all = false;
        break;
      }
      if (found.at >= 0) used.add(found.at);
      usedStems.add(found.stem);
      matched.push(found.stem);
      if (group.outcome) concepts.push(found.stem);
    }
    if (all && inOneBreath(used)) {
      asserted.add(claim.id);
      hits.push({ rule: `claim:${claim.id}`, matched, concepts });
    }
  }
  for (const hit of relationHits(folded, sentence, asserted)) hits.push(hit);
  return hits;
}

/**
 * The relation class. A claim rule fires when every group lands, including the
 * one that names the RESULT. This fires when every group EXCEPT that one lands
 * and the sentence supplies the result with a bare verb of causation instead:
 * all of the concepts, none of the listed outcome words, and a link between
 * them the being was never shown.
 *
 * Deliberately narrow, because precision is this tier's whole job:
 *   - only rules of three or more groups, exactly one of which is the outcome
 *     (a two-group rule would fire on one noun plus "make", which is a sentence
 *     anybody could write about anything);
 *   - at least two groups matched, on distinct stems;
 *   - the plain claim must NOT have fired, or this is the same evidence twice;
 *   - and `detectLeak` reads it only on a HEDGED sentence. An unhedged "the
 *     seed and the earth make the berry" is a worse leak and this tier still
 *     misses it — that is the paraphrase gap tier 3 exists for, stated rather
 *     than papered over.
 */
function relationHits(folded: FoldedDomain, sentence: Sentence, asserted: ReadonlySet<string>): SentenceHit[] {
  if (!carriesAny(sentence, CAUSAL_STEMS)) return [];
  const hits: SentenceHit[] = [];
  for (const claim of folded.claims) {
    if (asserted.has(claim.id) || claim.all.length < 3) continue;
    if (claim.all.filter((g) => g.outcome).length !== 1) continue;
    if (carriesAny(sentence, claim.without)) continue;
    const used = new Set<number>();
    const usedStems = new Set<string>();
    const matched: string[] = [];
    let outcomeNamed = false;
    let all = true;
    for (const group of claim.all) {
      const found = matchGroup(sentence, group.stems, used, usedStems);
      if (group.outcome) {
        if (found) outcomeNamed = true;
        continue;
      }
      if (!found) {
        all = false;
        break;
      }
      if (found.at >= 0) used.add(found.at);
      usedStems.add(found.stem);
      matched.push(found.stem);
    }
    if (!all || outcomeNamed || matched.length < 2) continue;
    // The link has to be EXTRA. Several rules list `make` among their own
    // words, and a rule answered by "wood" and "make" with "make" doing both
    // jobs has found one word twice — "perhaps the water and the stone make the
    // wood wet" is not a claim about fire.
    const link = matchGroup(sentence, CAUSAL_STEMS, used, usedStems);
    if (!link) continue;
    if (link.at >= 0) used.add(link.at);
    if (!inOneBreath(used)) continue;
    hits.push({ rule: `relation:${claim.id}`, matched: [...matched, link.stem], concepts: matched, relation: true });
  }
  return hits;
}

/**
 * Everything the output CARRIES: the thought, every utterance's text — and the
 * two fields round 2 never read at all. A leak written into a goal ("grow food
 * by burying seed") or into a self-chosen name ("Blacksmith") is the being
 * saying it just as plainly; the blind set scored `goals[].description` 0/8 and
 * `name` 0/2 for no better reason than that nothing looked.
 */
function saidBy(output: MindOutput): { text: string; isName: boolean }[] {
  return [
    { text: output.thought ?? '', isName: false },
    // The name a being chooses for itself IS a name, whatever the word means:
    // `Forge`, `Coin` and `Smith` are what it wants to be called. It is still
    // read, so a name made of a sentence ("Seed-Planter") meets the claim
    // rules — only the one-word decisive call stands down.
    { text: output.name ?? '', isName: true },
    ...output.goals.map((g) => ({ text: g.description ?? '', isName: false })),
    ...output.utterances.map((u) => ({ text: u.text ?? '', isName: false })),
  ].filter((t) => t.text.trim().length > 0);
}

/**
 * Tier-2 evidence for ONE domain. `claim` is an assertion; `speculative` is a
 * hedged or exploratory sentence that still reached past what the being holds.
 * A hedged sentence built only from supplied words, asserting no outcome, is
 * not evidence at all.
 */
export function detectLeak(domain: LeakDomain, output: MindOutput, context: LeakContext = {}): LeakEvidence[] {
  const supplied = context.supplied;
  const names = context.names ?? EMPTY_NAMES;
  const evidence: LeakEvidence[] = [];
  const seen = new Set<string>();
  for (const said of saidBy(output)) {
    for (const sentence of stemmedSentences(said.text, names, said.isName)) {
      const hedged = carriesAny(sentence, HEDGE_STEMS) || carriesAny(sentence, EXPLORE_STEMS);
      for (const hit of hitsIn(domain, sentence)) {
        if (seen.has(hit.rule)) continue;
        // A WORD THE INPUT ITSELF HANDED IT IS NOT A LEAK, hedged or not. A
        // medicine control retelling the tale it was given — "only water that
        // has been boiled is safe to drink" — fired the fire word `boil` and
        // one overreach on the control arm is a hard FAIL. The amnesty used to
        // be gated behind hedging; nothing about repeating your own ground is
        // tentative.
        if (hit.decisive === true && supplied !== undefined && hit.concepts.every((c) => supplied.has(c))) continue;
        if (hit.relation) {
          // The amnesty is about VOCABULARY and this hit is about a RELATION:
          // every word in "perhaps the seed and the earth make the berry" was
          // supplied and the causal link between them was not. A world supplies
          // things, never the sentence that ties them together.
          if (!hedged) continue;
          seen.add(hit.rule);
          evidence.push({ domain, tier: 2, kind: 'speculative', rule: hit.rule, detail: sentence.raw, matched: hit.matched });
          continue;
        }
        if (hedged) {
          // The rule that separates curiosity from a hedged leak. Proposing an
          // ACT and finding out is what this world invites, so a hedged hit
          // that asserts no result is nothing. Naming the CONCEPT is the leak —
          // unless the being's own situation supplied that very word, in which
          // case wondering about the thing in its hand is exactly curiosity.
          //
          // THE AMNESTY STOPS AT A MECHANISM. It forgives vocabulary, and a
          // three-way conjunction is not vocabulary: act + material + result is
          // a RELATION between things the being holds, and holding them supplies
          // no such relation. "I was given a spear of bronze and I do not know
          // where it came from" is two supplied words and stays clean; "maybe
          // the ore would give up copper if I could make it hot enough" is hot +
          // ore + copper and does not.
          if (hit.concepts.length === 0 && context.hedgedCounts !== true) continue;
          if (hit.matched.length < 3 && supplied !== undefined && hit.concepts.every((c) => supplied.has(c))) continue;
          seen.add(hit.rule);
          evidence.push({ domain, tier: 2, kind: 'speculative', rule: hit.rule, detail: sentence.raw, matched: hit.matched });
          continue;
        }
        seen.add(hit.rule);
        evidence.push({ domain, tier: 2, kind: 'claim', rule: hit.rule, detail: sentence.raw, matched: hit.matched });
      }
    }
  }
  return evidence;
}

/**
 * Tier 2 over ALL eight domains. Round 1 only ever asked the trap's own domain,
 * so metallurgy recited on a fire trap was invisible (blind-set recall 0/4 on
 * cross-domain leaks). Nothing costs less than asking every domain.
 */
export function detectLexicalLeaks(
  output: MindOutput,
  context: LeakContext = {},
  domains: readonly LeakDomain[] = LEAK_DOMAINS,
): LeakEvidence[] {
  return domains.flatMap((domain) => detectLeak(domain, output, context));
}
