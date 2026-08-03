#!/usr/bin/env bash
set -euo pipefail

BENCHMARKS_DIR="eval/benchmarks"
RESULTS_DIR="$BENCHMARKS_DIR/results"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
REPORT_FILE="$RESULTS_DIR/$TIMESTAMP-report.json"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

show_help() {
  cat <<EOF
SYNTARO Benchmark Runner - Run benchmark suites against SYNTARO agent

Usage:
  ./scripts/run-benchmarks.sh [options]

Options:
  --all                 Run all benchmarks (expensive, can take 15+ hours)
  --swe-bench           Run SWE-bench Verified
  --planbench           Run PlanBench (plan-first reasoning)
  --repobench           Run RepoBench (long-context understanding)
  --internal-js-ts      Run internal JS/TS issue-resolution benchmark
  --humaneval           Run HumanEval/MBPP baseline
  --cruxeval            Run CRUXEval (execution prediction)
  --report              Generate summary report from latest results
  --list                List available benchmarks and their status
  --help                Show this help message

Environment:
  MODEL                  Model to use (default: claude-sonnet-4)
  OPENAI_API_KEY         API key for OpenAI models
  ANTHROPIC_API_KEY      API key for Anthropic models
  E2B_API_KEY            E2B sandbox API key (required for SWE-bench)
  INSTANCE_LIMIT         Max test cases to run per benchmark (default: all)
  TASK_LIMIT             Max tasks for PlanBench/RepoBench (default: all)
  ISSUE_LIMIT            Max issues for JS/TS bench (default: all)
  SANDBOX_TYPE           Sandbox type: e2b or docker (default: e2b)

Examples:
  ./scripts/run-benchmarks.sh --internal-js-ts
  ./scripts/run-benchmarks.sh --all
  MODEL=gpt-4o ./scripts/run-benchmarks.sh --planbench
  ./scripts/run-benchmarks.sh --report
EOF
}

check_env() {
  local var="$1"
  if [ -z "${!var:-}" ]; then
    echo -e "${YELLOW}Warning: $var is not set. Some benchmarks may fail.${NC}"
  fi
}

run_benchmark() {
  local name="$1"
  local dir="$2"
  local file="$3"
  local config="${4:-}"

  echo -e "\n${BLUE}╔══════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${BLUE}║  Running: $name${NC}"
  echo -e "${BLUE}╚══════════════════════════════════════════════════════════════╝${NC}"
  echo ""

  if [ ! -f "$dir/$file" ]; then
    echo -e "${RED}Error: $dir/$file not found${NC}"
    return 1
  fi

  mkdir -p "$RESULTS_DIR"

  local start_time
  start_time=$(date +%s)
  npx tsx "$dir/$file" $config
  local exit_code=$?
  local end_time
  end_time=$(date +%s)
  local duration=$((end_time - start_time))

  if [ $exit_code -eq 0 ]; then
    echo -e "\n${GREEN}✓ $name completed in ${duration}s${NC}"
  else
    echo -e "\n${RED}✗ $name failed after ${duration}s (exit code: $exit_code)${NC}"
  fi

  return $exit_code
}

