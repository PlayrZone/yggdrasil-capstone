import type { SimEvent } from '../../contract/types.js';
import { at as placeAt } from '../../worlds/forager/space.js';
import { classicGeography } from '../../world/geography.js';
import type { WorldGeography } from '../../world/geography.js';
import type { AuthoredStory, NarrativeAuthor } from './SocietySystem.js';

/** What the author needs from the host: who a being is called. */
export interface NarrationHost {
  nameOf(agentId: number): string;
}

/**
 * Turn a memorable event into a STORY (or null). Only dramatic, relatively
 * rare events become narratives — a slaying, a violent death, the raising of
 * a home — the things a people would actually retell. Keyed so every witness
 * of the same event remembers the same story.
 */
export class ForagerNarrator implements NarrativeAuthor {
  constructor(
    private readonly host: NarrationHost,
    /** Which map's region names the tales are told in. */
    private readonly geography: WorldGeography = classicGeography,
  ) {}

  storyFor(event: SimEvent): AuthoredStory | null {
    const bucket = Math.floor(event.tick / 300);
    const region = this.geography.regionAt(event.x, event.y);
    const who = this.host.nameOf(event.actorId);
    const at = { place: placeAt(event.x, event.y) };
    switch (event.type) {
      case 'KilledPredator':
        return { id: `slew:${event.actorId}:${bucket}`, text: `${who} slew a ${event.payload['predator'] ?? 'beast'} in the ${region}`, ...at };
      case 'AgentDied': {
        const cause = String(event.payload['cause'] ?? '');
        if (cause !== 'violence') return null; // only a dramatic death is a story
        return { id: `fell:${event.actorId}:${bucket}`, text: `${who} fell to violence in the ${region}`, ...at };
      }
      case 'BuiltStructure':
        if (event.payload['buildKind'] !== 'shelter') return null;
        return { id: `home:${event.actorId}:${bucket}`, text: `${who} raised a home in the ${region}`, ...at };
      case 'AttackedAgent': {
        const victim = this.host.nameOf(event.targetIds[0] ?? 0);
        return { id: `attack:${event.actorId}:${bucket}`, text: `${who} attacked ${victim} in the ${region}`, ...at };
      }
      default:
        return null;
    }
  }
}
