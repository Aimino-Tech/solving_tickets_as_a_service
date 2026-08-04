#!/usr/bin/env bash
# ==============================================================================
# RabbitMQ Definition Export & Backup Script
#
# Exports RabbitMQ definitions (queues, exchanges, bindings, users, vhosts)
# via the management HTTP API and optionally uploads to S3-compatible storage.
#
# Usage:
#   ./scripts/backup-rabbitmq.sh                    # Export definitions
#   ./scripts/backup-rabbitmq.sh --hourly           # Hourly backup prefix
#   ./scripts/backup-rabbitmq.sh --dry-run          # Show what would be done
#   ./scripts/backup-rabbitmq.sh --restore <file>   # Restore definitions
#
# Environment variables:
#   RABBITMQ_URL          - AMQP URL (for mgmt API derivation)
#   RABBITMQ_MGMT_URL     - Override for management API URL
#   BACKUP_S3_BUCKET      - S3 bucket name (optional)
#   BACKUP_S3_ENDPOINT    - S3 endpoint URL
#   BACKUP_S3_ACCESS_KEY  - S3 access key
#   BACKUP_S3_SECRET_KEY  - S3 secret key
#   BACKUP_DIR            - Local backup directory (default: /var/backups/rabbitmq)
#   BACKUP_RETENTION_DAYS  - Daily retention (default: 30)
#   BACKUP_RETENTION_HOURS - Hourly retention (default: 7)
#
# Dependencies: curl, jq, sha256sum
# ==============================================================================

set -euo pipefail

# ── Configuration ─────────────────────────────────────────────────────────────

BACKUP_DIR="${BACKUP_DIR:-/var/backups/rabbitmq}"
BACKUP_S3_BUCKET="${BACKUP_S3_BUCKET:-}"
BACKUP_S3_ENDPOINT="${BACKUP_S3_ENDPOINT:-}"
BACKUP_S3_ACCESS_KEY="${BACKUP_S3_ACCESS_KEY:-}"
BACKUP_S3_SECRET_KEY="${BACKUP_S3_SECRET_KEY:-}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
BACKUP_RETENTION_HOURS="${BACKUP_RETENTION_HOURS:-7}"
IS_HOURLY=false
DRY_RUN=false
RESTORE_FILE=""

TIMESTAMP=$(date -u +"%Y%m%dT%H%M%SZ")
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# ── Parse arguments ───────────────────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
  case "$1" in
    --hourly)    IS_HOURLY=true; shift ;;
    --dry-run)   DRY_RUN=true; shift ;;
    --restore)   RESTORE_FILE="$2"; shift 2 ;;
    *)           echo "Usage: $0 [--hourly] [--dry-run] [--restore <file>]"; exit 1 ;;
  esac
done

# ── Logging helpers ───────────────────────────────────────────────────────────

info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; }

# ── Dependency check ──────────────────────────────────────────────────────────

check_deps() {
  local missing=0
  for dep in curl jq sha256sum; do
    if ! command -v "$dep" &>/dev/null; then
      error "Missing dependency: $dep"
      missing=1
    fi
  done

  if command -v aws &>/dev/null; then
    S3_CMD="aws"
  elif command -v s3cmd &>/dev/null; then
    S3_CMD="s3cmd"
  else
    S3_CMD=""
  fi

  if [[ "$missing" -eq 1 ]]; then
    error "Install missing dependencies."
    echo "  Ubuntu/Debian: apt-get install curl jq coreutils"
    echo "  Alpine:        apk add curl jq coreutils"
    exit 1
  fi
}

# ── Parse RabbitMQ URL ────────────────────────────────────────────────────────

parse_rabbitmq_url() {
  local url="${RABBITMQ_URL:-amqp://guest:guest@localhost:5672}"
  local without_protocol="${url#amqp://}"
  without_protocol="${without_protocol#amqps://}"

  local userinfo="${without_protocol%%@*}"
  local hostinfo="${without_protocol#*@}"

  RMQ_USER="${userinfo%%:*}"
  RMQ_PASS="${userinfo#*:}"
  RMQ_HOST="${hostinfo%%:*}"
  RMQ_PORT="${hostinfo##*:}"
  RMQ_PORT="${RMQ_PORT:-5672}"

  if [[ -n "${RABBITMQ_MGMT_URL:-}" ]]; then
    RMQ_MGMT_URL="$RABBITMQ_MGMT_URL"
  else
    local mgmt_port=$((RMQ_PORT + 10000))
    RMQ_MGMT_URL="http://${RMQ_HOST}:${mgmt_port}"
  fi
}

