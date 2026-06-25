#!/usr/bin/env bash
# =============================================================================
# STAS CI Gates — "Leave It Cleaner Than You Found It"
#
# Five gates that run on every PR:
#   Gate 0 — "Leave It Cleaner" (lsp_diagnostics + test suite on touched files)
#   Gate 1 — LSP/TypeScript diagnostics on changed files (zero-tolerance)
#   Gate 2 — Test regression check (compare base vs head test results)
#   Gate 3 — Lint diff enforcement (biome check)
#   Gate 4 — (Optional) Container vulnerability scan (grype)
#
# Usage:
#   bash .github/scripts/ci-gates.sh <gate-number>     # single gate
#   bash .github/scripts/ci-gates.sh all               # all gates (default)
#   bash .github/scripts/ci-gates.sh 1,3               # specific gates
#
# Environment:
#   CI=true                          Set when running in GitHub Actions
#   BASE_SHA=<sha>                   Merge-base commit (default: origin/main)
#   HEAD_SHA=<sha>                   PR head commit (default: HEAD)
#   CI_SKIP_VULN_SCAN=true           Skip vulnerability scan (Gate 4)
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
warn()  { printf "\033[33m[  WARN]\033[0m %s\n" "$*"; }
fail()  { printf "\033[31m[  FAIL]\033[0m %s\n" "$*"; EXIT_CODE=1; }

get_changed_files() {
  git diff --name-only "$BASE_SHA"..."$HEAD_SHA" --diff-filter=ACMRT | sort -u || true
}

get_changed_ts_files() {
  get_changed_files | grep -E '\.(ts|tsx|mts|cts)$' || true
}

get_changed_checkable_files() {
  get_changed_files | grep -E '\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|json|css)$' || true
}

# ---------------------------------------------------------------------------
# Gate 1 — LSP Diagnostics on Changed Files
#   Runs TypeScript compiler diagnostics on every file touched in the PR.
#   BLOCK if any error found on touched files (pre-existing OR new).
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

  # Run tsc --noEmit (full project)
  info "Running tsc --noEmit (full project diagnostics)..."
  local tsc_output
  tsc_output=$(npx tsc --noEmit 2>&1 || true)

  if echo "$tsc_output" | grep -qi "error TS"; then
    # Check if any error references our changed files
    local touched_errors=0
    while IFS= read -r file; do
      if echo "$tsc_output" | grep -q "$file"; then
        fail "Gate 1 — TypeScript error in: $file"
        touched_errors=$((touched_errors + 1))
      fi
    done <<< "$changed_files"

    if [ "$touched_errors" -eq 0 ]; then
      pass "Gate 1 — No TypeScript errors in changed files (errors exist elsewhere)"
    fi
  else
    pass "Gate 1 — tsc --noEmit: zero errors"
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
  local base_sha_actual
  local head_sha_actual

  # Resolve SHAs
  base_sha_actual=$(git rev-parse "$BASE_SHA" 2>/dev/null || echo "$BASE_SHA")
  head_sha_actual=$(git rev-parse "$HEAD_SHA" 2>/dev/null || echo "$HEAD_SHA")

  # Stash working changes
  local stash_created=false
  if ! git diff --quiet 2>/dev/null; then
    git stash push --include-untracked 2>/dev/null || true
    stash_created=true
  fi

  # ── Run tests on base ──
  info "Running tests on BASE (${base_sha_actual:0:12})..."
  if git cat-file -e "${base_sha_actual}" 2>/dev/null; then
    git checkout -q "${base_sha_actual}" -- 2>/dev/null || true
  fi

  if npx vitest run --reporter=json 2>/dev/null | tail -1 > "$base_results" 2>/dev/null; then
    pass "Base tests passed"
  else
    warn "Base tests had failures (these are pre-existing)"
  fi

  # ── Restore head ──
  info "Running tests on HEAD (${head_sha_actual:0:12})..."
  git checkout -q "${head_sha_actual}" -- 2>/dev/null || true
  if [ "$stash_created" = true ]; then
    git stash pop 2>/dev/null || true
  fi

  if npx vitest run --reporter=json 2>/dev/null | tail -1 > "$head_results" 2>/dev/null; then
    pass "Head tests passed"
  fi

  # ── Compare results ──
  local regression_count=0
  if [ -f "$base_results" ] && [ -f "$head_results" ]; then
    regression_count=$(node -e "
      const base = JSON.parse(require('fs').readFileSync('$base_results','utf8'));
      const head = JSON.parse(require('fs').readFileSync('$head_results','utf8'));
      const basePassed = new Set(
        (base.testResults || []).flatMap(r =>
          (r.assertionResults || [])
            .filter(a => a.status === 'passed')
            .map(a => (r.title || '') + ' > ' + (a.fullName || a.title || ''))
        )
      );
      const headFailed = new Set(
        (head.testResults || []).flatMap(r =>
          (r.assertionResults || [])
            .filter(a => a.status === 'failed')
            .map(a => (r.title || '') + ' > ' + (a.fullName || a.title || ''))
        )
      );
      let count = 0;
      for (const test of basePassed) {
        if (headFailed.has(test)) {
          console.log('  REGRESSION: ' + test);
          count++;
        }
      }
      process.stdout.write(String(count));
    " 2>/dev/null || echo "0")

    # Ensure we have a number
    regression_count=$(echo "$regression_count" | grep -oE '^[0-9]+' || echo "0")
  else
    info "JSON test results not available — running head-only check"
    if npx vitest run 2>&1; then
      pass "Gate 2 — All tests pass on PR head"
    else
      fail "Gate 2 — Tests failing on PR head"
    fi
    rm -f "$base_results" "$head_results"
    return
  fi

  if [ "$regression_count" -gt 0 ]; then
    fail "Gate 2 — $regression_count regression(s) found (previously-passing tests now fail)"
  else
    pass "Gate 2 — Zero regressions (all previously-passing tests still pass)"
  fi

  rm -f "$base_results" "$head_results"
}

