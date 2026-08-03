#!/usr/bin/env bash
# ==============================================================================
# Redis Backup Script
#
# Triggers a Redis SAVE, copies the RDB dump to a timestamped backup file,
# and optionally uploads to S3-compatible storage.
#
# Usage:
#   ./scripts/backup-redis.sh                       # Daily backup (default)
#   ./scripts/backup-redis.sh --hourly              # Hourly backup prefix
#   ./scripts/backup-redis.sh --dry-run             # Show what would be done
#   ./scripts/backup-redis.sh --restore <file>      # Restore from backup
#
# Environment variables:
#   REDIS_URL             - Redis connection URL (required)
#   BACKUP_S3_BUCKET      - S3 bucket name (optional)
#   BACKUP_S3_ENDPOINT    - S3 endpoint URL
#   BACKUP_S3_ACCESS_KEY  - S3 access key
#   BACKUP_S3_SECRET_KEY  - S3 secret key
#   BACKUP_DIR            - Local backup directory (default: /var/backups/redis)
#   BACKUP_RETENTION_DAYS  - Daily retention (default: 30)
#   BACKUP_RETENTION_HOURS - Hourly retention (default: 7)
#
# Dependencies: redis-cli, gzip, sha256sum
# ==============================================================================

set -euo pipefail

# ── Configuration ─────────────────────────────────────────────────────────────

BACKUP_DIR="${BACKUP_DIR:-/var/backups/redis}"
REDIS_RDB_DIR="/data"
REDIS_RDB_FILE="dump.rdb"
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
  for dep in redis-cli sha256sum; do
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
    echo "  Ubuntu/Debian: apt-get install redis-tools coreutils"
    echo "  Alpine:        apk add redis coreutils"
    exit 1
  fi
}

# ── Parse Redis URL ───────────────────────────────────────────────────────────

parse_redis_url() {
  local url="${REDIS_URL:-redis://localhost:6379}"
  local without_protocol="${url#redis://}"
  without_protocol="${without_protocol#rediss://}"

  local userinfo="${without_protocol%%@*}"
  local hostinfo="${without_protocol#*@}"

  if [[ "$userinfo" == "$hostinfo" ]]; then
    REDIS_HOST="${hostinfo%%:*}"
    REDIS_PORT="${hostinfo##*:}"
    REDIS_PORT="${REDIS_PORT:-6379}"
    REDIS_PASSWORD=""
  else
    REDIS_HOST="${hostinfo%%:*}"
    REDIS_PORT="${hostinfo##*:}"
    REDIS_PORT="${REDIS_PORT:-6379}"
    REDIS_PASSWORD="${userinfo#*:}"
  fi

  REDIS_HOST="${REDIS_HOST:-localhost}"
  REDIS_PORT="${REDIS_PORT:-6379}"
}

# ── Get Redis RDB directory ───────────────────────────────────────────────────

