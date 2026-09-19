import { ThinkOutcomeCounters, observeThinkOutcomes } from '../consciousness/LlmMind.js';
import type { ThinkFallbackReason, ThinkOutcome } from '../consciousness/LlmMind.js';
import { sha256Hex } from './commit.js';
import type { SealedTraceKey } from './trace.js';

/**
 * WHAT THE RUN SAYS ABOUT ITSELF, COUNTED AT THE SOURCE AND BOUND TO THE RUN.
 *
 * Two defects, one file.
 *
 * FIRST, PARTIAL DEGRADATION WAS INVISIBLE (S6). The only integrity channel was
 * `CognitionRecordV2.parse.fellBackToReflex`, which is true only when a think
 * failed TWICE — so a single bad completion rescued by the retry counted as a
 * clean think, and `LlmMind` swallowed every backend error into the reflex
 * policy besides. The reviewer planted a backend that failed 5% of the time and
 * then 20% of the time; both runs came back reporting `fallbackRate 0`. The
 * number was a floor on double failures, not a measure of degradation.
 * `LlmMind` now reports every think's outcome — `ok | retried-ok |
 * fell-back(backend | invalid-reply)` — and this file reads those counters.
 *
 * SECOND, NOTHING BOUND THE CLAIM TO THE RUN. `judgeTraces` took a
 * caller-supplied `{degraded, reasons}` and could not check it: a forged
 * `{degraded: false}`, or an honest one replayed from a healthy run onto a
 * degraded one, or one edited after the numbers were in, all passed. An
 * attestation now carries a MAC over the run's own trace set, its seeds and the
 * gate's rule hash, keyed by the blinding secret — which is drawn from the
 * host's CSPRNG per run and is published only after `unseal()`. Forging it
 * needs the secret; replaying it fails on the handles; editing it fails on the
 * digest. `judgeTraces` verifies before it judges and refuses on a mismatch.
 */

/** What every think in one arm did. Counted at the source, never from a row. */
export interface ThinkOutcomeReport {
  thinks: number;
  ok: number;
  retriedOk: number;
  fellBack: number;
  /** `fellBack / thinks` — the number S6 is about. */
  fallbackRate: number;
  /** `(retriedOk + fellBack) / thinks` — reported, not a threshold on its own. */
  retryRate: number;
  fellBackByReason: Record<ThinkFallbackReason, number>;
}

/**
 * PRE-REGISTERED, like `INTEGRITY_THRESHOLDS` and `JUDGE_GATE` before it.
 *
 * TWO PERCENT. A think the world carried is not this mind's behaviour, and the
 * reviewer's 5% plant is the smallest degradation anyone bothered to plant — so
 * the threshold sits below it rather than between the plants. Retries are
 * REPORTED and not gated: a retry that succeeded produced this mind's own
 * decision, and a threshold on it would refuse runs for a slow provider.
 */
export const ATTESTATION_THRESHOLDS = Object.freeze({
  /**
   * TWO PERCENT OF THINKS THE WORLD CARRIED. A think that fell back is not this
   * mind's behaviour, and the reviewer's smallest plant was 5%, so the
   * threshold sits below the plants rather than between them.
   */
  maxFallbackRate: 0.02,
  /**
   * TWO PERCENT OF THINKS THAT NEEDED A SECOND COMPLETION — and this is the
   * threshold that actually catches the reviewer's 5% plant.
   *
   * The arithmetic matters and round 4 never did it. `LlmMind` tries twice, so
   * a transport failing a share f of CALLS makes a think RETRY at about f and
   * FALL BACK at about f²: a 5% plant falls back on **0.25%** of thinks, which
   * no honest fallback threshold can catch, while 5% of thinks needed a second
   * completion. The retry rescued the DECISION — that moment really is the
   * mind's own — but it did not rescue the RUN: a transport failing one call in
   * twenty is not the transport the block was priced and powered for, and
   * pretending otherwise is exactly how a 5% plant reads `fallbackRate 0`.
   *
   * Measured (`test/eval-attest.test.ts`, 400 thinks/cell): a 5% plant gives a
   * retry rate around 0.04–0.05 and a fallback rate around 0.002; a 20% plant
   * about 0.20 and 0.04. Both are caught here; 20% and 100% are caught by the
   * fallback threshold as well.
   */
  maxRetryRate: 0.02,
  /** Reported beside it so a reader can see the traffic the rate came from. */
  minThinksForARate: 1,
});