# ── Export definitions ────────────────────────────────────────────────────────

export_definitions() {
  local suffix="$1"
  local backup_name="syntaro-rabbitmq-defs-${suffix}-${TIMESTAMP}.json"
  local backup_file="${BACKUP_DIR}/${backup_name}"

  info "Exporting RabbitMQ definitions to: ${backup_file}"

  mkdir -p "$BACKUP_DIR"
  parse_rabbitmq_url

  if [[ "$DRY_RUN" == "true" ]]; then
    info "[DRY RUN] Would export definitions from ${RMQ_MGMT_URL}/api/definitions"
    return 0
  fi

  local health_check_url="${RMQ_MGMT_URL}/api/overview"
  if ! curl -s -o /dev/null -w "%{http_code}" -u "${RMQ_USER}:${RMQ_PASS}" "$health_check_url" | grep -q "200"; then
    error "Cannot connect to RabbitMQ management API at ${RMQ_MGMT_URL}"
    echo "  Ensure the management plugin is enabled:"
    echo "    rabbitmq-plugins enable rabbitmq_management"
    echo "  Or set RABBITMQ_MGMT_URL explicitly."
    exit 1
  fi

  local http_code
  http_code=$(curl -s -o "$backup_file" -w "%{http_code}" \
    -u "${RMQ_USER}:${RMQ_PASS}" \
    -H "Accept: application/json" \
    "${RMQ_MGMT_URL}/api/definitions")

  if [[ "$http_code" != "200" ]]; then
    error "Failed to export definitions (HTTP ${http_code})"
    rm -f "$backup_file"
    exit 1
  fi

  if ! jq empty "$backup_file" 2>/dev/null; then
    error "Exported definitions is not valid JSON"
    rm -f "$backup_file"
    exit 1
  fi

  sha256sum "$backup_file" | cut -d' ' -f1 > "${backup_file}.sha256"

  local file_size
  file_size=$(du -h "$backup_file" | cut -f1)
  info "Definitions exported: ${backup_file} (${file_size})"

  local queue_count
  queue_count=$(jq '.queues | length' "$backup_file")
  local exchange_count
  exchange_count=$(jq '.exchanges | length' "$backup_file")
  local bindings_count
  bindings_count=$(jq '.bindings | length' "$backup_file")
  info "Queues: ${queue_count}, Exchanges: ${exchange_count}, Bindings: ${bindings_count}"

  if [[ -n "$BACKUP_S3_BUCKET" ]]; then
    if [[ -n "$S3_CMD" ]]; then
      local s3_path="s3://${BACKUP_S3_BUCKET}/rabbitmq/${suffix}/$(basename "$backup_file")"
      info "Uploading to S3: ${s3_path}"

      case "$S3_CMD" in
        aws)
          AWS_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY" \
          AWS_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_KEY" \
          aws s3 cp "$backup_file" "$s3_path" \
            --endpoint-url "$BACKUP_S3_ENDPOINT"
          AWS_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY" \
          AWS_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_KEY" \
          aws s3 cp "${backup_file}.sha256" "${s3_path}.sha256" \
            --endpoint-url "$BACKUP_S3_ENDPOINT"
          ;;
        s3cmd)
          s3cmd --access_key="$BACKUP_S3_ACCESS_KEY" \
                --secret_key="$BACKUP_S3_SECRET_KEY" \
                --host="$BACKUP_S3_ENDPOINT" \
                put "$backup_file" "$s3_path"
          s3cmd --access_key="$BACKUP_S3_ACCESS_KEY" \
                --secret_key="$BACKUP_S3_SECRET_KEY" \
                --host="$BACKUP_S3_ENDPOINT" \
                put "${backup_file}.sha256" "${s3_path}.sha256"
          ;;
      esac
    else
      warn "S3 CLI not available — skipping S3 upload for RabbitMQ definitions"
    fi
  fi

  cleanup_old "$suffix"
}

