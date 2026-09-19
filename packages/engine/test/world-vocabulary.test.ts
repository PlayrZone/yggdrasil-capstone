import { describe, expect, it } from 'vitest';
import {
  AgentMind,
  Experiment,
  MindOutputError,
  MockMindBackend,
  WaitingMind,
  actionForCore,
  at,
  buildThinkPrompt,
  encodeIntent,
  foragerAdapter,
  importanceOf,
  parseMindOutput,
  policyFor,
} from '../src/index.js';
import type { AgentSnapshot, MindOutput, ThinkInput, WorldView } from '../src/index.js';
import { Interventions } from '../src/runner/Interventions.js';
import { SimRuntime } from '../src/runner/Runtime.js';
import { scenarioFor } from '../src/runner/Scenario.js';
import { toyWorld } from './fixtures/toyAdapter.js';
import {
  WAS_INTENT_ARG_LINES,
  WAS_INTENT_KINDS,
  WAS_INTENT_VOCAB,
  WAS_NEED_HINT,
  wasBuildKindHint,
  wasObjectKindHint,
} from './fixtures/foragerVerbsBefore.js';

/**
 * THE PARSER AND THE PROMPT NOW READ THE WORLD (W1-B3), AND DECIDE THE SAME.
 *
 * T1's 92 parser cases run unmodified — only their construction says which
 * world — so identity of the ACCEPT/REJECT decisions is already pinned there.
 * What is pinned HERE is the part those cases cannot see: the exact reason code
 * when an input is illegal in TWO ways at once (the arg read order decides
 * which the model is told about), the byte-for-byte refusal clauses, and the
 * prompt's verb line. Then the same two functions are run against a world that
 * shares nothing with this one.
 */

const reasonOf = (raw: string, world = foragerAdapter): string => {
  try {
    parseMindOutput(raw, world);
    return 'accepted';
  } catch (err) {
    return err instanceof MindOutputError ? err.reason : 'threw';
  }
};

const messageOf = (raw: string, world = foragerAdapter): string => {
  try {
    parseMindOutput(raw, world);
    return 'accepted';
  } catch (err) {
    return err instanceof MindOutputError ? err.message : 'threw';
  }
};

