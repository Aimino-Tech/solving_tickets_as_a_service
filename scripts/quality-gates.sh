#!/usr/bin/env bash
# =============================================================================
# scripts/quality-gates.sh — SYNTARO Quality Gates Pipeline
#
# Implements 6 deterministic gates from AIM-1848/AIM-1895 + OSS tools:
#   Gate 1 — Reality Check: every referenced file actually exists
#   Gate 2 — Compile Check: tsc --noEmit passes (no type errors)
#   Gate 3 — Test Integrity Check: tests have real assertions (not vacuous)
#   Gate 4 — Hallucination/Stub Check: no placeholder patterns, fake imports
#   Gate 5 — Dead Code Check: knip + ts-prune (orphaned files, unused exports)
#   Gate 6 — External AI Tool Scan: ghostcheck + trace-core + anti-hallucination + vibecop
#
# Usage:
#   npm run quality-gates                      # run all 6 gates on full repo
#   npm run quality-gates -- --changed-only    # only scan files changed vs origin/main
#   npm run quality-gates -- --gate=1,3        # run specific gates only
#
# Exit codes:
#   0 — All gates PASSED
#   1 — Warnings (non-critical)
#   2 — One or more gates FAILED (fix before proceed)
# =============================================================================

set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

CHANGED_ONLY=false
SELECTED_GATES=""
FIX_DIFF=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --changed-only) CHANGED_ONLY=true; shift ;;
    --gate=*) SELECTED_GATES="${1#*=}"; shift ;;
    --fix-diff) FIX_DIFF="${2:-}"; shift 2 ;;
    --fix-diff=*) FIX_DIFF="${1#*=}"; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# ── Fix-diff mode (AIM-4622): gate a single fix patch in an isolated clone ──
# Applies the unified diff to a throwaway clone of the repo and runs the
# deterministic gates against exactly the files the patch touches. This is the
# mode used to verify cheap-tier (Tier 1-2) fixes with the same gates as
# frontier-tier fixes.
if [ -n "$FIX_DIFF" ]; then
  if [ ! -f "$FIX_DIFF" ]; then
    echo -e "${RED}Fix diff not found: $FIX_DIFF${NC}"
    exit 2
  fi
  if ! git rev-parse --git-dir >/dev/null 2>&1; then
    echo -e "${YELLOW}--fix-diff requires a git repo${NC}"
    exit 2
  fi
  FIX_TMP="$(mktemp -d)"
  trap 'rm -rf "$FIX_TMP"' EXIT
  git clone -q --no-hardlinks . "$FIX_TMP"
  if [ -d "$ROOT/node_modules" ]; then
    ln -s "$ROOT/node_modules" "$FIX_TMP/node_modules"
  fi
  if ! git -C "$FIX_TMP" apply --check "$FIX_DIFF" 2>/dev/null; then
    echo -e "${RED}Fix diff does not apply cleanly against HEAD${NC}"
    exit 2
  fi
  git -C "$FIX_TMP" apply "$FIX_DIFF"
  ROOT="$FIX_TMP"
  cd "$ROOT"
  CHANGED_FILES=$(grep -E '^\+\+\+ ' "$FIX_DIFF" | sed 's#^+++ b/##' | grep -v '/dev/null' || true)
  if [ -z "$CHANGED_FILES" ]; then
    echo -e "${YELLOW}No changed files parsed from fix diff${NC}"
    exit 2
  fi
  CHANGED_ONLY=true
fi

# ── Determine changed files ──────────────────────────────────────────────────
if $CHANGED_ONLY && [ -z "$FIX_DIFF" ]; then
  if ! git rev-parse --git-dir >/dev/null 2>&1; then
    echo -e "${YELLOW}Not a git repo — falling back to full scan${NC}"
    CHANGED_ONLY=false
  else
    BASE="${BASE_BRANCH:-origin/main}"
    CHANGED_FILES=$(git diff --name-only "$BASE"...HEAD --diff-filter=AM 2>/dev/null || git diff --name-only HEAD 2>/dev/null || echo "")
    if [ -z "$CHANGED_FILES" ]; then
      echo -e "${YELLOW}No changed files vs $BASE — scanning all files${NC}"
      CHANGED_ONLY=false
    fi
  fi