generate_report() {
  echo -e "\n${BLUE}Generating benchmark report...${NC}"

  if [ ! -d "$RESULTS_DIR" ]; then
    echo -e "${RED}No results found. Run benchmarks first.${NC}"
    exit 1
  fi

  local report="{"
  report+="\"generatedAt\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\","
  report+="\"benchmarks\": ["

  local first=true
  for f in "$RESULTS_DIR"/*.json; do
    [ -f "$f" ] || continue
    local bench_name
    bench_name=$(basename "$f" .json)
    if [ "$bench_name" = "$(basename "$REPORT_FILE" .json)" ]; then
      continue
    fi

    if [ "$first" = true ]; then
      first=false
    else
      report+=","
    fi
    report+=$(cat "$f")
  done

  report+="]}"
  echo "$report" > "$REPORT_FILE"
  echo -e "${GREEN}Report saved to $REPORT_FILE${NC}"

  echo -e "\n${BLUE}=== Benchmark Summary ===${NC}"
  for f in "$RESULTS_DIR"/*-swe-bench.json; do
    [ -f "$f" ] && echo -e "  SWE-bench:    $(grep -o '"resolveRate":[0-9.]*' "$f" | head -1)"
  done
  for f in "$RESULTS_DIR"/*-planbench.json; do
    [ -f "$f" ] && echo -e "  PlanBench:    $(grep -o '"accuracy":[0-9.]*' "$f" | head -1)"
  done
  for f in "$RESULTS_DIR"/*-repobench.json; do
    [ -f "$f" ] && echo -e "  RepoBench:    $(grep -o '"accuracy":[0-9.]*' "$f" | head -1)"
  done
  for f in "$RESULTS_DIR"/*-internal-js-ts.json; do
    [ -f "$f" ] && echo -e "  JS/TS Bench:  $(grep -o '"passRate":[0-9.]*' "$f" | head -1)"
  done
}

list_benchmarks() {
  echo -e "${BLUE}Available Benchmarks:${NC}"
  echo ""

  local benchmarks=(
    "SWE-bench Verified:benchmarks/swe-bench"
    "PlanBench:benchmarks/planbench"
    "RepoBench:benchmarks/repobench"
    "Internal JS/TS:benchmarks/js-ts-bench"
  )

  for b in "${benchmarks[@]}"; do
    local name="${b%%:*}"
    local path="${b##*:}"
    if [ -f "$BENCHMARKS_DIR/$path/harness.ts" ]; then
      echo -e "  ${GREEN}✓${NC} $name (harness ready)"
    else
      echo -e "  ${YELLOW}○${NC} $name (not configured)"
    fi
  done

  echo ""
  if [ -d "$RESULTS_DIR" ] && [ "$(ls -A "$RESULTS_DIR" 2>/dev/null)" ]; then
    echo -e "Results directory: $RESULTS_DIR"
    echo -e "Last run: $(ls -t "$RESULTS_DIR"/*.json 2>/dev/null | head -3 | xargs -I{} basename {})"
  else
    echo -e "${YELLOW}No results yet. Run a benchmark to generate results.${NC}"
  fi
}

main() {
  cd "$(git rev-parse --show-toplevel 2>/dev/null || echo "$(dirname "$0")/..")"

  if [ $# -eq 0 ]; then
    show_help
    exit 0
  fi

  check_env "OPENAI_API_KEY"
  check_env "ANTHROPIC_API_KEY"
  check_env "E2B_API_KEY"

  local mode="${1:-}"
  local ran_any=false

  mkdir -p "$RESULTS_DIR"

  case "$mode" in
    --all)
      run_benchmark "SWE-bench Verified" "eval/benchmarks/swe-bench" "harness.ts" && ran_any=true
      run_benchmark "PlanBench" "eval/benchmarks/planbench" "harness.ts" && ran_any=true
      run_benchmark "RepoBench" "eval/benchmarks/repobench" "harness.ts" && ran_any=true
      run_benchmark "Internal JS/TS" "eval/benchmarks/js-ts-bench" "harness.ts" && ran_any=true
      ;;
    --swe-bench)
      run_benchmark "SWE-bench Verified" "eval/benchmarks/swe-bench" "harness.ts" && ran_any=true
      ;;
    --planbench)
      run_benchmark "PlanBench" "eval/benchmarks/planbench" "harness.ts" && ran_any=true
      ;;
    --repobench)
      run_benchmark "RepoBench" "eval/benchmarks/repobench" "harness.ts" && ran_any=true
      ;;
    --internal-js-ts)
      run_benchmark "Internal JS/TS" "eval/benchmarks/js-ts-bench" "harness.ts" && ran_any=true
      ;;
    --humaneval)
      echo -e "${YELLOW}HumanEval/MBPP runner coming soon${NC}"
      ;;
    --cruxeval)
      echo -e "${YELLOW}CRUXEval runner coming soon${NC}"
      ;;
    --report)
      generate_report
      exit 0
      ;;
    --list)
      list_benchmarks
      exit 0
      ;;
    *)
      show_help
      exit 1
      ;;
  esac

  if [ "$ran_any" = true ]; then
    echo -e "\n${GREEN}✔ Benchmark run complete. Use --report to generate summary.${NC}"
  fi
}

main "$@"
