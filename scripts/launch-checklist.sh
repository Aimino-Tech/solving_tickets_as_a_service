#!/usr/bin/env bash
# =============================================================================
# scripts/launch-checklist.sh — STAS Launch Day ASCII Checklist
#
# Parses docs/launch/launch-day-run-sheet.md and outputs a formatted ASCII
# checklist for terminal use during launch day.
#
# Usage:
#   bash scripts/launch-checklist.sh              # Show all phases
#   bash scripts/launch-checklist.sh --phase pre-launch   # Filter by phase
#   bash scripts/launch-checklist.sh --verbose    # Show descriptions too
#   bash scripts/launch-checklist.sh --help       # Show help
#
# Supported phase filters (case-insensitive):
#   pre-launch, h-1, hn-drop, reddit-drop, ph-drop, t+24h, t+48h, sustained
# =============================================================================

set -euo pipefail

# ── Config ──────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RUN_SHEET="$PROJECT_ROOT/docs/launch/launch-day-run-sheet.md"
PHASE_FILTER=""
VERBOSE=false

# ── Colors ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

# ── Help ────────────────────────────────────────────────────────────────────
show_help() {
  cat <<EOF
STAS Launch Day Checklist — Terminal checklist from launch-day-run-sheet.md

Usage: bash scripts/launch-checklist.sh [OPTIONS]

Options:
  --phase <phase>    Filter by phase (pre-launch, h-1, hn-drop, reddit-drop,
                     ph-drop, t+24h, t+48h, sustained)
  --verbose, -v      Show full action descriptions
  --help, -h         Show this help message

Examples:
  bash scripts/launch-checklist.sh
  bash scripts/launch-checklist.sh --phase hn-drop
  bash scripts/launch-checklist.sh --phase pre-launch --verbose
EOF
  exit 0
}

# ── Parse arguments ─────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --phase)
      shift
      PHASE_FILTER="$(echo "$1" | tr '[:upper:]' '[:lower:]')"
      shift
      ;;
    --verbose|-v)
      VERBOSE=true
      shift
      ;;
    --help|-h)
      show_help
      ;;
    *)
      echo "Unknown option: $1"
      show_help
      ;;
  esac
done

# ── Check run sheet exists ──────────────────────────────────────────────────
if [ ! -f "$RUN_SHEET" ]; then
  echo -e "${RED}ERROR${NC}: Launch run sheet not found at $RUN_SHEET"
  echo "Run the pre-launch smoke test to verify the file exists:"
  echo "  bash scripts/pre-launch-smoke-test.sh"
  exit 1
fi

# ── Phase headers for matching ──────────────────────────────────────────────
phase_header() {
  local phase="$1"
  case "$phase" in
    pre-launch)      echo "^## Pre-Launch" ;;
    h-1)             echo "^## H-1" ;;
    hn-drop)         echo "^## HN Drop" ;;
    reddit-drop)     echo "^## Reddit Drop" ;;
    ph-drop)         echo "^## PH Drop" ;;
    sustained)       echo "^## Sustained" ;;
    t+24h)           echo "^## T+24h" ;;
    t+48h)           echo "^## T+48h" ;;
    *)               echo "" ;;
  esac
}

# ── Pretty-print phase name ─────────────────────────────────────────────────
phase_title() {
  case "$1" in
    pre-launch)  echo "PRE-LAUNCH — T-60min to T-5min" ;;
    h-1)         echo "H-1 — HN LAUNCH WINDOW (T+0min to T+60min)" ;;
    hn-drop)     echo "HN DROP — T+15min (Conditional)" ;;
    reddit-drop) echo "REDDIT DROP — T+30min to T+60min" ;;
    ph-drop)     echo "PH DROP — T+60min to T+90min" ;;
    sustained)   echo "SUSTAINED — T+2h to T+24h" ;;
    t+24h)       echo "T+24h — AMPLIFICATION WAVE 2" ;;
    t+48h)       echo "T+48h — POST-LAUNCH RECOVERY & METRICS" ;;
    *)           echo "$1" ;;
  esac
}

