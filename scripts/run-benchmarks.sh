#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# STAS Benchmark Runner
#
# Runs the full benchmark suite or individual benchmarks and generates reports.
#
# Usage:
#   ./scripts/run-benchmarks.sh [OPTIONS]
#
# Options:
#   --suite <name>       Benchmark suite to run (full, swe-bench, planbench,
#                         repobench, js-ts-benchmark). Default: full
#   --model <name>       Model to benchmark. Default: $STAS_MODEL or claude-sonnet-4
#   --output <dir>       Output directory. Default: eval/results/
#   --agent-version <v>  Agent version tag. Default: dev
#   --prompt-version <v> Prompt version tag. Default: dev
#   --notes <text>       Notes to attach to the run
#   --verbose            Verbose output
#   --dry-run            Simulate without running benchmarks
#   --check-publish      Check if ready to publish (no run)
#   --trends             Show historical trends (no run)
#   --help               Show this help message
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Defaults
SUITE="full"
MODEL="${STAS_MODEL:-claude-sonnet-4}"
OUTPUT_DIR=""
AGENT_VERSION="${STAS_AGENT_VERSION:-dev}"
PROMPT_VERSION="${STAS_PROMPT_VERSION:-dev}"
NOTES=""
VERBOSE=""
DRY_RUN=""
CHECK_PUBLISH=""
SHOW_TRENDS=""

# Parse args
while [[ $# -gt 0 ]]; do
  case "$1" in
    --suite) SUITE="$2"; shift 2 ;;
    --model) MODEL="$2"; shift 2 ;;
    --output) OUTPUT_DIR="$2"; shift 2 ;;
    --agent-version) AGENT_VERSION="$2"; shift 2 ;;
    --prompt-version) PROMPT_VERSION="$2"; shift 2 ;;
    --notes) NOTES="$2"; shift 2 ;;
    --verbose) VERBOSE="--verbose"; shift ;;
    --dry-run) DRY_RUN="--dry-run"; shift ;;
    --check-publish) CHECK_PUBLISH="true"; shift ;;
    --trends) SHOW_TRENDS="true"; shift ;;
    --help)
      sed -n '/^# ==========/,/^# ==========/p' "$0" | grep '^#' | sed 's/^# \?//'
      exit 0
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

cd "$PROJECT_ROOT"

echo "╔══════════════════════════════════════════════════╗"
echo "║     STAS Benchmark Runner                       ║"
echo "╚══════════════════════════════════════════════════╝"
echo "Suite:          $SUITE"
echo "Model:          $MODEL"
echo "Agent version:  $AGENT_VERSION"
echo "Prompt version: $PROMPT_VERSION"
echo "Output:         ${OUTPUT_DIR:-eval/results/}"
echo ""

# Check-publish mode: run the publishing readiness check
if [ -n "$CHECK_PUBLISH" ]; then
  echo "Checking publishing readiness..."
  npx tsx eval/benchmarks/core.ts --suite "$SUITE" --model "$MODEL" \
    ${OUTPUT_DIR:+--output "$OUTPUT_DIR"} \
    --agent-version "$AGENT_VERSION" \
    --prompt-version "$PROMPT_VERSION" \
    ${NOTES:+--notes "$NOTES"} \
    $VERBOSE $DRY_RUN
  exit $?
fi

# Trends mode: show historical trends
if [ -n "$SHOW_TRENDS" ]; then
  echo "Showing historical benchmark trends..."
  npx tsx -e "
    const { getAllTrends } = require('./eval/benchmarks/tracker')
    const trends = getAllTrends({
      'swe-bench': 0.85,
      'planbench': 0.80,
      'repobench': 0.80,
      'js-ts-benchmark': 0.85,
    })
    if (trends.length === 0) {
      console.log('No benchmark runs recorded yet.')
    }
    for (const t of trends) {
      const icon = t.isTopTier ? '✅' : '⬆️'
      const arrow = t.trend === 'improving' ? '📈' : t.trend === 'declining' ? '📉' : '➡️'
      console.log(\`  \${icon} \${t.benchmark}: \${(t.currentPassRate * 100).toFixed(1)}% (threshold: \${(t.topTierThreshold * 100).toFixed(1)}%) \${arrow}\`)
      for (const run of t.runs) {
        console.log(\`       \${run.date.split('T')[0]}: \${(run.passRate * 100).toFixed(1)}%\`)
      }
    }
  "
  exit $?
fi

# Build output args
OUTPUT_ARGS=""
if [ -n "$OUTPUT_DIR" ]; then
  mkdir -p "$OUTPUT_DIR"
  OUTPUT_ARGS="--output $OUTPUT_DIR"
fi

# Set environment variables for the runner
export STAS_MODEL="$MODEL"
export STAS_AGENT_VERSION="$AGENT_VERSION"
export STAS_PROMPT_VERSION="$PROMPT_VERSION"

# Run benchmarks
echo "Starting benchmarks..."
echo ""

npx tsx eval/benchmarks/core.ts \
  --suite "$SUITE" \
  --model "$MODEL" \
  $OUTPUT_ARGS \
  --agent-version "$AGENT_VERSION" \
  --prompt-version "$PROMPT_VERSION" \
  ${NOTES:+--notes "$NOTES"} \
  $VERBOSE $DRY_RUN

EXIT_CODE=$?

echo ""
if [ $EXIT_CODE -eq 0 ]; then
  echo "✅ Benchmarks completed successfully"
else
  echo "❌ Benchmarks failed with exit code $EXIT_CODE"
fi

exit $EXIT_CODE
