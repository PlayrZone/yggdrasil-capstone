import { describe, expect, it } from 'vitest';
import {
  ATTESTATION_THRESHOLDS,
  JUDGE_GATE_HASH,
  actionForCore,
  LlmMind,
  SealedTraceKey,
  attestRun,
  emptyContext,
  foragerAdapter,
  foragerWorld,
  judgeTraces,
  reportOf,
  thinkOutcomeBreaches,
  verifyAttestation,
  watchThinkOutcomes,
} from '../src/index.js';
import type { CognitionRecord, RunAttestation, ThinkInput, TraceKey } from '../src/index.js';
import { ForeignPlaceError } from '../src/contract/space.js';
import type { IMindBackend } from '../src/consciousness/IMindBackend.js';
import { lcg, simulate, stochasticJudge } from './eval-simulation.js';

/**
 * S6 — PARTIAL SILENT FALLBACK WAS INVISIBLE, AND THE ATTESTATION WAS UNCHECKABLE.
 *
 * The reviewer, on round 4's integrity channel: *"**Not** caught: a PARTIAL
 * reflex fallback — my 5% and 20% plants came back `fallbackRate 0`, because
 * one bad completion is rescued by the retry and only a think that fails TWICE
 * counts, so 0.05 is a floor on double-failures rather than on degradation. And
 * nothing binds the attestation to the run: `judgeTraces` takes a
 * caller-supplied `{degraded, reasons}` and cannot check it."*
 *
 * Both halves are here. The first half is measured at the SOURCE — `LlmMind`
 * now reports what every think did — and the corpus-row number is printed
 * beside it so the gap is visible rather than argued about. The second half is
 * three attacks: forge, replay, and edit-after-minting.
 *
 * S6b (W1-B4 r4 ruling) is the third block: only a transport failure and an
 * invalid REPLY may become a reflex act. A `ForeignPlaceError` or a `TypeError`
 * thrown by the wire codec while decoding a reply is a program error, and
 * round 4's `catch` turned eleven of them into answered rows.
 */

/**
 * A VALID decision. An empty plan is `no-decision`, which the parser refuses —
 * so a "clean" backend that returned one would fall back on every single think
 * and this whole file would be measuring the wrong thing.
 */
const GOOD = JSON.stringify({ goals: [], plan: [{ kind: actionForCore(foragerAdapter, 'Wait')!.id }], utterances: [] });

function inputFor(id: number): ThinkInput {
  return {
    snapshot: {
      id,
      name: '',
      inventory: {},
      needs: {},
      health: 100,
      sick: false,
      // A REAL place: since W1-B4 r4 a place is a per-world #private class, and
      // {} makes the reflex policy throw a TypeError — which, satisfyingly, is
      // now a program error that propagates rather than a silent reflex act.
      place: foragerWorld.edges.at(0, 0),
      context: emptyContext(foragerAdapter),
      traits: { curiosity: 50, compassion: 50, loyalty: 50, ambition: 50, caution: 50 },
    },
    recalledMemories: [],
    knowledge: [],
    relationships: new Map(),
    worldView: { tick: id, night: false, season: 'spring', agents: [], resources: [], structures: [] },
    goals: [],
    trigger: 'periodic',
  } as unknown as ThinkInput;
}

/** A transport that fails a declared SHARE of its calls, deterministically. */
function flakyBackend(failRate: number, seed = 4242): IMindBackend {
  const rng = lcg(seed);
  return {
    modelId: `flaky-${failRate}`,
    complete: (_prompt: ThinkPrompt, _input: ThinkInput): Promise<string> =>
      rng() < failRate ? Promise.reject(new Error('transport: 503')) : Promise.resolve(GOOD),
  };
}

/** Drive `thinks` thinks through one mind and report both channels. */
async function driveMind(backend: IMindBackend, thinks: number): Promise<{
  atSource: ReturnType<typeof reportOf>;
  rowFallbacks: number;
  rowFallbackRate: number;
}> {
  const rows: CognitionRecord[] = [];
  const mind = new LlmMind(backend, {
    world: foragerAdapter,
    onCognition: (record) => rows.push(record),
    now: () => 0,
  });
  const watch = watchThinkOutcomes((o) => o.backend === backend);
  try {
    for (let i = 0; i < thinks; i++) await mind.complete(inputFor(i));
  } finally {
    watch.stop();
  }
  const rowFallbacks = rows.filter((r) => r.fellBackToReflex).length;
  return {
    atSource: reportOf(watch.counters),
    rowFallbacks,
    rowFallbackRate: Math.round((rowFallbacks / thinks) * 10000) / 10000,
  };
}

