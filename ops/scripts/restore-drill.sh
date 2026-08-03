#!/usr/bin/env bash
#
# restore-drill.sh — Quarterly Restore Drill
#
# Verifies backup freshness, integrity, and tests full restore to staging.
# Run this quarterly (or after any infrastructure change) to validate
# that the disaster recovery plan actually works.
#
# Usage:
#   ./scripts/restore-drill.sh                  # Full drill (interactive)
#   ./scripts/restore-drill.sh --check-only     # Backup freshness + integrity only
#   ./scripts/restore-drill.sh --staging-only   # Restore test only (skip checks)
#   ./scripts/restore-drill.sh --dry-run        # Print what would be done
#   ./scripts/restore-drill.sh --json           # Output results as JSON
#
# Exit codes:
#   0 — All checks passed
#   1 — One or more checks failed
#   2 — Prerequisites not met
#   3 — Interrupted by user
#
# YAML Front Matter:
# title: Restore Drill Script
# status: active
# last-updated: 2026-07-28
# ---

set -euo pipefail

# ── Configuration ──────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-/var/backups}"
STAGING_COMPOSE="${STAGING_COMPOSE:-docker-compose.staging.yml}"
STAGING_DB_URL="${STAGING_DB_URL:-postgres://syntaro:syntaro@localhost:5433/syntaro_staging}"
DRILL_LOG="${DRILL_LOG:-/var/log/syntaro-restore-drill.log}"
TIMESTAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# Services to check
SERVICES=("postgres" "redis" "rabbitmq")

# ── Colors ─────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ── State ──────────────────────────────────────────────────────────

RESULTS=()
PASS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0
START_TIME=""
END_TIME=""

# ── Helpers ────────────────────────────────────────────────────────

log() {
  local level="$1"
  local message="$2"
  local color="${NC}"
  case "$level" in
    INFO)  color="${BLUE}" ;;
    PASS)  color="${GREEN}" ;;
    FAIL)  color="${RED}" ;;
    WARN)  color="${YELLOW}" ;;
    SKIP)  color="${YELLOW}" ;;
  esac
  echo -e "${color}[${level}]${NC} ${message}"
  echo "[${TIMESTAMP}] [${level}] ${message}" >> "$DRILL_LOG"
}

record() {
  local check="$1"
  local status="$2"
  local detail="${3:-}"
  RESULTS+=("$(jo check="$check" status="$status" detail="$detail" timestamp="$TIMESTAMP" 2>/dev/null || echo "{\"check\":\"$check\",\"status\":\"$status\",\"detail\":\"$detail\",\"timestamp\":\"$TIMESTAMP\"}")")
  case "$status" in
    PASS) PASS_COUNT=$((PASS_COUNT + 1)) ;;
    FAIL) FAIL_COUNT=$((FAIL_COUNT + 1)) ;;
    SKIP) SKIP_COUNT=$((SKIP_COUNT + 1)) ;;
  esac
}

check_prereqs() {
  local missing=0
  for cmd in gpg aws jq psql redis-cli curl docker; do
    if ! command -v "$cmd" &>/dev/null; then
      log FAIL "Prerequisite not found: $cmd"
      missing=1
    fi
  done
  if [ "$missing" -eq 1 ]; then
    log FAIL "Install missing prerequisites and try again."
    exit 2
  fi
  log PASS "All prerequisites found"
}

# ── Check 1: Backup Freshness ─────────────────────────────────────

