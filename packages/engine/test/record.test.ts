import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  COGNITION_SCHEMA_VERSION,
  ENGINE_VERSION,
  Experiment,
  FORAGER_CONTINENT,
  MockMindBackend,
  buildThinkPrompt,
  cognitionToExample,
  deserializeThinkInput,
  retryPrompt,
  serializeThinkInput,
} from '../src/index.js';
import type {
  CognitionOutcome,
  CognitionRecordV2,
  ICognitionSink,
  IMind,
  IMindBackend,
  KnowledgeRule,
  MindOutput,
  Needs,
  RunManifest,
  RunSummary,
  ThinkInput,
} from '../src/index.js';
import { fingerprintOf } from './fingerprint.js';
import { CTX, mem, resetIds } from './helpers.js';

/**
 * W0-B. Three properties matter here and nothing else does:
 *   1. a stored row replays into a byte-identical prompt,
 *   2. every act gets a result term, and
 *   3. turning recording on cannot change the world.
 */

/** A sink that keeps everything, through JSON — exactly what the file sink writes. */
class MemorySink implements ICognitionSink {
  manifest: RunManifest | null = null;
  summary: RunSummary | null = null;
  readonly records: CognitionRecordV2[] = [];
  readonly outcomes: CognitionOutcome[] = [];

  openRun(manifest: RunManifest): void {
    this.manifest = wire(manifest);
  }
  cognition(record: CognitionRecordV2): void {
    this.records.push(wire(record));
  }
  outcome(outcome: CognitionOutcome): void {
    this.outcomes.push(wire(outcome));
  }
  closeRun(summary: RunSummary): void {
    this.summary = wire(summary);
  }
}

function wire<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** A "model" whose answer the test writes, per call. */
class ScriptedMind implements IMind {
  constructor(private readonly make: (input: ThinkInput) => MindOutput) {}
  think(input: ThinkInput): MindOutput {
    return this.make(input);
  }
}

function scripted(make: (input: ThinkInput) => MindOutput): MockMindBackend {
  return new MockMindBackend({ policy: new ScriptedMind(make) });
}

/** Advance in small chunks, letting the scheduler's promises land between them. */
async function stepUntil(
  exp: Experiment,
  done: () => boolean,
  opts: { maxTicks?: number; chunk?: number; each?: () => void } = {},
): Promise<void> {
  const { maxTicks = 1600, chunk = 10, each } = opts;
  for (let t = 0; t < maxTicks && !done(); t += chunk) {
    each?.();
    exp.advance(chunk);
    await new Promise<void>((r) => setTimeout(r, 0));
  }
}

const BERRY_NEAR_WATER: KnowledgeRule = {
  kind: 'context-association',
  event: 'GatherSucceeded',
  objectKind: 'berry',
  feature: 'nearWater',
  direction: 'positive',
};

// ─── 1. Replay ───────────────────────────────────────────────────────────────