describe('the same decisions, from the world’s tables', () => {
  it('refuses the same values with the same reason and the same words', () => {
    expect(messageOf('{"plan":[{"kind":"Eat","objectKind":"plutonium"}]}')).toBe(
      `bad-arg: objectKind is "plutonium", which is not a thing here — ${wasObjectKindHint('Eat')}`,
    );
    expect(messageOf('{"plan":[{"kind":"Build","buildKind":"tower"}]}')).toBe(
      `bad-arg: buildKind is "tower", which is not a thing here — ${wasBuildKindHint('Build')}`,
    );
    expect(messageOf('{"plan":[{"kind":"Idle"}],"goals":[{"description":"x","need":"money"}]}')).toBe(
      `bad-arg: need is "money", which is not a thing here — ${WAS_NEED_HINT}`,
    );
    expect(messageOf('{"plan":[{"kind":"Teleport"}]}')).toBe('bad-intent: invalid intent kind: Teleport');
  });

  /**
   * WHEN AN INTENT IS ILLEGAL TWICE the model hears about exactly one of them,
   * and which one is decided by the order the arguments are read in. That order
   * used to be whatever `parsePlan` happened to write; it is now the world's
   * (`planArguments`), and these are the pairs that tell the two apart.
   */
  it('reports the same one of two illegal arguments', () => {
    const cases: [string, string][] = [
      ['{"plan":[{"kind":"Build","buildKind":"tower","durationTicks":1e999}]}', 'bad-arg'],
      ['{"plan":[{"kind":"Build","durationTicks":1e999,"buildKind":"tower"}]}', 'bad-arg'],
      ['{"plan":[{"kind":"Eat","objectKind":"plutonium","x":1e999}]}', 'bad-number'],
      ['{"plan":[{"kind":"Eat","x":1e999,"objectKind":"plutonium"}]}', 'bad-number'],
      ['{"plan":[{"kind":"Eat","objectKind":"plutonium","buildKind":"tower"}]}', 'bad-arg'],
      ['{"plan":[{"kind":"MoveTo","targetId":1e999,"objectKind":"plutonium"}]}', 'bad-number'],
      ['{"plan":[{"kind":"Teleport","objectKind":"plutonium"}]}', 'bad-intent'],
      ['{"plan":[{"kind":"Sleep","durationTicks":1e999,"objectKind":"plutonium"}]}', 'bad-arg'],
    ];
    for (const [raw, reason] of cases) expect(reasonOf(raw), raw).toBe(reason);
    // The last pair is the one that moves if the order is taken from where each
    // argument first appears instead: `durationTicks` (Sleep) would then be read
    // before `objectKind` (Eat) and this would read `bad-number`.
    expect(messageOf('{"plan":[{"kind":"Sleep","durationTicks":1e999,"objectKind":"plutonium"}]}')).toContain(
      'objectKind',
    );
  });

  it('writes an intent’s fields in the order the wire has always had them', () => {
    const out = parseMindOutput(
      '{"plan":[{"durationTicks":9,"buildKind":"wall","objectKind":"wood","targetId":3,"y":2,"x":1,"kind":"Build"}]}',
      foragerAdapter,
    );
    // The MIND's step carries one opaque place; the WIRE — what the body is
    // handed and what a corpus row stores — keeps the field order it has always
    // had, which is the thing byte-identity is a claim about (W1-B4).
    expect(Object.keys(out.plan[0]!)).toEqual(['kind', 'place', 'targetId', 'objectKind', 'buildKind', 'durationTicks']);
    expect(Object.keys(encodeIntent(foragerAdapter, out.plan[0]!))).toEqual([
      'kind',
      'x',
      'y',
      'targetId',
      'objectKind',
      'buildKind',
      'durationTicks',
    ]);
  });

  it('still accepts every verb this world has, and no other', () => {
    for (const verb of WAS_INTENT_KINDS) {
      expect(reasonOf(`{"plan":[{"kind":"${verb}"}]}`), verb).toBe('accepted');
    }
    for (const verb of ['Snaffle', 'Dawdle', 'Nibble', 'Shuffle']) {
      expect(reasonOf(`{"plan":[{"kind":"${verb}"}]}`), verb).toBe('bad-intent');
    }
  });
});

describe('the prompt offers the world’s verbs', () => {
  it('renders the forager vocabulary line byte for byte', () => {
    const prompt = buildThinkPrompt(thinkInput(foragerAdapter), foragerAdapter);
    expect(prompt.system).toContain(`INTENT kind is one of: ${WAS_INTENT_VOCAB}.`);
    // The needs header quoted 60/85 before; it quotes the world's now.
    expect(prompt.user).toContain('NEEDS (0 satisfied, 100 desperate — 60+ pressing, 85+ critical):');
  });

  /**
   * …AND THE PARAGRAPH UNDER IT (B3 verifier, backlog 2), which was still typed
   * out inside the mind. Asserted as the whole four-line block in place, so a
   * line break or a comma moving is a failure, not a near miss.
   */
  it('renders the argument paragraph, in place, byte for byte', () => {
    const prompt = buildThinkPrompt(thinkInput(foragerAdapter), foragerAdapter);
    expect(prompt.system).toContain(
      `INTENT kind is one of: ${WAS_INTENT_VOCAB}.\nIntent args: ${WAS_INTENT_ARG_LINES.join('\n')}\n`,
    );
  });

  it('offers a different world its own verbs, and none of this one’s', () => {
    const prompt = buildThinkPrompt(thinkInput(toyWorld), toyWorld);
    expect(prompt.system).toContain('INTENT kind is one of: Shuffle, Snaffle, Nibble, Dawdle.');
    for (const verb of WAS_INTENT_KINDS) {
      expect(prompt.system, verb).not.toContain(`, ${verb},`);
    }
    // Not one of the forager's argument shapes either — the toy world declares
    // no paragraph, so it is told nothing rather than told about berries.
    expect(prompt.system).not.toContain('Intent args:');
    for (const line of WAS_INTENT_ARG_LINES) expect(prompt.system, line).not.toContain(line);
    // Its thresholds, too — the toy world's hunger presses at 10, not at 60.
    expect(prompt.user).toContain('100 desperate — 10+ pressing, 20+ critical');
  });
});

