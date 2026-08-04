#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# SYNTARO Guardrail — Post-hoc slop-intent scanner
# ──────────────────────────────────────────────────────────────────────────────
# Scans changed files for slop patterns: stubs, placeholders, mocks, deferrals.
# This is the Level 3 backup layer — catches what slips past LiteLLM.
#
# Exit codes:
#   0 = clean (no slop detected)
#   1 = slop detected (prints details)
#
# Usage:
#   bash scripts/guardrail.sh               # full repo scan
#   bash scripts/guardrail.sh --changed     # only changed vs origin/main
#   bash scripts/guardrail.sh --file src/foo.ts  # single file
#
# Integration:
#   - npm run guardrail          (full scan)
#   - npm run guardrail:changed  (changed only)
#   - WORKFLOW.md after_run hook (auto scan after each agent run)
# ──────────────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── Config ────────────────────────────────────────────────────────────────────
# Color output
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

# ── Slop patterns (aligned with slop_patterns.json categories) ──────────────

# Stub patterns: high severity
STUB_PATTERNS=(
    "i['\"]ll stub"
    "let me mock"
    "stub this out"
    "stub it out"
    "just a stub"
    "just a mock"
    "just a placeholder"
    "create a mock"
    "create a stub"
    "mock out"
    "mock this up"
)

# Deferral patterns: high severity
DEFER_PATTERNS=(
    "implement later"
    "in a follow.up"
    "in a future pr"
    "in a future commit"
    "not implemented yet"
    "not going to implement"
    "we can implement later"
    "will be implemented"
    "we['\"]ll implement"
    "we['\"]ll add"
    "we['\"]ll come back"
    "we['\"]ll handle later"
)

# Placeholder patterns: high severity
PLACEHOLDER_PATTERNS=(
    "this is a placeholder"
    "this is just a placeholder"
    "placeholder for now"
    "placeholder function"
    "placeholder value"
    "dummy data"
    "dummy function"
    "dummy implementation"
    "temporary implementation"
    "temporary workaround"
    "sample data"
    "sample implementation"
    "demo data"
    "demo implementation"
)

# Mock data patterns: medium severity
MOCK_PATTERNS=(
    "MockUser"
    "MockData"
    "MockService"
    "MockRepository"
    "TestData"
    "FakeData"
    "DummyData"
    "SampleData"
    "DemoData"
)

# Self-aware slop: medium severity
SELF_AWARE_PATTERNS=(
    "for demonstration purposes"
    "for demo purposes"
    "in a real application"
    "in a production environment"
    "this is not production ready"
    "not production ready"
    "this is just an example"
    "example implementation"
    "basic implementation"
    "simple implementation"
    "naive implementation"
)

# Implementation stubs: high severity
IMPL_STUBS=(
    "throw new Error.*Not implemented"
    "throw new Error.*not implemented"
    "NotImplementedError"
    "NotImplementedException"
)

# ── Ignore rules ──────────────────────────────────────────────────────────────

IGNORE_FILE="$REPO_ROOT/.guardrailignore"

is_ignored() {
    local file="$1"
    # Normalize path to relative from repo root
    local rel="${file#$REPO_ROOT/}"

    # Check .guardrailignore patterns
    if [[ -f "$IGNORE_FILE" ]]; then
        while IFS= read -r line || [[ -n "$line" ]]; do
            # Strip comments and empty lines
            line="${line%%#*}"
            line="${line## }"
            line="${line%% }"
            [[ -z "$line" ]] && continue

            # Convert gitignore-style glob to find-compatible
            # If pattern ends with /** or /*, match dir
            # Simple glob match
            case "$rel" in
                $line) return 0 ;;
                */$line) return 0 ;;
                $line/*) return 0 ;;
                *.$line) return 0 ;;
            esac
        done < "$IGNORE_FILE"
    fi

    return 1
}

# ── Helpers ───────────────────────────────────────────────────────────────────

usage() {
    echo "Usage: $0 [--changed | --file <path>]"
    echo "  (no args)    Scan entire repo"
    echo "  --changed    Scan only changed files vs origin/main"
    echo "  --file <p>   Scan a single file or directory"
    exit 0
}

scan_file() {
    local file="$1"
    local found=0

    # Check ignore list first
    if is_ignored "$file"; then
        return 0
    fi

    # Only scan source files
    case "$file" in
        *.ts|*.tsx|*.js|*.jsx|*.py|*.rs|*.go|*.java|*.kt|*.swift|*.rb|*.php)
            ;;
        *)
            return 0
            ;;
    esac

    if [[ ! -f "$file" ]]; then
        return 0
    fi

    local content
    content=$(cat "$file")

    for pattern in "${STUB_PATTERNS[@]}" "${DEFER_PATTERNS[@]}" "${PLACEHOLDER_PATTERNS[@]}" "${IMPL_STUBS[@]}"; do
        if echo "$content" | grep -in "$pattern" > /dev/null 2>&1; then
            local line
            line=$(echo "$content" | grep -in "$pattern" | head -1)
            echo -e "${RED}SLOP [HIGH]${NC} $file: $line"
            found=1
        fi
    done

    for pattern in "${MOCK_PATTERNS[@]}" "${SELF_AWARE_PATTERNS[@]}"; do
        if echo "$content" | grep -in "$pattern" > /dev/null 2>&1; then
            local line
            line=$(echo "$content" | grep -in "$pattern" | head -1)
            echo -e "${YELLOW}SLOP [MED]${NC} $file: $line"
            found=1
        fi
    done

    return $found
}

# ── Main ──────────────────────────────────────────────────────────────────────

FILES=()

if [[ $# -eq 0 ]]; then
    # Full repo scan
    while IFS= read -r -d '' file; do
        FILES+=("$file")
    done < <(find "$REPO_ROOT/src" -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.jsx' -o -name '*.py' \) -print0 2>/dev/null || true)
elif [[ "$1" == "--changed" ]]; then
    # Changed files only
    while IFS= read -r -d '' file; do
        FILES+=("$file")
    done < <(git -C "$REPO_ROOT" diff --name-only origin/main...HEAD --diff-filter=ACMRT | xargs -I{} find "$REPO_ROOT/{}" -maxdepth 0 -type f 2>/dev/null || true)
elif [[ "$1" == "--file" && -n "${2:-}" ]]; then
    FILES=("$2")
else
    usage
fi

if [[ ${#FILES[@]} -eq 0 ]]; then
    echo -e "${GREEN}No files to scan.${NC}"
    exit 0
fi

echo "🔍 Scanning ${#FILES[@]} files for slop patterns..."
TOTAL_FOUND=0

for file in "${FILES[@]}"; do
    scan_file "$file" || TOTAL_FOUND=$((TOTAL_FOUND + 1))
done

if [[ $TOTAL_FOUND -gt 0 ]]; then
    echo ""
    echo -e "${RED}========================================${NC}"
    echo -e "${RED}  GUARDRAIL FAILED: $TOTAL_FOUND file(s) with slop${NC}"
    echo -e "${RED}========================================${NC}"
    exit 1
else
    echo -e "${GREEN}✅ Guardrail clean — no slop patterns detected.${NC}"
    exit 0
fi