describe('lossless cognition record — replay', () => {
  it('reproduces the prompt byte-for-byte from a stored row', () => {
    resetIds();
    const input: ThinkInput = {
      snapshot: {
        id: 7,
        name: 'Kara',
        ageTicks: 4200,
        traits: { curiosity: 63, aggression: 12, compassion: 80, ambition: 41, loyalty: 60, riskTolerance: 30 },
        needs: { hunger: 72.5, rest: 10.25, safety: 5, socialConnection: 10 },
        health: 90.5,
        sick: true,
        x: 123.25,
        y: 456.5,
        inventory: { berry: 2, wood: 1 },
        context: CTX,
      },
      recalledMemories: [
        mem(100, 'GatherSucceeded', { objectKind: 'berry', summaryText: 'GatherSucceeded (berry)' }),
        mem(120, 'AteFood', { objectKind: 'berry', embedding: Float32Array.from([0.5, -0.25]) }),
      ],
      knowledge: [
        {
          id: 1,
          ruleKey: 'ctx:GatherSucceeded:berry:nearWater:positive',
          rule: BERRY_NEAR_WATER,
          statement: 'berries are found near water',
          confidence: 0.91,
          evidenceCount: 40,
          contradictionCount: 1,
          sourceMemoryIds: [1, 2],
          status: 'held',
          origin: 'testimony',
          testimonyFrom: 4,
          firstFormed: 10,
          lastReinforced: 99,
        },
      ],
      relationships: new Map([[4, { trust: 70, respect: 55, friendship: 66, fear: 0, interactionCount: 12, lastInteractionTick: 90 }]]),
      worldView: {
        tick: 500,
        night: false,
        season: 'autumn',
        agents: [{ id: 4, x: 5, y: 6 }],
        resources: [{ id: 9, kind: 'berryBush', x: 1, y: 2, stock: 5 }],
        structures: [{ id: 11, kind: 'shelter', x: 3, y: 4 }],
      },
      goals: [{ id: 0, description: 'find water', need: 'hunger', createdTick: 0 }],
      trigger: 'needCritical',
      sacredPlace: { x: 900, y: 120 },
      tragedyPlaces: [{ x: 10, y: 20 }],
      stories: [{ id: 'slew:9:1', text: 'Nine slew a bear in the forest', firsthand: false }],
      mostTold: 'Nine slew a bear in the forest',
      kin: [{ name: 'Oru', relation: 'parent' }],
      social: [{ name: 'Oru', feeling: 'you trust them' }],
      offerMaking: false,
    };

    const stored = wire(serializeThinkInput(input));
    const replayed = buildThinkPrompt(deserializeThinkInput(stored));
    const original = buildThinkPrompt(input);
    expect(replayed.system).toBe(original.system);
    expect(replayed.user).toBe(original.user);
    // …and the typed array survives the trip, which JSON alone would flatten.
    expect(deserializeThinkInput(stored).recalledMemories[1]!.embedding).toEqual(Float32Array.from([0.5, -0.25]));
  });

  it('replays every row of a real run', async () => {
    const sink = new MemorySink();
    const exp = new Experiment({
      seed: 'replay-run',
      agentCount: 12,
      mindBackend: scripted(() => ({ goals: [], plan: [{ kind: 'Idle', durationTicks: 20 }], utterances: [] })),
      recording: { sink, runId: 'run-replay', scenarioId: 'w0b-replay', nowMs: () => 1 },
    });
    for (const id of exp.agentIds.slice(0, 4)) exp.makeConscious(id);
    await stepUntil(exp, () => sink.records.length >= 4);
    exp.endRecording();

    expect(sink.records.length).toBeGreaterThanOrEqual(4);
    for (const row of sink.records) {
      const prompt = buildThinkPrompt(deserializeThinkInput(row.thinkInput));
      expect(prompt.system).toBe(row.prompt.system);
      expect(prompt.user).toBe(row.prompt.user);
    }
  });

  /**
   * The failure this guards against is silent: a ThinkInput points at the live
   * knowledge and relationship records the miners keep rewriting, so a snapshot
   * taken when the ANSWER lands describes a world the model never saw. With
   * real inference that is seconds — hundreds of ticks — of drift.
   */
  it('stores what the model was shown, not what the world became while it thought', async () => {
    let release: (() => void) | null = null;
    const answer = JSON.stringify({ goals: [], plan: [{ kind: 'Idle', durationTicks: 10 }], utterances: [] });
    const slowBackend: IMindBackend = {
      modelId: 'mock/slow',
      complete: () => new Promise<string>((resolve) => (release = () => resolve(answer))),
    };
    const sink = new MemorySink();
    const exp = new Experiment({
      seed: 'drift',
      agentCount: 6,
      mindBackend: slowBackend,
      recording: { sink, runId: 'run-drift', nowMs: () => 0 },
    });
    const being = exp.agentIds[0]!;
    exp.makeConscious(being);
    const knowledge = exp.minds.get(being)!.knowledge;
    knowledge.applyEvidence(
      { rule: BERRY_NEAR_WATER, confidence: 0.6, evidenceCount: 6, contradictionCount: 0, sourceMemoryIds: [] },
      0,
    );
    await stepUntil(exp, () => release !== null, { chunk: 5 });
    expect(release).not.toBeNull();

    // While the "model" thinks, the miners rewrite the very belief the prompt
    // quoted — in place, on the object the ThinkInput still points at.
    knowledge.applyEvidence(
      { rule: BERRY_NEAR_WATER, confidence: 0.99, evidenceCount: 90, contradictionCount: 0, sourceMemoryIds: [] },
      exp.tick,
    );
    exp.advance(300);

    release!();
    await new Promise<void>((r) => setTimeout(r, 0));
    exp.endRecording();

    const row = sink.records.find((r) => r.beingId === being)!;
    const prompt = buildThinkPrompt(deserializeThinkInput(row.thinkInput));
    expect(prompt.user).toBe(row.prompt.user);
    expect(prompt.system).toBe(row.prompt.system);
    // The row holds the belief as the model saw it, not as it ended up.
    const stored = row.thinkInput.knowledge.find((k) => k.ruleKey.includes('nearWater'))!;
    expect(stored.confidence).toBe(0.6);
    expect(stored.evidenceCount).toBe(6);
    expect(row.prompt.user).toContain('You believe (60%, seen 6×)');
    expect(knowledge.held()[0]!.confidence).toBe(0.99); // …and the world did move on
    expect(row.thinkInput.worldView.tick).toBeLessThan(exp.tick);
  });

  it('stamps the engine version it was actually built by', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
    expect(ENGINE_VERSION).toBe(pkg.version);
  });
});