describe('a world with no instinct of its own', () => {
  it('waits, by the act its own world binds to Wait', () => {
    const mind = policyFor(toyWorld);
    expect(mind).toBeInstanceOf(WaitingMind);
    const out: MindOutput = mind.think(thinkInput(toyWorld));
    expect(out.plan).toEqual([{ kind: 'Dawdle' }]);
    expect(out.plan[0]!.kind).toBe(actionForCore(toyWorld, 'Wait')!.id);
    expect(out.goals).toEqual([]);
    expect(out.utterances).toEqual([]);
    // A fresh array each time: the body owns what it is handed.
    expect(mind.think(thinkInput(toyWorld)).plan[0]).not.toBe(out.plan[0]);
  });

  it('is what an AgentMind in that world thinks with, and the forager’s is not', () => {
    const toy = new AgentMind(1, toyWorld);
    expect(toy.think(snapshot(toyWorld), view(), 'periodic').plan).toEqual([{ kind: 'Dawdle' }]);
    // The forager world declares a policy, so its beings get that instead.
    const forager = new AgentMind(1, foragerAdapter);
    const out = forager.think(snapshot(foragerAdapter), view(), 'periodic');
    expect(out.plan.every((i) => WAS_INTENT_KINDS.includes(i.kind as never))).toBe(true);
    expect(out.plan.some((i) => i.kind === 'Dawdle')).toBe(false);
  });

  it('parses and refuses by the toy world’s own vocabulary', () => {
    expect(reasonOf('{"plan":[{"kind":"Snaffle","targetId":3}]}', toyWorld)).toBe('accepted');
    expect(reasonOf('{"plan":[{"kind":"Nibble","objectKind":"crumb"}]}', toyWorld)).toBe('accepted');
    // Its `edible` tag filters the same argument the forager world leaves open.
    expect(reasonOf('{"plan":[{"kind":"Nibble","objectKind":"lever"}]}', toyWorld)).toBe('bad-arg');
    expect(reasonOf('{"plan":[{"kind":"Nibble","objectKind":"berry"}]}', toyWorld)).toBe('bad-arg');
    // Nothing of this world reaches that one: not a verb, not a kind, not a drive.
    expect(reasonOf('{"plan":[{"kind":"Eat","objectKind":"berry"}]}', toyWorld)).toBe('bad-intent');
    expect(reasonOf('{"plan":[{"kind":"Dawdle"}],"goals":[{"description":"x","need":"safety"}]}', toyWorld)).toBe('bad-arg');
    expect(reasonOf('{"plan":[{"kind":"Dawdle"}],"goals":[{"description":"x","need":"hunger"}]}', toyWorld)).toBe('accepted');
  });
});

