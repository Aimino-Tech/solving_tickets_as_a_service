#!/usr/bin/env bash
# restore-all.sh — Orchestrate full stack restore from latest backups
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
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
    --help|-h)   echo "Usage: $0 [--dry-run]"; exit 0 ;;
    *)           error "Unknown argument: $1"; exit 1 ;;
  esac
done

echo ""
echo "═══════════════════════════════════════════════════════════════"
info "STAS Full Stack Restore"
echo "═══════════════════════════════════════════════════════════════"
echo ""

info "Step 1/3: Restoring PostgreSQL..."
if [[ "$DRY_RUN" == "true" ]]; then
  info "[DRY RUN] Would restore PostgreSQL"
else
  "$SCRIPT_DIR/restore-postgres.sh"
fi
echo ""

info "Step 2/3: Restoring Redis..."
if [[ "$DRY_RUN" == "true" ]]; then
  info "[DRY RUN] Would restore Redis"
else
  "$SCRIPT_DIR/restore-redis.sh"
fi
echo ""

info "Step 3/3: Restoring RabbitMQ definitions..."
if [[ "$DRY_RUN" == "true" ]]; then
  info "[DRY RUN] Would restore RabbitMQ"
else
  "$SCRIPT_DIR/restore-rabbitmq.sh"
fi
echo ""

echo "═══════════════════════════════════════════════════════════════"
info "Full stack restore complete!"
echo ""

info "Next steps:"
echo "  1. Start the application stack:"
echo "     docker compose -f docker-compose.prod.yml up -d"
echo ""
echo "  2. Verify health:"
echo "     curl -f http://localhost:3000/health"
echo ""
echo "  3. Run database migrations (if needed):"
echo "     docker compose -f docker-compose.prod.yml run --rm stas-webhook npx tsx src/db/migrate.ts"
echo ""
echo "  4. Process a test issue to verify end-to-end functionality"
echo "═══════════════════════════════════════════════════════════════"
