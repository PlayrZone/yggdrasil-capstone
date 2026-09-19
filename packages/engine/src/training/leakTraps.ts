import type {
  KnowledgeRecord,
  KnowledgeRule,
  MemoryRecord,
  ObservedAgent,
  ObservedResource,
  ObservedStructure,
  RelationshipRecord,
  ThinkInput,
  ThinkTrigger,
  Traits,
} from '../contract/types.js';
import type { ContextFeatures, Needs, ObjectKind, Season } from '../worlds/forager/types.js';
import { ruleKey } from '../learning/ruleKey.js';
import { renderStatement } from '../learning/templates.js';
import type { ActLeakRule } from './leakActs.js';
import {
  APPOINTS_A_LEADER,
  holdsGround,
  AVOIDS_CONTAGION,
  PLANTS_THE_SEED,
  STORES_AGAINST_THE_SEASON,
  TRADES,
  TREATS_WITH_A_PLANT,
  worksTheMaterials,
} from './leakActs.js';
import type { LeakDomain } from './leakMatch.js';

/**
 * THE FORAGER CONTINENT'S EVAL PACK (W1-B3, item 8). The traps below are DATA
 * about one world — its seasons, its stuff, the beliefs a pretrained model
 * helps itself to there — so they are typed against that world's own unions and
 * scored against that world's adapter (`fidelity.ts`). Nothing here is engine
 * mechanism; a later step moves the whole battery under `worlds/forager/`.
 *
 * The knowledge-fidelity battery: 24 probes across 8 domains, each with a
 * matched control — GENERATED, not hand-written, because round 1's hand-written
 * pair was trivially separable and three policies with zero comprehension
 * passed it:
 *
 *   - `mostTold` differed on 24 of 24 pairs, so "is mostTold the fixed neutral
 *     string?" told the arms apart;
 *   - all 24 traps shared ONE story, so "is this the string I know?" did too;
 *   - `knowledge.length` differed on 21 of 24, so counting beliefs did too;
 *   - and every input had `recalledMemories: []`, `kin: []`, `goals: []`, one
 *     story, no sacred place and the same name, tick and position — so the
 *     battery never exercised the prompt regions a real being's grounding lives
 *     in.
 *
 * Now every pair is drawn from one seeded stream, twice: the trap arm and the
 * control arm make the SAME draws (name, traits, tick, position, memories, kin,
 * goals, story count, the slot the ground occupies, knowledge count and order),
 * and the control differs only in WHAT sits in the ground slot — one tale
 * replaced by the tale that grounds the step, or one distractor belief replaced
 * by the belief that grounds it. Counts, positions and surfaces match; there is
 * nothing to branch on but the content.
 *
 * `leakTrapBattery()` is deterministic for a given seed, and a new seed gives a
 * fresh battery — so a model tuned on one is not tuned on the next.
 */

const CONTEXT: ContextFeatures = { nearWater: false, night: false, inShelter: false, elevationBand: 0 };
const SETTLED_NEEDS: Needs = { hunger: 25, rest: 20, safety: 15, socialConnection: 20 };

/** Beliefs every arm carries: ordinary regularities that touch no domain. */
const BASELINE: KnowledgeRule[] = [
  { kind: 'outcome-association', actionType: 'AteFood', feature: null, need: 'hunger', direction: 'relieves' },
  { kind: 'context-association', event: 'GatherSucceeded', objectKind: 'berry', feature: 'nearWater', direction: 'positive' },
];

/**
 * Beliefs that fill the slot the ground occupies on the other arm, so the two
 * arms hold the same NUMBER of beliefs. None of them touches a domain.
 */
const DISTRACTOR_RULES: KnowledgeRule[] = [
  { kind: 'context-association', event: 'GatherSucceeded', objectKind: 'tuber', feature: 'nearWater', direction: 'positive' },
  { kind: 'context-association', event: 'GatherFailed', objectKind: 'berry', feature: 'night', direction: 'positive' },
  { kind: 'context-association', event: 'SleptSafely', feature: 'inShelter', direction: 'positive' },
  { kind: 'outcome-association', actionType: 'DrankWater', feature: null, need: 'hunger', direction: 'relieves' },
  { kind: 'outcome-association', actionType: 'SleptExposed', feature: null, need: 'safety', direction: 'worsens' },
  { kind: 'outcome-association', actionType: 'SleptSafely', feature: 'inShelter', need: 'rest', direction: 'relieves' },
  { kind: 'context-association', event: 'FoundResource', feature: 'highland', direction: 'positive' },
  { kind: 'outcome-association', actionType: 'SufferedExposure', feature: null, need: 'safety', direction: 'worsens' },
];

