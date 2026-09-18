import type { AgentMind } from '../../agent/AgentMind.js';
import { mutateNarrative } from '../../narrative/NarrativeStore.js';
import type { SocietyHost, SocietySystem } from './SocietySystem.js';

const CO_PRESENCE_INTERVAL = 150; // how often time-spent-together builds bonds
const CO_PRESENCE_RANGE = 13; // how close counts as "together"

/** Bonds form from time spent together — preferred individuals, then clusters. */
export class CoPresenceSystem implements SocietySystem {
  readonly intervalTicks = CO_PRESENCE_INTERVAL;

  constructor(private readonly host: SocietyHost) {}

  step(tick: number): void {
    const host = this.host;
    const live: { id: number; mind: AgentMind; x: number; y: number }[] = [];
    for (const id of host.agentIds) {
      const mind = host.minds.get(id);
      if (!mind || !host.agentBody(id)?.alive) continue;
      const t = host.positionOf(id)!;
      live.push({ id, mind, x: t.x, y: t.y });
    }
    // `live` is ascending by id (agentIds is), so taking each being's living
    // neighbours ascending and keeping only the ones after it visits exactly
    // the pairs — in exactly the order — the old O(n²) double loop did.
    const byId = new Map(live.map((l) => [l.id, l]));
    for (const a of live) {
      for (const near of host.world.spatial.within('GahallianBody', a.x, a.y, CO_PRESENCE_RANGE)) {
        if (near.id <= a.id) continue;
        const b = byId.get(near.id);
        if (!b) continue;
        a.mind.relationships.coPresence(b.id, tick);
        b.mind.relationships.coPresence(a.id, tick);
        // Companions retell their stories — and a retelling can DISTORT
        // (a detail lost, a beast made greater). Drift accumulates along the
        // chain, so a memory drifts toward myth, and different tribes end up
        // telling different versions of the same event.
        // The retelling carries the story's own age (sa.firstTick), not the
        // hour it was told — an old tale stays old in a new mouth.
        if ((tick + a.id + b.id) % 3 === 0) {
          const sa = a.mind.narratives.pickToRetell(tick);
          if (sa) b.mind.narratives.remember(sa.id, mutateNarrative(sa.text, (b.id * 31 + sa.text.length) >>> 0), sa.x, sa.y, sa.firstTick, false);
          const sb = b.mind.narratives.pickToRetell(tick);
          if (sb) a.mind.narratives.remember(sb.id, mutateNarrative(sb.text, (a.id * 31 + sb.text.length) >>> 0), sb.x, sb.y, sb.firstTick, false);
        }
      }
    }
  }
}
