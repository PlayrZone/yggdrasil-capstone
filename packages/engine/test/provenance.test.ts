import { describe, expect, it } from 'vitest';
import { Experiment } from '../src/runner/Experiment.js';
import { AgentMind } from '../src/agent/AgentMind.js';
import { RuleIntern } from '../src/knowledge/KnowledgeStore.js';
import { mem } from './helpers.js';
import { ProvenanceSample, snapshotOf } from '../src/learning/ILearner.js';
import { describeEpisode } from '../src/memory/memoryFromEvent.js';
import { fingerprintOf } from './fingerprint.js';
import type { EvidenceSnapshot } from '../src/contract/types.js';

/**
 * A belief must be able to say what it rests on AFTER the episodes are gone —
 * the memory stream is bounded and a dead being holds none at all, so an id
 * into it is not an answer to "why do you believe that?". These hold the
 * snapshots that replaced the ids, the bound on them, and the two ways a
 * tombstone is made compact without any reader seeing a difference.
 */

/** A mind whose hot set is tiny, so eviction happens within a few appends. */
function tinyMind(id = 1): AgentMind {
  return new AgentMind(id, { memoryHotCapacity: 8 });
}

const WET = { nearWater: true, night: false, inShelter: false, elevationBand: 0 };
const DRY = { nearWater: false, night: false, inShelter: false, elevationBand: 0 };

/**
 * A life that reliably mines one context rule: gathering always happens by the
 * water, everything else away from it, so the feature lifts far above chance.
 */
function liveByTheRiver(mind: AgentMind, rounds: number): void {
  for (let i = 0; i < rounds; i++) {
    mind.observe(mem(i * 20, 'GatherSucceeded', { objectKind: 'berry', context: WET }));
    mind.observe(mem(i * 20 + 10, 'SawAgent', { context: DRY }));
  }
}

describe('provenance outlives the episodes', () => {
  it('survives eviction: the ids dangle, the snapshots do not', () => {
    const mind = tinyMind();
    liveByTheRiver(mind, 60);
    mind.consolidate(2000);

    const record = mind.knowledge.all().find((k) => k.rule.kind === 'context-association');
    expect(record).toBeDefined();
    const provenance = record!.provenance ?? [];
    expect(provenance.length).toBeGreaterThan(0);

    // The record's own ids mostly point at memories that no longer exist…
    const dangling = record!.sourceMemoryIds.filter((id) => mind.memory.get(id) === undefined);
    expect(dangling.length).toBeGreaterThan(0);
    // …while every snapshot still answers what, when and how it was known.
    for (const p of provenance) {
      expect(p.type).toBe('GatherSucceeded');
      expect(p.objectKind).toBe('berry');
      expect(p.origin).toBe('experience');
      expect(Number.isFinite(p.tick)).toBe(true);
      // The line the memory carried is not stored — it is rendered back from
      // the fields, by the same function that wrote it.
      expect(describeEpisode(p.type, p.subjects, p.objectKind, p.causedBy)).toBe('GatherSucceeded (berry)');
    }
  });

  it('keeps at most six, oldest first, each episode once', () => {
    const mind = tinyMind();
    liveByTheRiver(mind, 200);
    mind.consolidate(8000);

    for (const record of mind.knowledge.all()) {
      const p = record.provenance ?? [];
      expect(p.length).toBeLessThanOrEqual(6);
      expect(new Set(p.map((s) => s.memoryId)).size).toBe(p.length);
      expect([...p].sort((a, b) => a.memoryId - b.memoryId)).toEqual(p);
    }
  });

  it('is deterministic — the same life yields the same evidence', () => {
    const run = (): EvidenceSnapshot[] => {
      const mind = tinyMind();
      liveByTheRiver(mind, 80);
      mind.consolidate(4000);
      return mind.knowledge.all().flatMap((k) => [...(k.provenance ?? [])]);
    };
    expect(run()).toEqual(run());
  });

  it('a dead being can still say why it believed what it did', () => {
    const exp = new Experiment({ seed: 'prov-dead', agentCount: 36 });
    exp.advance(14_400);

    const tombstones = exp.agentIds
      .map((id) => exp.minds.get(id))
      .filter((mind, i) => mind && !exp.agentBody(exp.agentIds[i]!)?.alive);
    expect(tombstones.length).toBeGreaterThan(0);

    let withProvenance = 0;
    for (const mind of tombstones) {
      expect(mind!.memory.hotCount).toBe(0); // every episode released…
      for (const k of mind!.knowledge.all()) {
        const p = k.provenance ?? [];
        if (p.length === 0) continue;
        withProvenance++;
        // …yet the belief still carries its evidence.
        expect(p.length).toBeLessThanOrEqual(6);
        for (const s of p) expect(s.memoryId).toBeGreaterThan(0);
      }
    }
    expect(withProvenance).toBeGreaterThan(0);
  });
});