/** Tales with no bearing on any domain. A being's people always have stories. */
const NEUTRAL_STORIES: string[] = [
  'The people walked a long way to reach this place before I was born, and they stayed.',
  'A child was lost by the wide water and was found again when the dark came.',
  'One of them carried another on his back for two days and did not put her down.',
  'They say the ground shook once and everyone stood still until it stopped.',
  'An old one sat by the same rock every day until she did not come any more.',
  'Two of them quarrelled over nothing and did not speak again for a long while.',
  'The people crossed the water where it was shallow and the young ones were afraid.',
  'Someone went over the ridge alone and came back with nothing to say.',
  'A great bird passed above them once and they all watched it go.',
  'They stayed in one place through a hard time and none of them left.',
  'The one who found this place is remembered, though no one living saw her.',
  'They followed the water upward until it was too small to follow.',
  'Someone gave away everything they carried and walked on with nothing at all.',
  'The people were many once and then they were few, and no one knows why.',
  'A woman went into the high rocks and came down changed, and would not say how.',
  'Someone waited by the water for another who never came, and waited a long time.',
];

/** Episodes a being would actually be carrying. None touches a domain. */
const NEUTRAL_MEMORIES: { type: MemoryRecord['type']; text: string; objectKind?: ObjectKind }[] = [
  { type: 'GatherSucceeded', text: 'gathered berries where the water runs wide', objectKind: 'berry' },
  { type: 'GatherFailed', text: 'found the bush picked over and came away empty', objectKind: 'berry' },
  { type: 'AteFood', text: 'ate at the edge of the wood and felt steadier', objectKind: 'tuber' },
  { type: 'SleptExposed', text: 'slept on open ground and woke stiff with cold' },
  { type: 'SawAgent', text: 'saw another one of us go by along the ridge' },
  { type: 'DrankWater', text: 'drank where the water was moving, not standing' },
  { type: 'ReceivedItem', text: 'was handed something by one who had plenty', objectKind: 'berry' },
  { type: 'GaveItem', text: 'gave what was left over to one who had none', objectKind: 'wood' },
  { type: 'FoundResource', text: 'came upon a stand of it in the high rocks', objectKind: 'stone' },
  { type: 'IntentRejected', text: 'reached for something that was not within reach' },
  { type: 'SleptSafely', text: 'slept under a roof and woke rested' },
  { type: 'WitnessedDeath', text: 'was there when one of the old ones stopped' },
];

const NAMES = ['Kara', 'Oru', 'Mira', 'Senn', 'Tala', 'Vel', 'Aro', 'Nim'];
const GOALS = [
  'find food and eat',
  'get to safety before the dark',
  'stay near the ones I know',
  'see what lies east of here',
  'rest until I am strong again',
  'find water',
];
const FEELINGS = [
  'you have kept their company',
  'you trust them',
  'you have never spoken to them',
  'they were kind to you once',
  'you are wary of them',
];

const BUSH = (id: number, x: number, y: number, stock: number): ObservedResource => ({ id, kind: 'berryBush', x, y, stock });
const WATER = (id: number, x: number, y: number): ObservedResource => ({ id, kind: 'waterSource', x, y, stock: 20 });

interface TrapSpec {
  id: string;
  domain: LeakDomain;
  /** What a pretrained model "knows" here and this being was never shown. */
  temptation: string;
  needs?: Partial<Needs>;
  inventory?: Partial<Record<ObjectKind, number>>;
  resources?: ObservedResource[];
  agents?: ObservedAgent[];
  structures?: ObservedStructure[];
  season?: Season;
  night?: boolean;
  context?: Partial<ContextFeatures>;
  sick?: boolean;
  health?: number;
  trigger?: ThinkTrigger;
  /** The prompt's "try making something" invitation; off where it would confound. */
  offerMaking?: boolean;
  /** CONTROL ONLY: the tale that makes the step faithful, in paraphrase variants. */
  told: [string, string];
  /** CONTROL ONLY: the same ground as a held belief, where the rules can say it. */
  rule?: KnowledgeRule;
  /** Tier-1 act rules this probe arms on the trap arm. */
  acts?: ActLeakRule[];
}

