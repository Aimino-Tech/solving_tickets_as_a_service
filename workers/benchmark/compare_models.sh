#!/usr/bin/env bash
# =============================================================================
#  compare_models.sh — Model Comparison Benchmark Wrapper
#
#  Runs the model comparison benchmark (XGBoost, LightGBM, CatBoost, sklearn)
#  on all benchmark datasets and exports results to benchmark_output/.
#
#  Usage:
#    ./workers/benchmark/compare_models.sh                    # full run
#    ./workers/benchmark/compare_models.sh --datasets iris,wine  # subset
#    ./workers/benchmark/compare_models.sh --models XGBoost,LightGBM
#    ./workers/benchmark/compare_models.sh --help
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Defaults
DATASETS=""
MODELS=""
EXPORT_CSV="${PROJECT_ROOT}/benchmark_output/model_comparison.csv"
EXPORT_JSON="${PROJECT_ROOT}/benchmark_output/model_comparison.json"

# ── Parse arguments ──────────────────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
    case "$1" in
        --datasets)
            DATASETS="$2"
            shift 2
            ;;
        --models)
            MODELS="$2"
            shift 2
            ;;
        --csv)
            EXPORT_CSV="$2"
            shift 2
            ;;
        --json)
            EXPORT_JSON="$2"
            shift 2
            ;;
        --help|-h)
            echo "Usage: $0 [--datasets d1,d2,...] [--models m1,m2,...] [--csv PATH] [--json PATH]"
            echo ""
            echo "Runs model comparison benchmark across all registered datasets and models."
            echo ""
            echo "Options:"
            echo "  --datasets LIST   Comma-separated dataset names (default: all)"
            echo "  --models LIST     Comma-separated model names (default: all)"
            echo "  --csv PATH        Output CSV path"
            echo "  --json PATH       Output JSON path"
            echo "  --help, -h        Show this help"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            echo "Use --help for usage."
            exit 1
            ;;
    esac
done

# ── Build Python command ─────────────────────────────────────────────────────

PYTHON="${PYTHON:-python3}"
CMD="${PYTHON} -m workers.benchmark.model_comparison"

# Build argument list for Python invocation
ARGS=()

if [[ -n "$DATASETS" ]]; then
    # Convert comma-separated to space-separated
    IFS=',' read -ra DS_NAMES <<< "$DATASETS"
    ARGS+=("--datasets" "${DS_NAMES[@]}")
fi

if [[ -n "$MODELS" ]]; then
    IFS=',' read -ra MD_NAMES <<< "$MODELS"
    ARGS+=("--models" "${MD_NAMES[@]}")
fi

# Ensure output directory exists
mkdir -p "$(dirname "$EXPORT_CSV")"

# ── Run ──────────────────────────────────────────────────────────────────────

echo "============================================================================="
echo "  Model Comparison Benchmark"
echo "  Project:  $(basename "$PROJECT_ROOT")"
echo "  Datasets: ${DATASETS:-all}"
echo "  Models:   ${MODELS:-all}"
echo "  CSV:      $EXPORT_CSV"
echo "  JSON:     $EXPORT_JSON"
echo "============================================================================="
echo ""

# shellcheck disable=SC2086
cd "$PROJECT_ROOT" && $PYTHON -c "
import sys
from workers.benchmark.model_comparison import run_model_comparison, get_dataset_names, _MODEL_REGISTRY, print_summary_table

datasets = '${DATASETS}'.split(',') if '${DATASETS}' else None
models = '${MODELS}'.split(',') if '${MODELS}' else None

results, df = run_model_comparison(
    dataset_names=datasets,
    model_names=models,
    export_csv='${EXPORT_CSV}',
    export_json='${EXPORT_JSON}',
)
print_summary_table(df)
print(f'\nResults exported to:')
print(f'  CSV:  ${EXPORT_CSV}')
print(f'  JSON: ${EXPORT_JSON}')
print(f'Done — {len(results)} (dataset, model) pairs evaluated.')
"

echo ""
echo "Benchmark complete."