describe('a death must be a real death', () => {
  it('an authored AgentDied over a LIVING being neither wipes it nor stops it learning', () => {
    const exp = new Experiment({ seed: 'authored-death', agentCount: 24 });
    exp.advance(2400);
    const id = exp.agentIds.find((a) => exp.agentBody(a)?.alive && (exp.minds.get(a)?.memory.hotCount ?? 0) > 20)!;
    const mind = exp.minds.get(id)!;
    const held = mind.memory.hotCount;
    const learners = mind.learners.length;

    const body = exp.agentBody(id)!;
    const t = exp.agentEntity(id)!.components['Transform2D'] as { x: number; y: number };
    exp.authorEvent({ tick: exp.tick, type: 'AgentDied', actorId: id, targetIds: [], x: t.x, y: t.y, payload: { cause: 'violence' } });

    expect(body.alive).toBe(true);
    expect(mind.memory.hotCount).toBeGreaterThanOrEqual(held);
    expect(mind.learners).toHaveLength(learners);

    // And it goes on living a mind's life: still remembering, still learning.
    const knowledgeBefore = mind.knowledge.all().length;
    exp.advance(4800);
    expect(mind.memory.hotCount).toBeGreaterThan(0);
    expect(mind.knowledge.all().length).toBeGreaterThanOrEqual(knowledgeBefore);
  });

  it('a real death still entombs', () => {
    const exp = new Experiment({ seed: 'authored-death', agentCount: 24 });
    exp.advance(14_400);
    const dead = exp.agentIds.filter((id) => !exp.agentBody(id)?.alive);
    expect(dead.length).toBeGreaterThan(0);
    for (const id of dead) expect(exp.minds.get(id)!.memory.hotCount).toBe(0);
  });
});

