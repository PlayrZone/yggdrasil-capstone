import type { WorldAdapter } from '../../contract/adapter.js';
import { defineForagerWorld } from './define.js';
import { FORAGER_ACTIONS } from './actions.js';
import { FORAGER_KINDS } from './kinds.js';
import { foragerReflexPolicy } from './reflexPolicy.js';
import { foragerSpace } from './space.js';
import { NEED_CRITICAL, NEED_PRESSING } from './types.js';
import { seasonAt } from '../../body/index.js';

/**
 * THE FORAGER CONTINENT, DECLARED. Adapter #1 (W1-B1): the tables the mind used
 * to own, moved here verbatim. Every entry says where it came from, because the
 * only thing this file is allowed to be is a faithful transcription — the
 * goldens are bit-identical across the move, and a number that "looks wrong"
 * here is a finding to report, not to fix.
 *
 * Known oddities transcribed as they stand (audit 01 §2, deliberately NOT
 * corrected in B1):
 *  - `WitnessedDeath.relationshipDeltas` is unreachable. A `WitnessedDeath`
 *    memory only ever arises in the bystander perspective, whose origin is
 *    `observation`, and participant deltas apply to `experience` only. It is
 *    kept because removing it would be a behaviour change dressed as a move.
 *  - `SawAgent` and `FoundResource` are never emitted by any system, yet carry
 *    salience. Kept for the same reason.
 */
