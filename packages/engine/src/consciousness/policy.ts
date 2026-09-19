import { actionForCore } from '../contract/actions.js';
import type { ReflexPolicy, WorldAdapter } from '../contract/adapter.js';
import type { MindOutput } from '../contract/types.js';

/**
 * WHAT CARRIES A BEING BETWEEN SLOW THOUGHTS (W1-B3).
 *
 * A world declares its own instinct (`WorldAdapter.reflexPolicy`) and the mind
 * calls it. A world that declares none is LEGAL — the brief's principle 3 — and
 * this is what happens then: the being waits, by taking the action its world
 * binds to the core verb `Wait`. It is the smallest honest answer. Inventing
 * something for it to do would be this engine having an opinion about a world it
 * has never seen, and defaulting to another world's policy is exactly the bug
 * W1-B1 found in `LlmMind` and `MockMindBackend`.
 *
 * A world with no `Wait` action at all gets an empty plan, which its body will
 * read as "nothing decided" — still the being's own world answering, not ours.
 */
export class WaitingMind implements ReflexPolicy {
  private readonly waiting: MindOutput;

  constructor(world: WorldAdapter) {
    const wait = actionForCore(world, 'Wait');
    this.waiting = { goals: [], plan: wait ? [{ kind: wait.id }] : [], utterances: [] };
  }

  think(): MindOutput {
    // A fresh plan array every time: the body owns what it is handed, and two
    // beings must never end up holding one.
    return { goals: [], plan: this.waiting.plan.map((intent) => ({ ...intent })), utterances: [] };
  }
}

/** The policy this world hands out, or waiting. Never another world's. */
export function policyFor(world: WorldAdapter): ReflexPolicy {
  return world.reflexPolicy ? world.reflexPolicy(world) : new WaitingMind(world);
}
