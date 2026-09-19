import type { World } from '../core/World.js';
import type { PerceptionSystem } from '../body/PerceptionSystem.js';
import type { GahallianBody } from '../body/GahallianBody.js';
import type { AgentMind } from '../agent/AgentMind.js';
import type { RuleIntern } from '../knowledge/KnowledgeStore.js';
import { memoryFromEvent } from '../memory/memoryFromEvent.js';
import type { SimEvent } from '../contract/types.js';
import type { RunCounters } from './RunCounters.js';
import type { NarrativeAuthor } from './society/SocietySystem.js';

/** Just enough of `SimEventBus` to register a listener — so a test can watch
 *  the registrations themselves, which is the only way the order is pinned. */
export interface ListenerSink {
  on(listener: (event: SimEvent) => void): () => void;
}

export interface EventPipelineHost {
  readonly world: World;
  readonly bus: ListenerSink;
  readonly perception: PerceptionSystem;
  readonly minds: ReadonlyMap<number, AgentMind>;
  readonly counters: RunCounters;
  agentBody(id: number): GahallianBody | undefined;
}

export interface EventPipelineOptions {
  /** Whose tale an event becomes, if any. */
  readonly narrator: NarrativeAuthor;
  /** Cycle 13 A/B: does respect grow from witnessed competence? (prestige) */
  readonly leadership: boolean;
  /** Shared rule strings for the dead — see RuleIntern. */
  readonly tombstoneRules: RuleIntern;
  /** The recorder's bracketing passes, or null when nothing is recorded. */
  readonly recorder: { observeBefore: (e: SimEvent) => void; observeAfter: (e: SimEvent) => void } | null;
}

/**
 * ONE GLOBAL EVENT, N PARTIAL VIEWS — the pipeline that turns what happened
 * into what each being remembers about it.
 *
 * LISTENER ORDER IS LOAD BEARING and this function is the only place it is
 * decided. Registration order is firing order (`EventBus`), and it must be:
 *
 *  1. `recorder.observeBefore` — "who already knew this?" is only answerable
 *     before the witnesses hear an utterance.
 *  2. the world's own pass — counters, then the story, then every witness's
 *     memory / narrative / respect, then the actor's own copy of the story.
 *  3. `recorder.observeAfter`  — "who took it in?" is only answerable after.
 *  4. `entomb` — LAST, so every other reader of a being that just died has
 *     already run. From here it can never think again, so the tiers only a
 *     thinking mind uses are released.
 *
 * Position 4 is currently a SAFETY MARGIN, not a live dependency: no reader
 * above touches what `entomb` frees. `witnessesOf` returns only the living, so
 * the dying being never takes a memory from its own death; the actor's own
 * story write lands in `narratives`, which survives entombing; and the
 * recorder's window (`RecorderWorld`) exposes only body / knowledge /
 * narratives / name / generation / day — none of them freed. Moving `entomb`
 * first therefore changes no fingerprint today, and would silently start
 * mattering the moment any of those readers grows. So the order is pinned
 * STRUCTURALLY instead of behaviourally: `test/runner-listener-order.test.ts`
 * captures the registrations in order and asserts what each of the four is.
 */
export function installEventPipeline(host: EventPipelineHost, opts: EventPipelineOptions): void {
  if (opts.recorder) host.bus.on(opts.recorder.observeBefore);

  host.bus.on((event) => {
    host.counters.observe(event);

    const story = opts.narrator.storyFor(event);
    for (const witnessId of host.perception.witnessesOf(host.world, event)) {
      const mind = host.minds.get(witnessId);
      if (!mind) continue;
      const witness = host.world.getEntity(witnessId);
      if (!witness) continue;
      const t = witness.components['Transform2D'] as { x: number; y: number };
      const context = host.perception.contextAt(host.world, t.x, t.y, event.tick);
      const memory = memoryFromEvent(event, witnessId, context);
      if (memory) mind.observe(memory);
      // A memorable event becomes a STORY the witness carries.
      if (story) mind.narratives.remember(story.id, story.text, story.x, story.y, event.tick, true);
      // PRESTIGE (Cycle 13): seeing a being do something competent — slay a
      // predator, raise a shelter — earns it respect. Nothing assigns a leader;
      // respect simply accrues to the visibly capable, and (via the social pull)
      // others come to orbit them. Respect decays, so prestige must be re-earned.
      if (opts.leadership && witnessId !== event.actorId) {
        if (event.type === 'KilledPredator') mind.relationships.gainRespect(event.actorId, 5, event.tick);
        else if (event.type === 'BuiltStructure' && event.payload['buildKind'] === 'shelter') mind.relationships.gainRespect(event.actorId, 3, event.tick);
      }
    }
    if (story) host.minds.get(event.actorId)?.narratives.remember(story.id, story.text, story.x, story.y, event.tick, true);
  });

  if (opts.recorder) host.bus.on(opts.recorder.observeAfter);

  host.bus.on((event) => {
    if (event.type !== 'AgentDied') return;
    // The BODY decides, not the event. `authorEvent` lets a driver stage a
    // death that nothing in the world performed; entombing on the event alone
    // would leave that being alive, amnesiac and — with its miners gone —
    // unable to ever learn again.
    const body = host.agentBody(event.actorId);
    if (body && !body.alive) host.minds.get(event.actorId)?.entomb(opts.tombstoneRules);
  });
}
