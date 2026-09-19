import { ThinkOutcomeCounters } from '../consciousness/LlmMind.js';
import type { SimEvent } from '../contract/types.js';

const EVENT_LOG_CAP = 400;

export class RunCounters {
  eventCount = 0;
  birthCount = 0;
  readonly eventLog: SimEvent[] = [];
  readonly deathsByCause: Record<string, number> = {};
  exchangeCount = 0;
  conflictCount = 0;
  sicknessCount = 0;
  shareCount = 0;
  seedPlantCount = 0;
  sproutCount = 0;
  buildCount = 0;
  /** Phase 3 Exp 1: per-agent count of crafts COMPLETED (actor of a Crafted event). */
  readonly craftsByAgent = new Map<number, number>();
  /**
   * What this run's thinks actually did. Fed by whoever subscribes to
   * `observeThinkOutcomes` for this run's backend — the W1-E runner does, per
   * arm, so an A/B attests degradation per arm rather than per process.
   */
  readonly thinks = new ThinkOutcomeCounters();

  observe(event: SimEvent): void {
    this.eventCount++;
    this.eventLog.push(event);
    if (this.eventLog.length > EVENT_LOG_CAP) this.eventLog.shift();
    switch (event.type) {
      case 'AgentDied': {
        const cause = (event.payload['cause'] as string | undefined) ?? 'unknown';
        this.deathsByCause[cause] = (this.deathsByCause[cause] ?? 0) + 1;
        break;
      }
      case 'GaveItem':
        this.exchangeCount++;
        break;
      case 'AttackedAgent':
        this.conflictCount++;
        break;
      case 'BecameSick':
        this.sicknessCount++;
        break;
      case 'SeedDeposited':
        this.seedPlantCount++;
        break;
      case 'PlantSprouted':
        this.sproutCount++;
        break;
      case 'BuiltStructure':
        this.buildCount++;
        break;
      case 'Crafted':
        this.craftsByAgent.set(event.actorId, (this.craftsByAgent.get(event.actorId) ?? 0) + 1);
        break;
      case 'UtteranceSpoken': {
        const u = event.payload['utterance'] as { speechAct?: string } | undefined;
        if (u?.speechAct === 'share-knowledge') this.shareCount++;
        break;
      }
      default:
        break;
    }
  }
}
