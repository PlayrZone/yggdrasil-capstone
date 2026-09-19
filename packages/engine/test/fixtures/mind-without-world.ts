/**
 * THE MIND, COMPILED IN A REPOSITORY WHERE THE FORAGER WORLD DOES NOT EXIST.
 *
 * `test/mind-type-graph.test.ts` compiles this file with a compiler host that
 * reports every path under `src/worlds/` as missing. If any module the mind
 * needs still reached that world — as a value OR as a type, which
 * `verbatimModuleSyntax` erases from the emit but never from resolution — this
 * file would not resolve and the test would see TS2307.
 *
 * It touches every mind directory, because the proof is about the whole brain,
 * not about `AgentMind`'s own imports.
 *
 * W1-B3 adds the three files that sat in NEITHER net (B2 verifier, backlog 1):
 * `schema.ts`, `LlmMind.ts` and `MockMindBackend.ts`. The last two are exactly
 * the files whose silent forager default B2 deleted, and a barrel or dynamic
 * import of the world in either used to leave guard AND proof green. They are
 * built here now, so the compiler has to resolve their imports too.
 *
 * The W1-B4 verifier (backlog 11) found the last one still outside every net:
 * `FireworksMindBackend.ts`, the PAID backend, which nothing compiled against a
 * worldless repository. It is built here now too — constructed, never called;
 * the proof is about resolution, and it holds no key.
 */
import { AgentMind } from '../../src/agent/AgentMind.js';
import { WorldGate } from '../../src/contract/gate.js';
import type { KnowledgeRule, MemoryRecord, SimEvent } from '../../src/contract/types.js';
import { MemoryStream } from '../../src/memory/MemoryStream.js';
import { importanceOf } from '../../src/memory/importance.js';
import { memoryFromEvent } from '../../src/memory/memoryFromEvent.js';
import { ContextMiner } from '../../src/learning/ContextMiner.js';
import { CraftObservationMiner } from '../../src/learning/CraftObservationMiner.js';
import { OutcomeMiner } from '../../src/learning/OutcomeMiner.js';
import { SocialMiner } from '../../src/learning/SocialMiner.js';
import { SuccessionMiner } from '../../src/learning/SuccessionMiner.js';
import { ruleKey } from '../../src/learning/ruleKey.js';
import { KnowledgeStore } from '../../src/knowledge/KnowledgeStore.js';
import { RelationshipStore } from '../../src/relationships/RelationshipStore.js';
import { NarrativeStore } from '../../src/narrative/NarrativeStore.js';
import { FireworksMindBackend } from '../../src/consciousness/FireworksMindBackend.js';
import { LlmMind } from '../../src/consciousness/LlmMind.js';
import { MockMindBackend } from '../../src/consciousness/MockMindBackend.js';
import { policyFor } from '../../src/consciousness/policy.js';
import { parseMindOutput } from '../../src/consciousness/schema.js';
import { buildThinkPrompt } from '../../src/consciousness/prompt.js';
import { makeToyWorld } from './toyAdapter.js';

const world = makeToyWorld('proof', 0.5);

export function inhabit(): number {
  const mind = new AgentMind(7, world, { craftLearning: true });
  const event: SimEvent = {
    tick: 1,
    type: 'GaveItem',
    actorId: 9,
    targetIds: [7],
    x: 0,
    y: 0,
    payload: {},
  };
  const context = { nearWater: true, night: false, inShelter: false, elevationBand: 0 };
  // WHERE IT HAPPENED comes from the edge now, and a mind's only source for
  // one with nothing behind it is the world's own `unplaced` (W1-B4 round 3).
  const memory = memoryFromEvent(world, event, 7, context, world.space.unplaced, new WorldGate());
  if (memory) mind.observe(memory);
  mind.consolidate(2);
  mind.injectIdea('a thought', 3, 'AteFood', context);

  const rule: KnowledgeRule = { kind: 'succession', causeType: 'AteFood', effectType: 'GaveItem' };
  const stores = [new KnowledgeStore(), new RelationshipStore(world), new NarrativeStore()] as const;
  const learners = [
    new ContextMiner(world),
    new OutcomeMiner(world),
    new SocialMiner(world),
    new SuccessionMiner(world),
    new CraftObservationMiner(world),
  ];
  const stream = new MemoryStream(8);
  const stored: MemoryRecord | undefined = memory ? stream.append(memory) : undefined;
  for (const learner of learners) if (stored) learner.observe(stored);

  // The slow path, built for a world this compiler cannot see: the backend, the
  // mind that drives it, the prompt it composes and the parser that reads the
  // reply. Not CALLED — the proof is about resolution, not behaviour.
  // writeReply is what a mock is HANDED instead of a codec (W1-B4 round 4),
  // and this is the proof that the seam is narrow enough: a compilation with no
  // worlds/ in it can still build one, because a function from a decision to
  // text names nothing about space.
  const backend = new MockMindBackend({ world, writeReply: () => '{}' });
  const paid = new FireworksMindBackend({ apiKey: '', model: 'none' });
  const llm = new LlmMind(backend, { world, fallback: policyFor(world) });
  const parsed = parseMindOutput('{"plan":[{"kind":"Dawdle"}]}', world);

  return (
    stores.length +
    learners.length +
    ruleKey(rule).length +
    importanceOf(world, 'AteFood', {}) +
    // The mind asks the world about its places and never opens one: how far,
    // which way, and whether two are the same place (W1-B4).
    world.space.distance(world.space.unplaced, world.space.unplaced) +
    world.space.direction(world.space.unplaced, world.space.unplaced).length +
    (world.space.equal(world.space.unplaced, world.space.unplaced) ? 1 : 0) +
    mind.gate.counts.undeclaredEvent +
    llm.modelId.length +
    paid.modelId.length +
    parsed.plan.length +
    buildThinkPrompt(mind.buildThinkInput(snapshotOf(), viewOf(), 'periodic'), world).user.length
  );
}

function snapshotOf(): Parameters<AgentMind['buildThinkInput']>[0] {
  return {
    id: 7,
    name: 'proof',
    ageTicks: 0,
    traits: { curiosity: 0, aggression: 0, compassion: 0, ambition: 0, loyalty: 0, riskTolerance: 0 },
    needs: { hunger: 0, rest: 0 },
    health: 100,
    sick: false,
    // A place in a world this compiler cannot see, minted by that world. The
    // mind holds it and can read nothing off it (W1-B4).
    place: world.space.unplaced,
    inventory: {},
    context: {},
  };
}

function viewOf(): Parameters<AgentMind['buildThinkInput']>[1] {
  return { tick: 0, night: false, season: 'always', agents: [], resources: [], structures: [] };
}
