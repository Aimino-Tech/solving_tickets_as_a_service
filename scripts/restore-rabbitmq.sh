#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

BACKUP_DIR="${BACKUP_DIR:-/var/backups/rabbitmq}"
RABBITMQ_URL="${RABBITMQ_URL:-http://guest:guest@localhost:15672}"
RESTORE_FILE=""
DRY_RUN=false

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)   DRY_RUN=true; shift ;;
    --help|-h)   echo "Usage: $0 [--dry-run] [backup-file]"; exit 0 ;;
    *)           RESTORE_FILE="$1"; shift ;;
  esac
done

if [[ -f "$PROJECT_DIR/.env" ]]; then
  set -a
  source "$PROJECT_DIR/.env"
  set +a
fi

BACKUP_DIR="${BACKUP_DIR:-/var/backups/rabbitmq}"

if [[ -z "$RESTORE_FILE" ]]; then
  RESTORE_FILE=$(ls -t "$BACKUP_DIR"/*.json 2>/dev/null | head -1)
  if [[ -z "$RESTORE_FILE" ]]; then
    RESTORE_FILE=$(ls -t "$BACKUP_DIR"/*.json.gz 2>/dev/null | head -1)
  fi
  if [[ -z "$RESTORE_FILE" ]]; then
    RESTORE_FILE=$(ls -t "$BACKUP_DIR"/*.json.gz.gpg 2>/dev/null | head -1)
  fi
  if [[ -z "$RESTORE_FILE" ]]; then
    error "No backup file specified and no backups found in $BACKUP_DIR"
    exit 1
  fi
  info "Using latest backup: $RESTORE_FILE"
fi

if [[ ! -f "$RESTORE_FILE" ]]; then
  error "Backup file not found: $RESTORE_FILE"
  exit 1
fi

info "Restoring RabbitMQ definitions from: $RESTORE_FILE"

if [[ "$DRY_RUN" == "true" ]]; then
  info "[DRY RUN] Would restore: $RESTORE_FILE -> $RABBITMQ_URL/api/definitions"
  exit 0
fi

TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT

DECOMPRESSED="$TEMP_DIR/definitions.json"
case "$RESTORE_FILE" in
  *.gpg)
    BACKUP_GPG_PASSPHRASE="${BACKUP_GPG_PASSPHRASE:-}"
    if [[ -z "$BACKUP_GPG_PASSPHRASE" ]]; then
      error "BACKUP_GPG_PASSPHRASE is required for encrypted backups"
      exit 1
    fi
    gpg --batch --yes --decrypt --passphrase "$BACKUP_GPG_PASSPHRASE" "$RESTORE_FILE" > "$DECOMPRESSED"
    ;;
  *.gz)
    gunzip -c "$RESTORE_FILE" > "$DECOMPRESSED"
    ;;
  *.json)
    cp "$RESTORE_FILE" "$DECOMPRESSED"
    ;;
esac

info "Uploading definitions to RabbitMQ management API..."
if command -v curl &>/dev/null; then
  curl -s -X POST \
    -H "Content-Type: application/json" \
    -d @"$DECOMPRESSED" \
    "$RABBITMQ_URL/api/definitions"

  info "Definitions restored. Checking queues..."
  curl -s "$RABBITMQ_URL/api/queues" | python3 -m json.tool 2>/dev/null \
    | grep -E '"name"|"messages"' | head -20
else
  warn "curl not found. Definitions file extracted to: $DECOMPRESSED"
  info "Manually upload with:"
  info "  curl -X POST -H 'Content-Type: application/json' -d @$DECOMPRESSED $RABBITMQ_URL/api/definitions"
fi

info "RabbitMQ restore completed"