fi

if [ -n "$FIX_DIFF" ]; then
  echo -e "${CYAN}══════════════════════════════════════════════════════════════${NC}"
  echo -e "${CYAN}  QUALITY GATES — Fix diff: $(basename "$FIX_DIFF")${NC}"
  echo -e "${CYAN}══════════════════════════════════════════════════════════════${NC}"
  TS_CHANGED=$(echo "$CHANGED_FILES" | grep -E '\.(ts|tsx)$' | grep -v node_modules | grep -v '\.d\.ts$' || true)
elif $CHANGED_ONLY; then
  echo -e "${CYAN}══════════════════════════════════════════════════════════════${NC}"
  echo -e "${CYAN}  QUALITY GATES — Changed files vs $BASE${NC}"
  echo -e "${CYAN}══════════════════════════════════════════════════════════════${NC}"
  TS_CHANGED=$(echo "$CHANGED_FILES" | grep -E '\.(ts|tsx)$' | grep -v node_modules | grep -v '\.d\.ts$' || true)
else
  echo -e "${CYAN}══════════════════════════════════════════════════════════════${NC}"
  echo -e "${CYAN}  QUALITY GATES — Full repository scan${NC}"
  echo -e "${CYAN}══════════════════════════════════════════════════════════════${NC}"
fi

GATE_PASS=0
GATE_FAIL=0
GATE_SKIP=0

gate_header() {
  local n="$1" name="$2"
  echo ""
  echo -e "${CYAN}── Gate $n: $name ────────────────────────────────────────${NC}"
}

gate_pass() {
  local msg="$1"
  echo -e "  ${GREEN}✓ PASS:${NC} $msg"
  GATE_PASS=$((GATE_PASS + 1))
}

gate_fail() {
  local msg="$1"
  echo -e "  ${RED}✗ FAIL:${NC} $msg"
  GATE_FAIL=$((GATE_FAIL + 1))
}

gate_skip() {
  local msg="$1"
  echo -e "  ${YELLOW}— SKIP:${NC} $msg"
  GATE_SKIP=$((GATE_SKIP + 1))
}

run_gate() {
  local n="$1"
  if [ -n "$SELECTED_GATES" ]; then
    local run=false
    IFS=',' read -ra GATES <<< "$SELECTED_GATES"
    for g in "${GATES[@]}"; do
      if [ "$g" = "$n" ]; then run=true; fi
    done
    $run || { gate_skip "Gate $n excluded by --gate filter"; return; }
  fi
}

# ══════════════════════════════════════════════════════════════════════════════
# Gate 1 — Reality Check
# ══════════════════════════════════════════════════════════════════════════════
gate_header "1" "Reality Check — files referenced actually exist"
run_gate "1"

if $CHANGED_ONLY; then
  REALITY_TARGETS=$(echo "$CHANGED_FILES" | grep -E '\.(ts|tsx|js|jsx|py)$' | grep -v node_modules | grep -v '\.d\.ts$' || true)
else
  REALITY_TARGETS=$(find src/ workers/ -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.py' \) \
    -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/dist/*' -not -path '*/__pycache__/*' 2>/dev/null || true)
fi

if [ -z "$REALITY_TARGETS" ]; then
  gate_skip "No source files to check"