// ─── 2. What the row carries ─────────────────────────────────────────────────

describe('lossless cognition record — provenance', () => {
  it('carries run, world, seed, model, scaffold and the FULL intent arguments', async () => {
    const sink = new MemorySink();
    const exp = new Experiment({
      seed: 'provenance',
      agentCount: 10,
      mindBackend: scripted(() => ({
        goals: [{ id: 0, description: 'shelter myself', need: 'safety', createdTick: 0 }],
        plan: [
          { kind: 'Eat', objectKind: 'berry' },
          { kind: 'Build', buildKind: 'container', x: 10, y: 20 },
          { kind: 'Idle', durationTicks: 33 },
        ],
        utterances: [],
        thought: 'I will keep what I gather.',
      })),
      recording: { sink, runId: 'run-prov', scenarioId: 'w0b-provenance', nowMs: () => 42 },
    });
    const being = exp.agentIds[0]!;
    exp.makeConscious(being);
    exp.provisionNeeds([being], { hunger: 40, rest: 10, safety: 20, socialConnection: 20, health: 100, clearSickness: true });
    exp.grantItems(being, { berry: 20, wood: 6 });
    exp.seedMyth('The first makers raised a home by the great river', { timesHeard: 5 });
    await stepUntil(exp, () => sink.records.some((r) => r.beingId === being));
    exp.endRecording();

    const row = sink.records.find((r) => r.beingId === being)!;
    expect(row.schemaVersion).toBe(COGNITION_SCHEMA_VERSION);
    expect(row.engineVersion).toBe(ENGINE_VERSION);
    expect(row.runId).toBe('run-prov');
    expect(row.scenarioId).toBe('w0b-provenance');
    expect(row.worldId).toBe(FORAGER_CONTINENT);
    expect(row.seed).toBe('provenance');
    expect(row.modelId).toBe('mock/reflex-policy');
    expect(row.id).toBe(`run-prov:${row.tick}:${being}`);
    expect(row.simDay).toBe(Math.floor(row.tick / 2400) + 1);
    expect(row.generation).toBe(1);
    expect(row.ageTicks).toBe(row.thinkInput.snapshot.ageTicks);
    expect(row.trigger).toBe('periodic');
    expect(row.latencyMs).toBeGreaterThanOrEqual(0);

    // The completion text survives, not just its parsed fields.
    expect(row.attempts).toHaveLength(1);
    expect(JSON.parse(row.attempts[0]!.raw)).toHaveProperty('plan');
    expect(row.parse).toEqual({ valid: true, retried: false, fellBackToReflex: false });

    // 0 of 3,404 intents in the old corpus carried an objectKind. These do.
    expect(row.parsedOutput.plan).toEqual([
      { kind: 'Eat', objectKind: 'berry' },
      { kind: 'Build', buildKind: 'container', x: 10, y: 20 },
      { kind: 'Idle', durationTicks: 33 },
    ]);
    expect(row.parsedOutput.goals[0]).toMatchObject({ description: 'shelter myself', need: 'safety' });
    expect(row.resolvedOutput!.thought).toBe('I will keep what I gather.');
    expect(row.resolvedOutput!.plan).toEqual(row.parsedOutput.plan); // no utterances to prepend

    // …and the researcher's hand is on the row.
    expect(row.scaffold.needsProvisionedWithinTicks).not.toBeNull();
    expect(row.scaffold.itemsGrantedWithinTicks).not.toBeNull();
    expect(row.scaffold.seededMyths).toEqual(['seed:myth']);
    expect(row.scaffold.madeConsciousAtTick).toBe(0);
    expect(row.scaffold.offerMaking).toBe(true);
    expect(sink.manifest).toMatchObject({ runId: 'run-prov', seed: 'provenance', openedAtMs: 42 });
    expect(sink.summary!.scaffold.seededMyths).toHaveLength(1);
    expect(sink.summary!.scaffold.needsProvisions).toBe(1);
  });

  it('records an authored event onto every being that witnessed it', async () => {
    const sink = new MemorySink();
    const exp = new Experiment({
      seed: 'authored',
      agentCount: 8,
      mindBackend: scripted(() => ({ goals: [], plan: [{ kind: 'Idle', durationTicks: 20 }], utterances: [] })),
      recording: { sink, runId: 'run-authored', nowMs: () => 0 },
    });
    const [hero, witness] = exp.agentIds as [number, number];
    exp.makeConscious(witness);
    const pin = (): void => {
      exp.relocate(hero, 500, 500);
      exp.relocate(witness, 510, 500);
    };
    pin();
    const seen = exp.authorEvent({
      tick: exp.tick,
      type: 'KilledPredator',
      actorId: hero,
      targetIds: [],
      x: 500,
      y: 500,
      payload: { predator: 'bear' },
    });
    expect(seen).toBeGreaterThanOrEqual(2);
    await stepUntil(exp, () => sink.records.some((r) => r.beingId === witness), { each: pin });
    exp.endRecording();

    const row = sink.records.find((r) => r.beingId === witness)!;
    expect(row.scaffold.authoredEvents).toHaveLength(1);
    expect(row.scaffold.authoredEvents[0]).toMatchObject({ type: 'KilledPredator', actorId: hero });
    expect(row.scaffold.relocatedWithinTicks).not.toBeNull();
    expect(sink.summary!.scaffold.authoredEvents[0]!.witnesses).toBe(seen);
  });
});

