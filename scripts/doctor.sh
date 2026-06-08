#!/usr/bin/env bash
# =============================================================================
# scripts/doctor.sh — STAS System Diagnostics
#
# Usage:
#   npm run doctor
#   bash scripts/doctor.sh
#   bash scripts/doctor.sh --verbose
#
# What it checks:
#   1. Required tools (Node >=20, Docker, Python >=3.12, OpenCode CLI)
#   2. Service connectivity (Redis, PostgreSQL, RabbitMQ)
#   3. .env configuration validation
#   4. Port conflicts (3000, 4096, 6379, 5672)
#   5. System resources (disk space, memory)
#
# Exit codes:
#   0 — All checks passed
#   1 — Warnings (non-critical issues)
#   2 — Errors (critical issues requiring attention)
# =============================================================================

set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# ── Colors ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

info()     { echo -e "${BLUE}ℹ${NC} $*"; }
success()  { echo -e "${GREEN}✔${NC} $*"; }
warn()     { echo -e "${YELLOW}⚠${NC} $*"; }
error()    { echo -e "${RED}✖${NC} $*"; }
header()   { echo -e "\n${BOLD}${CYAN}━━━ $* ━━━${NC}\n"; }
dim()      { echo -e "${DIM}$*${NC}"; }

VERBOSE=false
[ "${1:-}" = "--verbose" ] && VERBOSE=true

ALL_PASSED=true
HAS_ERRORS=false
HAS_WARNINGS=false

report() {
  local status="$1"
  local check_name="$2"
  local message="$3"
  local fix="${4:-}"

  case "$status" in
    pass)
      echo -e "  ${GREEN}✔${NC} ${BOLD}${check_name}${NC} — ${message}"
      ;;
    warn)
      HAS_WARNINGS=true
      ALL_PASSED=false
      echo -e "  ${YELLOW}⚠${NC} ${BOLD}${check_name}${NC} — ${message}"
      if [ -n "$fix" ]; then
        echo -e "     ${DIM}Fix: ${fix}${NC}"
      fi
      ;;
    error)
      HAS_ERRORS=true
      ALL_PASSED=false
      echo -e "  ${RED}✖${NC} ${BOLD}${check_name}${NC} — ${message}"
      if [ -n "$fix" ]; then
        echo -e "     ${DIM}Fix: ${fix}${NC}"
      fi
      ;;
    info)
      echo -e "  ${BLUE}ℹ${NC} ${BOLD}${check_name}${NC} — ${message}"
      ;;
  esac
}

# ═══════════════════════════════════════════════════════════════════════════════
# BANNER
# ═══════════════════════════════════════════════════════════════════════════════

echo -e "${CYAN}"
echo "  ███████  ████████  █████   ██████"
echo "  ██         ██    ██   ██  ██   ██"
echo "  ███████    ██    ███████  ██████       ${BOLD}STAS Doctor${NC}${CYAN}"
echo "       ██    ██    ██   ██  ██   ██"
echo "  ███████    ██    ██   ██  ██   ██      ${DIM}System Diagnostics${NC}${CYAN}"
echo -e "${NC}"

echo -e "  ${DIM}$(date -u '+%Y-%m-%d %H:%M:%S UTC')${NC}"
echo -e "  ${DIM}Working directory: ${ROOT}${NC}"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 1: Tool Version Checks
# ═══════════════════════════════════════════════════════════════════════════════

header "1. Required Tools"