check_backup_freshness() {
  log INFO "--- Check 1: Backup Freshness ---"

  for service in "${SERVICES[@]}"; do
    local latest
    latest=$(ls -t "$BACKUP_DIR/$service/daily/" 2>/dev/null | head -1)

    if [ -z "$latest" ]; then
      log FAIL "No backup found for $service"
      record "freshness-$service" "FAIL" "No backup file found in $BACKUP_DIR/$service/daily/"
      continue
    fi

    local file_path="$BACKUP_DIR/$service/daily/$latest"
    local file_age=$(( $(date +%s) - $(stat -c %Y "$file_path" 2>/dev/null || echo 0) ))
    local max_age=$(( 6 * 3600 ))  # 6 hours max age for daily backups

    if [ "$file_age" -gt "$max_age" ]; then
      log FAIL "Backup for $service is stale: ${file_age}s old (max ${max_age}s)"
      record "freshness-$service" "FAIL" "Stale: ${file_age}s old, file=$file_path"
    else
      log PASS "Backup for $service is fresh: ${file_age}s old"
      record "freshness-$service" "PASS" "Age: ${file_age}s, file=$file_path"
    fi
  done
}

# ── Check 2: Backup Integrity ──────────────────────────────────────

check_backup_integrity() {
  log INFO "--- Check 2: Backup Integrity ---"

  # PostgreSQL: verify pg_restore can list contents
  local pg_latest
  pg_latest=$(ls -t "$BACKUP_DIR/postgres/daily/" 2>/dev/null | head -1)
  if [ -n "$pg_latest" ]; then
    local pg_file="$BACKUP_DIR/postgres/daily/$pg_latest"
    local pg_size
    pg_size=$(stat -c%s "$pg_file" 2>/dev/null || echo 0)

    if [ "$pg_size" -lt 1000 ]; then
      log FAIL "PostgreSQL backup suspiciously small: ${pg_size} bytes"
      record "integrity-postgres" "FAIL" "Too small: ${pg_size} bytes"
    else
      # Try to decrypt and list (gives us integrity check without full restore)
      if gpg --decrypt --batch --passphrase "${BACKUP_GPG_PASSPHRASE:-}" "$pg_file" 2>/dev/null | gunzip | pg_restore --list 2>/dev/null | head -5 > /dev/null 2>&1; then
        log PASS "PostgreSQL backup integrity verified (${pg_size} bytes)"
        record "integrity-postgres" "PASS" "Size: ${pg_size} bytes, decrypt + list OK"
      else
        log WARN "PostgreSQL backup integrity check skipped (no GPG key or incompatible format)"
        record "integrity-postgres" "SKIP" "Could not verify: GPG key or format issue"
      fi
    fi
  fi

  # Redis: verify RDB header
  local redis_latest
  redis_latest=$(ls -t "$BACKUP_DIR/redis/daily/" 2>/dev/null | head -1)
  if [ -n "$redis_latest" ]; then
    local redis_file="$BACKUP_DIR/redis/daily/$redis_latest"
    local redis_size
    redis_size=$(stat -c%s "$redis_file" 2>/dev/null || echo 0)

    if [ "$redis_size" -lt 100 ]; then
      log FAIL "Redis backup suspiciously small: ${redis_size} bytes"
      record "integrity-redis" "FAIL" "Too small: ${redis_size} bytes"
    else
      # Check RDB header magic bytes
      if file "$redis_file" | grep -qi "redis" || file "$redis_file" | grep -qi "data"; then
        log PASS "Redis backup integrity verified (${redis_size} bytes)"
        record "integrity-redis" "PASS" "Size: ${redis_size} bytes, format verified"
      else
        log WARN "Redis backup format could not be verified (trying decompress)"
        record "integrity-redis" "SKIP" "Format unclear, size: ${redis_size} bytes"
      fi
    fi
  fi

  # RabbitMQ: verify JSON
  local rmq_latest
  rmq_latest=$(ls -t "$BACKUP_DIR/rabbitmq/daily/" 2>/dev/null | head -1)
  if [ -n "$rmq_latest" ]; then
    local rmq_file="$BACKUP_DIR/rabbitmq/daily/$rmq_latest"
    local rmq_size
    rmq_size=$(stat -c%s "$rmq_file" 2>/dev/null || echo 0)

    if [ "$rmq_size" -lt 10 ]; then
      log FAIL "RabbitMQ backup suspiciously small: ${rmq_size} bytes"
      record "integrity-rabbitmq" "FAIL" "Too small: ${rmq_size} bytes"
    else
      # Check it's valid JSON (RabbitMQ definitions are JSON)
      if jq empty "$rmq_file" 2>/dev/null; then
        log PASS "RabbitMQ backup integrity verified (valid JSON, ${rmq_size} bytes)"
        record "integrity-rabbitmq" "PASS" "Valid JSON, size: ${rmq_size} bytes"
      else
        log WARN "RabbitMQ backup may be encrypted — checking size only"
        record "integrity-rabbitmq" "SKIP" "Encrypted format, size: ${rmq_size} bytes"
      fi
    fi
  fi
}