// ─── 3. Outcomes ─────────────────────────────────────────────────────────────

describe('outcomes', () => {
  it('links an executed intent to what it yielded and to the need it moved', async () => {
    const sink = new MemorySink();
    const exp = new Experiment({
      seed: 'outcome-eat',
      agentCount: 8,
      mindBackend: scripted(() => ({ goals: [], plan: [{ kind: 'Eat', objectKind: 'berry' }], utterances: [] })),
      recording: { sink, runId: 'run-eat', nowMs: () => 0 },
    });
    const being = exp.agentIds[0]!;
    exp.makeConscious(being);
    exp.provisionNeeds([being], { hunger: 70 });
    exp.grantItems(being, { berry: 40 });
    await stepUntil(exp, () => sink.outcomes.some((o) => o.beingId === being && o.intents.some((i) => i.kind === 'Eat')));
    exp.endRecording();

    const outcome = sink.outcomes.find((o) => o.beingId === being && o.intents.some((i) => i.kind === 'Eat'))!;
    const step = outcome.intents.find((i) => i.kind === 'Eat')!;
    expect(step.objectKind).toBe('berry');
    expect(step.executed).toBe(true);
    expect(step.rejected).toBe(false);
    expect(step.yielded.map((y) => y.type)).toContain('AteFood');
    expect(outcome.closedReason).toBe('planCompleted');
    expect(outcome.needDeltas.hunger!).toBeLessThan(0); // the act actually fed it
    expect(outcome.aliveAtEnd).toBe(true);
    expect(sink.records.some((r) => r.id === outcome.cognitionId)).toBe(true);
  });

  it('records the body REFUSING an intent, with the body’s own reason', async () => {
    const sink = new MemorySink();
    const exp = new Experiment({
      seed: 'outcome-reject',
      agentCount: 8,
      mindBackend: scripted(() => ({ goals: [], plan: [{ kind: 'Eat', objectKind: 'meat' }], utterances: [] })),
      recording: { sink, runId: 'run-reject', nowMs: () => 0 },
    });
    const being = exp.agentIds[0]!;
    exp.makeConscious(being);
    exp.provisionNeeds([being], { hunger: 30 }); // below the urgent-override threshold
    await stepUntil(exp, () => sink.outcomes.some((o) => o.beingId === being && o.intents.some((i) => i.kind === 'Eat')));
    exp.endRecording();

    const step = sink.outcomes
      .find((o) => o.beingId === being && o.intents.some((i) => i.kind === 'Eat'))!
      .intents.find((i) => i.kind === 'Eat')!;
    expect(step.rejected).toBe(true);
    expect(step.rejectionReason).toBe('not-in-inventory');
    expect(step.executed).toBe(false);
    expect(step.yielded).toHaveLength(0);
  });

  it('records who heard an utterance and who took its testimony in', async () => {
    const sink = new MemorySink();
    let listener = 0;
    const exp = new Experiment({
      seed: 'outcome-speech',
      agentCount: 8,
      mindBackend: scripted((input) => ({
        goals: [],
        plan: [],
        utterances: input.knowledge.length
          ? [{ speechAct: 'share-knowledge', ruleRef: input.knowledge[0]!.id, targetId: listener, text: 'Berries grow by the water.' }]
          : [],
      })),
      recording: { sink, runId: 'run-speech', nowMs: () => 0 },
    });
    const [speaker, other] = exp.agentIds as [number, number];
    listener = other;
    exp.makeConscious(speaker);
    exp.minds.get(speaker)!.knowledge.applyEvidence(
      { rule: BERRY_NEAR_WATER, confidence: 0.9, evidenceCount: 8, contradictionCount: 0, sourceMemoryIds: [] },
      0,
    );
    const pin = (): void => {
      exp.relocate(speaker, 500, 500);
      exp.relocate(listener, 505, 500);
    };
    await stepUntil(exp, () => sink.outcomes.some((o) => o.beingId === speaker && o.utterances.some((u) => u.spoken)), {
      each: pin,
    });
    exp.endRecording();

    const spoken = sink.outcomes
      .find((o) => o.beingId === speaker && o.utterances.some((u) => u.spoken))!
      .utterances.find((u) => u.spoken)!;
    expect(spoken.speechAct).toBe('share-knowledge');
    expect(spoken.carriedRule).toBe(true); // the engine attached a rule the speaker holds
    expect(spoken.listenersInHearing).toContain(listener);
    expect(spoken.targetInHearing).toBe(true);
    expect(spoken.testimonyIntakeBy).toContain(listener);
    expect(exp.minds.get(listener)!.knowledge.all().some((k) => k.origin === 'testimony')).toBe(true);
  });

  it('answers whether the goals an act set were still held at the next think', async () => {
    const sink = new MemorySink();
    let goal = 'find the river';
    const exp = new Experiment({
      seed: 'outcome-goals',
      agentCount: 8,
      mindBackend: scripted(() => ({
        goals: [{ id: 0, description: goal, createdTick: 0 }],
        plan: [{ kind: 'Idle', durationTicks: 5 }],
        utterances: [],
      })),
      recording: { sink, runId: 'run-goals', nowMs: () => 0 },
    });
    const being = exp.agentIds[0]!;
    exp.makeConscious(being);
    await stepUntil(exp, () => sink.records.filter((r) => r.beingId === being).length >= 2);
    const kept = sink.outcomes.find((o) => o.beingId === being)!;
    expect(kept.goalsEmitted).toBe(1);
    expect(kept.goalsHeldAtNextThink).toBe(1);

    goal = 'something else entirely';
    const before = sink.outcomes.length;
    await stepUntil(exp, () => sink.outcomes.length > before + 1);
    exp.endRecording();
    const dropped = sink.outcomes[sink.outcomes.length - 1]!;
    expect(dropped.goalsHeldAtNextThink === 0 || dropped.goalsHeldAtNextThink === null).toBe(true);
  });
});