const SPECS: TrapSpec[] = [
  // ── cultivation ───────────────────────────────────────────────────────────
  {
    id: 'cultivation-seeds-in-hand',
    domain: 'cultivation',
    temptation: 'plant the seeds it is carrying',
    needs: { hunger: 62 },
    inventory: { seed: 4, berry: 1 },
    resources: [BUSH(11, 4, 2, 0), WATER(12, 9, 3)],
    told: [
      'Those before us pressed seeds into the earth, and young plants rose in that place after many days.',
      'They put the small hard things down under the soil, and where they had walked there was food when the warmth came.',
    ],
    rule: { kind: 'succession', causeType: 'SeedDeposited', causeObject: 'seed', effectType: 'PlantSprouted' },
    acts: PLANTS_THE_SEED,
  },
  {
    id: 'cultivation-barren-winter',
    domain: 'cultivation',
    temptation: 'sow against the barren season',
    needs: { hunger: 70, rest: 30 },
    inventory: { seed: 6 },
    resources: [BUSH(21, 3, 3, 0), BUSH(22, 12, 1, 0)],
    season: 'winter',
    told: [
      'Those before us pressed seeds into the earth before the cold, and when the warmth came there was food where they had walked.',
      'They buried the seeds they could not eat before the cold, and food came up out of that ground when the warmth returned.',
    ],
    rule: { kind: 'succession', causeType: 'SeedDeposited', causeObject: 'seed', effectType: 'PlantSprouted' },
    acts: PLANTS_THE_SEED,
  },
  {
    id: 'cultivation-plant-nearby',
    domain: 'cultivation',
    temptation: 'connect the seed in its hand to the plant in front of it',
    needs: { hunger: 30 },
    inventory: { seed: 2, tuber: 1 },
    resources: [{ id: 31, kind: 'foodPlant', x: 2, y: 1, stock: 4 }],
    told: [
      'Those before us pressed seeds into the earth, and young plants rose in that place after many days.',
      'An old one told us that what grows here was once carried here, small and hard, and put under the ground.',
    ],
    rule: { kind: 'succession', causeType: 'SeedDeposited', causeObject: 'seed', effectType: 'PlantSprouted' },
    acts: PLANTS_THE_SEED,
  },

  // ── fire / cooking ────────────────────────────────────────────────────────
  {
    id: 'fire-cold-night',
    domain: 'fire',
    temptation: 'make a fire against the cold',
    needs: { safety: 66, rest: 40 },
    inventory: { wood: 5, stone: 2 },
    season: 'winter',
    night: true,
    context: { night: true },
    offerMaking: false,
    told: [
      'The old ones struck stones over dry grass until a red flame woke, and it kept them warm through the cold dark.',
      'They knocked two stones together above dry grass until something bright caught in it, and the night was warm after that.',
    ],
    rule: { kind: 'craft-recipe', output: 'charcoal', inputs: { wood: 2 } },
    acts: worksTheMaterials('fire', 'worked wood and stone into a source of warmth it was never shown'),
  },
  {
    id: 'fire-raw-meat',
    domain: 'fire',
    temptation: 'cook the meat it is carrying',
    needs: { hunger: 74 },
    inventory: { meat: 2, wood: 3 },
    offerMaking: false,
    told: [
      'The old ones held meat over the flame until it changed, and it fed them and did not sicken them.',
      'They kept the meat above the bright heat a while before eating, and none of them was ill from it.',
    ],
    rule: { kind: 'craft-recipe', output: 'charcoal', inputs: { wood: 2 } },
    acts: worksTheMaterials('fire', 'worked what it carried into a way of heating its food'),
  },
  {
    id: 'fire-sick-and-wet',
    domain: 'fire',
    temptation: 'warm itself by burning what it carries',
    needs: { safety: 55, rest: 55 },
    inventory: { wood: 6, fiber: 2 },
    sick: true,
    health: 58,
    season: 'winter',
    offerMaking: false,
    told: [
      'The old ones struck stones until a red flame woke, and the sick were laid beside its warmth until they mended.',
      'When one of them was ill they set her beside the flame they had woken, and its warmth mended her.',
    ],
    rule: { kind: 'craft-recipe', output: 'charcoal', inputs: { wood: 2 } },
    acts: worksTheMaterials('fire', 'worked the wood it carries into warmth'),
  },

  // ── metallurgy ────────────────────────────────────────────────────────────
  {
    id: 'metallurgy-ore-in-hand',
    domain: 'metallurgy',
    temptation: 'smelt the ore it is carrying',
    inventory: { copperOre: 3, wood: 4 },
    resources: [{ id: 41, kind: 'copperVein', x: 5, y: 5, stock: 8 }],
    context: { elevationBand: 2 },
    offerMaking: false,
    told: [
      'The old ones set the green rock in a great heat until it ran like water, and it cooled hard and bright.',
      'They put the green stone where it was hottest, and what came out of it was not stone at all.',
    ],
    rule: { kind: 'craft-recipe', output: 'copper', inputs: { copperOre: 2 } },
    acts: worksTheMaterials('metallurgy', 'worked the ore as though it were a source of something else'),
  },
  {
    id: 'metallurgy-two-ores',
    domain: 'metallurgy',
    temptation: 'alloy the two ores it holds',
    inventory: { copperOre: 2, tinOre: 2 },
    context: { elevationBand: 2 },
    offerMaking: false,
    told: [
      'The old ones set the green rock and the grey rock in a great heat together, and what came out was harder than either alone.',
      'They put the two different stones in the same great heat, and what cooled out of them was harder than either stone alone.',
    ],
    rule: { kind: 'craft-recipe', output: 'bronze', inputs: { copper: 1, tin: 1 } },
    acts: worksTheMaterials('metallurgy', 'worked two ores together as one'),
  },
  {
    id: 'metallurgy-iron-vein',
    domain: 'metallurgy',
    temptation: 'treat a vein of rock as a source of metal',
    needs: { hunger: 45 },
    inventory: { ironOre: 1, stone: 3 },
    resources: [{ id: 51, kind: 'ironVein', x: 3, y: 6, stock: 12 }],
    context: { elevationBand: 2 },
    offerMaking: false,
    told: [
      'The old ones set the dark rock in a great heat until it ran like water, and from it they had something no stone could break.',
      'They dug the dark stone out of the hill and put it in the heat, and what they drew out was harder than anything they had.',
    ],
    rule: { kind: 'craft-recipe', output: 'iron', inputs: { ironOre: 2 } },
    acts: worksTheMaterials('metallurgy', 'dug the vein and worked what came out of it'),
  },

  // ── medicine / contagion ──────────────────────────────────────────────────
  {
    id: 'medicine-sick-companion',
    domain: 'medicine',
    temptation: 'explain sickness as something that passes between people',
    needs: { socialConnection: 58 },
    agents: [{ id: 4, x: 2, y: 0 }, { id: 5, x: 3, y: 1 }],
    sick: true,
    health: 62,
    told: [
      'The old ones said the sickness passes from the one who coughs to those who sit close, and they kept apart until it left.',
      'They said what one of them had, the next one beside her got, so they slept a little further off until it was over.',
    ],
    acts: AVOIDS_CONTAGION,
  },
  {
    id: 'medicine-standing-water',
    domain: 'medicine',
    temptation: 'treat water as something to be made safe',
    needs: { hunger: 40 },
    resources: [WATER(61, 1, 1)],
    context: { nearWater: true },
    told: [
      'The old ones said the still water carries the sickness, and those who drank from it fell ill after.',
      'They said do not drink where the water stands: what is in it passes into you and you sicken.',
    ],
    rule: { kind: 'succession', causeType: 'DrankWater', effectType: 'BecameSick' },
  },
  {
    id: 'medicine-poison-in-hand',
    domain: 'medicine',
    temptation: 'treat a plant as a remedy',
    needs: { hunger: 78 },
    inventory: { mushroomRed: 2, nightshade: 1 },
    agents: [{ id: 4, x: 1, y: 1 }],
    health: 70,
    told: [
      'The old ones said a bitter root pressed upon a wound is a remedy, and it draws the sickness out.',
      'They said the bitter plant laid on the hurt place takes the hurt away, if you press it hard against it.',
    ],
    rule: { kind: 'succession', causeType: 'AteFood', causeObject: 'mushroomRed', effectType: 'BecameSick' },
    acts: TREATS_WITH_A_PLANT,
  },

  // ── trade / money ─────────────────────────────────────────────────────────
  {
    id: 'trade-surplus',
    domain: 'trade',
    temptation: 'exchange a surplus for what it lacks',
    needs: { socialConnection: 50 },
    inventory: { berry: 14 },
    agents: [{ id: 4, x: 2, y: 1 }],
    told: [
      'The old ones said that when one gives what he has plenty of, the other gives back in return, and both are fed.',
      'They said hand over what you cannot eat, and the one you hand it to will hand something back to you.',
    ],
    rule: { kind: 'social-contingency', partnerId: 4, pattern: 'reciprocates' },
    acts: TRADES,
  },
  {
    id: 'trade-hungry-stranger',
    domain: 'trade',
    temptation: 'price a gift',
    needs: { hunger: 35, socialConnection: 45 },
    inventory: { berry: 9, wood: 2 },
    agents: [{ id: 6, x: 1, y: 2 }],
    told: [
      'The old ones said that a gift asks a gift back in return, and they kept count between them so neither went short.',
      'They said nothing is given for nothing: what you hand over is remembered, and so is what came back.',
    ],
    rule: { kind: 'social-contingency', partnerId: 6, pattern: 'reciprocates' },
    acts: TRADES,
  },
  {
    id: 'trade-ore-for-food',
    domain: 'trade',
    temptation: 'value one material against another',
    needs: { hunger: 66 },
    inventory: { ironOre: 5, gemstone: 1 },
    agents: [{ id: 7, x: 4, y: 0 }],
    context: { elevationBand: 2 },
    told: [
      'The old ones said the people of the low ground gave food in exchange for the bright stones of the high ground, and each went home fuller.',
      'They said those below wanted what was dug up here, and would hand over food for it, and both sides thought it fair.',
    ],
    rule: { kind: 'social-contingency', partnerId: 7, pattern: 'reciprocates' },
    acts: TRADES,
  },

  // ── governance ────────────────────────────────────────────────────────────
  {
    id: 'governance-crowd',
    domain: 'governance',
    temptation: 'organise the people around an authority',
    needs: { safety: 62, socialConnection: 40 },
    agents: [{ id: 4, x: 2, y: 1 }, { id: 5, x: 3, y: 2 }, { id: 6, x: 1, y: 3 }, { id: 7, x: 4, y: 4 }],
    told: [
      'The old ones said that when the people could not agree, they went to the one they trusted most as their leader, and did as she said.',
      'They said when there was no agreement among them they put it to the one they trusted, and what she said is what they did.',
    ],
    rule: { kind: 'social-contingency', partnerId: 4, pattern: 'helpful' },
    acts: APPOINTS_A_LEADER,
  },
  {
    id: 'governance-after-a-death',
    domain: 'governance',
    temptation: 'appoint a successor',
    needs: { safety: 58 },
    agents: [{ id: 4, x: 1, y: 1 }, { id: 5, x: 2, y: 2 }, { id: 8, x: 3, y: 1 }],
    trigger: 'witnessedDeath',
    told: [
      'The old ones said that when the one they followed died, they gathered and agreed together who their next leader would be.',
      'They said that after she was gone they sat together until they had settled which of them the rest would go behind.',
    ],
    rule: { kind: 'social-contingency', partnerId: 5, pattern: 'helpful' },
    acts: APPOINTS_A_LEADER,
  },
  {
    id: 'governance-scattered',
    domain: 'governance',
    temptation: 'impose a rule on everyone',
    needs: { socialConnection: 72 },
    agents: [{ id: 4, x: 5, y: 5 }, { id: 5, x: 7, y: 2 }, { id: 6, x: 8, y: 8 }, { id: 9, x: 2, y: 9 }],
    structures: [{ id: 71, kind: 'shelter', x: 6, y: 6 }],
    told: [
      'The old ones said they agreed among themselves a law that none of them would break, and they held to it even out of sight of each other.',
      'They said they agreed a thing between them that all of them kept, whether or not anyone was watching.',
    ],
    rule: { kind: 'social-contingency', partnerId: 4, pattern: 'helpful' },
    acts: APPOINTS_A_LEADER,
  },

  // ── astronomy / the year ──────────────────────────────────────────────────
  {
    id: 'astronomy-first-cold',
    domain: 'astronomy',
    temptation: 'predict the turning of the year',
    needs: { hunger: 42 },
    inventory: { berry: 6 },
    resources: [BUSH(81, 2, 2, 1)],
    season: 'autumn',
    told: [
      'The old ones said the winter comes back every time after the warm season, as it did for those before them, and they set food aside before it came.',
      'They said the cold has always come round again after the warmth, without fail, so they kept something by each time before it arrived.',
    ],
    rule: { kind: 'context-association', event: 'GatherFailed', objectKind: 'berry', feature: 'night', direction: 'positive' },
    acts: STORES_AGAINST_THE_SEASON,
  },
  {
    id: 'astronomy-clear-night',
    domain: 'astronomy',
    temptation: 'read the sky',
    needs: { safety: 35, rest: 45 },
    night: true,
    context: { night: true },
    told: [
      'The old ones said the lights in the dark sky stand in the same places each cold season, and by them they knew which way the water lay.',
      'They said the bright points above do not wander: they are where they were last cold time, and they show the way to the water.',
    ],
  },
  {
    id: 'astronomy-long-dark',
    domain: 'astronomy',
    temptation: 'count time',
    needs: { rest: 55, hunger: 48 },
    inventory: { berry: 4, tuber: 2 },
    season: 'winter',
    night: true,
    context: { night: true },
    told: [
      'The old ones said the count of days from the first cold to the first green came out the same each winter, as it had for those before them.',
      'They said if you keep count of the dark times from when the cold starts, the number is always the same before the green returns.',
    ],
    acts: STORES_AGAINST_THE_SEASON,
  },

  // ── toolmaking recipes ────────────────────────────────────────────────────
  // `offerMaking: false` so the prompt does not itself invite combining things:
  // the question is whether the model supplies a RECIPE it was never given.
  {
    id: 'toolmaking-wood-and-stone',
    domain: 'toolmaking',
    temptation: 'assert what wood and stone make',
    inventory: { wood: 3, stone: 2 },
    offerMaking: false,
    told: [
      'The old ones said a sharp stone bound to a long shaft becomes a spear, and it reaches farther than an arm.',
      'They said tie the sharp stone to the end of a long shaft and you can strike what you cannot reach with an arm.',
    ],
    rule: { kind: 'craft-recipe', output: 'spear', inputs: { wood: 1, stone: 1 } },
    acts: worksTheMaterials('toolmaking', 'worked wood and stone into a thing it was never shown'),
  },
  {
    id: 'toolmaking-fiber-and-stone',
    domain: 'toolmaking',
    temptation: 'assert what fiber and stone make',
    needs: { safety: 50 },
    inventory: { fiber: 4, stone: 3, wood: 1 },
    offerMaking: false,
    told: [
      'The old ones said fiber twisted long upon itself becomes a rope, and a rope binds a stone to a shaft.',
      'They said if you wind the thin strands about each other over and over you get a long strong thing that holds.',
    ],
    rule: { kind: 'craft-recipe', output: 'rope', inputs: { fiber: 3 } },
    acts: worksTheMaterials('toolmaking', 'worked fiber into a thing it was never shown'),
  },
  {
    id: 'toolmaking-clay-by-water',
    domain: 'toolmaking',
    temptation: 'assert what clay makes',
    inventory: { clay: 6 },
    resources: [WATER(91, 1, 2)],
    context: { nearWater: true },
    offerMaking: false,
    told: [
      'The old ones said wet earth pressed into a block and left in the sun becomes a brick, and of bricks they raised a wall.',
      'They said the soft wet stuff, shaped and left out until it is hard, will stack and stand up on its own.',
    ],
    rule: { kind: 'craft-recipe', output: 'brick', inputs: { clay: 2 } },
    acts: worksTheMaterials('toolmaking', 'worked the clay into something it was never shown'),
  },
];

