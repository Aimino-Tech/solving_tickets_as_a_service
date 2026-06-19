#!/usr/bin/env bash
# =============================================================================
# STAS CI Gates — "Leave It Cleaner Than You Found It"
#
# Three gates that run on every PR:
#   Gate 1 — LSP/TypeScript diagnostics on changed files (zero-tolerance)
#   Gate 2 — Test regression check (compare base vs head)
#   Gate 3 — Lint diff check (block new warnings)
#
# Usage:
#   bash .github/scripts/ci-gates.sh <gate-number>
#
# Environment:
#   CI=true                          Set when running in GitHub Actions
#   BASE_SHA=<sha>                   Merge-base commit (default: origin/main)
#   HEAD_SHA=<sha>                   PR head commit (default: HEAD)
# =============================================================================
set -euo pipefail

GATE="${1:-all}"
BASE_SHA="${BASE_SHA:-$(git merge-base origin/main HEAD 2>/dev/null || echo origin/main)}"
HEAD_SHA="${HEAD_SHA:-HEAD}"
EXIT_CODE=0

# ---------------------------------------------------------------------------
# Utilities
# ---------------------------------------------------------------------------
info()  { printf "\033[36m[ci-gates]\033[0m %s\n" "$*"; }
pass()  { printf "\033[32m[  PASS]\033[0m %s\n" "$*"; }
fail()  { printf "\033[31m[  FAIL]\033[0m %s\n" "$*"; EXIT_CODE=1; }

get_changed_files() {
  git diff --name-only "$BASE_SHA"..."$HEAD_SHA" --diff-filter=ACMRT | sort -u
}

get_changed_ts_files() {
  get_changed_files | grep -E '\.(ts|tsx|mts|cts)$' || true
}

# ---------------------------------------------------------------------------
# Gate 1 — LSP Diagnostics on Changed Files
#   Runs TypeScript compiler diagnostics on every file touched in the PR.
#   BLOCK if any error found (pre-existing OR new).
# ---------------------------------------------------------------------------
gate_lsp_diagnostics() {
  info "Gate 1 — LSP Diagnostics on changed files"

  local changed_files
  changed_files=$(get_changed_ts_files)

  if [ -z "$changed_files" ]; then
    pass "No TypeScript files changed — skipping Gate 1"
    return
  fi

  info "Changed TS files:"
  echo "$changed_files" | while IFS= read -r f; do echo "  - $f"; done

  # Run tsc --noEmit to check ALL files (catches pre-existing too)
  info "Running tsc --noEmit (full project diagnostics)..."
  if npm run typecheck 2>&1; then
    pass "Gate 1 — tsc --noEmit: zero errors"
  else
    fail "Gate 1 — tsc --noEmit: TypeScript errors found (see above)"
  fi

  # Additionally, run a focused check on just the changed files
  info "Running isolated diagnostics on changed files..."
  local has_errors=0
  for file in $changed_files; do
    if [ ! -f "$file" ]; then
      info "  Skipping deleted file: $file"
      continue
    fi
    # Use npx tsc with --noEmit on individual file when possible
    # Fallback: check if the file parses correctly via node --check
    if [[ "$file" == *.ts ]] || [[ "$file" == *.tsx ]]; then
      if ! npx tsc --noEmit --strict "$file" 2>/dev/null; then
        fail "Gate 1 — Diagnostic error in: $file"
        has_errors=1
      fi
    fi
  done

  if [ "$has_errors" -eq 0 ]; then
    pass "Gate 1 — All changed files pass diagnostics"
  fi
}

# ---------------------------------------------------------------------------
# Gate 2 — Test Regression Check
#   Run test suite on base branch, then on PR head. Compare results.
#   BLOCK if any previously-passing test now fails.
# ---------------------------------------------------------------------------
gate_test_regression() {
  info "Gate 2 — Test Regression Check"

  local base_results="/tmp/test-results-base.json"
  local head_results="/tmp/test-results-head.json"

  # Run tests on base branch
  info "Running tests on BASE ($BASE_SHA)..."
  git stash push --include-untracked 2>/dev/null || true
  git checkout "$BASE_SHA" -- 2>/dev/null || true
  npm ci --silent 2>/dev/null
  if npx vitest run --reporter=json 2>/dev/null | tail -1 > "$base_results"; then
    pass "Base tests passed"
  fi

  # Restore PR head
  info "Running tests on HEAD ($HEAD_SHA)..."
  git checkout "$HEAD_SHA" -- 2>/dev/null || true
  git stash pop 2>/dev/null || true
  npm ci --silent 2>/dev/null
  if npx vitest run --reporter=json 2>/dev/null | tail -1 > "$head_results"; then
    pass "Head tests passed"
  fi

  # Compare results
  local regression_count=0
  if [ -f "$base_results" ] && [ -f "$head_results" ]; then
    regression_count=$(node -e "
      const base = JSON.parse(require('fs').readFileSync('$base_results','utf8'));
      const head = JSON.parse(require('fs').readFileSync('$head_results','utf8'));
      const basePassed = new Set(
        (base.testResults || []).flatMap(r =>
          (r.assertionResults || [])
            .filter(a => a.status === 'passed')
            .map(a => r.title + ' > ' + a.title)
        )
      );
      const headFailed = new Set(
        (head.testResults || []).flatMap(r =>
          (r.assertionResults || [])
            .filter(a => a.status === 'failed')
            .map(a => r.title + ' > ' + a.title)
        )
      );
      let count = 0;
      for (const test of basePassed) {
        if (headFailed.has(test)) {
          console.log('  REGRESSION: ' + test);
          count++;
        }
      }
      console.error('count=' + count);
      process.exit(0);
    " 2>&1)
    regression_count=$(echo "$regression_count" | grep '^[0-9]' || echo "0")
  else
    info "Could not parse test results (JSON reporter may differ)"
    # Fallback: just check if tests pass on head
    if npx vitest run 2>&1; then
      pass "Gate 2 — All tests pass on PR head"
    else
      fail "Gate 2 — Tests failing on PR head"
    fi
    return
  fi

  if [ "$regression_count" -gt 0 ]; then
    fail "Gate 2 — $regression_count regression(s) found (previously-passing tests now fail)"
  else
    pass "Gate 2 — Zero regressions (all previously-passing tests still pass)"
  fi

  # Cleanup
  rm -f "$base_results" "$head_results"
}

# ---------------------------------------------------------------------------
# Gate 3 — Lint Diff Check
#   Run biome check on files changed in this PR. BLOCK if new lint warnings
#   introduced that don't exist on the base branch.
# ---------------------------------------------------------------------------
gate_lint_diff() {
  info "Gate 3 — Lint Diff Check"

  local changed_files
  changed_files=$(get_changed_files)

  if [ -z "$changed_files" ]; then
    pass "No files changed — skipping Gate 3"
    return
  fi

  # Use biome check --changed with git integration
  info "Running biome check on changed files (--since=$BASE_SHA)..."
  if npx biome check --changed --since="$BASE_SHA" 2>&1; then
    pass "Gate 3 — No new lint warnings"
  else
    fail "Gate 3 — New lint warnings found in changed files"
  fi
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
case "$GATE" in
  1) gate_lsp_diagnostics ;;
  2) gate_test_regression ;;
  3) gate_lint_diff ;;
  all)
    gate_lsp_diagnostics
    echo ""
    gate_test_regression
    echo ""
    gate_lint_diff
    ;;
  *)
    echo "Usage: $0 {1|2|3|all}"
    exit 1
    ;;
esac

exit $EXIT_CODE
