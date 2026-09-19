import { describe, expect, it } from 'vitest';
import { blindTraces, foragerAdapter, judgeTraces, pairTraces, runAb, verifyCommitment, wilsonInterval } from '../src/index.js';
import type { ArmId, BlindTrace, RawBeingTrace, SealedTraceKey, TraceJudgement, TracePair } from '../src/index.js';

/**
 * THE BLINDING RULE, TESTED THE ONLY WAY THAT MEANS ANYTHING.
 *
 * ROUND 1's TEST COULD NOT SEE ROUND 1's BUG. It ran an A/B with the SAME mind
 * on both arms, stripped the handle, and asserted the rest was byte-identical —
 * so it removed the one field that named the arm and then declared the
 * remainder clean. Meanwhile handles were a counter over `[...armA, ...armB]`,
 * printed as the first line of the text, and sent to the paid judge verbatim:
 * `trace-001=A trace-002=A trace-003=B trace-004=B`, 100% unblinding from
 * format alone, no classifier required.
 *
 * WHAT BLINDING CAN AND CANNOT PROMISE, decided here rather than fudged.
 *
 * "A classifier given only format features cannot beat chance" is impossible as
 * a claim about TEXT STATISTICS on a real run, and measuring it says so: a
 * faithful mind and an omniscient one write different words, so mean token
 * length, punctuation rates and how often a field is empty separate them at
 * 1.00 — and they SHOULD, because that is the behaviour the instrument exists
 * to measure. A blinding that hid it would have hidden the experiment.
 *
 * So the promise is exact, and it is three separate claims:
 *
 *   1. METADATA CARRIES NOTHING — the handle, where the trace sits in the list,
 *      the parity of that position, the template's own line signature. At
 *      chance on identical lives AND on a real run. On the same traces blinded
 *      round 1's way (`plantTell: 'ordered'`) the same classifier wins
 *      outright: a blinding test that cannot be made to fail is not evidence.
 *   2. THE TEMPLATE ADDS NOTHING. Two arms emitting the same content, one of
 *      them through the whole baseline apparatus, render BYTE-IDENTICAL text —
 *      with nothing stripped. Round 1's version of this test had to strip the
 *      handle first, which is what let the handle be the answer key.
 *   3. WHAT IS LEFT IS BEHAVIOUR, AND IT IS DISCLOSED. Text statistics and trace
 *      length are measured, printed, and named in the README as channels the
 *      blinding does not close, because they are the measurement.
 */

const world = foragerAdapter;
/** Tests are entitled to know the answer; a run is not entitled to a guessable one. */
const SECRET = '0f1e2d3c4b5a69788796a5b4c3d2e1f0';
const SPEC = { seeds: ['w1e-blind'], ticks: 900, cohortSize: 6, agentCount: 16, blindSecret: SECRET } as const;
const MOCK_A = { id: 'A' as const, backend: { kind: 'mock', mind: 'faithful' } as const };
const MOCK_B = { id: 'B' as const, backend: { kind: 'mock', mind: 'omniscient' } as const };

// ─── The classifier ──────────────────────────────────────────────────────────

/**
 * THE CHANNEL BLINDING OWNS: the handle, where the trace sits in the list, and
 * the template's own shape. Not one of these is downstream of anything a being
 * said, so a classifier that finds an arm in here has found a blinding defect
 * and nothing else.
 */
function metadataFeatures(trace: BlindTrace, at: number, total: number): Record<string, number> {
  const lines = trace.text.split('\n');
  const prefixes = new Set(lines.map((line) => line.trim().split(':')[0] ?? ''));
  const handle = trace.traceId.replace(/^trace-/, '');
  return {
    handleAsNumber: Number.parseInt(handle, 36) || 0,
    handleFirstChar: handle.charCodeAt(0) || 0,
    handleLastChar: handle.charCodeAt(handle.length - 1) || 0,
    handleLength: handle.length,
    handleDigitSum: [...handle].reduce((s, c) => s + Number.parseInt(c, 36), 0),
    indexInList: at,
    indexParity: at % 2,
    indexFraction: at / Math.max(1, total - 1),
    distinctLinePrefixes: prefixes.size,
    labelSignature: [...prefixes].sort().join('|').length,
  };
}