semver_compare() {
  local v1="${1#v}"; v1="${v1%%-*}"; v1="${v1%+*}"
  local v2="${2#v}"; v2="${v2%%-*}"; v2="${v2%+*}"
  local IFS=.
  local i a b
  read -ra a <<< "$v1"
  read -ra b <<< "$v2"
  for ((i = 0; i < ${#a[@]}; i++)); do
    if [ "${a[i]:-0}" -lt "${b[i]:-0}" ]; then
      return 1
    fi
  done
  return 0
}

check_node() {
  if ! command -v node &>/dev/null; then
    report error "Node.js" "Not found" "Install from https://nodejs.org/en/download/"
    return
  fi
  local version cleaned
  version=$(node --version 2>/dev/null || true)
  cleaned=$(echo "$version" | grep -oE '[0-9]+\.[0-9]+(\.[0-9]+)?' | head -1 || echo "0.0.0")
  if semver_compare "$cleaned" "20.0.0"; then
    report pass "Node.js" "v${cleaned}"
  else
    report error "Node.js" "v${cleaned} — minimum required is v20" "Upgrade Node.js to v20 or later"
  fi
}

check_npm() {
  if ! command -v npm &>/dev/null; then
    report error "npm" "Not found" "Install Node.js (includes npm)"
    return
  fi
  report pass "npm" "v$(npm --version 2>/dev/null || echo 'unknown')"
}

check_docker() {
  if ! command -v docker &>/dev/null; then
    report warn "Docker" "Not found (required for sandbox)" "Install from https://docs.docker.com/get-docker/"
    return
  fi
  report pass "Docker" "$(docker --version 2>/dev/null || echo 'unknown')"
  if docker info &>/dev/null 2>&1; then
    report pass "Docker daemon" "Running"
  else
    report error "Docker daemon" "Not running" "Start Docker Desktop or dockerd"
  fi
}

check_docker_compose() {
  if docker compose version &>/dev/null 2>&1; then
    report pass "Docker Compose" "$(docker compose version 2>/dev/null || echo 'available')"
  else
    report warn "Docker Compose" "Not found" "Install Docker Compose plugin"
  fi
}

check_python() {
  if ! command -v python3 &>/dev/null; then
    report error "Python 3" "Not found" "Install from https://www.python.org/downloads/"
    return
  fi
  local version cleaned
  version=$(python3 --version 2>/dev/null || echo "unknown")
  cleaned=$(echo "$version" | grep -oE '[0-9]+\.[0-9]+(\.[0-9]+)?' | head -1 || echo "0.0.0")
  if semver_compare "$cleaned" "3.12.0"; then
    report pass "Python 3" "v${cleaned}"
  else
    report warn "Python 3" "v${cleaned} — v3.12+ recommended" "Install Python 3.12+ from https://www.python.org/downloads/"
  fi
}

check_opencode() {
  if ! command -v opencode &>/dev/null; then
    report warn "OpenCode CLI" "Not found" "npm install -g @opencode/cli"
    return
  fi
  report pass "OpenCode CLI" "$(opencode --version 2>/dev/null || opencode --help 2>/dev/null | head -1 || echo 'installed')"
}

check_git() {
  if ! command -v git &>/dev/null; then
    report error "git" "Not found" "Install from https://git-scm.com/downloads"
    return
  fi
  report pass "git" "$(git --version 2>/dev/null || echo 'unknown')"
}

check_tsx() {
  if npx tsx --version &>/dev/null 2>&1; then
    report pass "tsx" "Available"
  else
    report warn "tsx" "Not found (needed for running TypeScript scripts)" "npm install -D tsx"
  fi
}

check_node
check_npm
check_docker
check_docker_compose
check_python
check_opencode
check_git
check_tsx

echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 2: Service Connectivity
# ═══════════════════════════════════════════════════════════════════════════════

header "2. Service Connectivity"

if [ -f ".env" ]; then
  set -a
  source ".env" 2>/dev/null || true
  set +a
fi

check_redis() {
  local redis_url="${REDIS_URL:-redis://localhost:6379}"

  if command -v redis-cli &>/dev/null; then
    if redis-cli -u "$redis_url" ping 2>/dev/null | grep -q "PONG"; then
      report pass "Redis" "Reachable at ${redis_url}"
      return
    fi
  fi

  if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "stas-redis"; then
    if docker exec stas-redis redis-cli ping 2>/dev/null | grep -q "PONG"; then
      report pass "Redis" "Reachable via Docker container stas-redis"
      return
    fi
  fi

  if command -v nc &>/dev/null; then
    local redis_host="${redis_url#redis://}"
    redis_host="${redis_host%%:*}"
    local redis_port="${redis_url##*:}"
    redis_port="${redis_port%%/*}"
    redis_port="${redis_port:-6379}"
    if nc -z -w3 "$redis_host" "$redis_port" 2>/dev/null; then
      report pass "Redis" "Port ${redis_port} open on ${redis_host}"
      return
    fi
  fi

  report warn "Redis" "Not reachable at ${redis_url}" "Start Redis: docker compose up -d redis"
}

check_postgres() {
  local db_url="${DATABASE_URL:-postgres://localhost:5432/stas}"

  if command -v psql &>/dev/null; then
    if PGPASSWORD="${PGPASSWORD:-}" psql "$db_url" -c "SELECT 1" &>/dev/null 2>&1; then
      report pass "PostgreSQL" "Reachable"
      return
    fi
  fi

  if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "stas-postgres"; then
    if docker exec stas-postgres pg_isready -U "${POSTGRES_USER:-stas}" &>/dev/null 2>&1; then
      report pass "PostgreSQL" "Reachable via Docker container stas-postgres"
      return
    fi
  fi

  if command -v nc &>/dev/null; then
    local pg_host="${db_url#postgres://}"
    pg_host="${pg_host#*:*}@"
    pg_host="${pg_host%%:*}"
    pg_host="${pg_host:-localhost}"
    local pg_port="${db_url##*:}"
    pg_port="${pg_port%%/*}"
    pg_port="${pg_port:-5432}"
    if nc -z -w3 "$pg_host" "$pg_port" 2>/dev/null; then
      report pass "PostgreSQL" "Port ${pg_port} open on ${pg_host}"
      return
    fi
  fi

  report info "PostgreSQL" "Not reachable (optional for development)"
}

check_rabbitmq() {
  local rmq_url="${RABBITMQ_URL:-amqp://guest:guest@localhost:5672/stas}"

  if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "stas-rabbitmq"; then
    if docker exec stas-rabbitmq rabbitmq-diagnostics check_port_connectivity &>/dev/null 2>&1; then
      report pass "RabbitMQ" "Reachable via Docker container stas-rabbitmq"
      return
    fi
  fi

  if command -v nc &>/dev/null; then
    local rmq_host="${rmq_url#amqp://}"
    rmq_host="${rmq_host#*:*}@"
    rmq_host="${rmq_host%%:*}"
    rmq_host="${rmq_host:-localhost}"
    local rmq_port="${rmq_url##*:}"
    rmq_port="${rmq_port%%/*}"
    rmq_port="${rmq_port:-5672}"
    if nc -z -w3 "$rmq_host" "$rmq_port" 2>/dev/null; then
      report pass "RabbitMQ" "Port ${rmq_port} open on ${rmq_host}"
      return
    fi
  fi

  report info "RabbitMQ" "Not reachable (optional — used for Celery workers)"
}

check_opencode_service() {
  local oc_url="${OPENCODE_URL:-http://localhost:4096}"
  if curl -sf "${oc_url}/health" &>/dev/null 2>&1; then
    report pass "OpenCode serve" "Reachable at ${oc_url}"
  elif curl -sf "${oc_url}" &>/dev/null 2>&1; then
    report pass "OpenCode serve" "Responding at ${oc_url}"
  else
    report info "OpenCode serve" "Not at ${oc_url} (start: opencode serve --port 4096)"
  fi
}

check_bot_health() {
  local bot_url="http://localhost:${PORT:-3000}"
  if curl -sf "${bot_url}/health" &>/dev/null 2>&1; then
    local status
    status=$(curl -sf "${bot_url}/health" 2>/dev/null | head -c 200 || echo "unknown")
    report pass "STAS bot" "Running at ${bot_url} — ${status}"
  else
    report info "STAS bot" "Not running at ${bot_url} (start: npm run dev)"
  fi
}

check_redis
check_postgres
check_rabbitmq
check_opencode_service
check_bot_health

echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 3: Environment Configuration Validation
# ═══════════════════════════════════════════════════════════════════════════════

header "3. Environment Configuration"

if [ ! -f ".env" ]; then
  report error ".env file" "Not found at ${ROOT}/.env" "Run: cp .env.example .env, or: npm run setup"
else
  report pass ".env file" "Found at ${ROOT}/.env"

  set -a
  source ".env" 2>/dev/null || true
  set +a

  local missing_vars=()
  [ -z "${GITHUB_APP_ID:-}" ]       && missing_vars+=("GITHUB_APP_ID")
  [ -z "${GITHUB_WEBHOOK_SECRET:-}" ] && missing_vars+=("GITHUB_WEBHOOK_SECRET")

  if [ "${#missing_vars[@]}" -eq 0 ]; then
    report pass "GitHub App credentials" "GITHUB_APP_ID and GITHUB_WEBHOOK_SECRET are set"
  else
    report warn "GitHub App credentials" "Missing: ${missing_vars[*]}" "Add them to .env or run: npm run init"
  fi

  if [ -n "${GITHUB_APP_PRIVATE_KEY:-}" ]; then
    if echo "${GITHUB_APP_PRIVATE_KEY}" | grep -q "BEGIN" 2>/dev/null; then
      report pass "Private key" "Configured (PEM format detected)"
    else
      report warn "Private key" "GITHUB_APP_PRIVATE_KEY may not be valid PEM" "Ensure it starts with -----BEGIN RSA PRIVATE KEY-----"
    fi
  elif [ -n "${GITHUB_APP_PRIVATE_KEY_PATH:-}" ]; then
    if [ -f "${GITHUB_APP_PRIVATE_KEY_PATH}" ]; then
      report pass "Private key" "Found at ${GITHUB_APP_PRIVATE_KEY_PATH}"
    else
      report error "Private key file" "Path set but not found: ${GITHUB_APP_PRIVATE_KEY_PATH}" "Check the path in GITHUB_APP_PRIVATE_KEY_PATH"
    fi
  else
    report info "Private key" "Not configured (required for production only)"
  fi

  if [ -n "${REDIS_URL:-}" ]; then
    if echo "${REDIS_URL}" | grep -Eq '^redis://|^rediss://'; then
      report pass "REDIS_URL" "Valid format"
    else
      report warn "REDIS_URL" "May not be a valid Redis URL" "Should start with redis:// or rediss://"
    fi
  fi

  if [ "${NODE_ENV:-development}" = "production" ]; then
    report warn "NODE_ENV" "Set to 'production' for development?" "Set NODE_ENV=development for local work"
  fi

  if [ "${DEV_SKIP_WEBHOOK_SIGNATURE_VERIFY:-false}" = "true" ]; then
    report info "DEV_SKIP_WEBHOOK_SIGNATURE_VERIFY" "Enabled — webhook signatures not verified"
  fi
fi

echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 4: Port Conflict Check
# ═══════════════════════════════════════════════════════════════════════════════

header "4. Port Conflict Check"

check_port() {
  local port="$1"
  local service="$2"

  if command -v ss &>/dev/null; then
    if ss -tlnp "sport = :${port}" 2>/dev/null | grep -q "LISTEN"; then
      local proc
      proc=$(ss -tlnp "sport = :${port}" 2>/dev/null | grep -oP 'users:\(\("\K[^"]+' || echo "unknown")
      report info "Port ${port}" "In use by ${proc} (${service})"
    else
      report pass "Port ${port}" "Available (${service})"
    fi
  elif command -v lsof &>/dev/null; then
    if lsof -i ":${port}" -P -n 2>/dev/null | grep -q LISTEN; then
      local proc
      proc=$(lsof -i ":${port}" -P -n 2>/dev/null | awk 'NR==2{print $1}')
      report info "Port ${port}" "In use by ${proc} (${service})"
    else
      report pass "Port ${port}" "Available (${service})"
    fi
  elif command -v nc &>/dev/null; then
    if nc -z -w2 localhost "$port" 2>/dev/null; then
      report info "Port ${port}" "In use (${service})"
    else
      report pass "Port ${port}" "Available (${service})"
    fi
  else
    report info "Port check" "Cannot check ports (install ss, lsof, or nc)"
    return
  fi
}

check_port "3000" "STAS bot / webhook server"
check_port "4096" "OpenCode serve"
check_port "6379" "Redis"
check_port "5672" "RabbitMQ"
check_port "5432" "PostgreSQL"
check_port "5555" "Flower (Celery monitoring)"

echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 5: System Resources
# ═══════════════════════════════════════════════════════════════════════════════

header "5. System Resources"

if command -v df &>/dev/null; then
  avail_kb=$(df -k . 2>/dev/null | awk 'NR==2{print $4}' || echo "0")
  if [ "$avail_kb" -gt 1048576 ]; then
    avail_gb=$(echo "scale=1; $avail_kb / 1048576" | bc 2>/dev/null || echo ">1")
    report pass "Disk space" "${avail_gb}GB available"
  elif [ "$avail_kb" -gt 524288 ]; then
    report warn "Disk space" "Less than 1GB available" "Free up disk space"
  else
    report warn "Disk space" "Critically low (<512MB)" "Free up disk space immediately"
  fi
fi

if command -v free &>/dev/null; then
  mem_avail_mb=$(free -m 2>/dev/null | awk 'NR==2{print $7}' || echo "0")
  if [ "$mem_avail_mb" -gt 1024 ]; then
    report pass "Memory" "${mem_avail_mb}MB available"
  elif [ "$mem_avail_mb" -gt 512 ]; then
    report warn "Memory" "Only ${mem_avail_mb}MB available" "Close other applications"
  else
    report warn "Memory" "Low (${mem_avail_mb}MB available)" "Close other applications"
  fi
fi

if [ -d "node_modules" ]; then
  report pass "Dependencies" "node_modules exists"
else
  report warn "Dependencies" "node_modules not found" "Run: npm install"
fi

if [ -d ".venv" ] && [ -f ".venv/bin/python3" ]; then
  report pass "Python venv" "Found at .venv"
elif [ -d ".venv" ]; then
  report warn "Python venv" "Incomplete — missing python3 binary" "Run: python3 -m venv .venv && .venv/bin/pip install -r workers/requirements.txt"
else
  report info "Python venv" "Not created (run: npm run setup)"
fi

echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# SUMMARY
# ═══════════════════════════════════════════════════════════════════════════════

header "Summary"

if $ALL_PASSED && ! $HAS_WARNINGS; then
  echo -e "  ${GREEN}${BOLD}All checks passed!${NC} Your environment looks great."
  echo ""
  echo -e "  ${BOLD}Next steps:${NC}"
  echo "    - Start OpenCode:  ${DIM}opencode serve --port 4096${NC}"
  echo "    - Start the bot:   ${DIM}npm run dev${NC}"
  echo "    - Check health:    ${DIM}curl http://localhost:3000/health${NC}"
  echo ""
  exit 0
elif $HAS_ERRORS; then
  echo -e "  ${RED}${BOLD}Some checks failed.${NC} Review the errors above and fix them."
  echo ""
  echo -e "  ${BOLD}Quick fix:${NC} Run ${DIM}npm run setup${NC} to auto-configure your environment."
  echo ""
  exit 2
else
  echo -e "  ${YELLOW}${BOLD}All checks passed with warnings.${NC} Review the items above."
  echo ""
  echo -e "  ${BOLD}Next steps:${NC}"
  echo "    - Start OpenCode:  ${DIM}opencode serve --port 4096${NC}"
  echo "    - Start the bot:   ${DIM}npm run dev${NC}"
  echo ""
  exit 1
fi
