/* eslint-disable */
import type { RuntimeView } from '../../src/runner/RuntimeView.js';
import { at } from '../../src/worlds/forager/space.js';

/**
 * NOT A RUNTIME TEST — a type-level one. `runner-view-readonly.test.ts`
 * compiles this file with the TypeScript API and asserts it produces NO
 * diagnostics at all. Every `@ts-expect-error` below must therefore still be
 * an error: the moment one of these mutations becomes legal, tsc reports the
 * directive as unused (TS2578) and the test fails.
 *
 * The verifier compiled 16 mutations through the old `RuntimeView`, `entomb()`
 * among them, because it handed out the real `AgentMind` and `GahallianBody`.
 * It now hands out projections. This is the list.
 */

// ── The instrument MUST still be able to read. If any of these breaks, the
//    view has been narrowed past usefulness and this file stops compiling.
export function stillReadable(view: RuntimeView): number {
  let n = view.tick + view.agentIds.length + view.births.length + view.aliveCount();
  n += view.conscious.size + view.lastThought.size + view.eventLog.length;
  n += view.nameOf(1).length + view.generationOf(1);
  const body = view.agentBody(1);
  if (body) n += body.needs.hunger + body.traits.curiosity + (body.inventory.wood ?? 0) + (body.alive ? 1 : 0);
  const at = view.positionOf(1);
  if (at) n += at.x + at.y;
  const mind = view.minds.get(1);
  if (mind) {
    for (const k of mind.knowledge.all()) n += k.confidence + k.evidenceCount + k.statement.length;
    for (const k of mind.knowledge.held()) n += k.id;
    n += mind.knowledge.get('craft:spear')?.id ?? 0;
    for (const [, r] of mind.relationships.asMap()) n += r.trust + r.respect;
    for (const s of mind.narratives.all()) n += s.timesHeard + s.text.length;
    for (const [, c] of mind.memory.experienceCounts()) n += c;
    for (const g of mind.goals) n += g.description.length;
  }
  view.each('Animal', (e) => void (n += e.id));
  return n;
}

// ── …and MUST NOT be able to write. ──────────────────────────────────────────
export function mutations(view: RuntimeView): void {
  const mind = view.minds.get(1)!;
  const body = view.agentBody(1)!;

  // 1–7: the mind's mutators do not exist on the projection at all.
  // @ts-expect-error a report may not end a life
  mind.entomb();
  // @ts-expect-error a report may not write a memory
  mind.observe({});
  // @ts-expect-error a report may not run the miners
  mind.consolidate(0);
  // @ts-expect-error a report may not whisper to a being
  mind.injectIdea('x', 0);
  // @ts-expect-error a report may not apply a decision
  mind.applyOutput({});
  // @ts-expect-error a report may not make a being think
  mind.think({}, {}, 'periodic');
  // @ts-expect-error the miners are not the instrument's to see
  mind.learners;

  // 8–12: goals and knowledge are readable, never writable.
  // @ts-expect-error the goal list is not a place to add one
  mind.goals.push({ id: 1, description: 'x', createdTick: 0 });
  // @ts-expect-error a goal is not the instrument's to reword
  mind.goals[0]!.description = 'x';
  // @ts-expect-error a belief is not the instrument's to strengthen
  mind.knowledge.all()[0]!.confidence = 1;
  // @ts-expect-error evidence comes from the miners, never from a measurement
  mind.knowledge.applyEvidence({}, 0);
  // @ts-expect-error testimony comes from a mouth, never from a report
  mind.knowledge.intakeTestimony({}, 1, 1, 0, 2);

  // 13–16: relationships. `asMap()` hands out the store's LIVE map.
  // @ts-expect-error the live map is not the instrument's to extend
  mind.relationships.asMap().set(1, {});
  // @ts-expect-error …nor to edit through
  mind.relationships.asMap().get(1)!.trust = 99;
  // @ts-expect-error prestige is earned in the world, not granted by analysis
  mind.relationships.gainRespect(1, 5, 0);
  // @ts-expect-error decay is the mind's own clock
  mind.relationships.decay(0);

  // 17–19: narratives.
  // @ts-expect-error a report may not put a story in a head
  mind.narratives.remember('a', 'b', at(0, 0), 0, true);
  // @ts-expect-error …nor seed one
  mind.narratives.seed('a', 'b', at(0, 0), 0, 1);
  // @ts-expect-error …nor rewrite the words of one
  mind.narratives.all()[0]!.text = 'x';

  // 20–21: the memory stream is a tally here, not a stream.
  // @ts-expect-error the episodic tier is not exposed
  mind.memory.append({});
  // @ts-expect-error …and cannot be freed
  mind.memory.release();

  // 22–25: the body is a projection of what a report reads.
  // @ts-expect-error a report may not kill
  body.alive = false;
  // @ts-expect-error …nor feed
  body.needs.hunger = 0;
  // @ts-expect-error …nor provision
  body.inventory.wood = 9;
  // @ts-expect-error the plan is the body's business
  body.plan;

  // 26–33: the containers themselves.
  // @ts-expect-error the roster is not the instrument's to extend
  view.agentIds.push(1);
  // @ts-expect-error the kinship ledger is append-only, by the runtime
  view.births.push({ child: 1, parents: [1, 2], tick: 0 });
  // @ts-expect-error …and its rows are not editable
  view.births[0]!.tick = 0;
  // @ts-expect-error consciousness is granted by an intervention, not a report
  view.conscious.add(1);
  // @ts-expect-error a thought is observed, never written
  view.lastThought.set(1, 'x');
  // @ts-expect-error the event log is the runtime's
  view.eventLog.push({ tick: 0, type: 'AteFood', actorId: 1, targetIds: [], x: 0, y: 0, payload: {} });
  // @ts-expect-error …and its rows are history
  view.eventLog[0]!.tick = 0;
  // @ts-expect-error relocating is an intervention
  view.positionOf(1)!.x = 0;

  // 34–36: the clock, the registry, and a component bag.
  // @ts-expect-error a report may not move time
  view.tick = 5;
  // @ts-expect-error …nor admit a being
  view.minds.set(1, mind);
  view.each('Animal', (e) => {
    // @ts-expect-error …nor write through an observed entity
    e.components['Animal'] = null;
  });
}
