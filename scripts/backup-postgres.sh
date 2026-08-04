#!/usr/bin/env bash
# ==============================================================================
# PostgreSQL Automated Backup Script
#
# Creates encrypted pg_dump backups and uploads them to S3-compatible storage.
# Supports daily (30-day retention) and hourly (7-day retention) backup schedules.
#
# Usage:
#   ./scripts/backup-postgres.sh                    # Daily backup (default)
#   ./scripts/backup-postgres.sh --hourly           # Hourly backup (shorter retention)
#   ./scripts/backup-postgres.sh --dry-run          # Show what would be done
#   ./scripts/backup-postgres.sh --restore <file>   # Restore from a backup file
#
# Environment variables (see .env.example):
#   DATABASE_URL          - PostgreSQL connection string (required)
#   BACKUP_S3_BUCKET      - S3 bucket name (required)
#   BACKUP_S3_ENDPOINT    - S3 endpoint URL (e.g., https://s3.amazonaws.com)
#   BACKUP_S3_REGION      - S3 region (default: us-east-1)
#   BACKUP_S3_ACCESS_KEY  - S3 access key (required)
#   BACKUP_S3_SECRET_KEY  - S3 secret key (required)
#   BACKUP_GPG_PASSPHRASE - Passphrase for GPG encryption (required)
#   BACKUP_DIR            - Local backup directory (default: /var/backups/postgres)
#   BACKUP_RETENTION_DAYS - Daily backup retention (default: 30)
#   BACKUP_RETENTION_HOURS - Hourly backup retention (default: 7)
#
# Dependencies: pg_dump, gpg, aws-cli (or s3cmd), sha256sum
# ==============================================================================

set -euo pipefail

# ── Configuration ─────────────────────────────────────────────────────────────

BACKUP_DIR="${BACKUP_DIR:-/var/backups/postgres}"
BACKUP_S3_BUCKET="${BACKUP_S3_BUCKET:-}"
BACKUP_S3_ENDPOINT="${BACKUP_S3_ENDPOINT:-}"
BACKUP_S3_REGION="${BACKUP_S3_REGION:-us-east-1}"
BACKUP_S3_ACCESS_KEY="${BACKUP_S3_ACCESS_KEY:-}"
BACKUP_S3_SECRET_KEY="${BACKUP_S3_SECRET_KEY:-}"
BACKUP_GPG_PASSPHRASE="${BACKUP_GPG_PASSPHRASE:-}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
BACKUP_RETENTION_HOURS="${BACKUP_RETENTION_HOURS:-7}"
IS_HOURLY=false
DRY_RUN=false
RESTORE_FILE=""

TIMESTAMP=$(date -u +"%Y%m%dT%H%M%SZ")
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Color output
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
  for dep in pg_dump gpg sha256sum; do
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
    warn "Neither aws-cli nor s3cmd found — backups will be local-only"
    S3_CMD=""
  fi

  if [[ "$missing" -eq 1 ]]; then
    error "Install missing dependencies and retry."
    echo "  Ubuntu/Debian: apt-get install postgresql-client gpg coreutils"
    echo "  Alpine:        apk add postgresql-client gnupg coreutils"
    echo "  For S3 upload: pip install awscli  or  apt-get install s3cmd"
    exit 1
  fi
}

# ── Database URL parsing ──────────────────────────────────────────────────────

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
  DB_NAME="${DB_NAME:-syntaro}"
}

# ── Backup function ───────────────────────────────────────────────────────────

