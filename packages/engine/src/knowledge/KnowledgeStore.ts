import type { KnowledgeRecord, KnowledgeRule, KnowledgeStatus } from '../contract/types.js';
import type { EvidenceReport } from '../learning/ILearner.js';
import { ruleKey } from '../learning/ruleKey.js';
import { renderStatement } from '../learning/templates.js';

/**
 * A rule entering a store is COPIED: one utterance reaches every witness by
 * reference, so without this the whole audience — and the speaker — would hold
 * a single object and one being's belief could be edited through another's.
 * `craft-recipe` nests `inputs`, so a spread alone is not enough.
 */
export function copyRule(rule: KnowledgeRule): KnowledgeRule {
  return rule.kind === 'craft-recipe' ? { ...rule, inputs: { ...rule.inputs } } : { ...rule };
}

/** Lifecycle thresholds — pure function of counts + confidence. */
const HELD_MIN_EVIDENCE = 4;
const HELD_MIN_CONFIDENCE = 0.55;
const CONTESTED_MIN_CONFIDENCE = 0.3;
const ABANDON_MIN_OBSERVATIONS = 6;

function statusOf(evidence: number, contradictions: number, confidence: number): KnowledgeStatus {
  const observations = evidence + contradictions;
  if (observations >= ABANDON_MIN_OBSERVATIONS && confidence < CONTESTED_MIN_CONFIDENCE) {
    return 'abandoned';
  }
  if (evidence >= HELD_MIN_EVIDENCE) {
    if (confidence >= HELD_MIN_CONFIDENCE) return 'held';
    return confidence >= CONTESTED_MIN_CONFIDENCE ? 'contested' : 'abandoned';
  }
  return 'hypothesis';
}

/** How much a listener trusts hearsay: scaled by trust in the speaker. */
function testimonyConfidence(speakerConfidence: number, trust01: number): number {
  return speakerConfidence * (0.3 + 0.5 * trust01);
}

/**
 * Per-agent knowledge base — the RESULT of learning, separate from memory
 * (general, not episodic) and from the miners (output, not process).
 * Strictly subjective: no global store exists anywhere; population-level
 * "shared knowledge" is an Observatory measurement, never a mechanism.
 *
 * Knowledge may be correct, incorrect, or incomplete. There is no truth
 * oracle here — an abandoned superstition is a research finding, so
 * abandoned records are kept, not deleted.
 */
export class KnowledgeStore {
  private records = new Map<string, KnowledgeRecord>();
  private nextId = 1;

  /** Apply a miner's evidence report. Own evidence overrides testimony. */
  applyEvidence(report: EvidenceReport, tick: number): KnowledgeRecord {
    const key = ruleKey(report.rule);
    const existing = this.records.get(key);
    const confidence = clamp01(report.confidence);
    if (existing) {
      const reinforced = report.evidenceCount > existing.evidenceCount;
      existing.confidence = confidence;
      existing.evidenceCount = report.evidenceCount;
      existing.contradictionCount = report.contradictionCount;
      existing.sourceMemoryIds = report.sourceMemoryIds;
      existing.status = statusOf(report.evidenceCount, report.contradictionCount, confidence);
      if (reinforced) existing.lastReinforced = tick;
      // First-hand evidence upgrades hearsay into experience.
      if (existing.origin === 'testimony' && report.evidenceCount > 0) {
        existing.origin = 'experience';
      }
      return existing;
    }
    const record: KnowledgeRecord = {
      id: this.nextId++,
      ruleKey: key,
      rule: report.rule,
      statement: renderStatement(report.rule),
      confidence,
      evidenceCount: report.evidenceCount,
      contradictionCount: report.contradictionCount,
      sourceMemoryIds: report.sourceMemoryIds,
      status: statusOf(report.evidenceCount, report.contradictionCount, confidence),
      origin: 'experience',
      firstFormed: tick,
      lastReinforced: tick,
    };
    this.records.set(key, record);
    return record;
  }

  /**
   * Intake a rule heard from another agent. Confidence is discounted by
   * trust in the speaker — testimony is never inherited at face value.
   * If the listener already holds first-hand knowledge of this rule, the
   * hearsay changes nothing (own evidence wins).
   */
  intakeTestimony(
    rule: KnowledgeRule,
    speakerConfidence: number,
    trust01: number,
    tick: number,
    toldBy: number,
    sourceMemoryId: number,
  ): KnowledgeRecord {
    const key = ruleKey(rule);
    const existing = this.records.get(key);
    if (existing) {
      if (existing.origin === 'testimony') {
        // Repeated hearsay reinforces, with diminishing weight.
        const boosted = clamp01(
          existing.confidence + (testimonyConfidence(speakerConfidence, trust01) - existing.confidence) * 0.3,
        );
        existing.confidence = boosted;
        existing.lastReinforced = tick;
        existing.status = boosted >= HELD_MIN_CONFIDENCE ? 'held' : 'hypothesis';
      }
      return existing;
    }
    const confidence = clamp01(testimonyConfidence(speakerConfidence, trust01));
    const record: KnowledgeRecord = {
      id: this.nextId++,
      ruleKey: key,
      rule: copyRule(rule),
      statement: renderStatement(rule),
      confidence,
      evidenceCount: 0,
      contradictionCount: 0,
      sourceMemoryIds: [sourceMemoryId],
      status: confidence >= HELD_MIN_CONFIDENCE ? 'held' : 'hypothesis',
      origin: 'testimony',
      testimonyFrom: toldBy,
      firstFormed: tick,
      lastReinforced: tick,
    };
    this.records.set(key, record);
    return record;
  }

  get(key: string): KnowledgeRecord | undefined {
    return this.records.get(key);
  }

  /** Held knowledge — what prompts and reflex modulation may consume. */
  held(): KnowledgeRecord[] {
    return [...this.records.values()]
      .filter((r) => r.status === 'held')
      .sort((a, b) => b.confidence - a.confidence || a.id - b.id);
  }

  all(): KnowledgeRecord[] {
    return [...this.records.values()].sort((a, b) => a.id - b.id);
  }
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}
