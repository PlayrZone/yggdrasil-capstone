#!/usr/bin/env bash
# Runs the Milestone 2 evidence at the current commit of the capstone clone.
# Usage: run_evidence.sh <repo> <outdir>
set -u
REPO="$1"; OUT="$2"
mkdir -p "$OUT/baseline"
export NO_COLOR=1 FORCE_COLOR=0
cd "$REPO" || exit 1

stamp() { date -u +%FT%TZ; }
header() {
  echo "commit:   $(git rev-parse HEAD)"
  echo "dirty:    $([ -z "$(git status --porcelain)" ] && echo no || echo yes)"
  echo "started:  $(stamp)"
  echo "node:     $(node --version)   pnpm: $(pnpm --version)"
  echo "command:  $1"
  echo "----------------------------------------------------------------"
}
run() { # run <logfile> <label> <cmd...>
  local log="$OUT/$1"; shift; local label="$1"; shift
  { header "$label"; "$@" 2>&1; echo "----------------------------------------------------------------"; echo "exit code: $?   finished: $(stamp)"; } > "$log"
  tail -3 "$log" | head -2
}

echo "[1] baseline";  YGG_BASELINE_OUT="$(cygpath -w "$OUT/baseline")" run 01-baseline-run.txt "pnpm --filter @yggdrasil/engine baseline" pnpm --filter @yggdrasil/engine baseline
echo "[2] bench";     run 02-throughput-bench.txt "pnpm --filter @yggdrasil/engine exec vitest run --config bench/vitest.config.ts bench/spatial.bench.ts" pnpm --filter @yggdrasil/engine exec vitest run --config bench/vitest.config.ts bench/spatial.bench.ts
echo "[3] adapter";   run 03-world-adapter-audit.txt "vitest run (adapter boundary tests) --reporter=verbose" pnpm --filter @yggdrasil/engine exec vitest run test/mind-type-graph.test.ts test/world-adapter.test.ts test/world-space.test.ts test/world-tables-out.test.ts test/world-tables-transcribed.test.ts test/mind-no-geometry.test.ts test/world-vocabulary.test.ts --reporter=verbose
echo "[4] replay";    run 04-determinism-replay.txt "vitest run (determinism, goldens, record/replay) --reporter=verbose" pnpm --filter @yggdrasil/engine exec vitest run test/continent-determinism.test.ts test/golden-state.test.ts test/continent-golden.test.ts test/record.test.ts --reporter=verbose
echo "[5] suites"
{
  header "typecheck + full test suites (engine, db, mcp-server, lab)"
  for step in "@yggdrasil/engine typecheck" "@yggdrasil/engine test" "@yggdrasil/db test" "@yggdrasil/mcp-server test" "@yggdrasil/lab typecheck" "@yggdrasil/lab test"; do
    set -- $step
    echo; echo "### pnpm --filter $1 $2"
    pnpm --filter "$1" "$2" 2>&1 | tail -14
    echo "### exit code: ${PIPESTATUS[0]}"
  done
  echo "----------------------------------------------------------------"; echo "finished: $(stamp)"
} > "$OUT/05-full-test-suites.txt" 2>&1
grep -E "^### |Test Files|Tests " "$OUT/05-full-test-suites.txt"
echo "ALL DONE $(stamp)"