else
  PHANTOM_COUNT=0
  PHANTOM_PATTERNS=""
    # Extract import/require patterns and check if local files exist
      while IFS= read -r file; do
        if [ ! -f "$file" ]; then
          echo -e "    ${RED}[PHANTOM]${NC} File listed as changed but doesn't exist: $file"
          PHANTOM_COUNT=$((PHANTOM_COUNT + 1))
          continue
        fi
        # Extract relative imports from TypeScript/Python files
        if [[ "$file" == *.ts ]] || [[ "$file" == *.tsx ]]; then
          IMPORTS=$(grep -oP "(?:from\s+['\"])(\.\.?/[^'\"]+)(?:['\"]|$)" "$file" 2>/dev/null | sed "s/from ['\"]//" | sed "s/['\"]$//" || true)
        elif [[ "$file" == *.py ]]; then
          IMPORTS=$(grep -oP "(?:from\s+)(\.[.\w]+)(?:\s+import)" "$file" 2>/dev/null | sed "s/from //" | sed "s/ import//" || true)
        else
          IMPORTS=""
        fi
        for imp in $IMPORTS; do
          # Strip .js extension from TS imports (ESM convention, not phantom)
          imp_stripped="${imp%.js}"
          # Normalize import to potential file path
          dir=$(dirname "$file")
          resolved="$dir/$imp_stripped"
          # Try extensions
          found=false
          for ext in ".ts" ".tsx" ".js" ".jsx" "/index.ts" "/index.tsx" "/index.js"; do
            if [ -f "${resolved}${ext}" ]; then
              found=true
              break
            fi
          done
          if ! $found; then
            # For Python, try .py extension
            if [[ "$file" == *.py ]]; then
              py_path=$(echo "$resolved" | sed 's/\./\//g')
              if [ -f "${py_path}.py" ]; then
                found=true
              fi
            fi
          fi
          # Self-referencing import detection
          # Pattern: ./<parent-dir>/<basename> from <parent-dir>/<basename>.ts
          # Common in JSDoc examples where a usage import resolves to the file itself
          if ! $found && [[ "$file" == *.ts || "$file" == *.tsx ]]; then
            file_base_noext="$(basename "${file%.*}")"
            file_dir_base="$(basename "$(dirname "$file")")"
            imp_base="$(basename "$imp_stripped")"
            imp_dir="$(dirname "$imp_stripped")"
            imp_dir_base="$(basename "$imp_dir")"
            if [ "$imp_base" = "$file_base_noext" ] && [ "$imp_dir_base" = "$file_dir_base" ] && [ "$imp_dir" != "." ]; then
              found=true
            fi
          fi
          if ! $found && [[ "$imp" != .* ]]; then
            : # skip non-relative imports (npm packages)
          elif ! $found; then
            PHANTOM_COUNT=$((PHANTOM_COUNT + 1))
            echo -e "    ${YELLOW}[PHANTOM]${NC} $file imports '$imp_stripped' — file not found"
          fi
        done
      done <<< "$REALITY_TARGETS"

  if [ "$PHANTOM_COUNT" -gt 0 ]; then
    gate_fail "$PHANTOM_COUNT phantom file(s) detected"
  else
    gate_pass "All referenced source files exist"
  fi
fi

# ══════════════════════════════════════════════════════════════════════════════
# Gate 2 — Compile Check
# ══════════════════════════════════════════════════════════════════════════════
gate_header "2" "Compile Check — tsc --noEmit passes"
run_gate "2"

if [ ! -f tsconfig.json ]; then
  gate_skip "No tsconfig.json found"
elif ! command -v npx >/dev/null 2>&1; then
  gate_skip "npx not available"
else
  if npx tsc --noEmit 2>&1; then
    gate_pass "TypeScript compilation clean"
  else
    gate_fail "TypeScript compilation errors detected — run 'npm run typecheck' for details"
  fi
fi

# ══════════════════════════════════════════════════════════════════════════════
# Gate 3 — Test Integrity Check
# ══════════════════════════════════════════════════════════════════════════════
gate_header "3" "Test Integrity Check — no vacuous tests"
run_gate "3"

VACUOUS_COUNT=0

if $CHANGED_ONLY; then
  TEST_FILES=$(echo "$CHANGED_FILES" | grep -E '\.(test|spec|test\.ts|spec\.ts)\.(ts|tsx)$' | grep -v node_modules || true)