describe('tombstones share what a rule determines', () => {
  it('interning collapses identity and changes no value', () => {
    const intern = new RuleIntern();
    const minds = [0, 1].map((i) => {
      const mind = tinyMind(i);
      liveByTheRiver(mind, 40);
      mind.consolidate(2000);
      return mind;
    });
    const before = minds.map((m) => m.knowledge.all().map((k) => ({ ...k, rule: { ...k.rule } })));

    for (const mind of minds) mind.entomb(intern);

    const [a, b] = minds.map((m) => m.knowledge.all());
    expect(a!.length).toBeGreaterThan(0);
    // Every value identical to what it was…
    minds.forEach((mind, i) => {
      expect(mind.knowledge.all().map((k) => ({ ...k, rule: { ...k.rule } }))).toEqual(before[i]);
    });
    // …and the two tombstones now point at ONE string and one rule object.
    let shared = 0;
    for (const ka of a!) {
      const kb = b!.find((k) => k.ruleKey === ka.ruleKey);
      if (!kb) continue;
      shared++;
      expect(kb.ruleKey).toBe(ka.ruleKey);
      expect(kb.statement).toBe(ka.statement);
      expect(Object.is(kb.rule, ka.rule)).toBe(true);
      expect(Object.is(kb.statement, ka.statement)).toBe(true);
    }
    expect(shared).toBeGreaterThan(0);
    expect(intern.size).toBe(shared);
  });

  it('never shares across beings whose belief only LOOKS the same', () => {
    // `ruleKey` for a craft-recipe is its output alone — "one belief however
    // its inputs are remembered" — so two beings can key the same and believe
    // different things. Interning on the key would hand the second the first's
    // recipe and silently rewrite what a dead being believed.
    const vague = { kind: 'craft-recipe', output: 'spear', inputs: {} } as const;
    const learned = { kind: 'craft-recipe', output: 'spear', inputs: { wood: 1, stone: 1 } } as const;
    const report = (rule: typeof vague | typeof learned) => ({
      rule, confidence: 0.9, evidenceCount: 6, contradictionCount: 0, sourceMemoryIds: [],
    });
    const a = new AgentMind(10);
    const b = new AgentMind(11);
    a.knowledge.applyEvidence(report(vague), 100);
    b.knowledge.applyEvidence(report(learned), 100);
    expect(a.knowledge.all()[0]!.ruleKey).toBe(b.knowledge.all()[0]!.ruleKey); // same key…
    expect(a.knowledge.all()[0]!.statement).not.toBe(b.knowledge.all()[0]!.statement); // …different belief

    const intern = new RuleIntern();
    a.entomb(intern);
    b.entomb(intern);

    const ra = a.knowledge.all()[0]!;
    const rb = b.knowledge.all()[0]!;
    expect(ra.rule).toEqual(vague);
    expect(rb.rule).toEqual(learned);
    expect(Object.is(ra.rule, rb.rule)).toBe(false);
    expect(intern.size).toBe(2); // two contents, two entries
  });
});

describe('which six episodes a belief keeps', () => {
  /** Salience is a field here, so the policy can be pinned without a fixture. */
  const at = (id: number, importance: number): ReturnType<typeof snapshotOf> =>
    snapshotOf(mem(id, 'GatherSucceeded', { id, importance, objectKind: 'berry' }));

  it('keeps the first 2, the latest 2, and the 2 most important', () => {
    const sample = new ProvenanceSample('full');
    // Ten dull episodes with two striking ones buried in the middle — neither
    // first nor latest, and precisely the ones a person would cite.
    for (let i = 1; i <= 10; i++) sample.addSnapshot(at(i, i === 6 ? 0.99 : i === 3 ? 0.98 : 0.1));
    const kept = sample.snapshots().map((s) => s.memoryId);

    expect(kept).toEqual([1, 2, 3, 6, 9, 10]);
    expect(kept).toContain(6); // the striking ones survived being neither end
    expect(kept).toContain(3);
    expect(sample.ids()).toEqual([1, 2, 3, 4, 7, 8, 9, 10]); // the citation is untouched
  });

  it('collapses to fewer than six when a strongest is also an end', () => {
    const sample = new ProvenanceSample('full');
    for (let i = 1; i <= 10; i++) sample.addSnapshot(at(i, i === 6 ? 0.99 : 0.1 + i * 0.001));
    // Strongest are 6 and 10; 10 is also the latest, so five distinct remain.
    expect(sample.snapshots().map((s) => s.memoryId)).toEqual([1, 2, 6, 9, 10]);
  });

  it('breaks equal salience toward the earlier memory', () => {
    const sample = new ProvenanceSample('full');
    for (let i = 1; i <= 8; i++) sample.addSnapshot(at(i, i >= 5 ? 0.9 : 0.1));
    // 5 and 6 tie with 7 and 8 at 0.9; the earlier two win the strongest slots,
    // and 7/8 are here only because they are also the latest two.
    expect(sample.snapshots().map((s) => s.memoryId)).toEqual([1, 2, 5, 6, 7, 8]);
  });

  it('never exceeds six however long the evidence runs, and replays', () => {
    const run = (): number[] => {
      const sample = new ProvenanceSample('full');
      for (let i = 1; i <= 500; i++) sample.addSnapshot(at(i, (i * 37) % 100 / 100));
      return sample.snapshots().map((s) => s.memoryId);
    };
    const kept = run();
    expect(kept).toHaveLength(6);
    expect([...kept].sort((a, b) => a - b)).toEqual(kept);
    expect(run()).toEqual(kept);
  });
});

