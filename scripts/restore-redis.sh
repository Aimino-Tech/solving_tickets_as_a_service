#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

BACKUP_DIR="${BACKUP_DIR:-/var/backups/redis}"
REDIS_URL="${REDIS_URL:-redis://localhost:6379}"
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

BACKUP_DIR="${BACKUP_DIR:-/var/backups/redis}"

if [[ -z "$RESTORE_FILE" ]]; then
  RESTORE_FILE=$(ls -t "$BACKUP_DIR"/*.rdb 2>/dev/null | head -1)
  if [[ -z "$RESTORE_FILE" ]]; then
    RESTORE_FILE=$(ls -t "$BACKUP_DIR"/*.rdb.gz 2>/dev/null | head -1)
  fi
  if [[ -z "$RESTORE_FILE" ]]; then
    RESTORE_FILE=$(ls -t "$BACKUP_DIR"/*.rdb.gz.gpg 2>/dev/null | head -1)
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

info "Restoring Redis from: $RESTORE_FILE"

if [[ "$DRY_RUN" == "true" ]]; then
  info "[DRY RUN] Would restore: $RESTORE_FILE -> $REDIS_URL"
  exit 0
fi

TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT

DECOMPRESSED="$TEMP_DIR/dump.rdb"
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
  *.rdb)
    cp "$RESTORE_FILE" "$DECOMPRESSED"
    ;;
esac

if command -v redis-cli &>/dev/null; then
  info "Stopping Redis and restoring RDB..."
  redis-cli -u "$REDIS_URL" SHUTDOWN NOSAVE 2>/dev/null || true
  REDIS_DATA_DIR=$(redis-cli -u "$REDIS_URL" CONFIG GET dir 2>/dev/null | tail -1 || echo "/var/lib/redis")
  cp "$DECOMPRESSED" "$REDIS_DATA_DIR/dump.rdb"
  chmod 640 "$REDIS_DATA_DIR/dump.rdb"
  info "Redis data restored to $REDIS_DATA_DIR/dump.rdb"
  info "Start Redis manually: systemctl start redis (or docker compose start redis)"
else
  warn "redis-cli not found. RDB file extracted to: $DECOMPRESSED"
  info "Manually copy this file to your Redis data directory:"
  info "  cp $DECOMPRESSED /var/lib/redis/dump.rdb"
fi

info "Redis restore completed"