describe('the mind→body edge over a real run', () => {
  /**
   * An argument the PARSER cannot fault — `buildKind: "shelter"` is a perfectly
   * good structure — given to a verb that does not take one. B3 dropped the
   * step here; the verifier showed that deletes the BODY's refusal, which is an
   * event the being remembers. It goes through, the body answers for it, and
   * the tolerance is counted (`deferredParam`) rather than passed over.
   */
  it('hands the body a step the world does not declare, and counts the tolerance', async () => {
    const exp = new Experiment({
      seed: 'b3-refusal',
      agentCount: 4,
      mindBackend: new MockMindBackend({
        policy: {
          think: (): MindOutput => ({
            goals: [],
            plan: [
              { kind: 'Eat', objectKind: 'berry', buildKind: 'shelter' },
              { kind: 'Idle', durationTicks: 5 },
            ],
            utterances: [],
          }),
        },
      }),
    });
    const id = exp.agentIds[0]!;
    exp.makeConscious(id);
    const gate = exp.minds.get(id)!.gate;
    for (let t = 0; t < 1600 && gate.counts.deferredParam === 0; t += 10) {
      exp.advance(10);
      await new Promise<void>((r) => setTimeout(r, 0));
    }
    expect(gate.counts.deferredParam).toBe(1);
    expect(gate.counts.badParam).toBe(0);
    expect(gate.counts.undeclaredAction).toBe(0);
    // Both steps reached the body, in the order they were decided.
    expect(exp.agentBody(id)!.plan.map((i) => i.kind)).toEqual(['Eat', 'Idle']);
  }, 20_000);

  /**
   * The other half of the edge is UNREACHABLE from here, and that is the point:
   * a plan naming an act this world does not declare is refused by the parser
   * as `bad-intent` long before the gate sees it, and this world's reflex policy
   * emits only the acts it was given. `world-actions.test.ts` holds the gate to
   * it directly; nothing in a run can make it fire.
   */
  it('never sees an undeclared act at all — the parser has it first', async () => {
    const exp = new Experiment({
      seed: 'b3-undeclared',
      agentCount: 4,
      mindBackend: new MockMindBackend({
        policy: {
          think: (): MindOutput => ({
            goals: [],
            plan: [{ kind: 'Snaffle', targetId: 2 }],
            utterances: [],
          }),
        },
      }),
    });
    const id = exp.agentIds[0]!;
    exp.makeConscious(id);
    const log = exp.cognitionLog!;
    for (let t = 0; t < 1600 && log.count === 0; t += 10) {
      exp.advance(10);
      await new Promise<void>((r) => setTimeout(r, 0));
    }
    const record = log.recent(1)[0]!;
    expect(record.valid).toBe(false);
    expect(record.error).toContain('bad-intent');
    expect(exp.minds.get(id)!.gate.counts.undeclaredAction).toBe(0);
  }, 20_000);

  it('refuses nothing in a world whose policy and parser speak its own tables', () => {
    const exp = new Experiment({ seed: 'b3-edge', agentCount: 12 });
    exp.advance(3000);
    for (const [id, mind] of exp.minds) {
      expect(mind.gate.counts, `#${id}`).toEqual({
        undeclaredEvent: 0,
        undeclaredMemory: 0,
        undeclaredDrive: 0,
        undeclaredTestimony: 0,
        undeclaredAction: 0,
        badParam: 0,
        deferredParam: 0,
        authoredClamp: 0,
      });
    }
  });
});

/**
 * B2 verifier §3, backlog 4: an authored event was the one door a non-number
 * could come through, and a `NaN` importance makes `MemoryStream`'s eviction
 * comparator non-total — V8 then returns an arbitrary permutation of the
 * evicted block, which in a research engine is a reproducibility hazard.
 */