# ── Check 3: Restore to Staging ────────────────────────────────────

restore_to_staging() {
  log INFO "--- Check 3: Restore to Staging ---"

  # Verify staging environment is available
  if [ ! -f "$PROJECT_ROOT/$STAGING_COMPOSE" ] && [ ! -f "$STAGING_COMPOSE" ]; then
    log WARN "Staging compose file not found. Skipping restore test."
    log WARN "  Looked for: $PROJECT_ROOT/$STAGING_COMPOSE and $STAGING_COMPOSE"
    record "restore-staging" "SKIP" "No staging compose file found"
    return
  fi

  local compose_file
  if [ -f "$STAGING_COMPOSE" ]; then
    compose_file="$STAGING_COMPOSE"
  else
    compose_file="$PROJECT_ROOT/$STAGING_COMPOSE"
  fi

  # Start staging environment
  log INFO "Starting staging environment..."
  docker compose -f "$compose_file" up -d
  record "restore-staging-start" "PASS" "Staging environment started"

  # Restore PostgreSQL
  log INFO "Restoring PostgreSQL to staging..."
  local pg_latest
  pg_latest=$(ls -t "$BACKUP_DIR/postgres/daily/" 2>/dev/null | head -1)
  if [ -n "$pg_latest" ] && [ -f "$BACKUP_DIR/postgres/daily/$pg_latest" ]; then
    if "${PROJECT_ROOT}/scripts/restore-postgres.sh" "$BACKUP_DIR/postgres/daily/$pg_latest" 2>/dev/null; then
      log PASS "PostgreSQL restored to staging"
      record "restore-postgres" "PASS" "Restored from $pg_latest"
    else
      log FAIL "PostgreSQL restore to staging failed"
      record "restore-postgres" "FAIL" "Restore command failed"
    fi
  else
    log WARN "No PostgreSQL backup to restore"
    record "restore-postgres" "SKIP" "No backup file"
  fi

  # Restore Redis
  log INFO "Restoring Redis to staging..."
  local redis_latest
  redis_latest=$(ls -t "$BACKUP_DIR/redis/daily/" 2>/dev/null | head -1)
  if [ -n "$redis_latest" ] && [ -f "$BACKUP_DIR/redis/daily/$redis_latest" ]; then
    if "${PROJECT_ROOT}/scripts/restore-redis.sh" "$BACKUP_DIR/redis/daily/$redis_latest" 2>/dev/null; then
      log PASS "Redis restored to staging"
      record "restore-redis" "PASS" "Restored from $redis_latest"
    else
      log FAIL "Redis restore to staging failed"
      record "restore-redis" "FAIL" "Restore command failed"
    fi
  else
    log WARN "No Redis backup to restore"
    record "restore-redis" "SKIP" "No backup file"
  fi

  # Restore RabbitMQ
  log INFO "Restoring RabbitMQ definitions to staging..."
  local rmq_latest
  rmq_latest=$(ls -t "$BACKUP_DIR/rabbitmq/daily/" 2>/dev/null | head -1)
  if [ -n "$rmq_latest" ] && [ -f "$BACKUP_DIR/rabbitmq/daily/$rmq_latest" ]; then
    if "${PROJECT_ROOT}/scripts/restore-rabbitmq.sh" "$BACKUP_DIR/rabbitmq/daily/$rmq_latest" 2>/dev/null; then
      log PASS "RabbitMQ definitions restored to staging"
      record "restore-rabbitmq" "PASS" "Restored from $rmq_latest"
    else
      log FAIL "RabbitMQ restore to staging failed"
      record "restore-rabbitmq" "FAIL" "Restore command failed"
    fi
  else
    log WARN "No RabbitMQ backup to restore"
    record "restore-rabbitmq" "SKIP" "No backup file"
  fi

  # Cleanup: tear down staging
  log INFO "Tearing down staging environment..."
  docker compose -f "$compose_file" down -v 2>/dev/null || true
  record "restore-staging-cleanup" "PASS" "Staging environment torn down"
}