describe('the level is the host’s choice, and only the host can tell', () => {
  const at = (id: number, importance: number): ReturnType<typeof snapshotOf> =>
    snapshotOf(mem(id, 'GatherSucceeded', { id, importance, objectKind: 'berry' }));

  it('compact keeps one of each; off keeps none; ids never move', () => {
    const feed = (level: 'off' | 'compact' | 'full'): ProvenanceSample => {
      const sample = new ProvenanceSample(level);
      for (let i = 1; i <= 10; i++) sample.addSnapshot(at(i, i === 6 ? 0.99 : i === 3 ? 0.98 : 0.1));
      return sample;
    };
    const off = feed('off');
    const compact = feed('compact');
    const full = feed('full');

    expect(off.snapshots()).toEqual([]);
    // First, latest, strongest — one apiece.
    expect(compact.snapshots().map((s) => s.memoryId)).toEqual([1, 6, 10]);
    expect(full.snapshots().map((s) => s.memoryId)).toEqual([1, 2, 3, 6, 9, 10]);
    // The citation is the record's own and does not know about levels.
    expect(off.ids()).toEqual(full.ids());
    expect(compact.ids()).toEqual(full.ids());
  });

  it('compact still answers WHY: the striking episode survives at every level', () => {
    const sample = new ProvenanceSample('compact');
    for (let i = 1; i <= 40; i++) sample.addSnapshot(at(i, i === 17 ? 0.99 : 0.1));
    expect(sample.snapshots().map((s) => s.memoryId)).toContain(17);
    expect(sample.snapshots()).toHaveLength(3);
  });

  it('every level simulates identically — one golden config, three fingerprints', () => {
    // `fingerprintOf` walks the whole world and every mind but never touches
    // `provenance`, so equality here IS the proof that the option is an
    // instrument: nothing the simulation can reach changes with it.
    const prints = (['off', 'compact', 'full'] as const).map((provenance) => {
      const exp = new Experiment({ seed: 'golden-seeded', agentCount: 30, craftLearning: true, provenance });
      exp.seedMyth('The first makers raised a home by the great river', { timesHeard: 5 });
      exp.seedRecipe('spear', exp.agentIds.slice(0, 2));
      exp.advance(3000);
      return fingerprintOf(exp);
    });
    expect(prints[1]).toBe(prints[0]);
    expect(prints[2]).toBe(prints[0]);
    // …and it is the value the behaviour lock already records for this config.
    expect(prints[0]).toBe('533ea9199525930b:444023');
  });

  it('every belief that cites an episode can show it — at compact and at full', () => {
    // The fingerprint test above already proves the runs are the same world;
    // this is the instrument's own contract, checked inside each run. A record
    // with no citation at all has nothing to show: a negative context rule is
    // evidence that a feature was ABSENT, so no memory is filed under it, and
    // `sourceMemoryIds` has always been empty for those.
    for (const level of ['off', 'compact', 'full'] as const) {
      const exp = new Experiment({ seed: 'level-cmp', agentCount: 24, provenance: level });
      exp.advance(9600);
      const cap = level === 'full' ? 6 : 3;
      let cited = 0;
      let unexplained = 0;
      let explained = 0;
      for (const mind of exp.minds.values()) {
        for (const k of mind.knowledge.all()) {
          const p = k.provenance ?? [];
          expect(p.length).toBeLessThanOrEqual(cap);
          if (p.length > 0) explained++;
          if (k.sourceMemoryIds.length === 0) continue;
          cited++;
          if (p.length === 0) unexplained++;
        }
      }
      expect(cited).toBeGreaterThan(100);
      expect(unexplained).toBe(level === 'off' ? cited : 0);
      expect(explained).toBe(level === 'off' ? 0 : explained);
      if (level !== 'off') expect(explained).toBeGreaterThanOrEqual(cited);
    }
  });
});