/**
 * THE CHANNEL BEHAVIOUR OWNS. Measured, printed and disclosed — never asserted
 * to be at chance. A faithful mind and an omniscient one write different words,
 * so every statistic over those words separates them, and it must: that is the
 * thing the judge is being asked to read.
 */
function textStatistics(trace: BlindTrace): Record<string, number> {
  const text = trace.text;
  const lines = text.split('\n');
  const tokens = text.split(/\s+/).filter(Boolean);
  const chars = Math.max(1, text.length);
  const lineCount = Math.max(1, lines.length);
  const rate = (mark: string): number => (text.split(mark).length - 1) / chars;
  const startsWith = (prefix: string): number => lines.filter((l) => l.startsWith(prefix)).length / lineCount;
  return {
    meanLineLength: chars / lineCount,
    meanTokenLength: tokens.reduce((s, t) => s + t.length, 0) / Math.max(1, tokens.length),
    tokensPerLine: tokens.length / lineCount,
    emptyThoughtRate: startsWith('  thinks: (nothing)'),
    emptySaysRate: startsWith('  says: (nothing)'),
    emptyDoesRate: startsWith('  does: (nothing)'),
    carriesNothingRate: startsWith('  carries: nothing'),
    quoteRate: rate('"'),
    hashRate: rate('#'),
    semicolonRate: rate(';'),
  };
}

function lengthFeatures(trace: BlindTrace): Record<string, number> {
  return { moments: trace.moments, lines: trace.text.split('\n').length, chars: trace.text.length };
}

interface Row {
  features: Record<string, number>;
  arm: ArmId;
}
interface Rule {
  feature: string;
  threshold: number;
  above: ArmId;
}

/** The best single-feature threshold rule on this training set. Deterministic. */
function bestRule(rows: readonly Row[], arms: [ArmId, ArmId]): Rule {
  let best: Rule = { feature: '', threshold: 0, above: arms[0] };
  let bestScore = -1;
  for (const feature of Object.keys(rows[0]?.features ?? {}).sort()) {
    const values = [...new Set(rows.map((r) => r.features[feature] ?? 0))].sort((a, b) => a - b);
    for (let i = 0; i + 1 < values.length; i++) {
      const threshold = (values[i]! + values[i + 1]!) / 2;
      for (const above of arms) {
        const rule: Rule = { feature, threshold, above };
        const score = rows.filter((r) => predict(rule, r.features, arms) === r.arm).length;
        if (score > bestScore) {
          bestScore = score;
          best = rule;
        }
      }
    }
  }
  return best;
}

function predict(rule: Rule, features: Record<string, number>, arms: [ArmId, ArmId]): ArmId {
  const other = rule.above === arms[0] ? arms[1] : arms[0];
  return (features[rule.feature] ?? 0) > rule.threshold ? rule.above : other;
}

/**
 * Leave-one-out accuracy with the rule CHOSEN inside each fold. In-sample
 * best-of-twenty-features on twelve points is near 1.00 for pure noise, which
 * would make the clean case fail and the planted case mean nothing.
 */
function looAccuracy(rows: readonly Row[], arms: [ArmId, ArmId]): number {
  if (rows.length < 4) return 0.5;
  let correct = 0;
  for (let i = 0; i < rows.length; i++) {
    const train = rows.filter((_, j) => j !== i);
    if (predict(bestRule(train, arms), rows[i]!.features, arms) === rows[i]!.arm) correct++;
  }
  return correct / rows.length;
}

function rowsOf(
  traces: readonly BlindTrace[],
  key: SealedTraceKey,
  pick: (t: BlindTrace, at: number, total: number) => Record<string, number>,
): Row[] {
  const armOf = new Map(key.unseal().map((k) => [k.traceId, k.arm]));
  return traces.map((t, at) => ({ features: pick(t, at, traces.length), arm: armOf.get(t.traceId)! }));
}

/**
 * Twelve lives that are BYTE-IDENTICAL, six per arm. Anything a classifier finds
 * in these is the blinding, because there is nothing else in them.
 */