create_backup() {
  local suffix="$1"
  local backup_file="${BACKUP_DIR}/syntaro-postgres-${suffix}-${TIMESTAMP}.sql.gz.gpg"

  info "Creating PostgreSQL backup: ${backup_file}"

  mkdir -p "$BACKUP_DIR"
  parse_db_url "$DATABASE_URL"

  export PGPASSWORD="$DB_PASSWORD"

  if [[ "$DRY_RUN" == "true" ]]; then
    info "[DRY RUN] Would run: pg_dump -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME --format=custom | gzip | gpg --symmetric --passphrase ..."
    info "[DRY RUN] Backup file would be: ${backup_file}"
    return 0
  fi

  pg_dump \
    --host="$DB_HOST" \
    --port="$DB_PORT" \
    --username="$DB_USER" \
    --dbname="$DB_NAME" \
    --format=custom \
    --verbose \
    --no-owner \
    --no-privileges \
    2>"${backup_file}.dump.log" \
    | gzip \
    | gpg --batch --yes --symmetric --cipher-algo AES256 \
      --passphrase "$BACKUP_GPG_PASSPHRASE" \
      --output "$backup_file"

  sha256sum "$backup_file" | cut -d' ' -f1 > "${backup_file}.sha256"

  local file_size
  file_size=$(du -h "$backup_file" | cut -f1)
  info "Backup created: ${backup_file} (${file_size})"
  info "Checksum: $(cat "${backup_file}.sha256")"

  rm -f "${backup_file}.dump.log"

  if [[ -n "$BACKUP_S3_BUCKET" && -n "$S3_CMD" ]]; then
    upload_to_s3 "$backup_file" "${backup_file}.sha256" "$suffix"
  fi

  cleanup_old "$suffix"
}

# ── S3 upload ─────────────────────────────────────────────────────────────────

upload_to_s3() {
  local file="$1"
  local checksum_file="$2"
  local retention_type="$3"
  local s3_path="s3://${BACKUP_S3_BUCKET}/postgres/${retention_type}/$(basename "$file")"

  info "Uploading to S3: ${s3_path}"

  if [[ "$DRY_RUN" == "true" ]]; then
    info "[DRY RUN] Would upload: ${file} -> ${s3_path}"
    return 0
  fi

  case "$S3_CMD" in
    aws)
      AWS_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY" \
      AWS_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_KEY" \
      aws s3 cp "$file" "$s3_path" \
        --endpoint-url "$BACKUP_S3_ENDPOINT" \
        --region "$BACKUP_S3_REGION"

      AWS_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY" \
      AWS_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_KEY" \
      aws s3 cp "$checksum_file" "${s3_path}.sha256" \
        --endpoint-url "$BACKUP_S3_ENDPOINT" \
        --region "$BACKUP_S3_REGION"
      ;;
    s3cmd)
      s3cmd --access_key="$BACKUP_S3_ACCESS_KEY" \
            --secret_key="$BACKUP_S3_SECRET_KEY" \
            --host="$BACKUP_S3_ENDPOINT" \
            --host-bucket="${BACKUP_S3_BUCKET}.${BACKUP_S3_ENDPOINT}" \
            --region="$BACKUP_S3_REGION" \
            put "$file" "$s3_path"

      s3cmd --access_key="$BACKUP_S3_ACCESS_KEY" \
            --secret_key="$BACKUP_S3_SECRET_KEY" \
            --host="$BACKUP_S3_ENDPOINT" \
            --host-bucket="${BACKUP_S3_BUCKET}.${BACKUP_S3_ENDPOINT}" \
            --region="$BACKUP_S3_REGION" \
            put "$checksum_file" "${s3_path}.sha256"
      ;;
  esac

  info "S3 upload complete: ${s3_path}"
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

  info "Cleaning up local ${retention_type} backups older than ${retention_days} days"

  if [[ "$DRY_RUN" == "true" ]]; then
    info "[DRY RUN] Would delete files older than ${retention_days} days in ${BACKUP_DIR}/"
    return 0
  fi

  find "$BACKUP_DIR" -name "syntaro-postgres-${retention_type}-*" -type f -mtime "+${retention_days}" -delete 2>/dev/null || true
  find "$BACKUP_DIR" -name "syntaro-postgres-${retention_type}-*.sha256" -type f -mtime "+${retention_days}" -delete 2>/dev/null || true

  if [[ -n "$BACKUP_S3_BUCKET" && -n "$S3_CMD" ]]; then
    local cutoff_date
    cutoff_date=$(date -u -d "${retention_days} days ago" +"%Y-%m-%d")

    info "Cleaning up S3 ${retention_type} backups older than ${cutoff_date}"

    case "$S3_CMD" in
      aws)
        AWS_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY" \
        AWS_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_KEY" \
        aws s3 ls "s3://${BACKUP_S3_BUCKET}/postgres/${retention_type}/" \
          --endpoint-url "$BACKUP_S3_ENDPOINT" \
          --region "$BACKUP_S3_REGION" \
          | while read -r line; do
            local file_date="${line:0:10}"
            if [[ "$file_date" < "$cutoff_date" ]]; then
              local file_name
              file_name=$(echo "$line" | awk '{print $NF}')
              AWS_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY" \
              AWS_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_KEY" \
              aws s3 rm "s3://${BACKUP_S3_BUCKET}/postgres/${retention_type}/${file_name}" \
                --endpoint-url "$BACKUP_S3_ENDPOINT" \
                --region "$BACKUP_S3_REGION"
            fi
          done
        ;;
      s3cmd)
        s3cmd --access_key="$BACKUP_S3_ACCESS_KEY" \
              --secret_key="$BACKUP_S3_SECRET_KEY" \
              --host="$BACKUP_S3_ENDPOINT" \
              --host-bucket="${BACKUP_S3_BUCKET}.${BACKUP_S3_ENDPOINT}" \
              --region="$BACKUP_S3_REGION" \
              ls "s3://${BACKUP_S3_BUCKET}/postgres/${retention_type}/" \
          | while read -r line; do
            local file_date="${line:0:10}"
            if [[ "$file_date" < "$cutoff_date" ]]; then
              local file_name
              file_name=$(echo "$line" | awk '{print $NF}')
              s3cmd --access_key="$BACKUP_S3_ACCESS_KEY" \
                    --secret_key="$BACKUP_S3_SECRET_KEY" \
                    --host="$BACKUP_S3_ENDPOINT" \
                    --host-bucket="${BACKUP_S3_BUCKET}.${BACKUP_S3_ENDPOINT}" \
                    --region="$BACKUP_S3_REGION" \
                    rm "s3://${BACKUP_S3_BUCKET}/postgres/${retention_type}/${file_name}"
            fi
          done
        ;;
    esac
  fi
}

