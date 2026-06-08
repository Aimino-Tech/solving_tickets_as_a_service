#!/usr/bin/env bash
# backup-verify.sh — Verify backup integrity and freshness
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

BACKUP_DIR="${BACKUP_DIR:-/var/backups}"
MAX_BACKUP_AGE_HOURS="${MAX_BACKUP_AGE_HOURS:-4}"
EXIT_CODE=0

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; }

if [[ -f "$PROJECT_DIR/.env" ]]; then
  set -a
  source "$PROJECT_DIR/.env"
  set +a
fi

check_service() {
  local service="$1"
  local dir="${BACKUP_DIR}/${service}"
  local label="$2"

  info "Checking $label backups..."
  LATEST=$(ls -t "$dir" 2>/dev/null | head -1)

  if [[ -z "$LATEST" ]]; then
    error "CRITICAL: No $label backups found in $dir"
    EXIT_CODE=2
    return
  fi

  local filepath="$dir/$LATEST"
  local file_age=$(( ($(date +%s) - $(stat -c %Y "$filepath")) / 3600 ))

  if [[ "$file_age" -gt "$MAX_BACKUP_AGE_HOURS" ]]; then
    error "CRITICAL: $label backup is $file_age hours old (max: $MAX_BACKUP_AGE_HOURS)"
    EXIT_CODE=2
  else
    info "OK: $label backup is $file_age hours old"
  fi

  local size
  size=$(stat -c%s "$filepath" 2>/dev/null || echo "0")
  if [[ "$size" -lt 1000 ]]; then
    error "CRITICAL: $label backup too small: ${size} bytes"
    EXIT_CODE=2
  else
    info "OK: $label backup size: $(numfmt --to=iec $size)"
  fi

  if [[ -f "${filepath}.sha256" ]]; then
    EXPECTED=$(cat "${filepath}.sha256")
    ACTUAL=$(sha256sum "$filepath" | cut -d' ' -f1)
    if [[ "$EXPECTED" == "$ACTUAL" ]]; then
      info "OK: $label backup checksum verified"
    else
      error "CRITICAL: $label backup checksum mismatch!"
      EXIT_CODE=2
    fi
  else
    warn "No checksum file for $label backup"
  fi
}

echo ""
echo "═══════════════════════════════════════════════════════════════"
info "Backup Integrity Verification"
echo "═══════════════════════════════════════════════════════════════"
echo ""

check_service "postgres" "PostgreSQL"
check_service "redis" "Redis"
check_service "rabbitmq" "RabbitMQ"

echo ""
if [[ "$EXIT_CODE" -eq 0 ]]; then
  info "All backups verified successfully"
elif [[ "$EXIT_CODE" -eq 2 ]]; then
  error "One or more backup checks failed"
fi
echo "═══════════════════════════════════════════════════════════════"

exit "$EXIT_CODE"
