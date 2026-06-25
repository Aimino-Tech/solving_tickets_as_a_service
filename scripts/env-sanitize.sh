#!/usr/bin/env bash
# =============================================================================
# scripts/env-sanitize.sh — Env var sanitization & validation for sandbox
#
# Usage:
#   bash scripts/env-sanitize.sh <command> [options]
#
# Commands:
#   sanitize    Print a sanitised version of the current environment (stdout).
#   validate    Validate the current environment and print errors (stderr).
#   check       Run both sanitize + validate and exit with a status code.
#
# Options:
#   --allowlist KEY1,KEY2     Comma-separated list of allowed variable names.
#   --max-length N            Maximum value length (default: 4096).
#
# Exit codes:
#   0 — All good (validate / check passed, or sanitize succeeded)
#   1 — Validation errors found
#   2 — Invalid arguments
# =============================================================================

set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CMD="${1:-}"
shift 2>/dev/null || true

ALLOWLIST=""
MAX_LENGTH=4096

while [[ $# -gt 0 ]]; do
  case "$1" in
    --allowlist)
      ALLOWLIST="$2"
      shift 2
      ;;
    --max-length)
      MAX_LENGTH="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 2
      ;;
  esac
done

# ── Build Python one-liner from the worker module ─────────────────────────────

PYTHON="${PYTHON:-python3}"

_build_allowlist_arg() {
  if [[ -n "$ALLOWLIST" ]]; then
    # Convert comma-separated string to a Python set literal.
    local items=""
    IFS=',' read -ra KEYS <<< "$ALLOWLIST"
    for k in "${KEYS[@]}"; do
      items+="'${k}',"
    done
    echo "{${items}}"
  else
    echo "None"
  fi
}

case "$CMD" in
  sanitize)
    $PYTHON -c "
from workers.sandbox.env_sanitizer import sanitize_env
import os, json
allowlist = $(_build_allowlist_arg)
cleaned = sanitize_env(dict(os.environ), allowlist, max_value_length=$MAX_LENGTH)
print(json.dumps(cleaned, indent=2, sort_keys=True))
"
    ;;

  validate)
    $PYTHON -c "
from workers.sandbox.env_sanitizer import validate_env
import os, json
errors = validate_env(dict(os.environ))
if errors:
    for e in errors:
        print(e, file=__import__('sys').stderr)
    exit(1)
else:
    print('No validation errors')
"
    ;;

  check)
    SANITIZED=$($PYTHON -c "
from workers.sandbox.env_sanitizer import sanitize_env, validate_env
import os, json
env = dict(os.environ)
cleaned = sanitize_env(env, $(_build_allowlist_arg), max_value_length=$MAX_LENGTH)
errors = validate_env(cleaned)
if errors:
    print('VALIDATION_ERRORS:' + json.dumps(errors))
else:
    print('OK')
")
    if [[ "$SANITIZED" == OK ]]; then
      echo "All checks passed — environment is clean." >&2
      exit 0
    else
      echo "$SANITIZED" | grep -o '"VALIDATION_ERRORS:.*' | head -1 | sed 's/VALIDATION_ERRORS://' | $PYTHON -c "import sys,json; [print(e) for e in json.load(sys.stdin)]" >&2
      exit 1
    fi
    ;;

  *)
    echo "Usage: bash $0 <sanitize|validate|check> [--allowlist K1,K2] [--max-length N]" >&2
    exit 2
    ;;
esac
