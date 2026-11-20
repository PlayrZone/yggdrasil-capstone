# Research baseline

A measurement harness, not engine code. It runs the fixed seeded headless runs in the `RUNS` table at the top of `research-baseline.baseline.ts`, proves same-seed repeatability by whole-state fingerprint (`test/fingerprint.ts`), checks a different seed gives a different fingerprint and that a split advance equals a single one, measures throughput, and writes evidence files. Any failed check fails the run (after the files are written).

Run: `pnpm --filter @yggdrasil/engine baseline`

Output goes to `baseline/results/` (or `$YGG_BASELINE_OUT`):

- `baseline-results.json` — machine, engine version, git commit/dirty, every run's metrics, fingerprints and check results.
- `baseline-metrics.csv` — one flat row per run (deaths as `cause:count;cause:count`).
- `baseline-summary.txt` — a short table for a terminal.

Wall-clock fields are the only non-deterministic values. No model is called: runs use the reflex backend (asserted via `backendLabel === 'reflex'`), no network, no keys.