describe('W1-E · S6 · degradation is counted at the source, not inferred from a row', () => {
  it('catches the reviewer\'s 5%, 20% and 100% plants, all three', async () => {
    const rows: string[] = [];
    for (const plant of [0.05, 0.2, 1]) {
      const measured = await driveMind(flakyBackend(plant), 400);
      const outcomes = { A: measured.atSource };
      const breaches = thinkOutcomeBreaches(outcomes);
      rows.push(
        `  plant ${(plant * 100).toFixed(0).padStart(3)}%: at the SOURCE ok ${String(measured.atSource.ok).padStart(3)} ` +
          `retried-ok ${String(measured.atSource.retriedOk).padStart(3)} fell-back ${String(measured.atSource.fellBack).padStart(3)} ` +
          `(rate ${measured.atSource.fallbackRate.toFixed(4)}) · from the ROWS ${measured.rowFallbacks} ` +
          `(rate ${measured.rowFallbackRate.toFixed(4)}) · DEGRADED ${breaches.length > 0}`,
      );
      // THE BAR: every plant is caught.
      expect(breaches.length, `plant ${plant} must be caught`).toBeGreaterThan(0);
      // WHICH channel catches it is the arithmetic round 4 never did. `LlmMind`
      // tries twice, so a transport failing f of CALLS falls back on f² of
      // THINKS: at 5% that is 0.25%, below any honest fallback threshold, and
      // the 9.75% retry rate is where the signal is.
      const byFallback = measured.atSource.fallbackRate > ATTESTATION_THRESHOLDS.maxFallbackRate;
      const byRetry = measured.atSource.retryRate > ATTESTATION_THRESHOLDS.maxRetryRate;
      expect(byFallback || byRetry, `plant ${plant} caught by some channel`).toBe(true);
      expect(byRetry, `plant ${plant} always shows in the retry channel`).toBe(true);
      if (plant >= 0.2) expect(byFallback, `plant ${plant} also shows in the fallback channel`).toBe(true);
      if (plant <= 0.05) {
        expect(measured.atSource.fallbackRate, 'a 5% plant is BELOW the fallback threshold — that is the finding')
          .toBeLessThanOrEqual(ATTESTATION_THRESHOLDS.maxFallbackRate);
      }
      // …and the retry traffic is always at least the fallback traffic.
      expect(measured.atSource.retryRate).toBeGreaterThanOrEqual(measured.atSource.fallbackRate);
    }
    // eslint-disable-next-line no-console
    console.log(['', 'S6 · planted backend failure, 400 thinks per cell:', ...rows].join('\n'));
  }, 300_000);

  it('reproduces the round-4 blindness: the ROW channel reads ~0 at a 5% plant', async () => {
    const measured = await driveMind(flakyBackend(0.05, 991), 400);
    // THE REVIEWER'S FINDING, reproduced exactly. A row counts a fallback only
    // when a think failed TWICE, so at a 5% plant the ONLY number round 4 had
    // reads 0.0025 — under any threshold — and the run passed as clean.
    expect(measured.rowFallbackRate).toBeLessThan(ATTESTATION_THRESHOLDS.maxFallbackRate);
    const asRoundFourSawIt = {
      ...measured.atSource,
      fellBack: measured.rowFallbacks,
      fallbackRate: measured.rowFallbackRate,
      retriedOk: 0,
      retryRate: measured.rowFallbackRate,
    };
    expect(thinkOutcomeBreaches({ A: asRoundFourSawIt })).toEqual([]);
    // The SOURCE channel sees it, in the retry traffic the rows never carried.
    expect(measured.atSource.retryRate).toBeGreaterThan(ATTESTATION_THRESHOLDS.maxRetryRate);
    expect(measured.atSource.retryRate).toBeGreaterThan(measured.rowFallbackRate * 10);
    expect(thinkOutcomeBreaches({ A: measured.atSource }).length).toBeGreaterThan(0);
  }, 300_000);

  it('reports a clean run as clean, so the channel is not just a tripwire', async () => {
    const clean: IMindBackend = { modelId: 'clean', complete: () => Promise.resolve(GOOD) };
    const measured = await driveMind(clean, 200);
    expect(measured.atSource.thinks).toBe(200);
    expect(measured.atSource.ok).toBe(200);
    expect(measured.atSource.fellBack).toBe(0);
    expect(measured.atSource.retryRate).toBe(0);
    expect(thinkOutcomeBreaches({ A: measured.atSource })).toEqual([]);
  }, 120_000);

  it('separates a rescued retry from a fallback, and names the fallback reason', async () => {
    let call = 0;
    const everyOther: IMindBackend = {
      modelId: 'every-other',
      // First attempt unreadable, second fine: the think SUCCEEDS, and it is
      // not an `ok` — it is a `retried-ok`, which round 4 could not express.
      complete: () => Promise.resolve(call++ % 2 === 0 ? 'not json at all' : GOOD),
    };
    const measured = await driveMind(everyOther, 40);
    expect(measured.atSource.ok).toBe(0);
    expect(measured.atSource.retriedOk).toBe(40);
    expect(measured.atSource.fellBack).toBe(0);
    expect(measured.rowFallbacks).toBe(0);

    const alwaysBadReply: IMindBackend = { modelId: 'bad-reply', complete: () => Promise.resolve('{') };
    const invalid = await driveMind(alwaysBadReply, 20);
    expect(invalid.atSource.fellBack).toBe(20);
    expect(invalid.atSource.fellBackByReason['invalid-reply']).toBe(20);
    expect(invalid.atSource.fellBackByReason.backend).toBe(0);

    const alwaysDown: IMindBackend = { modelId: 'down', complete: () => Promise.reject(new Error('ECONNRESET')) };
    const down = await driveMind(alwaysDown, 20);
    expect(down.atSource.fellBackByReason.backend).toBe(20);
    expect(down.atSource.fellBackByReason['invalid-reply']).toBe(0);
  }, 120_000);
});