function identicalLives(perArm: number): RawBeingTrace[] {
  const moments = Array.from({ length: 5 }, (_, i) => ({
    t: i * 100,
    day: 1 + i,
    night: false,
    season: 'spring',
    felt: [{ drive: 'hunger', pressure: 40 }],
    perceived: [{ kind: 'berryBush', count: 1 }],
    others: 0,
    carried: [{ kind: 'berry', count: 1 }],
    thought: 'the same words in every trace',
    did: ['Wait()'],
    said: [],
    happened: null,
  }));
  const lives: RawBeingTrace[] = [];
  for (const arm of ['A', 'B'] as const) {
    for (let i = 0; i < perArm; i++) {
      lives.push({ runId: `run-${arm}`, arm, beingId: i + 1, moments: moments.map((m) => ({ ...m })) });
    }
  }
  return lives;
}

// ─── 1. The handle channel, isolated ─────────────────────────────────────────

describe('W1-E · the handle carries no information', () => {
  it('sits at chance on identical lives — and wins outright once round 1\'s handles are put back', () => {
    const lives = identicalLives(6);

    const clean = blindTraces(lives, world, { seed: 'handle-check', secret: SECRET, minMoments: 1 });
    const planted = blindTraces(lives, world, { seed: 'handle-check', secret: SECRET, minMoments: 1, plantTell: 'ordered' });

    const cleanAccuracy = looAccuracy(rowsOf(clean.traces, clean.key, metadataFeatures), ['A', 'B']);
    const plantedAccuracy = looAccuracy(rowsOf(planted.traces, planted.key, metadataFeatures), ['A', 'B']);

    // eslint-disable-next-line no-console
    console.log(`blinding/handle: clean ${cleanAccuracy.toFixed(3)} · planted tell ${plantedAccuracy.toFixed(3)} (n=${lives.length})`);

    // The bodies are identical, so a clean blinding leaves NOTHING to find.
    expect(cleanAccuracy).toBeLessThanOrEqual(0.6);
    // Round 1's scheme is recovered by the same classifier, bar the one fold
    // whose held-out point sits on the boundary the rule is fitted to.
    expect(plantedAccuracy).toBeGreaterThanOrEqual(0.9);
    expect(plantedAccuracy - cleanAccuracy).toBeGreaterThan(0.3);

    // And the mechanism, stated directly: round 1 put the handle in the text.
    expect(planted.traces[0]!.text).toMatch(/^TRACE trace-/);
    expect(clean.traces[0]!.text).toMatch(/^TRACE — /);
    expect(planted.manifest.plantedTell).toBe('ordered');
    expect(clean.manifest.plantedTell).toBeUndefined();
  });

  it('refuses to hand a handle to the text of a real trace', () => {
    const { traces } = blindTraces(identicalLives(3), world, { seed: 'no-handle', secret: SECRET, minMoments: 1 });
    for (const trace of traces) {
      expect(trace.text).not.toContain(trace.traceId);
      expect(trace.traceId).toMatch(/^trace-[0-9a-z]{6}$/);
    }
    // Opaque, not ordinal: no two handles are consecutive counters.
    const handles = traces.map((t) => t.traceId);
    expect(new Set(handles).size).toBe(handles.length);
    expect(handles).not.toEqual(['trace-001', 'trace-002', 'trace-003']);
  });
});

// ─── 2. Format on a real run, different minds ────────────────────────────────

