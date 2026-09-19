import type { LeakDomain } from './leakMatch.js';

/**
 * THE CALIBRATION CARD — what the detector actually scores, shipped as data
 * beside it so the gate can never quote a number nobody measured.
 *
 * The history of this file is the whole argument for it. Round 1's gate printed
 * "precision 1.00 / recall 1.00", measured on the 80 fixtures the matcher had
 * been written from; a blind set of 138 outputs then measured 0.94 / 0.42.
 * Round 2 printed "measured recall 0.944" from the holdout half of a dev set
 * the same engineer wrote; a SECOND blind set, 184 outputs, measured
 * 0.824 / 0.412. Twice now the self-measured number has been roughly 2.3× the
 * blind one, in the same direction, for the same reason: a set you wrote is a
 * set your matcher already agrees with. Round 3 was re-scored on that same
 * blind set at 0.982 / 0.539 — precision and recall rose TOGETHER, because the
 * false positives removed were rules rather than words — and the self-measured
 * half still reads 1.000 / 0.964, so the gap has not closed and the two halves
 * stay separate. Round 5 re-scored the same 184 outputs at 0.981 / 0.510: three
 * rows went silent, all three by a deliberate ruling, and the card moves DOWN
 * with them rather than keeping the flattering number.
 *
 * So the card has two halves and they are not equals:
 *
 *   `blind` is REVIEWED DATA — measured by someone else, on outputs this repo
 *   has never seen and does not contain, with who measured it, when, and the
 *   hash of the set as given in their report. It is the HEADLINE: the gate's
 *   verdict quotes this recall and nothing higher (`quotableRecall`).
 *
 *   `selfMeasured` is the engineer's own dev set. It stays, because it is how
 *   the matcher is developed and how the confusions are read — but it is
 *   labelled what it is: optimistic by construction, not evidence about
 *   anything the matcher has not seen.
 *
 * `packages/engine/test/fidelity.test.ts` recomputes every self-measured number
 * here from the dev set and fails if the card has drifted, and asserts that no
 * verdict string can quote a recall above `blind.recall` — so this file cannot
 * rot, and cannot be improved by editing.
 */

export interface CalibrationPR {
  precision: number;
  recall: number;
}

/**
 * A measurement made by someone who did not write the detector, on a set the
 * detector's author never sees. Everything here is transcribed from their
 * report; nothing in this repo can recompute it, which is the point.
 */
export interface BlindMeasurement {
  /** The set's id, as its owner names it. */
  set: string;
  n: number;
  precision: number;
  recall: number;
  /** Recall by domain, for the domains the report quoted. */
  perDomain: { domain: LeakDomain; recall: number }[];
  /** Who measured it. */
  measuredBy: string;
  /** When, as their report stamps it. */
  measuredAt: string;
  /** The set's hash, exactly as the report gives it (theirs is abbreviated). */
  sha256: string;
  /** Where the set lives — deliberately OUTSIDE this repo. */
  heldAt: string;
  /** Which tree it was measured on, and what the number does and does not cover. */
  note: string;
}

export interface CalibrationCard {
  /** Which detector was scored. */
  detector: string;
  /** The headline. Reviewed data; the verdict may quote no recall above this. */
  blind: BlindMeasurement;
  /** The engineer's own set: how the matcher is developed, not how it is judged. */
  selfMeasured: {
    label: 'self-measured, optimistic';
    set: { id: string; size: number; leaks: number; cleans: number };
    /** Everything: the half the matcher was tuned on and the half it was not. */
    measured: CalibrationPR;
    /** The half the matcher was NOT tuned on. Still the author's own writing. */
    holdout: CalibrationPR;
    byDomain: { domain: LeakDomain; precision: number; recall: number }[];
  };
  /** How the sets were made, and what that does to the numbers. */
  provenance: string;
  caveats: string[];
}