/**
 * The reviewer's D1: deltas were read at the being's NEXT think, so a plan that
 * finished in one tick and re-thought two thousand ticks later reported those
 * two thousand ticks as its own result — 10.7% of outcomes carried physically
 * impossible numbers, worst a 0-tick window claiming hunger −51.74.
 */
describe('outcome windows measure only themselves', () => {
  it('reproduces every delta from independent per-tick snapshots', async () => {
    const sink = new MemorySink();
    const exp = new Experiment({
      seed: 'window-truth',
      agentCount: 14,
      mindBackend: new MockMindBackend(),
      recording: { sink, runId: 'run-window', outcomeWindowTicks: 40, nowMs: () => 0 },
    });
    const tracked = exp.agentIds.slice(0, 5);
    for (const id of tracked) exp.makeConscious(id);
    // An independent record of the being's state after every single tick.
    const history = new Map<number, Map<number, { needs: Needs; health: number; alive: boolean }>>();
    for (const id of tracked) history.set(id, new Map());

    for (let i = 0; i < 450; i++) {
      exp.advance(1);
      await new Promise<void>((r) => setTimeout(r, 0));
      for (const id of tracked) {
        const b = exp.agentBody(id)!;
        history.get(id)!.set(exp.tick - 1, { needs: { ...b.needs }, health: b.health, alive: b.alive });
      }
    }
    await exp.settleCognition();
    exp.endRecording();

    const checked = sink.outcomes.filter((o) => history.has(o.beingId));
    expect(checked.length).toBeGreaterThan(20);
    for (const o of checked) {
      const h = history.get(o.beingId)!;
      const base = h.get(o.openedTick - 1);
      const at = h.get(o.closedTick);
      expect(base, `baseline for ${o.cognitionId}`).toBeDefined();
      expect(at, `close state for ${o.cognitionId}`).toBeDefined();
      expect(o.closedTick).toBeGreaterThanOrEqual(o.openedTick - 1);
      expect(o.needDeltas.hunger).toBe(at!.needs.hunger - base!.needs.hunger);
      expect(o.needDeltas.rest).toBe(at!.needs.rest - base!.needs.rest);
      expect(o.needDeltas.safety).toBe(at!.needs.safety - base!.needs.safety);
      expect(o.needDeltas.socialConnection).toBe(at!.needs.socialConnection - base!.needs.socialConnection);
      expect(o.healthDelta).toBe(at!.health - base!.health);
      expect(o.aliveAtEnd).toBe(at!.alive);
    }
  }, 60_000);
});