get_redis_dir() {
  local dir
  dir=$(redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" ${REDIS_PASSWORD:+-a "$REDIS_PASSWORD"} CONFIG GET dir 2>/dev/null | tail -1)
  if [[ -n "$dir" ]]; then
    REDIS_RDB_DIR="$dir"
  fi
}

get_redis_rdb_filename() {
  local filename
  filename=$(redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" ${REDIS_PASSWORD:+-a "$REDIS_PASSWORD"} CONFIG GET dbfilename 2>/dev/null | tail -1)
  if [[ -n "$filename" ]]; then
    REDIS_RDB_FILE="$filename"
  fi
}

# ── Backup function ───────────────────────────────────────────────────────────

create_backup() {
  local suffix="$1"
  local backup_name="syntaro-redis-${suffix}-${TIMESTAMP}.rdb.gz"
  local backup_file="${BACKUP_DIR}/${backup_name}"

  info "Starting Redis backup: ${backup_file}"

  mkdir -p "$BACKUP_DIR"
  parse_redis_url

  if [[ "$DRY_RUN" == "true" ]]; then
    info "[DRY RUN] Would trigger Redis SAVE on ${REDIS_HOST}:${REDIS_PORT}"
    info "[DRY RUN] Would copy RDB to ${backup_file}"
    return 0
  fi

  if ! redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" ${REDIS_PASSWORD:+-a "$REDIS_PASSWORD"} PING 2>/dev/null | grep -q "PONG"; then
    error "Cannot connect to Redis at ${REDIS_HOST}:${REDIS_PORT}"
    exit 1
  fi

  get_redis_dir
  get_redis_rdb_filename

  local rdb_path="${REDIS_RDB_DIR}/${REDIS_RDB_FILE}"
  info "Redis RDB location: ${rdb_path}"

  info "Triggering Redis SAVE..."
  local save_result
  save_result=$(redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" ${REDIS_PASSWORD:+-a "$REDIS_PASSWORD"} SAVE 2>/dev/null)
  if [[ "$save_result" != "OK" ]]; then
    error "Redis SAVE failed: ${save_result}"
    exit 1
  fi
  info "Redis SAVE completed"

  gzip -c "$rdb_path" > "$backup_file"

  sha256sum "$backup_file" | cut -d' ' -f1 > "${backup_file}.sha256"

  local file_size
  file_size=$(du -h "$backup_file" | cut -f1)
  info "Backup created: ${backup_file} (${file_size})"

  if [[ -n "$BACKUP_S3_BUCKET" ]]; then
    if [[ -n "$S3_CMD" ]]; then
      local s3_path="s3://${BACKUP_S3_BUCKET}/redis/${suffix}/$(basename "$backup_file")"
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
      warn "S3 CLI not available — skipping S3 upload for Redis backup"
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

  info "Cleaning up local ${retention_type} backups older than ${retention_days} days"

  if [[ "$DRY_RUN" == "true" ]]; then
    return 0
  fi

  find "$BACKUP_DIR" -name "syntaro-redis-${retention_type}-*" -type f -mtime "+${retention_days}" -delete 2>/dev/null || true
  find "$BACKUP_DIR" -name "syntaro-redis-${retention_type}-*.sha256" -type f -mtime "+${retention_days}" -delete 2>/dev/null || true
}

# ── Restore function ──────────────────────────────────────────────────────────

restore_backup() {
  local backup_file="$1"

  if [[ ! -f "$backup_file" ]]; then
    error "Backup file not found: ${backup_file}"
    exit 1
  fi

  info "Restoring Redis from backup: ${backup_file}"

  if [[ "$DRY_RUN" == "true" ]]; then
    info "[DRY RUN] Would restore: ${backup_file}"
    return 0
  fi

  parse_redis_url

  if [[ -f "${backup_file}.sha256" ]]; then
    info "Verifying checksum..."
    cd "$(dirname "$backup_file")"
    if ! sha256sum -c "${backup_file}.sha256" --status 2>/dev/null; then
      error "Checksum verification failed — backup may be corrupted"
      exit 1
    fi
    info "Checksum verified"
  fi

  local temp_rdb
  temp_rdb=$(mktemp /tmp/redis-restore-XXXXXX.rdb)
  gunzip -c "$backup_file" > "$temp_rdb"

  get_redis_dir
  get_redis_rdb_filename
  local rdb_path="${REDIS_RDB_DIR}/${REDIS_RDB_FILE}"

  info "Stopping Redis and replacing RDB file..."
  warn "This will replace current Redis data with backup data!"

  redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" ${REDIS_PASSWORD:+-a "$REDIS_PASSWORD"} SHUTDOWN NOSAVE 2>/dev/null || true

  cp "$temp_rdb" "$rdb_path"
  rm -f "$temp_rdb"

  info "Redis RDB file replaced. Start Redis manually:"
  echo "  redis-server /path/to/redis.conf"
  echo ""
  info "Or if running in Docker, restart the container:"
  echo "  docker restart syntaro-redis"

  info "Restore completed"
}

# ── Main ──────────────────────────────────────────────────────────────────────

main() {
  echo ""
  echo "═══════════════════════════════════════════════════════════════"
  info "SYNTARO Redis Backup Script"
  echo "═══════════════════════════════════════════════════════════════"
  echo ""

  check_deps

  if [[ -f "$PROJECT_DIR/.env" ]]; then
    set -a
    source "$PROJECT_DIR/.env"
    set +a
  fi

  if [[ -z "${REDIS_URL:-}" ]]; then
    REDIS_URL="redis://localhost:6379"
    info "REDIS_URL not set, defaulting to ${REDIS_URL}"
  fi

  if [[ -n "$RESTORE_FILE" ]]; then
    restore_backup "$RESTORE_FILE"
    exit 0
  fi

  if [[ "$IS_HOURLY" == "true" ]]; then
    info "Running hourly Redis backup (retention: ${BACKUP_RETENTION_HOURS} days)"
    create_backup "hourly"
  else
    info "Running daily Redis backup (retention: ${BACKUP_RETENTION_DAYS} days)"
    create_backup "daily"
  fi

  info "Redis backup completed successfully"
  echo "═══════════════════════════════════════════════════════════════"
}

main