describe('importance is a number, whatever it is handed', () => {
  it('is finite for every shape a delta slot can be in', () => {
    const shapes: unknown[] = [undefined, Number.NaN, Number.POSITIVE_INFINITY, -Infinity, 'lots', null, {}];
    for (const value of shapes) {
      const got = importanceOf(foragerAdapter, 'AteFood', { hunger: value } as Record<string, number>);
      expect(Number.isFinite(got), String(value)).toBe(true);
      // A magnitude nobody can measure contributes nothing — the event's own
      // salience is all that is left.
      expect(got, String(value)).toBe(0.25);
    }
  });

  it('is unchanged for every delta the engine actually writes', () => {
    expect(importanceOf(foragerAdapter, 'AteFood', {})).toBe(0.25);
    expect(importanceOf(foragerAdapter, 'AteFood', { hunger: -55 })).toBeCloseTo(0.415, 10);
    expect(importanceOf(foragerAdapter, 'WasAttacked', { safety: 25 })).toBe(0.975);
    expect(importanceOf(foragerAdapter, 'AgentDied', { safety: 100 })).toBe(1);
    expect(importanceOf(foragerAdapter, 'AteFood', { hunger: -40, safety: 12 })).toBeCloseTo(0.37, 10);
  });

  it('is clamped at the intervention edge too, so the ledger says what happened', () => {
    const exp = new Experiment({ seed: 'b3-authored', agentCount: 6 });
    exp.advance(200);
    const actor = exp.agentIds[0]!;
    const event = {
      tick: exp.tick,
      type: 'AteFood',
      actorId: actor,
      targetIds: [],
      x: 0,
      y: 0,
      payload: { needDeltas: { hunger: undefined, rest: -10 } } as Record<string, unknown>,
    };
    exp.authorEvent(event);
    expect(event.payload['needDeltas']).toEqual({ hunger: 0, rest: -10 });
    const memories = exp.minds.get(actor)!.memory.all().filter((m) => m.type === 'AteFood');
    for (const memory of memories) expect(Number.isFinite(memory.importance)).toBe(true);
  });

  /**
   * …AND THE CLAMP SAYS SO (B3 verifier, backlog 5). It rewrites a driver's
   * event in place and used to do it in total silence, so a run could differ
   * from what its driver wrote with no count anywhere non-zero. The run's own
   * gate carries it — a mind's gate counts what THAT being was handed, and an
   * authored deed is nobody's.
   */
  it('counts every unusable slot it rewrites, on the run’s own gate', () => {
    const options = { seed: 'b3-authored-count', agentCount: 6 };
    const runtime = new SimRuntime(options, scenarioFor(options));
    const host = new Interventions(runtime);
    runtime.advance(120);
    expect(runtime.gate.counts.authoredClamp).toBe(0);
    host.authorEvent({
      tick: runtime.tick,
      type: 'AteFood',
      actorId: runtime.agentIds[0]!,
      targetIds: [],
      x: 0,
      y: 0,
      // Three no being could feel, one it could, and one slot that is not a
      // need-change at all — the count is of values rewritten, not of events.
      payload: {
        needDeltas: { hunger: undefined, rest: Number.NaN, safety: -3 },
        targetNeedDeltas: { socialConnection: 'lots' },
        cause: 'violence',
      } as Record<string, unknown>,
    });
    expect(runtime.gate.counts.authoredClamp).toBe(3);
    // Nothing else on the gate moved: this is the host's edge, not a mind's.
    expect(runtime.gate.counts.undeclaredEvent).toBe(0);
    expect(runtime.gate.counts.badParam).toBe(0);
  });

  it('counts nothing when a driver writes what the engine writes', () => {
    const options = { seed: 'b3-authored-clean', agentCount: 6 };
    const runtime = new SimRuntime(options, scenarioFor(options));
    const host = new Interventions(runtime);
    runtime.advance(120);
    const payload = { needDeltas: { hunger: -40, rest: 2 } } as Record<string, unknown>;
    host.authorEvent({
      tick: runtime.tick,
      type: 'AteFood',
      actorId: runtime.agentIds[0]!,
      targetIds: [],
      x: 0,
      y: 0,
      payload,
    });
    expect(payload['needDeltas']).toEqual({ hunger: -40, rest: 2 });
    expect(runtime.gate.counts.authoredClamp).toBe(0);
  });
});

function thinkInput(world: typeof foragerAdapter): ThinkInput {
  return {
    snapshot: snapshot(world),
    recalledMemories: [],
    knowledge: [],
    relationships: new Map(),
    worldView: view(),
    goals: [],
    trigger: 'periodic',
  };
}

function snapshot(world: typeof foragerAdapter): AgentSnapshot {
  // The needs PARAGRAPH is still this world's prose and names four pressures by
  // hand — that is B5's, not B3's — so a snapshot carries those four slots
  // whatever world it is for, plus whatever that world actually declares. What
  // B3 moved is the VERB LINE, and that is what these tests read.
  const needs: Record<string, number> = { hunger: 10, rest: 10, safety: 10, socialConnection: 10 };
  for (const drive of world.drives) needs[drive.id] = 10;
  return {
    id: 1,
    name: 'Probe',
    ageTicks: 100,
    traits: { curiosity: 50, aggression: 10, compassion: 80, ambition: 40, loyalty: 60, riskTolerance: 30 },
    needs,
    health: 90,
    sick: false,
    place: at(0, 0),
    inventory: {},
    context: {},
  };
}

function view(): WorldView {
  return { tick: 0, night: false, season: 'spring', agents: [], resources: [], structures: [] };
}