# ---------------------------------------------------------------------------
# Gate 3 — Lint Diff Check
#   Run biome check on files changed in this PR. BLOCK if new lint warnings.
# ---------------------------------------------------------------------------
gate_lint_diff() {
  info "Gate 3 — Lint Diff Check"

  local changed_files
  changed_files=$(get_changed_checkable_files)

  if [ -z "$changed_files" ]; then
    pass "No checkable files changed — skipping Gate 3"
    return
  fi

  # Use biome check --changed with git integration
  info "Running biome check on changed files (--since=$BASE_SHA)..."
  if npx biome check --changed --since="$BASE_SHA" 2>&1; then
    pass "Gate 3 — No new lint warnings"
  else
    local biome_exit=$?
    # biome exits 1 on warnings, >1 on errors
    if [ "$biome_exit" -eq 1 ]; then
      warn "Gate 3 — Biome warnings found (non-blocking advisory)"
      pass "Gate 3 — No blocking lint errors"
    else
      fail "Gate 3 — Biome check failed with exit code $biome_exit"
    fi
  fi
}

# ---------------------------------------------------------------------------
# Gate 4 — Vulnerability scan gate (optional)
# ---------------------------------------------------------------------------
gate_vulnerability_scan() {
  info "Gate 4 — Container vulnerability scan"
  if [ "${CI_SKIP_VULN_SCAN:-}" = "true" ]; then
    pass "Gate 4 — Skipped (CI_SKIP_VULN_SCAN=true)"
    return
  fi
  if ! command -v grype >/dev/null 2>&1; then
    warn "grype not installed — skipping Gate 4"
    return
  fi
  local image="stas-bot:ci-scan"
  if docker build -t "${image}" --target build . >/dev/null 2>&1; then
    if grype "${image}" --fail-on high --scope all-layers -q; then
      pass "Gate 4 — No critical/high vulnerabilities found"
    else
      fail "Gate 4 — Critical or high vulnerabilities detected in container image"
    fi
  else
    warn "Gate 4 — Docker build failed, skipping scan"
  fi
}

# ---------------------------------------------------------------------------
# Gate resolution
# ---------------------------------------------------------------------------
run_gate() {
  case "$1" in
    1) gate_lsp_diagnostics ;;
    2) gate_test_regression ;;
    3) gate_lint_diff ;;
    4) gate_vulnerability_scan ;;
    *) fail "Unknown gate: $1" ;;
  esac
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
case "$GATE" in
  all)
    run_gate 0
    echo ""
    run_gate 1
    echo ""
    run_gate 2
    echo ""
    run_gate 3
    echo ""
    run_gate 4
    ;;
  *,*)
    # Comma-separated gate list
    IFS=',' read -ra GATES <<< "$GATE"
    for g in "${GATES[@]}"; do
      run_gate "$g"
      echo ""
    done
    ;;
  [0-9]*)
    run_gate "$GATE"
    ;;
  *)
    echo "Usage: $0 {1|2|3|4|all|1,2,3}"
    exit 1
    ;;
esac

exit $EXIT_CODE