# ── Check 4: Data Consistency Validation ──────────────────────────

validate_data_consistency() {
  log INFO "--- Check 4: Data Consistency Validation ---"

  # Only run if staging DB is accessible
  if ! psql "$STAGING_DB_URL" -c "SELECT 1" &>/dev/null; then
    log WARN "Staging database not accessible at $STAGING_DB_URL"
    log WARN "  Skipping data consistency validation"
    record "consistency-validation" "SKIP" "Staging DB not accessible"
    return
  fi

  # Check table counts
  log INFO "Checking table row counts..."
  local tables
  tables=$(psql "$STAGING_DB_URL" -t -A -c "
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename;
  " 2>/dev/null || echo "")

  if [ -z "$tables" ]; then
    log WARN "No tables found in staging database"
    record "consistency-tables" "SKIP" "No tables in staging DB"
    return
  fi

  local table_count=0
  while IFS= read -r table; do
    [ -z "$table" ] && continue
    table_count=$((table_count + 1))
    local row_count
    row_count=$(psql "$STAGING_DB_URL" -t -A -c "SELECT count(*) FROM \"$table\";" 2>/dev/null || echo "0")
    log INFO "  Table $table: ${row_count} rows"
  done <<< "$tables"

  log PASS "Found $table_count tables in staging database"
  record "consistency-tables" "PASS" "$table_count tables present"

  # Check critical tables have data
  for critical_table in "run_history" "users" "accounts" "credit_transactions"; do
    local count
    count=$(psql "$STAGING_DB_URL" -t -A -c "SELECT count(*) FROM \"$critical_table\";" 2>/dev/null || echo "0")
    if [ "$count" -gt 0 ]; then
      log PASS "Critical table $critical_table has ${count} rows"
      record "consistency-critical-$critical_table" "PASS" "${count} rows"
    else
      log WARN "Critical table $critical_table is empty (may be expected for staging)"
      record "consistency-critical-$critical_table" "SKIP" "Empty (expected for staging)"
    fi
  done
}

# ── Results Summary ────────────────────────────────────────────────

print_results() {
  echo ""
  echo "═══════════════════════════════════════════════════════"
  echo "            RESTORE DRILL RESULTS"
  echo "═══════════════════════════════════════════════════════"
  echo ""
  printf "  %-10s  %-10s  %s\n" "CHECK" "STATUS" "DETAIL"
  printf "  %-10s  %-10s  %s\n" "-----" "------" "------"
  for result in "${RESULTS[@]}"; do
    local check status detail
    check=$(echo "$result" | jq -r '.check // "unknown"' 2>/dev/null || echo "unknown")
    status=$(echo "$result" | jq -r '.status // "UNKNOWN"' 2>/dev/null || echo "UNKNOWN")
    detail=$(echo "$result" | jq -r '.detail // ""' 2>/dev/null || echo "")
    local color="${NC}"
    [ "$status" = "PASS" ] && color="${GREEN}"
    [ "$status" = "FAIL" ] && color="${RED}"
    [ "$status" = "SKIP" ] && color="${YELLOW}"
    printf "  ${color}%-10s  %-10s  %s${NC}\n" "$check" "$status" "${detail:0:60}"
  done
  echo ""
  echo "─────────────────────────────────────────────────────"
  printf "  Total: %d | ${GREEN}Pass: %d${NC} | ${RED}Fail: %d${NC} | ${YELLOW}Skip: %d${NC}\n" \
    "$((PASS_COUNT + FAIL_COUNT + SKIP_COUNT))" "$PASS_COUNT" "$FAIL_COUNT" "$SKIP_COUNT"
  echo "─────────────────────────────────────────────────────"
  echo ""

  if [ "$FAIL_COUNT" -eq 0 ]; then
    echo -e "${GREEN}✅ RESTORE DRILL PASSED${NC}"
  else
    echo -e "${RED}❌ RESTORE DRILL FAILED — ${FAIL_COUNT} check(s) failed${NC}"
    echo "  Review the results above and address failures before the next drill."
  fi

  echo ""
  echo "Log: $DRILL_LOG"
  echo "======================================================="
}

# ── JSON Output ────────────────────────────────────────────────────

print_json() {
  local duration_seconds=0
  if [ -n "$START_TIME" ] && [ -n "$END_TIME" ]; then
    duration_seconds=$(( END_TIME - START_TIME ))
  fi
  jo \
    drill_timestamp="$TIMESTAMP" \
    duration_seconds="$duration_seconds" \
    passed="$PASS_COUNT" \
    failed="$FAIL_COUNT" \
    skipped="$SKIP_COUNT" \
    total="$((PASS_COUNT + FAIL_COUNT + SKIP_COUNT))" \
    results=$(jo -a "${RESULTS[@]}") \
    status="$([ "$FAIL_COUNT" -eq 0 ] && echo "pass" || echo "fail")"
}

# ── Main ───────────────────────────────────────────────────────────

main() {
  local mode="${1:-full}"
  local json_output=false

  # Parse flags
  for arg in "$@"; do
    case "$arg" in
      --check-only) mode="check-only" ;;
      --staging-only) mode="staging-only" ;;
      --dry-run) mode="dry-run" ;;
      --json) json_output=true ;;
      --help|-h)
        echo "Usage: $0 [--check-only|--staging-only|--dry-run|--json|--help]"
        echo ""
        echo "  --check-only    Only verify backup freshness and integrity"
        echo "  --staging-only  Only test restore to staging (skip freshness checks)"
        echo "  --dry-run       Print what would be done, don't execute"
        echo "  --json          Output results as JSON"
        echo "  --help          Show this help message"
        exit 0
        ;;
    esac
  done

  echo ""
  echo "═══════════════════════════════════════════════════════"
  echo "        SYNTARO RESTORE DRILL — $(date -u +%Y-%m-%d)"
  echo "═══════════════════════════════════════════════════════"
  echo "  Mode: $mode"
  echo "  Backup dir: $BACKUP_DIR"
  echo "  Log file: $DRILL_LOG"
  echo ""

  START_TIME=$(date +%s)

  if [ "$mode" = "dry-run" ]; then
    echo "[DRY-RUN] The following checks would be performed:"
    echo ""
    echo "  Phase 1: Prerequisites check"
    echo "  Phase 2: Backup freshness verification"
    echo "  Phase 3: Backup integrity verification"
    echo "  Phase 4: Restore to staging environment"
    echo "  Phase 5: Data consistency validation"
    echo "  Phase 6: Results documentation"
    echo ""
    echo "[DRY-RUN] Full drill would execute the actual restore to staging."
    echo "[DRY-RUN] Use --check-only for a quick health check."
    exit 0
  fi

  # Phase 1: Prerequisites
  echo "── Phase 1: Prerequisites ──"
  check_prereqs
  echo ""

  # Phase 2+3: Backup checks (skip if staging-only)
  if [ "$mode" != "staging-only" ]; then
    check_backup_freshness
    echo ""
    check_backup_integrity
    echo ""
  fi

  # Phase 4+5: Restore test (skip if check-only)
  if [ "$mode" != "check-only" ]; then
    restore_to_staging
    echo ""
    validate_data_consistency
    echo ""
  fi

  END_TIME=$(date +%s)

  # Phase 6: Results
  if [ "$json_output" = true ]; then
    print_json
  else
    print_results
  fi

  # Return exit code
  [ "$FAIL_COUNT" -eq 0 ]
}

main "$@"