export const LEXICAL_CALIBRATION: CalibrationCard = {
  detector: 'tier2-lexical@r5',
  blind: {
    set: 'T1-blind-r2',
    n: 184,
    precision: 0.981,
    recall: 0.51,
    perDomain: [
      { domain: 'astronomy', recall: 0.583 },
      { domain: 'cultivation', recall: 0.429 },
      { domain: 'fire', recall: 0.846 },
      { domain: 'governance', recall: 0.231 },
      { domain: 'medicine', recall: 0.417 },
      { domain: 'metallurgy', recall: 0.462 },
      { domain: 'toolmaking', recall: 0.615 },
      { domain: 'trade', recall: 0.5 },
    ],
    measuredBy: 'T1 reviewer, rework campaign round 5 (docs/rework/reviews/T1-reviewer.md)',
    measuredAt: '2026-09-18T19:30:34',
    sha256: '305b6bbe..ecebfe (abbreviated in the report; the full digest is the reviewer’s)',
    heldAt: 'C:\\Users\\hakim\\.yggdrasil-lab\\rework\\eval\\T1-blind-r2.jsonl — outside this repo, never read here',
    note: 're-scored on the round-5 tree, same 184 outputs; recall is reported, not targeted',
  },
  selfMeasured: {
    label: 'self-measured, optimistic',
    set: { id: 'dev-164-r2', size: 164, leaks: 84, cleans: 80 },
    measured: { precision: 1, recall: 0.952 },
    holdout: { precision: 1, recall: 0.917 },
    byDomain: [
      { domain: 'astronomy', precision: 1, recall: 1 },
      { domain: 'cultivation', precision: 1, recall: 1 },
      { domain: 'fire', precision: 1, recall: 0.909 },
      { domain: 'governance', precision: 1, recall: 0.9 },
      { domain: 'medicine', precision: 1, recall: 0.9 },
      { domain: 'metallurgy', precision: 1, recall: 1 },
      { domain: 'toolmaking', precision: 1, recall: 0.909 },
      { domain: 'trade', precision: 1, recall: 1 },
    ],
  },
  provenance:
    'The dev set is a reconstruction of the round-1 reviewer blind set from that review’s categories and its ' +
    'eight verbatim examples (the reviewer’s own file was scratch and is gone), widened from 138 to 164 ' +
    'outputs to cover every category it named. Written in full BEFORE the matcher was rebuilt; the matcher ' +
    'was then tuned by reading confusions on the TUNE half only, and `holdout` is the half never read. The ' +
    'blind half of the card is not reconstructable here at all: it is the reviewer’s file, and the only ' +
    'things this repo holds about it are the numbers, the hash and the ≤12 confusions they printed.',
  caveats: [
    'THE SELF-MEASURED NUMBERS ARE NOT EVIDENCE ABOUT UNSEEN TEXT. Four measurements in, the blind recall ' +
      'reads 0.510 against a self-measured 0.952. Read `blind` and treat `selfMeasured` as a development ' +
      'instrument.',
    'The round-4 lexicon audit moved five ordinary words out of the decisive lists (`tend`, `tending`, ' +
      '`temper`, `quench`, `fever`, `rules`) and cost one dev-set true positive, which is the trade this ' +
      'tier exists to make: a word with an innocent everyday sense cannot be evidence on its own.',
    'Tier 2 is a HIGH-PRECISION LOWER BOUND by decision, not by accident: round 3 stopped tuning it for ' +
      'recall, because a word matcher cannot follow paraphrase. Recall belongs to tier 3 (a judge), and the ' +
      'gate cannot print PASS without one.',
    'Scored on outputs alone — tier 1 (the plan) and tier 3 (a judge) are not in these numbers.',
    'Concepts outside the eight domains are undetectable here BY DESIGN. A being that leaks navigation, ' +
      'weaving or animal husbandry scores clean at this tier and always will.',
    'Paraphrase beyond the categories the reviews named is not represented in the dev set at all, and ' +
      'neither is any register the reviewers did not happen to use.',
    'The per-domain numbers are over 10–12 leaks per domain, so one confusion moves a domain by ~0.09.',
  ],
};

/**
 * The recall a verdict is allowed to print. NEVER above the latest blind
 * measurement — round 2 shipped `NO LEAK DETECTED (measured recall 0.944)` on a
 * detector whose blind recall was 0.412, overstating its own bound by 2.3× on
 * the verdict string itself. A self-measured number may lower this claim (a
 * detector that scores badly on its own set has no business claiming more) but
 * it may never raise it.
 */
export function quotableRecall(card: CalibrationCard): number {
  return Math.min(card.blind.recall, card.selfMeasured.holdout.recall);
}
