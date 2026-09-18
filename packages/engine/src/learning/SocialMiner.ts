import type { MemoryRecord } from '../contract/types.js';
import type { EvidenceReport, ILearner, ProvenanceLevel } from './ILearner.js';
import { ProvenanceSample } from './ILearner.js';

interface PartnerTallies {
  interactions: number;
  myGives: number;
  theirGives: number;
  /** My gives answered by a give from them within the window. */
  reciprocations: number;
  attacks: number;
  /** Ticks of my unanswered gives, awaiting reciprocation. */
  openGives: number[];
  provenance: ProvenanceSample;
}

const RECIPROCATION_WINDOW = 1200;

/**
 * Mines per-partner interaction contingency: who gives back, who gives
 * unprompted, who attacks. The resulting knowledge ("Agent #7 is
 * dangerous") is the interpretive layer consciousness reads; the fast
 * scalar relationship records remain the reflex substrate. No "friend"
 * or "enemy" concept exists here — only observed behavior patterns.
 */
export class SocialMiner implements ILearner {
  constructor(private readonly provenanceLevel: ProvenanceLevel = 'compact') {}

  private partners = new Map<number, PartnerTallies>();

  private talliesFor(partnerId: number): PartnerTallies {
    let t = this.partners.get(partnerId);
    if (!t) {
      t = {
        interactions: 0,
        myGives: 0,
        theirGives: 0,
        reciprocations: 0,
        attacks: 0,
        openGives: [],
        provenance: new ProvenanceSample(this.provenanceLevel),
      };
      this.partners.set(partnerId, t);
    }
    return t;
  }

  observe(memory: MemoryRecord): void {
    for (const partnerId of memory.subjects) {
      const t = this.talliesFor(partnerId);
      switch (memory.type) {
        case 'GaveItem': {
          t.interactions++;
          t.myGives++;
          t.openGives.push(memory.tick);
          t.provenance.add(memory);
          break;
        }
        case 'ReceivedItem': {
          t.interactions++;
          t.theirGives++;
          t.provenance.add(memory);
          const open = t.openGives.findIndex((tick) => memory.tick - tick <= RECIPROCATION_WINDOW);
          if (open !== -1) {
            t.openGives.splice(open, 1);
            t.reciprocations++;
          }
          break;
        }
        case 'WasAttacked': {
          t.interactions++;
          t.attacks++;
          t.provenance.add(memory);
          break;
        }
        case 'UtteranceSpoken':
        case 'AttackedAgent': {
          t.interactions++;
          break;
        }
        default:
          break;
      }
      // Expire unanswered gives that fell out of the window.
      t.openGives = t.openGives.filter((tick) => memory.tick - tick <= RECIPROCATION_WINDOW);
    }
  }

  consolidate(): EvidenceReport[] {
    const reports: EvidenceReport[] = [];
    for (const [partnerId, t] of this.partners) {
      if (t.myGives >= 2) {
        reports.push({
          rule: { kind: 'social-contingency', partnerId, pattern: 'reciprocates' },
          confidence: (t.reciprocations + 1) / (t.myGives + 2),
          evidenceCount: t.reciprocations,
          contradictionCount: t.myGives - t.reciprocations,
          sourceMemoryIds: t.provenance.ids(),
          provenance: t.provenance.snapshots(),
        });
      }
      if (t.theirGives >= 2) {
        reports.push({
          rule: { kind: 'social-contingency', partnerId, pattern: 'generous' },
          confidence: t.theirGives / (t.theirGives + 1),
          evidenceCount: t.theirGives,
          contradictionCount: 0,
          sourceMemoryIds: t.provenance.ids(),
          provenance: t.provenance.snapshots(),
        });
      }
      if (t.attacks >= 1) {
        reports.push({
          rule: { kind: 'social-contingency', partnerId, pattern: 'dangerous' },
          confidence: t.attacks / (t.attacks + 1),
          evidenceCount: t.attacks,
          contradictionCount: 0,
          sourceMemoryIds: t.provenance.ids(),
          provenance: t.provenance.snapshots(),
        });
      }
    }
    return reports;
  }
}
