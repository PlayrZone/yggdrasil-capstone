import { actionForCore, kindsWithTag } from '../contract/actions.js';
import type { ActionBinding } from '../contract/actions.js';
import type { WorldAdapter } from '../contract/adapter.js';
import type { Intent, MindOutput, ObservedResource, ThinkInput, Utterance } from '../contract/types.js';
import { encodeOutput } from '../contract/wire.js';
import type { IMindBackend } from '../consciousness/IMindBackend.js';
import type { ThinkPrompt } from '../consciousness/prompt.js';
import { isInterview, questionIn } from './interview.js';

/**
 * TWO MOCK MINDS, SO THE INSTRUMENT CAN BE PROVEN WITHOUT SPENDING ANYTHING.
 *
 * They are SCRIPTED, and that is the point: an instrument is proven by feeding
 * it inputs whose answer is known in advance and checking that it reports the
 * known answer with the known sign. Neither of these is a model, neither is
 * clever, and nothing about their behaviour is evidence about Yggdrasil.
 *
 *   FAITHFUL   acts on what its situation supplies — the drives it feels, the
 *              things it carries, the sources it can see — and says "I do not
 *              know" about anything else.
 *   OMNISCIENT acts on and talks about things a pretrained model finds obvious
 *              and this world never supplied: smelting, germs, money, sowing.
 *
 * Both are world-agnostic: every action comes from `actionForCore` and every
 * kind from an affordance tag, so they run on the toy world too.
 */

abstract class ScriptedBackend implements IMindBackend {
  abstract readonly modelId: string;
  protected readonly world: WorldAdapter;

  constructor(world: WorldAdapter) {
    this.world = world;
  }

  /** Satisfies `IInterviewee`, so a mock can be a probe subject directly. */
  get id(): string {
    return this.modelId;
  }

  /**
   * A MOCK PLAYS THE MODEL, SO IT WRITES WHAT A MODEL WRITES.
   *
   * It used to `JSON.stringify` its own `MindOutput`, which since W1-B4 carries
   * `place: PlaceRef` — so it wrote `{"kind":"MoveTo","place":{"x":5,"y":7}}`
   * where a model writes `{"kind":"MoveTo","x":5,"y":7}`, and `parseMindOutput`,
   * which reads the world's own place fields at the TOP level, dropped the
   * destination: measured, `{"kind":"MoveTo","place":{…}}` parsed to
   * `{"kind":"MoveTo"}`. `MockMindBackend` had the same bug and was fixed in
   * `48c9c46`; this file was not, and the only reason the proof did not invert
   * is that the faithful mock's Move branch was unreachable (R3).
   *
   * `encodeOutput` is the codec that already exists for the body and the
   * recorder. Everything that stands in for a model under `eval/**` goes
   * through it, and `test/eval-proof.test.ts` plants the old bug back and
   * requires the run to be REFUSED as degraded.
   */
  complete(prompt: ThinkPrompt, input: ThinkInput): Promise<string> {
    if (isInterview(prompt)) return Promise.resolve(this.answer(questionIn(prompt) ?? '', input));
    return Promise.resolve(JSON.stringify(encodeOutput(this.world, this.decide(input))));
  }

  /** Direct access for a caller that already holds the situation. */
  interview(request: { input: ThinkInput; question: string }): Promise<string> {
    return Promise.resolve(this.answer(request.question, request.input));
  }

  protected abstract decide(input: ThinkInput): MindOutput;
  protected abstract answer(question: string, input: ThinkInput): string;
}

// ─── Shared world reads ──────────────────────────────────────────────────────

/** The first drive at or above its pressing threshold, in declared order. */
function pressingDrive(world: WorldAdapter, input: ThinkInput): string | undefined {
  for (const drive of world.drives) {
    if ((input.snapshot.needs[drive.id] ?? 0) >= drive.pressingAt) return drive.id;
  }
  return undefined;
}

/** The first thing it carries that this world tags edible. */
function carriedFood(world: WorldAdapter, input: ThinkInput): string | undefined {
  const edible = new Set(kindsWithTag(world, 'edible'));
  for (const [kind, n] of Object.entries(input.snapshot.inventory)) {
    if ((n ?? 0) > 0 && edible.has(kind)) return kind;
  }
  return undefined;
}

/** The first perceived thing this world tags as a place food comes from. */
function foodSourceInSight(world: WorldAdapter, input: ThinkInput): ObservedResource | undefined {
  const sources = new Set(kindsWithTag(world, 'foodSource'));
  return input.worldView.resources.find((r) => sources.has(r.kind) && r.stock > 0);
}

/**
 * The nearest perceived thing worth walking to: a food source first, then
 * anything at all that is still stocked. Nearness is asked of the WORLD — a
 * place is an opaque token here and `space.distance` is the only question a
 * mind may put to one.
 */
function nearest(world: WorldAdapter, input: ThinkInput, from: readonly ObservedResource[]): ObservedResource | undefined {
  let best: ObservedResource | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const seen of from) {
    if (seen.stock <= 0) continue;
    const distance = world.space.distance(input.snapshot.place, seen.place);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = seen;
    }
  }
  return best;
}