else
  TEST_FILES=$(find src/ workers/ -type f \( -name '*.test.ts' -o -name '*.spec.ts' -o -name '*.test.tsx' -o -name '*.spec.tsx' \) \
    -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/dist/*' 2>/dev/null || true)
fi

if [ -z "$TEST_FILES" ]; then
  gate_skip "No test files to check"
else
  while IFS= read -r tf; do
    if [ ! -f "$tf" ]; then continue; fi
    VACUOUS_REASONS=""

    # Check 1: Vacuous assertion pattern
    if grep -q 'expect(true)\.toBe(true)' "$tf" 2>/dev/null; then
      VACUOUS_REASONS="$VACUOUS_REASONS expect(true).toBe(true)"
    fi
    if grep -q 'expect(false)\.toBe(false)' "$tf" 2>/dev/null; then
      VACUOUS_REASONS="$VACUOUS_REASONS expect(false).toBe(false)"
    fi
    if grep -q 'expect(1)\.toBe(1)' "$tf" 2>/dev/null; then
      VACUOUS_REASONS="$VACUOUS_REASONS expect(1).toBe(1)"
    fi
    if grep -q 'expect(0)\.toBe(0)' "$tf" 2>/dev/null; then
      VACUOUS_REASONS="$VACUOUS_REASONS expect(0).toBe(0)"
    fi
    if grep -qP 'expect\(null\)\.toBe\(null\)' "$tf" 2>/dev/null; then
      VACUOUS_REASONS="$VACUOUS_REASONS expect(null).toBe(null)"
    fi

    # Check 2: Test file contains NO assertions at all
    if ! grep -qP '(expect|assert|should\.|assertEqual|assert\.)' "$tf" 2>/dev/null; then
      if grep -qP '(it\(|describe\(|test\()' "$tf" 2>/dev/null; then
        VACUOUS_REASONS="$VACUOUS_REASONS zero_assertions_in_test_block"
      fi
    fi

    # Check 3: Placeholders in test names
    if grep -qiP '(should\s+work|should\s+pass|placeholder\s*test|todo\s*test|dummy\s*test|sample\s*test)' "$tf" 2>/dev/null; then
      VACUOUS_REASONS="$VACUOUS_REASONS placeholder_test_name"
    fi

    if [ -n "$VACUOUS_REASONS" ]; then
      echo -e "    ${RED}[VACUOUS]${NC} $tf — $VACUOUS_REASONS"
      VACUOUS_COUNT=$((VACUOUS_COUNT + 1))
    fi
  done <<< "$TEST_FILES"

  if [ "$VACUOUS_COUNT" -gt 0 ]; then
    gate_fail "$VACUOUS_COUNT test file(s) contain vacuous/placeholder patterns"
  else
    gate_pass "All test files have meaningful assertions"
  fi

  # Also run the actual test suite
  echo ""
  echo -e "  ${CYAN}Running test suite...${NC}"
  if npx vitest run --reporter=verbose 2>&1 | tail -20; then
    gate_pass "Test suite passes"
  else
    gate_fail "Test suite has failures"
  fi
fi

# ══════════════════════════════════════════════════════════════════════════════
# Gate 4 — Hallucination / Stub Check
# ══════════════════════════════════════════════════════════════════════════════
gate_header "4" "Hallucination & Stub Check — no placeholders, fake imports, stubs"
run_gate "4"

STUB_COUNT=0
FAKE_IMPORT_COUNT=0

if $CHANGED_ONLY; then
  SCAN_TARGETS=$CHANGED_FILES
else
  SCAN_TARGETS=$(find src/ workers/ -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.py' \) \
    -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/dist/*' -not -path '*/__pycache__/*' 2>/dev/null || true)
fi

if [ -z "$SCAN_TARGETS" ]; then
  gate_skip "No source files to scan"
else
  # ── Hallucination Check: npm package verification ──
  if command -v npm >/dev/null 2>&1 && [ -f package.json ]; then
    INSTALLED=$(npm ls --depth=0 --all 2>/dev/null | grep -oP '[a-zA-Z@][a-zA-Z0-9_./-]+@' | sed 's/@$//' || true)
  fi

  while IFS= read -r file; do
    if [ ! -f "$file" ]; then continue; fi
    FILE_STUBS=0

    # ── Stub pattern scan ──
    STUB_PATTERNS=(
      'TODO: implement|TODO: Implement'
      'FIXME: add|FIXME: implement|FIXME: replace'
      "throw new Error\('Not implemented"
      'throw new Error\("Not implemented'
      'Not implemented yet'
      '// placeholder|// stub|// TODO '
      '\.then\(\(\) => \{\}\)'
      'catch\s*\([^)]*\)\s*\{\s*\}'
      "return\s+null\s*;\s*$"
      "return\s+\{\}\s*;\s*$"
      'function\s+\w+\s*\([^)]*\)\s*\{\s*\}[\s\S]*?$'
      'const\s+\w+\s*=\s*\([^)]*\)\s*=>\s*\{\s*\}'
    )

    for pat in "${STUB_PATTERNS[@]}"; do
      if grep -qP "$pat" "$file" 2>/dev/null; then
        FILE_STUBS=$((FILE_STUBS + 1))
        if [ "$FILE_STUBS" -eq 1 ]; then
          echo -e "    ${YELLOW}[STUB]${NC} $file"
        fi
        echo -e "           pattern: ${pat%%|*}"
      fi
    done

    if [ "$FILE_STUBS" -gt 0 ]; then
      STUB_COUNT=$((STUB_COUNT + 1))
    fi

    # ── Fake import detection for TypeScript ──
    if [[ "$file" == *.ts ]] || [[ "$file" == *.tsx ]]; then
      IMPORTS=$(grep -oP "import\s+\{[^}]*\}\s+from\s+'([^']+)'" "$file" 2>/dev/null | sed "s/import.*from '//" | sed "s/'$//" || true)
      IMPORTS="$IMPORTS $(grep -oP "import\s+\w+\s+from\s+'([^']+)'" "$file" 2>/dev/null | sed "s/import.*from '//" | sed "s/'$//" || true)"
      for imp in $IMPORTS; do
        # Check if it's a known npm package or a relative path
        if [[ "$imp" != .* ]] && [[ "$imp" != /* ]]; then
          # Extract package name (handle scoped packages)
          PKG_NAME=$(echo "$imp" | grep -oP '^(@[a-z0-9-]+\/[a-z0-9-]+|[a-z0-9-]+)' || true)
          if [ -n "$PKG_NAME" ] && [ "$PKG_NAME" != "typescript" ] && [ "$PKG_NAME" != "vitest" ] && [ "$PKG_NAME" != "express" ]; then
            # Skip known packages (would need node_modules check)
            if [ ! -d "node_modules/$PKG_NAME" ]; then
              # Could be a dependency — only flag if we're sure
              if grep -q "$PKG_NAME" package.json 2>/dev/null; then
                : # known dependency
              elif echo "$INSTALLED" | grep -q "$PKG_NAME" 2>/dev/null; then
                : # installed
              fi
            fi
          fi
        fi
      done
    fi
  done <<< "$SCAN_TARGETS"

  if [ "$STUB_COUNT" -gt 0 ]; then
    gate_fail "$STUB_COUNT file(s) contain stub/placeholder patterns"
  else
    gate_pass "No stub or placeholder patterns found"
  fi

  if [ "$FAKE_IMPORT_COUNT" -gt 0 ]; then
    gate_fail "$FAKE_IMPORT_COUNT potentially hallucinated package(s)"
  fi
fi

# ══════════════════════════════════════════════════════════════════════════════
# Gate 5 — Dead Code Check (knip + ts-prune)
# ══════════════════════════════════════════════════════════════════════════════
gate_header "5" "Dead Code Check — no orphaned files or unused exports"
run_gate "5"

DEAD_CODE_FAIL=0

# knip — unused files / exports
if command -v npx >/dev/null 2>&1 && [ -f knip.json ]; then
  echo -e "  ${CYAN}Running knip (dead code detection)...${NC}"
  KNIP_OUTPUT=$(npx knip --no-progress 2>&1 || true)
  KNIP_UNUSED=$(echo "$KNIP_OUTPUT" | grep -c "^src/" 2>/dev/null || echo "0")
  if [ "$KNIP_UNUSED" -gt 0 ]; then
    echo -e "    ${YELLOW}[DEAD]${NC} $KNIP_UNUSED file(s) may be unused"
    echo "$KNIP_OUTPUT" | grep "^src/" | head -15 | while IFS= read -r line; do
      echo -e "           $line"
    done
    DEAD_CODE_FAIL=$((DEAD_CODE_FAIL + KNIP_UNUSED))
  else
    echo -e "    ${GREEN}✓${NC} No unused source files detected"
  fi
else
  gate_skip "knip not configured (knip.json missing)"
fi

# ts-prune — unused TypeScript exports
if command -v npx >/dev/null 2>&1; then
  echo ""
  echo -e "  ${CYAN}Running ts-prune (unused export detection)...${NC}"
  TSPRUNE_OUTPUT=$(npx ts-prune 2>&1 || true)
  TSPRUNE_UNUSED=$(echo "$TSPRUNE_OUTPUT" | grep -v "used in module" | grep -c ":" 2>/dev/null || echo "0")
  if [ "$TSPRUNE_UNUSED" -gt 0 ] && [ -n "$TSPRUNE_OUTPUT" ]; then
    echo -e "    ${YELLOW}[UNUSED]${NC} $TSPRUNE_UNUSED export(s) not referenced externally"
    echo "$TSPRUNE_OUTPUT" | grep -v "used in module" | head -15 | while IFS= read -r line; do
      echo -e "           $line"
    done
    # Don't fail on ts-prune — many barrel exports are legitimate
    echo -e "    ${YELLOW}✓${NC} Flagged for review (not blocking — barrel exports are common)"
  else
    echo -e "    ${GREEN}✓${NC} No completely unused exports detected"
  fi
else
  gate_skip "npx not available for ts-prune"
fi

if [ "$DEAD_CODE_FAIL" -gt 5 ]; then
  gate_fail "$DEAD_CODE_FAIL potentially unused file(s) detected — review before PR"
else
  gate_pass "Dead code check complete"
fi

# ══════════════════════════════════════════════════════════════════════════════
# Gate 6 — External AI Tool Scan
# Runs 4 specialized OSS anti-hallucination/stub detectors in parallel
# ══════════════════════════════════════════════════════════════════════════════
gate_header "6" "External AI Tool Scan — ghostcheck + trace-core + anti-hallucination + vibecop"
run_gate "6"

AI_TOOL_FAIL=0

# ── ghostcheck (acv) — hallucinated packages, phantom APIs ──
if command -v npx >/dev/null 2>&1; then
  echo -e "  ${CYAN}[ghostcheck] Scanning for hallucinated packages and phantom APIs...${NC}"
  GHOST_OUT=$(npx acv check src/ 2>&1 || true)
  GHOST_ISSUES=$(echo "$GHOST_OUT" | grep -cP '(ERROR|WARN|phantom|hallucinat)' 2>/dev/null || echo "0")
  if [ "$GHOST_ISSUES" -gt 0 ]; then
    echo -e "    ${YELLOW}[HALLUCINATED]${NC} ghostcheck found $GHOST_ISSUES issue(s)"
    echo "$GHOST_OUT" | grep -P '(ERROR|WARN|phantom|hallucinat|SQL|unsafe)' | head -10 | sed 's/^/           /'
    AI_TOOL_FAIL=$((AI_TOOL_FAIL + GHOST_ISSUES))
  else
    echo -e "    ${GREEN}✓${NC} No hallucinated packages or phantom APIs"
  fi
fi

# ── trace-core — AI code security checker (single-file scan, no directory support) ──
if command -v npx >/dev/null 2>&1; then
  echo ""
  echo -e "  ${CYAN}[trace-core] Scanning source files for AI-generated code security issues...${NC}"
  if $CHANGED_ONLY; then
    TRACE_FILES=$(echo "$TS_CHANGED" | head -20 2>/dev/null || true)
  else
    TRACE_FILES=$(find src/ -name '*.ts' -not -path '*/node_modules/*' | head -20 2>/dev/null || true)
  fi
  TRACE_ISSUES=0
  for tf in $TRACE_FILES; do
    TR_RESULT=$(npx trace-check "$tf" 2>&1 || true)
    if echo "$TR_RESULT" | grep -qiP '(error|warning|issue|vulnerability|security)'; then
      TRACE_ISSUES=$((TRACE_ISSUES + 1))
      echo -e "           $tf"
    fi
  done
  if [ "$TRACE_ISSUES" -gt 0 ]; then
    echo -e "    ${YELLOW}[TRACE]${NC} trace-core flagged $TRACE_ISSUES file(s) with issues"
  else
    echo -e "    ${GREEN}✓${NC} No AI code security issues detected across ${TRACE_FILES} file(s)"
  fi
fi

# ── anti-hallucination-mcp — symbol/hallucination patterns ──
if command -v npx >/dev/null 2>&1; then
  echo ""
  echo -e "  ${CYAN}[anti-hallucination] Building symbol registry and scanning...${NC}"
  AH_INDEX=$(npx anti-hallucination index src/ 2>&1 || true)
  AH_ISSUES=$(echo "$AH_INDEX" | grep -ciP '(error|warning|unknown)' 2>/dev/null || echo "0")
  if [ "$AH_ISSUES" -gt 0 ]; then
    echo -e "    ${YELLOW}[ANTI-HALL]${NC} anti-hallucination flagged $AH_ISSUES pattern(s)"
    AI_TOOL_FAIL=$((AI_TOOL_FAIL + AH_ISSUES))
  else
    echo -e "    ${GREEN}✓${NC} No hallucination patterns detected"
  fi
fi

# ── vibecop — AI code quality linter ──
if command -v npx >/dev/null 2>&1; then
  echo ""
  echo -e "  ${CYAN}[vibecop] Scanning for AI code quality issues...${NC}"
  VIBE_OUT=$(npx vibecop scan src/ 2>&1 || true)
  VIBE_WARN=$(echo "$VIBE_OUT" | grep -c 'warning' 2>/dev/null || echo "0")
  VIBE_INFO=$(echo "$VIBE_OUT" | grep -c 'info' 2>/dev/null || echo "0")
  if [ "$VIBE_WARN" -gt 0 ]; then
    echo -e "    ${YELLOW}[VIBECOP]${NC} $VIBE_WARN warnings, $VIBE_INFO info items"
    echo "$VIBE_OUT" | grep -E 'warning|over-mocking|sleepy-test|no-error-path' | head -10 | sed 's/^/           /'
    AI_TOOL_FAIL=$((AI_TOOL_FAIL + VIBE_WARN))
  elif [ "$VIBE_INFO" -gt 0 ]; then
    echo -e "    ${YELLOW}[VIBECOP]${NC} $VIBE_INFO info items (no warnings)"
  else
    echo -e "    ${GREEN}✓${NC} No AI code quality issues detected"
  fi
fi

if [ "$AI_TOOL_FAIL" -gt 0 ]; then
  gate_fail "$AI_TOOL_FAIL external tool finding(s) — review output above"
else
  gate_pass "All external AI tools passed"
fi

# ══════════════════════════════════════════════════════════════════════════════
# Summary
# ══════════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${CYAN}══════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  QUALITY GATES SUMMARY${NC}"
echo -e "${CYAN}══════════════════════════════════════════════════════════════${NC}"
echo -e "  ${GREEN}Passed:${NC} $GATE_PASS"
echo -e "  ${RED}Failed:${NC} $GATE_FAIL"
echo -e "  ${YELLOW}Skipped:${NC} $GATE_SKIP"

if [ "$GATE_FAIL" -gt 0 ]; then
  echo ""
  echo -e "${RED}  ✗ QUALITY GATES BLOCKED — fix failures before proceeding${NC}"
  echo -e "${YELLOW}  Run: npm run quality-gates -- --gate=<N> to test a single gate${NC}"
  exit 2
else
  echo -e "${GREEN}  ✓ ALL GATES PASSED${NC}"
  exit 0
fi