# ── Retention cleanup ─────────────────────────────────────────────────────────

cleanup_old() {
  local retention_type="$1"
  local retention_days

  if [[ "$retention_type" == "daily" ]]; then
    retention_days="$BACKUP_RETENTION_DAYS"
  else
    retention_days="$BACKUP_RETENTION_HOURS"
  fi

  info "Cleaning up local ${retention_type} exports older than ${retention_days} days"

  if [[ "$DRY_RUN" == "true" ]]; then
    return 0
  fi

  find "$BACKUP_DIR" -name "syntaro-rabbitmq-defs-${retention_type}-*" -type f -mtime "+${retention_days}" -delete 2>/dev/null || true
  find "$BACKUP_DIR" -name "syntaro-rabbitmq-defs-${retention_type}-*.sha256" -type f -mtime "+${retention_days}" -delete 2>/dev/null || true
}

# ── Restore function ──────────────────────────────────────────────────────────

restore_definitions() {
  local backup_file="$1"

  if [[ ! -f "$backup_file" ]]; then
    error "Backup file not found: ${backup_file}"
    exit 1
  fi

  info "Restoring RabbitMQ definitions from: ${backup_file}"

  if ! jq empty "$backup_file" 2>/dev/null; then
    error "Backup file is not valid JSON"
    exit 1
  fi

  if [[ -f "${backup_file}.sha256" ]]; then
    info "Verifying checksum..."
    cd "$(dirname "$backup_file")"
    if ! sha256sum -c "${backup_file}.sha256" --status 2>/dev/null; then
      error "Checksum verification failed"
      exit 1
    fi
    info "Checksum verified"
  fi

  if [[ "$DRY_RUN" == "true" ]]; then
    info "[DRY RUN] Would upload definitions to ${RMQ_MGMT_URL}/api/definitions"
    return 0
  fi

  parse_rabbitmq_url

  info "Uploading definitions to RabbitMQ management API..."
  warn "This will overwrite current RabbitMQ configuration!"

  local http_code
  http_code=$(curl -s -o /dev/null -w "%{http_code}" \
    -u "${RMQ_USER}:${RMQ_PASS}" \
    -H "Content-Type: application/json" \
    -X POST \
    -d @"$backup_file" \
    "${RMQ_MGMT_URL}/api/definitions")

  if [[ "$http_code" == "200" || "$http_code" == "201" || "$http_code" == "204" ]]; then
    info "Definitions restored successfully (HTTP ${http_code})"
  else
    error "Failed to restore definitions (HTTP ${http_code})"
    exit 1
  fi
}

# ── Main ──────────────────────────────────────────────────────────────────────

main() {
  echo ""
  echo "═══════════════════════════════════════════════════════════════"
  info "SYNTARO RabbitMQ Definition Export Script"
  echo "═══════════════════════════════════════════════════════════════"
  echo ""

  check_deps

  if [[ -f "$PROJECT_DIR/.env" ]]; then
    set -a
    source "$PROJECT_DIR/.env"
    set +a
  fi

  if [[ -z "${RABBITMQ_URL:-}" ]]; then
    RABBITMQ_URL="amqp://guest:guest@localhost:5672"
    info "RABBITMQ_URL not set, defaulting to ${RABBITMQ_URL}"
  fi

  if [[ -n "$RESTORE_FILE" ]]; then
    restore_definitions "$RESTORE_FILE"
    exit 0
  fi

  if [[ "$IS_HOURLY" == "true" ]]; then
    info "Running hourly RabbitMQ definition export (retention: ${BACKUP_RETENTION_HOURS} days)"
    export_definitions "hourly"
  else
    info "Running daily RabbitMQ definition export (retention: ${BACKUP_RETENTION_DAYS} days)"
    export_definitions "daily"
  fi

  info "RabbitMQ definition export completed successfully"
  echo "═══════════════════════════════════════════════════════════════"
}

main