describe('W1-E · format tells on a real run', () => {
  it('cannot be classified from metadata, and says plainly what it CAN be classified from', async () => {
    const result = await runAb({ ...SPEC }, { arms: [MOCK_A, MOCK_B] });
    if (!result.usable) throw new Error(`the run produced no verdict: ${result.reason}`);
    expect(result.traces.length).toBeGreaterThanOrEqual(6);
    const n = result.traces.length;

    const metadata = looAccuracy(rowsOf(result.traces, result.key, metadataFeatures), ['A', 'B']);
    const words = looAccuracy(rowsOf(result.traces, result.key, (t) => textStatistics(t)), ['A', 'B']);
    const length = looAccuracy(rowsOf(result.traces, result.key, (t) => lengthFeatures(t)), ['A', 'B']);
    const interval = wilsonInterval(Math.round(metadata * n), n);

    // eslint-disable-next-line no-console
    console.log(
      `blinding/real-run (n=${n}): metadata ${metadata.toFixed(3)} Wilson [${interval.low}, ${interval.high}] · ` +
        `text statistics ${words.toFixed(3)} · length ${length.toFixed(3)}`,
    );

    // THE CLAIM: the handle, the ordering and the template carry nothing. The
    // interval on the metadata classifier has to contain a half.
    expect(interval.low).toBeLessThanOrEqual(0.5);

    // NOT A CLAIM, and deliberately unasserted: the other two are behaviour. A
    // mind that says different words writes different text statistics, and a
    // mind whose beings die earlier writes shorter traces. Both are printed and
    // both are named in the README under "what the blinding does not hide".
    expect(words).toBeGreaterThanOrEqual(0);
    expect(length).toBeGreaterThanOrEqual(0);
  }, 120_000);

  it('renders BYTE-IDENTICAL text when both arms say the same things, with nothing stripped', async () => {
    // Round 1's version of this test compared traces "once the opaque handle is
    // removed" — it stripped the one field that named the arm and declared the
    // rest identical. Nothing is stripped here, because nothing that names a
    // trace is in the text any more.
    const result = await runAb(
      { ...SPEC, cohortSize: 4 },
      { arms: [MOCK_A, { id: 'B' as const, backend: { kind: 'mock', mind: 'faithful' } as const }] },
    );
    if (!result.usable) throw new Error(result.reason);
    const armOf = new Map(result.key.unseal().map((k) => [k.traceId, k]));
    const byArm = (arm: ArmId): string[] =>
      result.traces
        .filter((t) => armOf.get(t.traceId)!.arm === arm)
        .sort((x, y) => armOf.get(x.traceId)!.beingId - armOf.get(y.traceId)!.beingId)
        .map((t) => t.text);
    const a = byArm('A');
    const b = byArm('B');
    expect(a.length).toBeGreaterThan(0);
    expect(b).toEqual(a);
  }, 120_000);

  it('prints no handle, no run id, no being id and no tick cadence', async () => {
    const result = await runAb({ ...SPEC }, { arms: [MOCK_A, MOCK_B] });
    if (!result.usable) throw new Error(result.reason);
    for (const trace of result.traces) {
      expect(trace.text).not.toContain(trace.traceId);
      expect(trace.text).not.toMatch(/TRACE trace-/);
      // Round 1 opened every moment with `[+<ticks since the trace began> · …]`,
      // and cadence follows prompt size through latency.
      expect(trace.text).not.toMatch(/\[\+\d+ ·/);
      expect(trace.text).toMatch(/\[moment \d+ · day \d+ ·/);
      for (const tell of [
        'mock/faithful', 'mock/omniscient', 'baseline', 'Yggdrasil', 'yggdrasil', 'w1e-ab', 'runId', 'beingId',
        'WHAT YOU KNOW', 'RECENT OBSERVATIONS', 'confidence', 'ruleKey', 'provenance', 'arm A', 'arm B',
      ]) {
        expect(trace.text).not.toContain(tell);
      }
      const refs = [...trace.text.matchAll(/#(\d+)/g)].map((m) => Number(m[1]));
      const distinct = [...new Set(refs)].sort((x, y) => x - y);
      expect(distinct).toEqual(distinct.map((_, at) => at + 1));
    }
  }, 120_000);

  it('returns the traces shuffled, not arm by arm', async () => {
    const result = await runAb({ ...SPEC }, { arms: [MOCK_A, MOCK_B] });
    if (!result.usable) throw new Error(result.reason);
    const armOf = new Map(result.key.unseal().map((k) => [k.traceId, k.arm]));
    const sequence = result.traces.map((t) => armOf.get(t.traceId));
    // Round 1's order was every A and then every B — two blocks.
    const blocks = sequence.filter((arm, at) => at === 0 || arm !== sequence[at - 1]).length;
    expect(blocks).toBeGreaterThan(2);
    expect(result.manifest.blinding.scheme).toBe('sealed-secret-permutation/opaque-handle');
    expect(result.manifest.blinding.publicSeed).toBe('w1e-blind');
    // The manifest carries a COMMITMENT, never the key. Round 2's `handleSeed`
    // WAS the key: it is gone, and nothing has replaced it.
    expect(result.manifest.blinding.commitment).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(result.manifest)).not.toContain(SECRET);
    expect(Object.keys(result.manifest.blinding)).not.toContain('handleSeed');
  }, 120_000);

  it('prints the same lines in the same order every moment, whatever happened', async () => {
    const result = await runAb({ ...SPEC }, { arms: [MOCK_A, MOCK_B] });
    if (!result.usable) throw new Error(result.reason);
    const labels = ['feels', 'sees', 'carries', 'thinks', 'does', 'says', 'then'];
    for (const trace of result.traces) {
      const blocks = trace.text.split('\n\n').slice(1);
      expect(blocks.length).toBe(trace.moments);
      for (const block of blocks) {
        const lines = block.split('\n');
        expect(lines[0]).toMatch(/^\[moment \d+ · day \d+ · \w+ · (day|night)\]$/);
        expect(lines.slice(1).map((line) => line.trim().split(':')[0])).toEqual(labels);
      }
    }
  }, 120_000);
});

// ─── 3. The permutation is not re-derivable from anything published ──────────

/**
 * ROUND 2's ATTACK, AS A FUNCTION. The reviewer re-ran the PUBLIC `blindTraces`
 * on a dummy pool of the same size, in the documented pooled-arm order, with
 * the seed the manifest printed — and recovered 8 of 8 arms by position,
 * without ever touching the key.
 *
 * It takes only what a run PUBLISHES, plus optionally a secret, so the same
 * function proves both halves: with the secret it still recovers everything
 * (the blinding really is only as strong as the secret), and with everything
 * the artefacts contain it is at chance.
 */
function attackByReblinding(
  published: { publicSeed: string; traces: number; armsInOrder: readonly ArmId[] },
  secret: string | undefined,
): number {
  const half = Math.floor(published.traces / 2);
  // The documented pooled order: arm A's traces, then arm B's.
  const dummy = identicalLives(half);
  const guess = blindTraces(dummy, world, {
    seed: published.publicSeed,
    ...(secret !== undefined ? { secret } : {}),
    minMoments: 1,
  });
  const guessed = guess.key.unseal().map((k) => k.arm);
  let correct = 0;
  for (let at = 0; at < Math.min(guessed.length, published.armsInOrder.length); at++) {
    if (guessed[at] === published.armsInOrder[at]) correct++;
  }
  return correct;
}

describe('W1-E · the blinding cannot be inverted by anyone holding the result', () => {
  it('is recovered 100% by the secret and at chance by every published artefact', async () => {
    const result = await runAb({ ...SPEC, cohortSize: 4 }, { arms: [MOCK_A, MOCK_B] });
    if (!result.usable) throw new Error(result.reason);
    const truth = result.key.unseal().map((k) => k.arm);
    const n = result.traces.length;
    expect(n).toBeGreaterThanOrEqual(6);

    // EVERYTHING A READER IS HANDED: the result object as it serialises, the
    // manifest, the blinded traces with their text and features, the spend and
    // ceiling lines, the integrity block. `subjects` and `sentPrompts` are
    // arm-keyed by construction and are not a blinding question.
    const published = JSON.stringify({
      manifest: result.manifest,
      traces: result.traces,
      perSeed: result.perSeed,
      contrasts: result.contrasts,
      integrity: result.integrity,
      // A reader holding the live object stringifies the whole thing, key and
      // all. `SealedTraceKey.toJSON` is what keeps that honest.
      key: result.key,
    });
    expect(published).not.toContain(SECRET);
    expect(published).not.toMatch(/"(secret|handleSeed)"/);
    expect(published).toContain(result.manifest.blinding.commitment);

    const holder = { publicSeed: result.manifest.blinding.publicSeed, traces: n, armsInOrder: truth };
    // WITH THE SECRET: total recovery. The blinding is exactly as strong as the
    // secret and no stronger, and a test that could not show that would not be
    // evidence of anything.
    expect(attackByReblinding(holder, SECRET)).toBe(n);

    // WITHOUT IT: the attacker may try as often as they like. Pooled over many
    // attempts, a re-blinding recovers arms at chance.
    let correct = 0;
    const attempts = 300;
    for (let i = 0; i < attempts; i++) correct += attackByReblinding(holder, undefined);
    const accuracy = correct / (attempts * n);
    const interval = wilsonInterval(correct, attempts * n);
    // eslint-disable-next-line no-console
    console.log(
      `blinding/attacker: with the secret ${n}/${n} (1.000) · from the published artefacts ` +
        `${accuracy.toFixed(3)} Wilson [${interval.low}, ${interval.high}] over ${attempts * n} predictions`,
    );
    expect(interval.low).toBeLessThanOrEqual(0.5);
    expect(interval.high).toBeGreaterThanOrEqual(0.5);
  }, 180_000);

  it('discloses the secret only after unsealing, and the commitment then verifies', async () => {
    const result = await runAb({ ...SPEC, cohortSize: 3 }, { arms: [MOCK_A, MOCK_B] });
    if (!result.usable) throw new Error(result.reason);
    // Before: a sealed key that answers questions is not sealed.
    expect(() => result.key.disclose()).toThrow(/only after unseal/);

    const before = result.traces.map((t) => t.traceId);
    result.key.unseal();
    const { secret, commitment } = result.key.disclose();
    expect(commitment).toBe(result.manifest.blinding.commitment);
    expect(verifyCommitment(secret, commitment)).toBe(true);
    expect(verifyCommitment('not-the-secret', commitment)).toBe(false);

    // AUDITABILITY: with the disclosed secret, the same run reproduces the same
    // handles in the same order — so "the handles were shuffled by something
    // you did not have" is checkable rather than promised.
    const again = await runAb({ ...SPEC, cohortSize: 3, blindSecret: secret }, { arms: [MOCK_A, MOCK_B] });
    if (!again.usable) throw new Error(again.reason);
    expect(again.traces.map((t) => t.traceId)).toEqual(before);
  }, 180_000);

  it('draws a different permutation every run when nothing is injected', async () => {
    const spec = { seeds: ['w1e-blind'], ticks: 480, cohortSize: 4, agentCount: 16 } as const;
    const one = await runAb({ ...spec }, { arms: [MOCK_A, MOCK_B] });
    const two = await runAb({ ...spec }, { arms: [MOCK_A, MOCK_B] });
    if (!one.usable || !two.usable) throw new Error('no verdict');
    // Same world, same seeds, same behaviour — different handles, because the
    // secret is fresh. Round 2's handles were a function of the run seed.
    expect(two.traces.map((t) => t.text).sort()).toEqual(one.traces.map((t) => t.text).sort());
    expect(two.traces.map((t) => t.traceId)).not.toEqual(one.traces.map((t) => t.traceId));
    expect(two.manifest.blinding.commitment).not.toBe(one.manifest.blinding.commitment);
  }, 180_000);
});

// ─── 4. The seal ─────────────────────────────────────────────────────────────

describe('W1-E · the key is sealed until every judgement is recorded', () => {
  it('is never unsealed while a judge is being asked, and a pair carries no arm', async () => {
    const result = await runAb({ ...SPEC, cohortSize: 4 }, { arms: [MOCK_A, MOCK_B] });
    if (!result.usable) throw new Error(result.reason);
    const pairs = pairTraces(result.traces, result.key, 'seal-check').pairs;
    expect(pairs.length).toBeGreaterThan(0);

    let sealedAtEveryCall = true;
    const watcher = {
      id: 'seal-watcher',
      compare: (pair: TracePair): Promise<TraceJudgement> => {
        if (result.key.unsealed) sealedAtEveryCall = false;
        expect(Object.keys(pair).sort()).toEqual(['left', 'pairId', 'right']);
        expect(JSON.stringify(pair)).not.toMatch(/"arm"/);
        return Promise.resolve({
          preference: 'tie' as const,
          confidence: 0,
          reasons: [],
          byCriterion: { pursues: 'tie', consistent: 'tie', reactive: 'tie', social: 'tie', ignorance: 'tie' } as const,
        });
      },
    };
    await judgeTraces(pairs, result.key, watcher);
    expect(sealedAtEveryCall).toBe(true);
    expect(result.key.unsealed).toBe(true);
  }, 120_000);

  it('places left and right in balance rather than by coin flip', async () => {
    const result = await runAb({ ...SPEC }, { arms: [MOCK_A, MOCK_B] });
    if (!result.usable) throw new Error(result.reason);
    const pairing = pairTraces(result.traces, result.key, 'balance-check');
    const left = pairing.manifest.placements.filter((p) => p.leftGroup === 0).length;
    expect(pairing.manifest.balancedPlacement).toBe(true);
    expect(left).toBe(Math.ceil(pairing.pairs.length / 2));
  }, 120_000);
});