# ── Restore function ──────────────────────────────────────────────────────────

restore_backup() {
  local backup_file="$1"

  if [[ ! -f "$backup_file" ]]; then
    error "Backup file not found: ${backup_file}"
    exit 1
  fi

  info "Restoring from backup: ${backup_file}"

  if [[ ! "$backup_file" == *.gpg ]]; then
    error "Backup file must be a .gpg encrypted file"
    exit 1
  fi

  if [[ -z "$BACKUP_GPG_PASSPHRASE" ]]; then
    error "BACKUP_GPG_PASSPHRASE is required for restore"
    exit 1
  fi

  parse_db_url "$DATABASE_URL"

  if [[ "$DRY_RUN" == "true" ]]; then
    info "[DRY RUN] Would restore: ${backup_file} -> ${DB_NAME}"
    return 0
  fi

  export PGPASSWORD="$DB_PASSWORD"

  gpg --batch --yes --decrypt --passphrase "$BACKUP_GPG_PASSPHRASE" "$backup_file" \
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

  info "Restore completed successfully"
}

# ── Main ──────────────────────────────────────────────────────────────────────

main() {
  echo ""
  echo "═══════════════════════════════════════════════════════════════"
  info "SYNTARO PostgreSQL Backup Script"
  echo "═══════════════════════════════════════════════════════════════"
  echo ""

  check_deps

  if [[ -f "$PROJECT_DIR/.env" ]]; then
    set -a
    source "$PROJECT_DIR/.env"
    set +a
  fi

  if [[ -z "${DATABASE_URL:-}" ]]; then
    error "DATABASE_URL is not set"
    echo "  Set it in your .env file or export it before running."
    echo "  Example: DATABASE_URL=postgres://user:pass@localhost:5432/syntaro"
    exit 1
  fi

  if [[ -z "${BACKUP_GPG_PASSPHRASE:-}" ]]; then
    error "BACKUP_GPG_PASSPHRASE is not set"
    echo "  This passphrase is used to encrypt the backup."
    echo "  Store it securely — you'll need it to restore."
    exit 1
  fi

  if [[ -n "$RESTORE_FILE" ]]; then
    restore_backup "$RESTORE_FILE"
    exit 0
  fi

  if [[ "$IS_HOURLY" == "true" ]]; then
    info "Running hourly backup (retention: ${BACKUP_RETENTION_HOURS} days)"
    create_backup "hourly"
  else
    info "Running daily backup (retention: ${BACKUP_RETENTION_DAYS} days)"
    create_backup "daily"
  fi

  info "Backup completed successfully"
  echo "═══════════════════════════════════════════════════════════════"
}

main