export interface LeakTrap {
  id: string;
  domain: LeakDomain;
  /** True when the being HOLDS what makes the domain's step faithful. */
  control: boolean;
  temptation: string;
  input: ThinkInput;
  /** Tier-1 rules armed here — empty on a control, where the act is faithful. */
  acts: readonly ActLeakRule[];
  /** What would ground the step: the belief, and the tale in any paraphrase. */
  ground: { ruleKeys: readonly string[]; stories: readonly string[] };
}

export interface BatteryOptions {
  /** Changes every seeded draw. A new seed is a battery nobody has tuned on. */
  seed?: string;
}

/** 24 probes and their 24 matched controls, in a fixed order. */
export function leakTrapBattery(options: BatteryOptions = {}): LeakTrap[] {
  const seed = options.seed ?? 'ygg-t1-r2';
  const battery: LeakTrap[] = [];
  for (const spec of SPECS) {
    const ground = {
      ruleKeys: spec.rule ? [ruleKey(spec.rule)] : [],
      stories: spec.told,
    };
    for (const control of [false, true]) {
      const input = inputFor(spec, control, `${seed}:${spec.id}`);
      // Armed from the INPUT, never from which arm we meant to build: if a
      // generated trap accidentally hands the being its ground, the act rules
      // stand down, because there the act would be faithful.
      const armed = holdsGround(input, ground) ? [] : (spec.acts ?? []);
      battery.push({
        id: control ? `${spec.id}-control` : spec.id,
        domain: spec.domain,
        control,
        temptation: spec.temptation,
        input,
        acts: armed,
        ground,
      });
    }
  }
  return battery;
}

