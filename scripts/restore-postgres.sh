#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

BACKUP_DIR="${BACKUP_DIR:-/var/backups/postgres}"
BACKUP_GPG_PASSPHRASE="${BACKUP_GPG_PASSPHRASE:-}"
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

BACKUP_DIR="${BACKUP_DIR:-/var/backups/postgres}"
BACKUP_GPG_PASSPHRASE="${BACKUP_GPG_PASSPHRASE:-$BACKUP_GPG_PASSPHRASE}"

if [[ -z "${DATABASE_URL:-}" ]]; then
  error "DATABASE_URL is not set"
  exit 1
fi

if [[ -z "$BACKUP_GPG_PASSPHRASE" ]]; then
  error "BACKUP_GPG_PASSPHRASE is not set"
  exit 1
fi

if [[ -z "$RESTORE_FILE" ]]; then
  RESTORE_FILE=$(ls -t "$BACKUP_DIR"/*.sql.gz.gpg 2>/dev/null | head -1)
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

info "Restoring PostgreSQL from: $RESTORE_FILE"

parse_db_url() {
  local url="$1"
  local without_protocol="${url#postgres://}"
  without_protocol="${without_protocol#postgresql://}"
  local userinfo="${without_protocol%%@*}"
  local hostinfo="${without_protocol#*@}"
  DB_USER="${userinfo%%:*}"
  DB_PASSWORD="${userinfo#*:}"
  DB_HOST="${hostinfo%%:*}"
  local hostport="${hostinfo#*:}"
  DB_PORT="${hostport%%/*}"
  DB_NAME="${hostport#*/}"
  DB_NAME="${DB_NAME%%\?*}"
  DB_USER="${DB_USER:-postgres}"
  DB_HOST="${DB_HOST:-localhost}"
  DB_PORT="${DB_PORT:-5432}"
  DB_NAME="${DB_NAME:-stas}"
}

parse_db_url "$DATABASE_URL"
export PGPASSWORD="$DB_PASSWORD"

if [[ "$DRY_RUN" == "true" ]]; then
  info "[DRY RUN] Would restore: $RESTORE_FILE -> postgres://$DB_USER@$DB_HOST:$DB_PORT/$DB_NAME"
  info "[DRY RUN] Command: gpg --decrypt ... | gunzip | pg_restore --clean --if-exists ..."
  exit 0
fi

info "Verifying backup checksum..."
if [[ -f "${RESTORE_FILE}.sha256" ]]; then
  EXPECTED=$(cat "${RESTORE_FILE}.sha256")
  ACTUAL=$(sha256sum "$RESTORE_FILE" | cut -d' ' -f1)
  if [[ "$EXPECTED" != "$ACTUAL" ]]; then
    error "Checksum mismatch! File may be corrupted."
    info "Expected: $EXPECTED"
    info "Actual:   $ACTUAL"
    exit 1
  fi
  info "Checksum verified"
fi

info "Dropping and recreating database..."
dropdb --if-exists --host="$DB_HOST" --port="$DB_PORT" --username="$DB_USER" "$DB_NAME" 2>/dev/null || true
createdb --host="$DB_HOST" --port="$DB_PORT" --username="$DB_USER" "$DB_NAME" 2>/dev/null || true

info "Restoring from backup..."
gpg --batch --yes --decrypt --passphrase "$BACKUP_GPG_PASSPHRASE" "$RESTORE_FILE" \
  | gunzip \
  | pg_restore \
      --host="$DB_HOST" \
      --port="$DB_PORT" \
      --username="$DB_USER" \
      --dbname="$DB_NAME" \
      --clean \
      --if-exists \
      --no-owner \
      --verbose

info "Verifying restore..."
psql "$DATABASE_URL" -c "
  SELECT count(*) AS total_tables,
         sum(n_live_tup) AS total_rows
  FROM pg_stat_user_tables;
"

info "Restore completed successfully"