/** Identity and integrity of the run an attestation belongs to. */
export interface AttestationBinding {
  /** How many blind handles the run produced. */
  traces: number;
  /** Which seeds it ran. The clusters, in order. */
  seeds: readonly string[];
  /** sha256 over the sorted handles — the trace SET, not its order. */
  handleDigest: string;
  publicSeed: string;
  commitment: string;
  /** The gate rule the verdict will be read under. */
  ruleHash: string;
  /** MAC over everything above AND over the claim, keyed by the blinding secret. */
  mac: string;
}

export interface RunAttestation {
  /** True when any pre-registered integrity threshold was crossed. */
  degraded: boolean;
  /** Which ones, in words. Empty when it is not degraded. */
  reasons: readonly string[];
  /** Per arm, counted at the source. Absent only on an attestation minted by hand. */
  thinkOutcomes?: Record<string, ThinkOutcomeReport>;
  /** Echoed so a reader need not look them up. */
  thresholds?: typeof ATTESTATION_THRESHOLDS;
  /** Present on every attestation `attestRun` minted. Absent means unbindable. */
  binding?: AttestationBinding;
}

export interface AttestationClaim {
  degraded: boolean;
  reasons: readonly string[];
  thinkOutcomes: Record<string, ThinkOutcomeReport>;
  seeds: readonly string[];
  ruleHash: string;
}

/**
 * Mint an attestation for a run, bound to its own key.
 *
 * The key is asked for a MAC, not for its arms: `bind` reveals nothing and does
 * not unseal, so an attestation can be minted while the judging is still blind.
 */
export function attestRun(key: SealedTraceKey, claim: AttestationClaim): RunAttestation {
  const handles = [...key.handles()].sort();
  const handleDigest = sha256Hex(`yggdrasil/handles/v1:${handles.join(',')}`);
  const binding: Omit<AttestationBinding, 'mac'> = {
    traces: handles.length,
    seeds: [...claim.seeds],
    handleDigest,
    publicSeed: key.publicSeed,
    commitment: key.commitment,
    ruleHash: claim.ruleHash,
  };
  return {
    degraded: claim.degraded,
    reasons: [...claim.reasons],
    thinkOutcomes: claim.thinkOutcomes,
    thresholds: ATTESTATION_THRESHOLDS,
    binding: { ...binding, mac: key.bind(digestOf(binding, claim)) },
  };
}

export interface AttestationCheck {
  ok: boolean;
  /** Why it was refused. Null when it verified. */
  reason: string | null;
}

/**
 * Verify an attestation against the key it claims to belong to, and against the
 * rule the verdict is about to be read under.
 */
export function verifyAttestation(
  attestation: RunAttestation | null | undefined,
  key: SealedTraceKey,
  ruleHash: string,
): AttestationCheck {
  if (!attestation) {
    return {
      ok: false,
      reason:
        'no run integrity was attested: an aggregate that has not been told whether the arms actually ran their own ' +
        'minds is not a verdict about the arms',
    };
  }
  const binding = attestation.binding;
  if (!binding) {
    return {
      ok: false,
      reason:
        'the attestation carries no binding, so nothing ties it to this run: a caller-supplied {degraded, reasons} ' +
        'is a claim about some run, and a verdict needs a claim about THIS one',
    };
  }
  const handles = [...key.handles()].sort();
  const handleDigest = sha256Hex(`yggdrasil/handles/v1:${handles.join(',')}`);
  if (binding.handleDigest !== handleDigest || binding.traces !== handles.length) {
    return { ok: false, reason: 'the attestation was minted over a DIFFERENT set of traces — a replayed attestation is not an attestation' };
  }
  if (binding.publicSeed !== key.publicSeed || binding.commitment !== key.commitment) {
    return { ok: false, reason: 'the attestation belongs to another blinding (its public seed or commitment does not match this key)' };
  }
  if (binding.ruleHash !== ruleHash) {
    return {
      ok: false,
      reason: `the attestation was minted under gate rule ${binding.ruleHash.slice(0, 12)} and this verdict is being read under ${ruleHash.slice(0, 12)}`,
    };
  }
  const expected = key.bind(
    digestOf(
      {
        traces: binding.traces,
        seeds: binding.seeds,
        handleDigest: binding.handleDigest,
        publicSeed: binding.publicSeed,
        commitment: binding.commitment,
        ruleHash: binding.ruleHash,
      },
      {
        degraded: attestation.degraded,
        reasons: attestation.reasons,
        thinkOutcomes: attestation.thinkOutcomes ?? {},
        seeds: binding.seeds,
        ruleHash: binding.ruleHash,
      },
    ),
  );
  if (expected !== binding.mac) {
    return {
      ok: false,
      reason:
        'the attestation does not authenticate: it was forged, or it was edited after it was minted (the MAC covers ' +
        'the degraded flag, the reasons and the per-arm think counters, not just the handles)',
    };
  }
  return { ok: true, reason: null };
}