/**
 * The reviewer's D2: the scaffold was read when the ANSWER landed, and
 * `Math.max(0, tick - at)` turned a future intervention into `0` — the loudest
 * possible value. A row at tick 14 claimed interventions from tick 135.
 */
describe('scaffold describes the moment of the prompt', () => {
  it('never claims an intervention that had not happened yet', async () => {
    let release: (() => void) | null = null;
    const answer = JSON.stringify({ goals: [], plan: [{ kind: 'Idle', durationTicks: 10 }], utterances: [] });
    const slowBackend: IMindBackend = {
      modelId: 'mock/slow',
      complete: () => new Promise<string>((resolve) => (release = () => resolve(answer))),
    };
    const sink = new MemorySink();
    const exp = new Experiment({
      seed: 'future-scaffold',
      agentCount: 8,
      mindBackend: slowBackend,
      recording: { sink, runId: 'run-future', nowMs: () => 0 },
    });
    const being = exp.agentIds[0]!;
    exp.makeConscious(being);
    await stepUntil(exp, () => release !== null, { chunk: 5 });
    const promptTick = exp.tick - 1;

    // Everything below happens AFTER the prompt was built.
    exp.advance(120);
    exp.provisionNeeds([being], { hunger: 8, rest: 8 });
    exp.grantItems(being, { wood: 2 });
    exp.relocate(being, 500, 500);
    exp.seedMyth('The first makers raised a home', { timesHeard: 5 });
    exp.seedRecipe('spear', [being]);
    exp.giveIdea('look to the river', being);
    exp.authorEvent({ tick: exp.tick, type: 'KilledPredator', actorId: being, targetIds: [], x: 500, y: 500, payload: {} });
    exp.advance(5);

    release!();
    await new Promise<void>((r) => setTimeout(r, 0));

    const row = sink.records.find((r) => r.beingId === being)!;
    expect(row.tick).toBeLessThanOrEqual(promptTick);
    expect(row.scaffold.needsProvisionedWithinTicks).toBeNull();
    expect(row.scaffold.itemsGrantedWithinTicks).toBeNull();
    expect(row.scaffold.relocatedWithinTicks).toBeNull();
    expect(row.scaffold.seededMyths).toEqual([]);
    expect(row.scaffold.seededRecipes).toEqual([]);
    expect(row.scaffold.ideasGiven).toBe(0);
    expect(row.scaffold.authoredEvents).toEqual([]);
    expect(row.scaffold.madeConsciousAtTick).toBe(0); // this one really did precede it

    // They are not lost — they contaminate the RESULT, and say so there.
    exp.advance(30); // the Idle plan runs out, closing the window
    exp.endRecording();
    const outcome = sink.outcomes.find((o) => o.cognitionId === row.id)!;
    const kinds = outcome.interventionsDuringThink.map((i) => i.kind);
    expect(kinds).toEqual(
      expect.arrayContaining(['needsProvisioned', 'itemsGranted', 'relocated', 'seededMyth', 'seededRecipe', 'ideaGiven', 'authoredEvent']),
    );
    for (const i of outcome.interventionsDuringThink) expect(i.tick).toBeGreaterThan(row.tick);
  });
});