# ── Extract and display items for a phase ───────────────────────────────────
show_phase() {
  local phase="$1"
  local header
  header="$(phase_header "$phase")"

  if [ -z "$header" ]; then
    echo -e "${YELLOW}Unknown phase: $phase${NC}"
    echo "Supported: pre-launch, h-1, hn-drop, reddit-drop, ph-drop, t+24h, t+48h, sustained"
    return
  fi

  local title
  title="$(phase_title "$phase")"

  echo ""
  echo -e " ${BOLD}${CYAN}════════════════════════════════════════════════════════════${NC}"
  echo -e " ${BOLD}${CYAN}  ${title}${NC}"
  echo -e " ${BOLD}${CYAN}════════════════════════════════════════════════════════════${NC}"
  echo ""

  # Extract the table rows for this phase.
  # Strategy: find the header line, then consume markdown table rows
  # (lines starting with |) until a blank line or next ## heading.
  local in_phase=false
  local in_table=false
  local item_count=0
  local row
  local time_col=""
  local action_col=""
  local owner_col=""
  local verify_col=""

  while IFS= read -r line; do
    # Detect phase start
    if echo "$line" | grep -Eq "$header"; then
      in_phase=true
      continue
    fi

    if [ "$in_phase" = true ]; then
      # Stop at next heading
      if echo "$line" | grep -Eq "^## "; then
        break
      fi

      # Detect table separator (---|---|---)
      if echo "$line" | grep -Eq "^\|[- ]+\|[- ]+\|[- ]+\|"; then
        in_table=true
        continue
      fi

      # Parse table data rows
      if [ "$in_table" = true ] && echo "$line" | grep -Eq "^\|"; then
        # Extract columns: strip leading/trailing |, split by |
        row="$(echo "$line" | sed 's/^|//' | sed 's/|$//')"
        time_col="$(echo "$row" | awk -F'|' '{print $1}' | sed 's/^ *//;s/ *$//')"
        action_col="$(echo "$row" | awk -F'|' '{print $2}' | sed 's/^ *//;s/ *$//')"
        owner_col="$(echo "$row" | awk -F'|' '{print $3}' | sed 's/^ *//;s/ *$//')"
        verify_col="$(echo "$row" | awk -F'|' '{print $4}' | sed 's/^ *//;s/ *$//')"

        if [ -n "$time_col" ] && [ -n "$action_col" ]; then
          item_count=$((item_count + 1))
          if [ "$VERBOSE" = true ]; then
            echo -e "  ${CYAN}[ ]${NC} ${BOLD}${time_col}${NC} — ${action_col}"
            echo -e "       ${DIM}Owner:${NC} ${owner_col}  ${DIM}Verify:${NC} ${verify_col}"
            echo ""
          else
            echo -e "  ${CYAN}[ ]${NC} ${BOLD}${time_col}${NC} — ${action_col} (${owner_col})"
          fi
        fi
      fi

      # If we hit a non-table line after being in the table and it's blank, stop
      if [ "$in_table" = true ] && [ -z "$line" ]; then
        in_table=false
      fi
    fi
  done < "$RUN_SHEET"

  if [ "$item_count" -eq 0 ]; then
    echo -e "  ${YELLOW}(no checklist items found for this phase)${NC}"
  fi

  echo ""
}

# ── Show all phases ─────────────────────────────────────────────────────────
show_all() {
  local phases=("pre-launch" "h-1" "hn-drop" "reddit-drop" "ph-drop" "sustained" "t+24h" "t+48h")
  local phase
  for phase in "${phases[@]}"; do
    show_phase "$phase"
  done
}

# ── Show run sheet metadata ─────────────────────────────────────────────────
show_header() {
  echo -e " ${BOLD}${BLUE}STAS Launch Day Checklist${NC}"
  echo -e " ${DIM}Source: docs/launch/launch-day-run-sheet.md${NC}"
  echo -e " ${DIM}Date:   $(date -u '+%Y-%m-%d %H:%M UTC')${NC}"

  # Extract Launch Commander from the file
  local commander
  commander=$(grep -m1 "^> \*\*Launch Commander\*\*" "$RUN_SHEET" 2>/dev/null | sed 's/^> \*\*Launch Commander\*\*: //')
  if [ -n "$commander" ]; then
    echo -e " ${DIM}Commander: ${commander}${NC}"
  fi
}

# ── Main ────────────────────────────────────────────────────────────────────
main() {
  show_header

  if [ -n "$PHASE_FILTER" ]; then
    show_phase "$PHASE_FILTER"
  else
    show_all
  fi

  echo -e " ${BOLD}${CYAN}════════════════════════════════════════════════════════════${NC}"
  echo -e " ${BOLD}${CYAN}  End of checklist — good luck!${NC}"
  echo -e " ${BOLD}${CYAN}════════════════════════════════════════════════════════════${NC}"
  echo ""
  echo -e " ${DIM}Mark items complete by replacing [ ] with [x] in${NC}"
  echo -e " ${DIM}docs/launch/launch-day-run-sheet.md${NC}"
}

main