export const foragerAdapter: WorldAdapter = defineForagerWorld({
  id: 'forager-continent',
  version: '1',

  // contract/types.ts IntentKind, with the argument shapes YggdrasilSystem's
  // switch reads. See actions.ts — order is the prompt's vocabulary order.
  actions: FORAGER_ACTIONS,

  // ObjectKind + ResourceNodeKind, tagged from the sets the engine already
  // keeps (NUTRITIOUS_FOODS, CRAFT_RECIPES, BuildKind, the reflex policy's own
  // EDIBLE / DIGGABLE / FOOD_NODES). See kinds.ts.
  kinds: FORAGER_KINDS,

  // consciousness/ReflexMind.ts, moved to reflexPolicy.ts verbatim. Principle 3
  // of the brief: this is not a mind, it is this world's survival instinct.
  reflexPolicy: foragerReflexPolicy,

  // contract/types.ts NEED_PRESSING/NEED_CRITICAL (shared with the body and the
  // prompt, so referenced rather than copied) + ReflexMind's NEED_THRESHOLD.
  // ORDER IS LOAD BEARING: the reflex policy scans drives in this order and a
  // tie goes to the later one.
  // `promptLabel` is the word the needs paragraph has always used where it
  // differs from the id — the paragraph is rendered from this table now rather
  // than typed out in `prompt.ts` (W1-B3 verifier, round 2, backlog 2).
  drives: [
    { id: 'hunger', pressingAt: NEED_PRESSING, criticalAt: NEED_CRITICAL, actsAt: 48 },
    { id: 'rest', pressingAt: NEED_PRESSING, criticalAt: NEED_CRITICAL, actsAt: 70 },
    { id: 'safety', pressingAt: NEED_PRESSING, criticalAt: NEED_CRITICAL, actsAt: 60 },
    {
      id: 'socialConnection',
      pressingAt: NEED_PRESSING,
      criticalAt: NEED_CRITICAL,
      actsAt: 74,
      promptLabel: 'social',
    },
  ],

  // learning/ContextMiner.ts + learning/OutcomeMiner.ts FEATURES, with the
  // `featureActive` projection each of them carried a copy of. ORDER IS LOAD
  // BEARING: it decides the order evidence reports come out in, which decides
  // the ids beliefs are given.
  context: [
    { id: 'nearWater', source: 'nearWater', kind: 'flag' },
    { id: 'night', source: 'night', kind: 'flag' },
    { id: 'inShelter', source: 'inShelter', kind: 'flag' },
    { id: 'highland', source: 'elevationBand', kind: 'band', band: 2 },
  ],

  // body/WorldRegularities.ts TICKS_PER_DAY, body/Climate.ts TICKS_PER_SEASON /
  // TICKS_PER_YEAR, runner/Scenario.ts ADULT_AGE.
  //
  // WRITTEN OUT, not imported, and that is not laziness: `Climate.ts`,
  // `WorldRegularities.ts` and `ResourceNodeSystem.ts` are in an import cycle,
  // so `TICKS_PER_SEASON` and `TICKS_PER_YEAR` initialise to NaN whenever the
  // module graph is entered at `PerceptionSystem` or `WorldRegularities` rather
  // than at `body/index.ts`. A world's clock must not depend on who imported
  // what first. Pinned equal to the body's own values in `test/climate.test.ts`.
  time: {
    ticksPerDay: 2400,
    ticksPerSeason: 9600,
    ticksPerYear: 38400,
    adultAge: 9600, // one season — ~4 days to mature
    seasonAt,
  },

  // runner/Runtime.ts `mindOptions`. The curious think and act more often; the
  // curious+ambitious learn faster and remember more. Children inherit the
  // traits, so cognitive lineages can form.
  cognitionDefaults: {
    // round(180 - curiosity × 1.1) → 70 (curious) … 180 (incurious)
    thinkInterval: { base: 180, scale: -1, weights: [['curiosity', 1.1]] },
    // round(420 - (curiosity × 0.6 + ambition × 0.4) × 2.2)
    consolidateInterval: {
      base: 420,
      scale: -2.2,
      weights: [
        ['curiosity', 0.6],
        ['ambition', 0.4],
      ],
    },
    // round(256 + ((curiosity + ambition) / 2) × 5)
    memoryHotCapacity: {
      base: 256,
      scale: 5,
      weights: [
        ['curiosity', 0.5],
        ['ambition', 0.5],
      ],
    },
    // learning/SuccessionMiner.ts's own defaults — a quarter of this world's
    // day, and eight of this world's units. Both were constants in the mind
    // (W1-B3 verifier, what B4 inherits); the miner now asks the world.
    successionWindowTicks: 600,
    successionRadius: 8,
  },

  // The plane this continent is, and the only way anything may ask about it.
  space: foragerSpace,

  /**
   * `salience` — memory/importance.ts BASE.
   * `outcome` — memory/memoryFromEvent.ts's outcome expression.
   * `relationshipDeltas` / `observerDeltas` — relationships/RelationshipStore.ts
   *   EVENT_DELTAS and OBSERVER_APPLICABLE.
   * `prestige` — runner/EventPipeline.ts's hard-coded Cycle-13 rule.
   * `roles` — memory/memoryFromEvent.ts's perspective switch.
   * `endsLife` — runner/EventPipeline.ts's entomb listener.
   * `narratable` — which events runner/society/Narration.ts can author a story
   *   from (declared here; B5 moves the wording).
   * `causal: false` — learning/SuccessionMiner.ts DEFAULT_EXCLUDE.
   * `social` — learning/SocialMiner.ts's switch over event names (W1-B2):
   *   `GaveItem`→gave, `ReceivedItem`→received, `WasAttacked`→harmed,
   *   `AttackedAgent`→harmedOther, `UtteranceSpoken`→engaged, and nothing
   *   else was a case. `harmedOther` and `engaged` behave alike in the miner
   *   today (a bare interaction) and are still declared apart, because what
   *   they ARE differs and B3's arbitration will care.
   * `demonstrates` — learning/CraftObservationMiner.ts's `type !== 'Crafted'`
   *   guard, with the two memory parts it then read.
   *
   * Listed in the order `SimEventType` declares them, which is also the order
   * BASE listed them; nothing reads the array in order, but a reviewer does.
   */
  events: [
    { id: 'GatherSucceeded', salience: 0.25, outcome: 'success' },
    { id: 'GatherFailed', salience: 0.3, outcome: 'failure' },
    { id: 'AteFood', salience: 0.25 },
    { id: 'DrankWater', salience: 0.15 },
    { id: 'BecameSick', salience: 0.85 },
    { id: 'RecoveredFromSickness', salience: 0.5 },
    // An interaction that moves no scalar — sleeping near someone is still
    // having been near them, and that is what the empty record says.
    { id: 'SleptSafely', salience: 0.15, relationshipDeltas: {} },
    { id: 'SleptExposed', salience: 0.35 },
    { id: 'SufferedExposure', salience: 0.5 },
    { id: 'ReceivedItem', salience: 0.6, relationshipDeltas: { trust: 6, friendship: 5 }, social: 'received' },
    {
      id: 'GaveItem',
      salience: 0.45,
      relationshipDeltas: { friendship: 2 },
      roles: { target: { recordsAs: 'ReceivedItem' } },
      social: 'gave',
    },
    {
      id: 'WasAttacked',
      salience: 0.9,
      relationshipDeltas: { trust: -15, fear: 12, friendship: -10 },
      social: 'harmed',
    },
    {
      id: 'AttackedAgent',
      salience: 0.7,
      relationshipDeltas: { fear: -2 },
      roles: { target: { recordsAs: 'WasAttacked' } },
      social: 'harmedOther',
      narratable: true,
    },
    { id: 'AttackedByPredator', salience: 0.92 },
    { id: 'FoughtPredator', salience: 0.8 },
    { id: 'KilledPredator', salience: 0.88, prestige: { respect: 5 }, narratable: true },
    { id: 'Crafted', salience: 0.78, demonstrates: { output: 'objectKind', inputs: 'craftInputs' } },
    { id: 'ChildBorn', salience: 0.9 },
    {
      id: 'AgentDied',
      salience: 0.95,
      // The memory is ABOUT the one who died. The hand behind it rides
      // separately, and only when a person's blow did it — a starvation, an
      // exposure or a beast names nobody.
      roles: { bystander: { recordsAs: 'WitnessedDeath', causedByFrom: 'killerId' } },
      endsLife: true,
      narratable: true,
    },
    {
      id: 'WitnessedDeath',
      salience: 0.9,
      relationshipDeltas: { fear: 4 }, // unreachable — see the file header
      observerDeltas: { fear: 4 },
    },
    { id: 'SeedDeposited', salience: 0.2 },
    { id: 'PlantSprouted', salience: 0.55 },
    {
      id: 'BuiltStructure',
      salience: 0.5,
      prestige: { respect: 3, whenPayload: { key: 'buildKind', equals: 'shelter' } },
      narratable: true,
    },
    { id: 'DepositedItem', salience: 0.2 },
    { id: 'WithdrewItem', salience: 0.25 },
    {
      id: 'UtteranceSpoken',
      salience: 0.35,
      relationshipDeltas: { friendship: 1 },
      // Spoken to, or overheard: either way you were told it.
      roles: { target: { heard: true }, bystander: { heard: true } },
      social: 'engaged',
      causal: false,
    },
    {
      id: 'IntentRejected',
      salience: 0.3,
      outcome: 'failure',
      roles: { bystander: { ignores: true } }, // other people's failed intents are invisible
      causal: false,
    },
    { id: 'SawAgent', salience: 0.1, causal: false },
    { id: 'FoundResource', salience: 0.3 },
  ],
});
