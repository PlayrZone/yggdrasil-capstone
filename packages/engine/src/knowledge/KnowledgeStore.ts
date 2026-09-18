import type { EvidenceSnapshot, KnowledgeRecord, KnowledgeRule, KnowledgeStatus, MemoryRecord } from '../contract/types.js';
import type { EvidenceReport } from '../learning/ILearner.js';
import { snapshotOf } from '../learning/ILearner.js';
import type { ProvenanceLevel } from '../learning/ILearner.js';
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
 * A stable, order-independent rendering of everything being shared. Rules are
 * flat or one level deep (`craft-recipe.inputs`) and hold no arrays, so sorted
 * keys are enough to make equal content produce one string and different
 * content produce two.
 */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  const o = value as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
    .join(',')}}`;
}

/**
 * Canonical instances of the three parts a rule determines — `ruleKey`, the
 * `rule` object and the rendered `statement`. Every being that holds a belief
 * computes them separately, which is right while they live and may each be
 * written independently, and pure duplication once a store is a tombstone
 * nothing will ever write again.
 *
 * Keyed on the full CONTENT of all three, never on `ruleKey` alone: `ruleKey`
 * is deliberately coarser than the value it identifies — a `craft-recipe` keys
 * on its output, so "one belief however its inputs are remembered" — and
 * interning on a key coarser than the value would hand the second tombstone the
 * first one's `inputs`, silently rewriting what a dead being believed. Two
 * tombstones share only when they agree on every byte, so no value can change.
 *
 * One table per Experiment, never a module global: it retains one entry per
 * distinct belief ever held by someone who died, which must die with the run
 * rather than accumulate across every run in a process.
 */
export class RuleIntern {
  private readonly canonical = new Map<string, { ruleKey: string; rule: KnowledgeRule; statement: string }>();

  /** Point the record at the shared instances, minting them if it is first. */
  adopt(record: KnowledgeRecord): void {
    // Length-prefixed rather than delimited: no separator can be mistaken
    // for content, and every byte of all three parts takes part.
    const content = `${canonical(record.rule)}|${record.ruleKey.length}|${record.ruleKey}|${record.statement}`;
    const shared = this.canonical.get(content);
    if (!shared) {
      this.canonical.set(content, { ruleKey: record.ruleKey, rule: record.rule, statement: record.statement });
      return; // this record already IS the canonical one
    }
    record.ruleKey = shared.ruleKey;
    record.rule = shared.rule;
    record.statement = shared.statement;
  }

  /** Distinct belief contents interned — for the bench. */
  get size(): number {
    return this.canonical.size;
  }
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
  /** Testimony is taken in here rather than by a miner, so this store needs
   *  the instrumentation level too — see `ProvenanceLevel`. */
  constructor(private readonly provenance: ProvenanceLevel = 'compact') {}

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
      setProvenance(existing, report.provenance);
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
      rule: copyRule(report.rule),
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
    setProvenance(record, report.provenance);
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
    sourceMemory: MemoryRecord,
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
      sourceMemoryIds: [sourceMemory.id],
      // The hearing itself is the whole evidence: who told you, and when.
      ...(this.provenance === 'off' ? {} : { provenance: [snapshotOf(sourceMemory)] }),
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

  /**
   * Fold the rule-derived parts onto shared instances. Values are untouched —
   * every reader sees exactly what it saw — so this is safe only for a store
   * nothing will write again, because the shared rule object is now reachable
   * from every dead being holding the belief. Called at death only.
   */
  compact(intern: RuleIntern): void {
    for (const record of this.records.values()) intern.adopt(record);
  }
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/**
 * Only ever ADDS the field. A report with no episodes behind it (a seeded
 * recipe) must not erase the provenance a record already carries, and a record
 * that never had any stays without the key rather than carrying an empty array
 * into every corpus row.
 */
function setProvenance(record: KnowledgeRecord, provenance: readonly EvidenceSnapshot[] | undefined): void {
  if (provenance && provenance.length > 0) record.provenance = provenance;
}