/** The bytes the MAC is taken over. Canonical, so two mints of one claim agree. */
function digestOf(binding: Omit<AttestationBinding, 'mac'>, claim: AttestationClaim): string {
  const arms = Object.keys(claim.thinkOutcomes).sort();
  const outcomes = arms
    .map((arm) => {
      const row = claim.thinkOutcomes[arm]!;
      return `${arm}:${row.thinks}/${row.ok}/${row.retriedOk}/${row.fellBack}/${row.fellBackByReason.backend}/${row.fellBackByReason['invalid-reply']}`;
    })
    .join(';');
  return sha256Hex(
    [
      'yggdrasil/attest/v1',
      binding.handleDigest,
      String(binding.traces),
      binding.publicSeed,
      binding.commitment,
      binding.ruleHash,
      [...binding.seeds].join(','),
      claim.degraded ? 'DEGRADED' : 'clean',
      [...claim.reasons].join('|'),
      outcomes,
    ].join(' '),
  );
}

// ─── Reading the source counters ─────────────────────────────────────────────

/**
 * Watch every think that goes through ONE backend, until `stop()`.
 *
 * The filter is the backend OBJECT, not the model id: two arms of an A/B share
 * a model id and an agent id space, and only the transport tells them apart.
 */
export function watchThinkOutcomes(belongsTo: (outcome: ThinkOutcome) => boolean): {
  counters: ThinkOutcomeCounters;
  stop: () => void;
} {
  const counters = new ThinkOutcomeCounters();
  const stop = observeThinkOutcomes((outcome) => {
    if (belongsTo(outcome)) counters.observeThink(outcome);
  });
  return { counters, stop };
}

export function reportOf(counters: ThinkOutcomeCounters): ThinkOutcomeReport {
  return {
    thinks: counters.thinks,
    ok: counters.ok,
    retriedOk: counters.retriedOk,
    fellBack: counters.fellBack,
    fallbackRate: counters.fallbackRate,
    retryRate: counters.retryRate,
    fellBackByReason: { ...counters.fellBackByReason },
  };
}

/** Which arms crossed the pre-registered fallback threshold, in words. */
export function thinkOutcomeBreaches(outcomes: Record<string, ThinkOutcomeReport>): string[] {
  const out: string[] = [];
  for (const arm of Object.keys(outcomes).sort()) {
    const row = outcomes[arm]!;
    if (row.thinks === 0) {
      out.push(`arm ${arm} reported no thinks at all, so nothing about it has been measured`);
      continue;
    }
    if (row.fallbackRate > ATTESTATION_THRESHOLDS.maxFallbackRate) {
      const why = Object.entries(row.fellBackByReason)
        .filter(([, n]) => n > 0)
        .map(([reason, n]) => `${n} ${reason}`)
        .join(', ');
      out.push(
        `arm ${arm} fell back to the world's reflex policy on ${row.fellBack} of ${row.thinks} thinks ` +
          `(${row.fallbackRate} > ${ATTESTATION_THRESHOLDS.maxFallbackRate}${why ? `; ${why}` : ''}): those moments are the WORLD acting, not this mind`,
      );
    }
    if (row.retryRate > ATTESTATION_THRESHOLDS.maxRetryRate) {
      out.push(
        `arm ${arm} needed a SECOND completion on ${row.retriedOk + row.fellBack} of ${row.thinks} thinks ` +
          `(${row.retryRate} > ${ATTESTATION_THRESHOLDS.maxRetryRate}): the retry rescued the decision, not the run — ` +
          'a transport this unreliable is not the one this block was priced and powered for',
      );
    }
  }
  return out;
}