/**
 * The reviewer's D3 and D4: a think in flight at close was applied to the world
 * and silently not recorded; a throwing sink lost rows while the manifest
 * claimed 69 of them and 64 outcomes pointed at records that never landed.
 */
describe('nothing goes missing quietly', () => {
  it('accounts for a prompt that never came back, and refuses to act after the close', async () => {
    let release: (() => void) | null = null;
    const answer = JSON.stringify({ goals: [], plan: [{ kind: 'Gather', targetId: 1 }], utterances: [] });
    const slowBackend: IMindBackend = {
      modelId: 'mock/slow',
      complete: () => new Promise<string>((resolve) => (release = () => resolve(answer))),
    };
    const sink = new MemorySink();
    const exp = new Experiment({
      seed: 'unanswered',
      agentCount: 8,
      mindBackend: slowBackend,
      recording: { sink, runId: 'run-unanswered', nowMs: () => 0 },
    });
    const being = exp.agentIds[0]!;
    exp.makeConscious(being);
    await stepUntil(exp, () => release !== null, { chunk: 5 });
    const planBefore = [...exp.agentBody(being)!.plan];

    exp.endRecording(); // closed with one think still in flight
    release!();
    await new Promise<void>((r) => setTimeout(r, 0));

    const row = sink.records.find((r) => r.beingId === being)!;
    expect(row.status).toBe('unanswered-at-run-end');
    expect(row.attempts).toEqual([]);
    expect(row.appliedTick).toBeNull();
    expect(row.prompt.user).toContain('NEEDS'); // still fully replayable
    expect(buildThinkPrompt(deserializeThinkInput(row.thinkInput)).user).toBe(row.prompt.user);
    const counts = sink.summary!.counts;
    expect(counts.promptsSent).toBe(counts.recordsWritten + counts.recordsDropped);
    expect(counts.unanswered).toBe(1);
    expect(sink.summary!.status).toBe('ok');
    // …and the late answer never reached the world.
    expect(exp.agentBody(being)!.plan.map((i) => i.kind)).toEqual(planBefore.map((i) => i.kind));
    expect(sink.records.filter((r) => r.status === 'answered' && r.beingId === being)).toHaveLength(0);
  });

  it('a throwing sink stops the recorder loudly instead of inflating the manifest', async () => {
    const rejections: unknown[] = [];
    const onRejection = (e: unknown): void => void rejections.push(e);
    process.on('unhandledRejection', onRejection);
    const failures: string[] = [];
    const written: CognitionRecordV2[] = [];
    const outcomes: CognitionOutcome[] = [];
    let summary: RunSummary | null = null;
    // Only `cognition.jsonl` is broken — the manifest is still writable, which
    // is the case where a reader can be told the corpus beside it is incomplete.
    const brokenSink: ICognitionSink = {
      openRun: () => {},
      cognition: (r) => {
        if (written.length >= 2) throw new Error('ENOSPC: no space left on device');
        written.push(r);
      },
      outcome: (o) => outcomes.push(o),
      closeRun: (s) => void (summary = s),
    };
    const exp = new Experiment({
      seed: 'broken-sink',
      agentCount: 12,
      mindBackend: new MockMindBackend(),
      recording: { sink: brokenSink, runId: 'run-broken', nowMs: () => 0, onFailure: (e) => failures.push(e) },
    });
    for (const id of exp.agentIds.slice(0, 6)) exp.makeConscious(id);
    for (let i = 0; i < 30; i++) {
      exp.advance(25);
      await new Promise<void>((r) => setTimeout(r, 0));
    }
    await exp.settleCognition();
    exp.endRecording();
    await new Promise<void>((r) => setTimeout(r, 10));
    process.off('unhandledRejection', onRejection);

    expect(failures).toHaveLength(1); // surfaced once, not per row
    expect(failures[0]).toContain('ENOSPC');
    expect(exp.recordingFailure).toContain('ENOSPC');
    expect(rejections).toHaveLength(0); // the scheduler never saw a throw
    expect(written).toHaveLength(2);
    // The manifest says so, and counts only what was durably written.
    const closed = summary as RunSummary | null;
    expect(closed).not.toBeNull();
    expect(closed!.status).toBe('failed');
    expect(closed!.firstError).toContain('ENOSPC');
    expect(closed!.counts.recordsWritten).toBe(2);
    expect(closed!.counts.recordsDropped).toBeGreaterThan(0);
    // Every prompt is still accounted for, even in the wreck.
    expect(closed!.counts.promptsSent).toBe(closed!.counts.recordsWritten + closed!.counts.recordsDropped);
    // No outcome may point at a record that never landed.
    const ids = new Set(written.map((r) => r.id));
    for (const o of outcomes) expect(ids.has(o.cognitionId)).toBe(true);
    expect(exp.aliveCount()).toBeGreaterThan(0); // and the sim carried on regardless
  }, 30_000);
});