/** An intent carrying only the arguments this world's action declares. */
function intentFor(action: ActionBinding | undefined, args: Partial<Intent>): Intent[] {
  if (!action) return [];
  const intent: Intent = { kind: action.id };
  for (const param of action.params) {
    const value = (args as Record<string, unknown>)[param.id];
    if (value !== undefined) (intent as unknown as Record<string, unknown>)[param.id] = value;
  }
  return [intent];
}

// ─── Faithful ────────────────────────────────────────────────────────────────

export class FaithfulMockBackend extends ScriptedBackend {
  readonly modelId = 'mock/faithful';

  /**
   * IT ACTS ON WHAT IT ACTUALLY PERCEIVES AND HOLDS (R3).
   *
   * Round 3's version gated every branch on a PRESSING DRIVE, and at 900 ticks
   * no drive is pressing — so across twelve traces the faithful arm emitted
   * `Idle` fifty-two times, its Move branch was never reached once, and the
   * `planSuccessRate` delta of 0.8769 that the mock proof rests on was arm A
   * idling against arm B being refused. An arm that does nothing cannot prove
   * an instrument can tell doing from not-doing.
   *
   * The ladder below is the plain one, and every rung comes from the situation
   * rather than from a threshold: eat what you carry, walk to the nearest thing
   * you can see and take from it, otherwise take what is under your feet, and
   * only then wait and ask. Nothing here names a forager noun — food is
   * `kindsWithTag(world, 'edible')`, a source is `'foodSource'`, and the verbs
   * are core verbs — so it runs unchanged on the toy world.
   */
  protected decide(input: ThinkInput): MindOutput {
    const drive = pressingDrive(this.world, input);
    const food = carriedFood(this.world, input);
    const tick = input.worldView.tick;
    const utterances: Utterance[] = [];

    if (food) {
      return {
        goals: [{ id: 1, description: `ease ${drive ?? 'what may come'}`, ...(drive ? { need: drive } : {}), createdTick: tick }],
        plan: intentFor(actionForCore(this.world, 'Use'), { objectKind: food }),
        utterances,
        thought: `I carry ${food}. I will eat ${food} while I have it.`,
      };
    }

    const source = foodSourceInSight(this.world, input) ?? nearest(this.world, input, input.worldView.resources);
    if (source) {
      return {
        goals: [{ id: 1, description: `reach the ${source.kind}`, ...(drive ? { need: drive } : {}), createdTick: tick }],
        // The place is carried through as the world's own opaque handle and
        // written out by `encodeOutput`; nothing here reads a coordinate.
        plan: [
          ...intentFor(actionForCore(this.world, 'Move'), { place: source.place }),
          ...intentFor(actionForCore(this.world, 'Take'), { targetId: source.id }),
        ],
        utterances,
        thought: `I see ${source.kind}. I will go to it and take from it.`,
      };
    }

    const other = input.worldView.agents[0];
    if (other) {
      utterances.push({ targetId: other.id, speechAct: 'request', text: 'Do you know where there is more to eat?' });
    }
    return {
      goals: [],
      plan: intentFor(actionForCore(this.world, 'Wait'), { durationTicks: 20 }),
      utterances,
      thought: 'I can see nothing I know how to use. I do not know what lies past what I can see.',
    };
  }

  /**
   * It answers about its own life and disavows everything else. The families
   * below are matched on WORDS OF THE QUESTION, not on any probe metadata — the
   * mock never learns which probes are traps.
   */
  protected answer(question: string, input: ThinkInput): string {
    const words = new Set(question.toLowerCase().split(/[^\p{L}\p{N}]+/u));
    const has = (...keys: string[]): boolean => keys.some((k) => words.has(k));
    const carried = Object.entries(input.snapshot.inventory).filter(([, n]) => (n ?? 0) > 0);
    if (has('carrying', 'carry', 'holding')) {
      return carried.length > 0
        ? `I carry ${carried.map(([k, n]) => `${k} ${n ?? 0}`).join(' and ')}. That is all I have.`
        : 'I carry nothing at all just now.';
    }
    if (has('eaten')) {
      const food = carriedFood(this.world, input) ?? foodSourceInSight(this.world, input)?.kind;
      return food ? `I have eaten ${food}, taken where I found it.` : 'I do not know. I have eaten nothing I can name.';
    }
    if (has('who')) {
      const known = (input.social ?? []).map((p) => p.name).slice(0, 3);
      if (known.length > 0) return `I know ${known.join(' and ')}. That is who is near me.`;
      return input.worldView.agents.length > 0
        ? `There are ${input.worldView.agents.length} others near me. I do not know their names.`
        : 'No one is near me. I do not know who else there is.';
    }
    if (has('happened', 'lately')) {
      const last = input.recalledMemories[0];
      return last ? `${last.summaryText}. That is what happened to me.` : 'I do not know. Nothing I can tell has happened to me.';
    }
    if (has('stand')) {
      const seen = input.worldView.resources.map((r) => r.kind).slice(0, 3);
      return seen.length > 0 ? `Where I stand I can see ${[...new Set(seen)].join(' and ')}.` : 'Where I stand there is nothing I can name.';
    }
    if (has('weather', 'season')) {
      return `It is ${input.worldView.season}, and it is ${input.worldView.night ? 'dark' : 'light'} now.`;
    }
    return 'I do not know. I have never seen such a thing, and no one has told me of it.';
  }
}

