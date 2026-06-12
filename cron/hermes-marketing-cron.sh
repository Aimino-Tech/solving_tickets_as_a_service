#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# Hermes Marketing Cron — hourly working-hours tick
# ============================================================
# What it does:
#   1. Checks if within working hours (Mon-Fri 9-18)
#   2. Queries Google Sheet for pending items
#   3. Only calls Hermes if there's actual work
#
# Cron scheduling (via crontab or systemd timer):
#   */1 9-18 * * 1-5  <PATH>/hermes-marketing-cron.sh        # hourly check
#   0 8 * * *           <PATH>/hermes-marketing-cron.sh --daily-digest  # P0.6 daily digest
#
# The daily digest (~08 UTC) runs::
#   python3 hermes_marketing_check.py --daily-digest
#
# The sheet-sync runs independently::
#   python3 hermes_marketing_check.py --sheet-sync
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_FILE="$SCRIPT_DIR/hermes-marketing.log"
LOCK_FILE="/tmp/hermes-marketing-cron.lock"

# --- Config ---
# Google Sheet ID (Tracking marketing)
SHEET_ID="1Nf_H61D4GGq5aFlypAHlW_f1Uaso1c4OmJ9QRz5qRaY"
SHEET_TAB="guerrilla-content-plan"
# Hermes gateway endpoint
HERMES_ENDPOINT="http://localhost:8787"
HERMES_API_KEY="${HERMES_MARKETING_API_KEY:-}"

# --- Lock (prevent overlap) ---
if [ -f "$LOCK_FILE" ]; then
    echo "[$(date)] SKIP — previous run still active" >> "$LOG_FILE"
    exit 0
fi
trap 'rm -f "$LOCK_FILE"' EXIT
touch "$LOCK_FILE"

# --- Working hours check (weekends included) ---
HOUR=$(date +%H)
DOW=$(date +%u)  # 1=Mon .. 7=Sun
# Run 9-18 every day including weekends
if [ "$HOUR" -lt 9 ] || [ "$HOUR" -ge 18 ]; then
    echo "[$(date)] SKIP — outside working hours (${HOUR}h)" >> "$LOG_FILE"
    exit 0
fi

echo "[$(date)] TICK — working hours, checking sheet..." >> "$LOG_FILE"

# --- Run Python check ---
cd "$SCRIPT_DIR"
python3 hermes_marketing_check.py \
    --sheet-id "$SHEET_ID" \
    --sheet-tab "$SHEET_TAB" \
    --hermes-endpoint "$HERMES_ENDPOINT" \
    >> "$LOG_FILE" 2>&1

echo "[$(date)] DONE" >> "$LOG_FILE"