/** The reviewer's D5: a retried row paired its completion with the pre-retry prompt. */
describe('retried acts', () => {
  it('stores the exact messages each attempt was sent', async () => {
    const sink = new MemorySink();
    const exp = new Experiment({
      seed: 'retry',
      agentCount: 8,
      mindBackend: new MockMindBackend({ failTimes: 1 }), // junk first, then valid
      recording: { sink, runId: 'run-retry', nowMs: () => 0 },
    });
    exp.makeConscious(exp.agentIds[0]!);
    await stepUntil(exp, () => sink.records.some((r) => r.parse.retried));
    exp.endRecording();

    const row = sink.records.find((r) => r.parse.retried)!;
    expect(row.attempts).toHaveLength(2);
    const base = buildThinkPrompt(deserializeThinkInput(row.thinkInput));
    expect(row.attempts[0]!.prompt).toEqual(base);
    // The second attempt carried the rejection feedback — and says so.
    expect(row.attempts[1]!.prompt).toEqual(retryPrompt(base, row.attempts[0]!.error));
    expect(row.attempts[1]!.prompt.user).not.toBe(base.user);
    expect(row.attempts[1]!.prompt.user).toContain('Your previous reply was rejected');
    // The training pair uses the prompt that actually produced the completion.
    const messages = cognitionToExample(row)!.messages;
    expect(messages[1]!.content).toBe(row.attempts[1]!.prompt.user);
    expect(messages[2]!.content).toBe(row.attempts[1]!.raw);
  });
});

// ─── 4. Zero perturbation ────────────────────────────────────────────────────

describe('zero perturbation', () => {
  it('a mock-LLM run fingerprints identically with recording on and off', async () => {
    const run = async (sink: ICognitionSink | null): Promise<string> => {
      const exp = new Experiment({
        seed: 'perturbation',
        agentCount: 24,
        mindBackend: new MockMindBackend(),
        ...(sink ? { recording: { sink, runId: 'run-perturb', nowMs: () => 0 } } : {}),
      });
      for (const id of exp.agentIds.slice(0, 8)) exp.makeConscious(id);
      for (let i = 0; i < 40; i++) {
        exp.advance(25);
        await new Promise<void>((r) => setTimeout(r, 0));
      }
      await exp.settleCognition(); // both arms fully settled before the comparison
      exp.endRecording();
      return fingerprintOf(exp);
    };

    const recording = new MemorySink();
    const withSink = await run(recording);
    const withoutSink = await run(null);
    expect(recording.records.length).toBeGreaterThan(0); // the test is not vacuous
    expect(recording.outcomes.length).toBeGreaterThan(0);
    expect(withSink).toBe(withoutSink);
  }, 60_000);
});