describe('W1-E · S6b · only a transport failure and an invalid REPLY may be survived', () => {
  /**
   * A world that throws `thrown` from ENGINE code ONLY ONCE A COMPLETION HAS
   * COME BACK — so the throw lands inside `parseMindOutput`, on exactly the
   * path the W1-B4 verifier found, and not at prompt-build time where it would
   * have propagated even in round 4 and this test would prove nothing.
   *
   * `armed()` says whether the backend was actually called first; every test
   * below asserts it, because a throw before the call is a different bug.
   */
  function worldThatThrowsAfterACompletion(thrown: Error): {
    world: typeof foragerAdapter;
    backend: IMindBackend;
    called: () => number;
  } {
    let completions = 0;
    const world = {
      ...foragerAdapter,
      get actions(): typeof foragerAdapter.actions {
        if (completions > 0) throw thrown;
        return foragerAdapter.actions;
      },
    } as unknown as typeof foragerAdapter;
    const backend: IMindBackend = {
      modelId: 'throws-after-completion',
      complete: () => {
        completions++;
        return Promise.resolve(GOOD);
      },
    };
    return { world, backend, called: () => completions };
  }

  it('rethrows a ForeignPlaceError from the reply path instead of answering with a reflex', async () => {
    // The W1-B4 verifier's finding: a `ForeignPlaceError` thrown while reading a
    // legal-looking reply was swallowed, eleven rows were recorded as answered,
    // and the run carried on. It must now reject loudly.
    const rows: CognitionRecord[] = [];
    const planted = worldThatThrowsAfterACompletion(new ForeignPlaceError('this place was not minted by this world'));
    const mind = new LlmMind(planted.backend, { world: planted.world, onCognition: (r) => rows.push(r), now: () => 0 });
    await expect(mind.complete(inputFor(1))).rejects.toBeInstanceOf(ForeignPlaceError);
    // The completion DID come back — so this is the parse path, not the prompt.
    expect(planted.called()).toBeGreaterThan(0);
    // …and nothing was recorded, as answered or otherwise.
    expect(rows).toHaveLength(0);
  });

  it('rethrows a raw TypeError from the reply path, and still falls back on a transport error', async () => {
    const planted = worldThatThrowsAfterACompletion(new TypeError("Cannot read properties of undefined (reading 'x')"));
    const mind = new LlmMind(planted.backend, { world: planted.world, now: () => 0 });
    await expect(mind.complete(inputFor(2))).rejects.toBeInstanceOf(TypeError);
    expect(planted.called()).toBeGreaterThan(0);

    // …and the two survivable failures still survive, or the fix would be a
    // different bug: a mind that dies whenever a provider hiccups.
    const flaky = await driveMind(flakyBackend(0.5, 5), 40);
    expect(flaky.atSource.thinks).toBe(40);
    expect(flaky.atSource.fellBack + flaky.atSource.ok + flaky.atSource.retriedOk).toBe(40);
  });

  it('is a fact about the classifier: a plain Error from the same path still falls back', async () => {
    // The falsification control. If `isProgramError` simply rethrew
    // everything, this would throw too — and a flaky provider would kill a run.
    const backend: IMindBackend = { modelId: 'plain', complete: () => Promise.reject(new Error('503 upstream')) };
    const mind = new LlmMind(backend, { world: foragerAdapter, now: () => 0 });
    await expect(mind.complete(inputFor(3))).resolves.toBeDefined();
  });

  it('does not report the same think twice, and reports one per think', async () => {
    const flaky = await driveMind(flakyBackend(0.4, 17), 100);
    expect(flaky.atSource.thinks).toBe(100);
  });
});

