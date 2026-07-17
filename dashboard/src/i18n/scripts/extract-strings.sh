#!/usr/bin/env bash
# extract-strings.sh — Find t('key') calls in dashboard source files
# Usage: bash dashboard/src/i18n/scripts/extract-strings.sh
set -euo pipefail

DASHBOARD_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"

echo "=== Translation keys in $DASHBOARD_DIR/src ==="
grep -rhoP "t\(['\"]([^'\"]+)['\"]" "$DASHBOARD_DIR/src" \
  | sed "s/t(['\"]//;s/['\"]$//" \
  | sort -u

echo ""
echo "=== Keys in en.json ==="
if [ -f "$DASHBOARD_DIR/src/i18n/locales/en.json" ]; then
  grep -oP '"[^"]+(?=":)' "$DASHBOARD_DIR/src/i18n/locales/en.json" | tr -d '"' | sort -u
fi

echo ""
echo "=== Unused keys (in en.json but not referenced in code) ==="
if [ -f "$DASHBOARD_DIR/src/i18n/locales/en.json" ]; then
  CODE_KEYS=$(grep -rhoP "t\(['\"]([^'\"]+)['\"]" "$DASHBOARD_DIR/src" \
    | sed "s/t(['\"]//;s/['\"]$//" | sort -u)
  JSON_KEYS=$(grep -oP '"[^"]+(?=":)' "$DASHBOARD_DIR/src/i18n/locales/en.json" | tr -d '"' | sort -u)
  comm -23 <(echo "$JSON_KEYS") <(echo "$CODE_KEYS")
fi