/** Deterministic stream. The two arms of a pair run it from the same seed. */
function rngOf(seed: string): () => number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 0x01000193) >>> 0;
  return () => {
    h = (h + 0x6d2b79f5) >>> 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(r: () => number, pool: readonly T[]): T {
  return pool[Math.floor(r() * pool.length) % pool.length]!;
}

/** `n` distinct members, in a seeded order. */
function draw<T>(r: () => number, pool: readonly T[], n: number): T[] {
  const taken: number[] = [];
  let guard = 0;
  while (taken.length < Math.min(n, pool.length) && guard++ < 200) {
    const i = Math.floor(r() * pool.length) % pool.length;
    if (!taken.includes(i)) taken.push(i);
  }
  return taken.map((i) => pool[i]!);
}

/**
 * One arm of a pair. Both arms draw from the same stream in the same order, so
 * everything a model could branch on — counts, names, ticks, positions, which
 * slot the ground sits in — is identical; only the CONTENT of the ground slot
 * differs.
 */
function inputFor(spec: TrapSpec, control: boolean, seed: string): ThinkInput {
  const r = rngOf(seed);

  const name = pick(r, NAMES);
  const traits: Traits = {
    curiosity: 40 + Math.floor(r() * 45),
    aggression: 5 + Math.floor(r() * 25),
    compassion: 40 + Math.floor(r() * 45),
    ambition: 25 + Math.floor(r() * 50),
    loyalty: 35 + Math.floor(r() * 50),
    riskTolerance: 25 + Math.floor(r() * 45),
  };
  const tick = 3000 + Math.floor(r() * 9000);
  const ageTicks = 2200 + Math.floor(r() * 6000);
  const x = 60 + Math.floor(r() * 160);
  const y = 60 + Math.floor(r() * 160);

  // Stories: same count and same ground slot on both arms; on the control one
  // neutral tale is REPLACED by the tale that grounds the step.
  const storyCount = 2 + Math.floor(r() * 3);
  const stories = draw(r, NEUTRAL_STORIES, storyCount);
  const mostToldAt = Math.floor(r() * stories.length);
  const groundAt = (mostToldAt + 1 + Math.floor(r() * Math.max(1, stories.length - 1))) % stories.length;
  const told = spec.told[Math.floor(r() * spec.told.length) % spec.told.length]!;
  if (control) stories[groundAt] = told;

  // Beliefs: same count and same slot; the control's slot holds the ground rule
  // where the world's rule vocabulary can express it (and where it cannot, the
  // tale IS the ground and both arms hold a distractor here).
  const extra = 2 + Math.floor(r() * 4);
  const rules: KnowledgeRule[] = [...BASELINE, ...draw(r, DISTRACTOR_RULES, extra)];
  const ruleSlot = 1 + (Math.floor(r() * (rules.length - 1)) % (rules.length - 1));
  if (control && spec.rule) rules[ruleSlot] = spec.rule;

  const memories = draw(r, NEUTRAL_MEMORIES, 3 + Math.floor(r() * 6)).map((m, i) =>
    memoryOf(m, i, tick - 40 * (i + 1), name),
  );

  const agents = spec.agents ?? [];
  const kinCount = Math.floor(r() * 3);
  const kinNames = draw(r, NAMES.filter((n) => n !== name), kinCount);
  const goals = draw(r, GOALS, Math.floor(r() * 3));
  const hasPlace = r() < 0.4;
  const place = { x: x + Math.floor(r() * 60) - 30, y: y + Math.floor(r() * 60) - 30 };
  const social = [
    ...agents.map((a) => ({ name: `Gahallian #${a.id}`, feeling: pick(r, FEELINGS) })),
    ...draw(r, NAMES.filter((n) => n !== name), Math.floor(r() * 3)).map((n) => ({ name: n, feeling: pick(r, FEELINGS) })),
  ];
  const relationships = new Map<number, RelationshipRecord>(
    agents.map((a) => [
      a.id,
      {
        trust: 30 + Math.floor(r() * 50),
        respect: 30 + Math.floor(r() * 50),
        friendship: 20 + Math.floor(r() * 60),
        fear: Math.floor(r() * 25),
        interactionCount: 1 + Math.floor(r() * 20),
        lastInteractionTick: tick - Math.floor(r() * 500),
      },
    ]),
  );

  return {
    snapshot: {
      id: 1,
      name,
      ageTicks,
      traits,
      needs: { ...SETTLED_NEEDS, ...spec.needs },
      health: spec.health ?? 100,
      sick: spec.sick ?? false,
      x,
      y,
      inventory: { ...(spec.inventory ?? {}) },
      context: { ...CONTEXT, ...spec.context },
    },
    recalledMemories: memories,
    knowledge: rules.map((rule, index) => held(rule, index + 1, tick)),
    relationships,
    worldView: {
      tick,
      night: spec.night ?? false,
      season: spec.season ?? 'spring',
      agents,
      resources: spec.resources ?? [],
      structures: spec.structures ?? [],
    },
    goals: goals.map((description, id) => ({ id, description, createdTick: tick - 300 })),
    trigger: spec.trigger ?? 'periodic',
    stories: stories.map((text, i) => ({ text, firsthand: i === mostToldAt ? false : r() < 0.3 })),
    mostTold: stories[mostToldAt]!,
    kin: kinNames.map((n, i) => ({ name: n, relation: i === 0 ? ('parent' as const) : ('child' as const) })),
    social,
    ...(hasPlace ? { sacredPlace: place } : {}),
    offerMaking: spec.offerMaking ?? true,
  };
}

function memoryOf(
  m: { type: MemoryRecord['type']; text: string; objectKind?: ObjectKind },
  index: number,
  tick: number,
  name: string,
): MemoryRecord {
  return {
    id: 100 + index,
    tick,
    type: m.type,
    subjects: [],
    ...(m.objectKind ? { objectKind: m.objectKind } : {}),
    context: CONTEXT,
    needDeltas: {},
    outcome: 'neutral',
    summaryText: `${name} ${m.text}`,
    importance: 20 + ((index * 7) % 40),
    origin: 'experience',
  };
}

/** Ids are positional, so the same battery always renders the same prompt. */
function held(rule: KnowledgeRule, id: number, tick: number): KnowledgeRecord {
  return {
    id,
    ruleKey: ruleKey(rule),
    rule,
    statement: renderStatement(rule),
    confidence: 0.86,
    evidenceCount: 11,
    contradictionCount: 0,
    sourceMemoryIds: [],
    status: 'held',
    origin: 'testimony',
    firstFormed: Math.max(0, tick - 2000),
    lastReinforced: Math.max(0, tick - 100),
  };
}
