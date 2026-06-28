#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# scripts/visual-verify.sh — Visual Verification Gate (AIM-2036)
# ──────────────────────────────────────────────────────────────────────────────
# Uses Playwright to capture screenshots, pixelmatch for diffing,
# and generates PASS/FAIL reports for UI regression detection.
#
# Usage:
#   bash scripts/visual-verify.sh                          # verify all routes
#   bash scripts/visual-verify.sh --base-url http://...     # custom base URL
#   bash scripts/visual-verify.sh --routes /,/dashboard     # comma-separated
#   bash scripts/visual-verify.sh --threshold 0.02          # 2% max mismatch
#   bash scripts/visual-verify.sh --output-dir ./screenshots
#   bash scripts/visual-verify.sh --oc-vision              # use oc-vision
#   bash scripts/visual-verify.sh --help                    # this help
#
# Dependencies:
#   - playwright (npm install -D @playwright/test)
#   - pixelmatch (npm install pixelmatch)
#   - tsx (for running the TypeScript runner)
#
# Environment variables:
#   VISUAL_BASE_URL    Default: http://localhost:3000
#   VISUAL_ROUTES      Default: /,/dashboard,/settings,/profile
#   VISUAL_THRESHOLD   Default: 0.05
#   VISUAL_OUTPUT_DIR  Default: .visual-verify-results
#   VISUAL_USE_OC      Set to "true" to use oc-vision instead
# ──────────────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# ── Defaults ──────────────────────────────────────────────────────────────────
BASE_URL="${VISUAL_BASE_URL:-http://localhost:3000}"
ROUTES="${VISUAL_ROUTES:-/,/dashboard,/settings,/profile}"
THRESHOLD="${VISUAL_THRESHOLD:-0.05}"
OUTPUT_DIR="${VISUAL_OUTPUT_DIR:-.visual-verify-results}"
USE_OC_VISION="${VISUAL_USE_OC:-false}"
RUNNER_SCRIPT="$REPO_ROOT/scripts/visual-verify-runner.ts"

# ── Parse arguments ───────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --base-url)
      BASE_URL="$2"; shift 2 ;;
    --routes)
      ROUTES="$2"; shift 2 ;;
    --threshold)
      THRESHOLD="$2"; shift 2 ;;
    --output-dir)
      OUTPUT_DIR="$2"; shift 2 ;;
    --oc-vision)
      USE_OC_VISION="true"; shift ;;
    --help)
      head -30 "$0" | sed 's/^# //; s/^#//'
      exit 0 ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}"
      echo "Usage: bash scripts/visual-verify.sh --help"
      exit 1 ;;
  esac
done

# ── Pre-flight checks ─────────────────────────────────────────────────────────
echo -e "${CYAN}══════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  VISUAL VERIFICATION GATE${NC}"
echo -e "${CYAN}══════════════════════════════════════════════════════════════${NC}"
echo ""

# Check for tsx
if ! command -v npx &>/dev/null; then
  echo -e "${RED}ERROR: npx not found. Install Node.js >= 20.${NC}"
  exit 1
fi

# Check for playwright
if ! npx playwright --version &>/dev/null; then
  echo -e "${YELLOW}WARNING: Playwright not found. Installing...${NC}"
  npm install -D @playwright/test --legacy-peer-deps 2>/dev/null
  npx playwright install chromium 2>/dev/null || true
fi

# Check for pixelmatch
if ! node -e "require('pixelmatch')" 2>/dev/null; then
  echo -e "${YELLOW}WARNING: pixelmatch not found. Installing...${NC}"
  npm install pixelmatch --legacy-peer-deps 2>/dev/null
  npm install -D @types/pixelmatch --legacy-peer-deps 2>/dev/null
fi

# Ensure output directory
mkdir -p "$OUTPUT_DIR"

# ── Build routes array as JSON ───────────────────────────────────────────────
# Convert comma-separated routes to JSON array
ROUTES_JSON="["
IFS=',' read -ra ROUTE_ARRAY <<< "$ROUTES"
FIRST=true
for route in "${ROUTE_ARRAY[@]}"; do
  $FIRST || ROUTES_JSON+=","
  ROUTES_JSON+="\"$route\""
  FIRST=false
done
ROUTES_JSON+="]"

# ── Run verification ─────────────────────────────────────────────────────────
echo -e "  ${CYAN}Base URL:${NC}  $BASE_URL"
echo -e "  ${CYAN}Routes:${NC}    $ROUTES"
echo -e "  ${CYAN}Threshold:${NC} $THRESHOLD (${THRESHOLD}% max mismatch)"
echo -e "  ${CYAN}Output:${NC}    $OUTPUT_DIR"
echo -e "  ${CYAN}Method:${NC}    $([ "$USE_OC_VISION" = "true" ] && echo "oc-vision" || echo "Playwright + pixelmatch")"
echo ""

# Create the runner script
cat > "$RUNNER_SCRIPT" << 'RUNNEREOF'
import { runVisualVerification, generateReport } from '../src/agent/visualVerificationGate.js';

const config = {
  baseUrl: process.env.VISUAL_BASE_URL || 'http://localhost:3000',
  routes: JSON.parse(process.env.VISUAL_ROUTES || '["/"]'),
  outputDir: process.env.VISUAL_OUTPUT_DIR || '.visual-verify-results',
  threshold: parseFloat(process.env.VISUAL_THRESHOLD || '0.05'),
  useOcVision: process.env.VISUAL_USE_OC === 'true',
};

async function main() {
  const start = Date.now();
  const summary = await runVisualVerification(config);
  const report = generateReport(summary);

  console.log(report);

  // Write report to file
  const { writeFile } = await import('node:fs/promises');
  await writeFile(`${config.outputDir}/visual-verify-report.txt`, report);

  if (!summary.passed) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Visual verification runner failed:', err);
  process.exit(2);
});
RUNNEREOF

# Export vars for the runner
export VISUAL_BASE_URL="$BASE_URL"
export VISUAL_ROUTES="$ROUTES_JSON"
export VISUAL_OUTPUT_DIR="$OUTPUT_DIR"
export VISUAL_THRESHOLD="$THRESHOLD"
export VISUAL_USE_OC="$USE_OC_VISION"

# Execute
if npx tsx "$RUNNER_SCRIPT" 2>&1; then
  echo ""
  echo -e "${GREEN}✓ VISUAL VERIFICATION PASSED${NC}"
  echo -e "  Report: $OUTPUT_DIR/visual-verify-report.txt"
  exit 0
else
  EXIT_CODE=$?
  echo ""
  echo -e "${RED}✗ VISUAL VERIFICATION FAILED${NC}"
  echo -e "  Report: $OUTPUT_DIR/visual-verify-report.txt"
  exit $EXIT_CODE
fi