describe('W1-E · S6 · the attestation is bound to the run it is about', () => {
  function keyFor(label: string, handles = 6): { key: SealedTraceKey; entries: TraceKey[] } {
    const entries: TraceKey[] = Array.from({ length: handles }, (_, i) => ({
      traceId: `${label}-h${i}`,
      arm: i % 2 === 0 ? 'A' : 'B',
      seed: `${label}-seed-${i % 3}`,
      beingId: i,
      runId: `${label}-run`,
    }));
    return { key: new SealedTraceKey(entries, `${label}-public`, `${label}-secret-0123456789abcd`), entries };
  }

  it('accepts the attestation it minted, and only that one', () => {
    const { key } = keyFor('honest');
    const claim = { degraded: false, reasons: [], thinkOutcomes: {}, seeds: ['s0', 's1', 's2'], ruleHash: JUDGE_GATE_HASH };
    const attestation = attestRun(key, claim);
    expect(verifyAttestation(attestation, key, JUDGE_GATE_HASH)).toEqual({ ok: true, reason: null });
  });

  it('refuses a FORGED attestation — the MAC needs the run secret', () => {
    const { key } = keyFor('forge');
    const real = attestRun(key, { degraded: true, reasons: ['arm B ran on reflex'], thinkOutcomes: {}, seeds: ['s'], ruleHash: JUDGE_GATE_HASH });
    // The attacker has the whole artefact and flips the one field that matters.
    const forged: RunAttestation = { ...real, degraded: false, reasons: [] };
    const check = verifyAttestation(forged, key, JUDGE_GATE_HASH);
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/does not authenticate/);
    // Inventing a MAC outright is no better.
    expect(verifyAttestation({ ...real, binding: { ...real.binding!, mac: 'f'.repeat(64) } }, key, JUDGE_GATE_HASH).ok).toBe(false);
  });

  it('refuses a REPLAYED attestation — an honest one from another run', () => {
    const healthy = keyFor('healthy');
    const degraded = keyFor('degraded');
    const clean = attestRun(healthy.key, { degraded: false, reasons: [], thinkOutcomes: {}, seeds: ['s'], ruleHash: JUDGE_GATE_HASH });
    const check = verifyAttestation(clean, degraded.key, JUDGE_GATE_HASH);
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/DIFFERENT set of traces|another blinding/);
  });

  it('refuses an attestation minted under a DIFFERENT gate rule', () => {
    const { key } = keyFor('rule');
    const attestation = attestRun(key, { degraded: false, reasons: [], thinkOutcomes: {}, seeds: ['s'], ruleHash: 'a'.repeat(64) });
    const check = verifyAttestation(attestation, key, JUDGE_GATE_HASH);
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/minted under gate rule/);
  });

  it('refuses an UNBOUND claim — round 4 accepted exactly this', async () => {
    const sim = simulate(8, 4);
    const bare = { degraded: false, reasons: [] } as RunAttestation;
    const aggregate = await judgeTraces(sim.pairs, sim.fresh().key, stochasticJudge(1, 0, 0.5, sim.armOf, lcg(3)), {
      arms: ['A', 'B'],
      integrity: bare,
    });
    expect(aggregate.attestation.ok).toBe(false);
    expect(aggregate.usableForVerdict).toBe(false);
    expect(aggregate.note).toMatch(/carries no binding/);
  }, 120_000);

  it('refuses silence, as it always did', async () => {
    const sim = simulate(8, 4);
    const aggregate = await judgeTraces(sim.pairs, sim.fresh().key, stochasticJudge(1, 0, 0.5, sim.armOf, lcg(4)), {
      arms: ['A', 'B'],
    });
    expect(aggregate.attestation.ok).toBe(false);
    expect(aggregate.note).toMatch(/no run integrity was attested/);
  }, 120_000);

  it('binds the THINK COUNTERS too, so an arm cannot be quietly made healthy', () => {
    const { key } = keyFor('counters');
    const sick = {
      thinks: 100,
      ok: 70,
      retriedOk: 10,
      fellBack: 20,
      fallbackRate: 0.2,
      retryRate: 0.3,
      fellBackByReason: { backend: 20, 'invalid-reply': 0 },
    };
    const attestation = attestRun(key, {
      degraded: true,
      reasons: thinkOutcomeBreaches({ B: sick }),
      thinkOutcomes: { B: sick },
      seeds: ['s'],
      ruleHash: JUDGE_GATE_HASH,
    });
    const healthy = { ...sick, fellBack: 0, fallbackRate: 0, fellBackByReason: { backend: 0, 'invalid-reply': 0 } };
    const edited: RunAttestation = { ...attestation, degraded: false, reasons: [], thinkOutcomes: { B: healthy } };
    expect(verifyAttestation(edited, key, JUDGE_GATE_HASH).ok).toBe(false);
  });
});
