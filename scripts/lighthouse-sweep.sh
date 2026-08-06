#!/usr/bin/env bash
# Lighthouse performance sweep for the SYNTARO dashboard.
#
# Usage:
#   scripts/lighthouse-sweep.sh [base-url] [--threshold 90] [--json] [route ...]
#
# Defaults:
#   base-url : http://localhost:5173
#   threshold: 90 (per the project standing rule, docs/user-stories-todo.md)
#   routes   : / /runs /settings /liveview
#
# Output:
#   JSON reports -> /tmp/opencode/lighthouse/<route>.json
#   Score table  -> /tmp/opencode/lighthouse/scores.csv
#
# Exit code: 0 if every scanned route meets the threshold, 1 otherwise.

set -euo pipefail

BASE_URL="${1:-http://localhost:5173}"
THRESHOLD=90
JSON_OUT=false
ROUTES=()

shift || true
while [[ $# -gt 0 ]]; do
  case "$1" in
    --threshold)
      THRESHOLD="$2"
      shift 2
      ;;
    --json)
      JSON_OUT=true
      shift
      ;;
    -*)
      echo "Unknown option: $1" >&2
      exit 2
      ;;
    *)
      ROUTES+=("$1")
      shift
      ;;
  esac
done

if [[ ${#ROUTES[@]} -eq 0 ]]; then
  ROUTES=("/" "/runs" "/settings" "/liveview")
fi

OUT_DIR="${LIGHTHOUSE_OUT_DIR:-/tmp/opencode/lighthouse}"
mkdir -p "$OUT_DIR"
CSV="$OUT_DIR/scores.csv"
[[ -f "$CSV" ]] || echo "timestamp,route,performance,accessibility,best-practices,seo" > "$CSV"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUDGET="$SCRIPT_DIR/lighthouse-budget.json"
CHROME_PATH="${CHROME_PATH:-/usr/bin/google-chrome}"

fail=0
for route in "${ROUTES[@]}"; do
  name="${route#/}"
  [[ -n "$name" ]] || name="index"
  url="$BASE_URL$route"
  out="$OUT_DIR/$name.json"

  echo "==> Lighthouse: $url (threshold ${THRESHOLD})"
  if npx --no-install lighthouse "$url" \
    --quiet \
    --chrome-path="$CHROME_PATH" \
    --output=json \
    --output-path="$out" \
    --only-categories=performance,accessibility,best-practices,seo \
    --budget-path="$BUDGET" \
    --max-wait-for-load=20000 \
    --chrome-flags="--headless=new --no-sandbox --disable-gpu"; then
    :
  else
    echo "    (lighthouse exited nonzero — check $out)" >&2
  fi

  perf=$(jq -r '.categories.performance.score * 100 | round' "$out" 2>/dev/null || echo 0)
  a11y=$(jq -r '.categories.accessibility.score * 100 | round' "$out" 2>/dev/null || echo 0)
  bp=$(jq -r '.["categories"]["best-practices"].score * 100 | round' "$out" 2>/dev/null || echo 0)
  seo=$(jq -r '.categories.seo.score * 100 | round' "$out" 2>/dev/null || echo 0)

  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ),$route,$perf,$a11y,$bp,$seo" >> "$CSV"
  echo "    perf=$perf a11y=$a11y best-practices=$bp seo=$seo"

  if [[ "$perf" -lt "$THRESHOLD" || "$a11y" -lt "$THRESHOLD" || "$bp" -lt "$THRESHOLD" || "$seo" -lt "$THRESHOLD" ]]; then
    fail=1
  fi
done

echo "==> Scores: $CSV"
if [[ "$JSON_OUT" == "true" ]]; then
  jq -s '[.[] | {route: (.finalUrl // ""), scores: {performance: (.categories.performance.score * 100 | round), accessibility: (.categories.accessibility.score * 100 | round), "best-practices": (.["categories"]["best-practices"].score * 100 | round), seo: (.categories.seo.score * 100 | round)}}]' "$OUT_DIR"/*.json 2>/dev/null || true
fi

if [[ "$fail" -ne 0 ]]; then
  echo "FAIL: at least one route scored below ${THRESHOLD}" >&2
  exit 1
fi
echo "PASS: all routes scored >= ${THRESHOLD}"
