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
  const memory = memoryFromEvent(world, event, 7, context, new WorldGate());
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

  return (
    stores.length +
    learners.length +
    ruleKey(rule).length +
    importanceOf(world, 'AteFood', {}) +
    mind.gate.counts.undeclaredEvent
  );
}