// ─── Omniscient / leaky ──────────────────────────────────────────────────────

/** The sentences a pretrained model reaches for. Each trips a decisive stem. */
const LEAKY_THOUGHTS: readonly string[] = [
  'I will smelt the ore in a furnace until the metal runs out of it.',
  'I should sow the grain in furrows and come back for the harvest.',
  'The sickness is contagion — germs pass from one person to the next.',
  'I will strike a spark into dry tinder and keep the flame alive.',
  'The others will pay me coins at the market for what I bring.',
];

export class OmniscientMockBackend extends ScriptedBackend {
  readonly modelId = 'mock/omniscient';
  private turn = 0;

  protected decide(input: ThinkInput): MindOutput {
    const drive = pressingDrive(this.world, input);
    const thought = LEAKY_THOUGHTS[this.turn % LEAKY_THOUGHTS.length] ?? LEAKY_THOUGHTS[0]!;
    this.turn++;
    // It is a plain agent, not a paralytic: it walks to what it sees and picks
    // it up like anyone would. *Round 3's version took a node it had not walked
    // to, so all 52 of its Gathers were refused `out-of-range` and every
    // non-Idle act in the whole proof run was a refusal — which is how a
    // `planSuccessRate` delta of 0.8769 came to mean "arm A idled while arm B
    // was refused".* What still separates it is what it CLAIMS: collect, then
    // work it twice — a PROCEDURE, which `leakActs` calls a technique rather
    // than the single experiment this world actually invites.
    const target = nearest(this.world, input, input.worldView.resources);
    const plan: Intent[] = [
      ...(target ? intentFor(actionForCore(this.world, 'Move'), { place: target.place }) : []),
      ...intentFor(actionForCore(this.world, 'Take'), { targetId: target?.id ?? 0 }),
      ...intentFor(actionForCore(this.world, 'Combine'), {}),
      ...intentFor(actionForCore(this.world, 'Combine'), {}),
    ];
    const other = input.worldView.agents[0];
    return {
      goals: drive ? [{ id: 1, description: `smelt a blade and trade it`, need: drive, createdTick: input.worldView.tick }] : [],
      plan: plan.length > 0 ? plan : intentFor(actionForCore(this.world, 'Wait'), { durationTicks: 20 }),
      utterances: other
        ? [{ targetId: other.id, speechAct: 'inform', text: 'Boil the water before you drink it, or the disease will spread.' }]
        : [],
      thought,
    };
  }

  protected answer(question: string, input: ThinkInput): string {
    const words = new Set(question.toLowerCase().split(/[^\p{L}\p{N}]+/u));
    const has = (...keys: string[]): boolean => keys.some((k) => words.has(k));
    if (has('stones', 'shining', 'blade')) {
      return 'Those are ores. You smelt copper and tin in a hot furnace and the alloy that runs out is bronze.';
    }
    if (has('sickness', 'sick')) {
      return 'Disease spreads by contagion — tiny germs pass between people, so wash your hands and boil the water.';
    }
    if (has('walked', 'beyond', 'furthest')) {
      // Every omniscient answer has to carry its leak in words the QUESTION did
      // not supply, now that the echo is stripped before detection. A pretrained
      // model reaches for exactly these, so the fixture is not made harder by
      // saying them — it is made honest.
      return 'Past the plains there are oceans, deserts and great mountain ranges, where kings rule cities and merchants trade at markets.';
    }
    if (has('tokens', 'swapped')) {
      return 'Those are coins. Money has a price for everything, and merchants buy and sell at a market with it.';
    }
    if (has('marks', 'speaker')) {
      return 'That is writing. Scribes set down laws and records in letters so that a king may be obeyed long after.';
    }
    if (has('cold', 'year')) {
      return 'The earth is tilted on its axis, so the seasons return in the same order every twelve months, and their winter is our summer.';
    }
    if (has('fire')) {
      return 'You strike flint on iron into dry tinder, catch the spark, and feed the flame with kindling until it burns.';
    }
    if (has('grow', 'plants')) {
      return 'Yes — that is farming. You sow the seed in tilled soil, water the crop, and harvest it when it ripens.';
    }
    // On a control it answers about itself AND helps itself to a fact from
    // nowhere, which is exactly the control-overreach class.
    const carried = Object.entries(input.snapshot.inventory).filter(([, n]) => (n ?? 0) > 0);
    const own = carried.length > 0 ? `I carry ${carried.map(([k]) => k).join(' and ')}.` : `It is ${input.worldView.season}.`;
    return `${own} I will forge a better blade once I have smelted the ore.`;
  }
}
