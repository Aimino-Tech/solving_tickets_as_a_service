#!/usr/bin/env bash
# =============================================================================
# scripts/setup.sh — STAS One-Command Development Environment Setup
#
# Usage:
#   npm run setup
#   bash scripts/setup.sh
#
# What it does:
#   1. Checks for required tools (Node >=20, Docker, Python >=3.12, OpenCode CLI)
#   2. Generates .env with sensible defaults for development
#   3. Optionally starts Docker services (Redis, RabbitMQ)
#   4. Creates Python venv and installs worker dependencies
#   5. Validates GitHub App credentials (if provided)
#   6. Prints success message with next steps
#
# Environment variables:
#   CI=true              — Non-interactive mode (skip prompts, use defaults)
#   SKIP_DOCKER=true     — Skip Docker service setup
#   SKIP_PYTHON=true     — Skip Python venv creation
#   SKIP_ENV=true        — Skip .env file generation
#   GITHUB_APP_ID        — Pre-set GitHub App ID (non-interactive)
#   GITHUB_WEBHOOK_SECRET — Pre-set webhook secret (non-interactive)
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

info()    { echo -e "${BLUE}ℹ${NC} $*"; }
success() { echo -e "${GREEN}✔${NC} $*"; }
warn()    { echo -e "${YELLOW}⚠${NC} $*"; }
error()   { echo -e "${RED}✖${NC} $*"; }
header()  { echo -e "\n${BOLD}${CYAN}━━━ $* ━━━${NC}\n"; }
dim()     { echo -e "${DIM}$*${NC}"; }

# ── Utility Functions ───────────────────────────────────────────────────────

cleanup() {
  local exit_code=$?
  if [ $exit_code -ne 0 ] && [ $exit_code -ne 130 ]; then
    echo ""
    error "Setup encountered an error (exit code $exit_code)."
    echo "  You can re-run: ${BOLD}npm run setup${NC}"
  fi
  exit "$exit_code"
}
trap cleanup EXIT

semver_compare() {
  local v1="${1#v}"; v1="${v1%%-*}"; v1="${v1%+*}"
  local v2="${2#v}"; v2="${v2%%-*}"; v2="${v2%+*}"
  local IFS=.
  local i parts1 parts2
  read -ra parts1 <<< "$v1"
  read -ra parts2 <<< "$v2"
  for ((i = 0; i < ${#parts1[@]}; i++)); do
    if [ "${parts1[i]:-0}" -lt "${parts2[i]:-0}" ]; then
      return 1
    fi
  done
  return 0
}

is_ci() {
  [ "${CI:-}" = "true" ] || [ "${CI:-}" = "1" ]
}

confirm() {
  local prompt="$1"
  local default="${2:-y}"
  if is_ci; then
    [ "$default" = "y" ] && return 0 || return 1
  fi
  local hint
  [ "$default" = "y" ] && hint="Y/n" || hint="y/N"
  read -r -p "$(echo -e "${BOLD}${prompt}${NC} ${DIM}(${hint})${NC}: ")" answer
  answer="${answer:-$default}"
  [[ "$answer" =~ ^[Yy] ]] && return 0 || return 1
}

# ═══════════════════════════════════════════════════════════════════════════════
# BANNER
# ═══════════════════════════════════════════════════════════════════════════════

echo -e "${CYAN}"
echo "  ███████  ████████  █████   ██████"
echo "  ██         ██    ██   ██  ██   ██"
echo "  ███████    ██    ███████  ██████       ${BOLD}Solving Tickets As A Service${NC}${CYAN}"
echo "       ██    ██    ██   ██  ██   ██"
echo "  ███████    ██    ██   ██  ██   ██      ${DIM}Label an issue. Get a PR.${NC}${CYAN}"
echo -e "${NC}"
header "Development Environment Setup"
echo -e "${DIM}This script will check your system, configure .env, and get you"
echo "ready to develop STAS. Press Ctrl+C at any time to abort.${NC}"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# STEP 1: Tool Check
# ═══════════════════════════════════════════════════════════════════════════════

header "Step 1: Checking Required Tools"

PASS=0
FAIL=0
WARN=0

check_tool() {
  local name="$1"
  local cmd="$2"
  local version_cmd="${3:-$cmd --version}"
  local min_version="${4:-}"
  local optional="${5:-false}"

  if command -v "$cmd" &>/dev/null; then
    local version
    version=$(eval "$version_cmd" 2>/dev/null | head -1 || true)

    if [ -n "$min_version" ] && [ -n "$version" ]; then
      local cleaned
      cleaned=$(echo "$version" | grep -oE '[0-9]+\.[0-9]+(\.[0-9]+)?' | head -1 || echo "0.0.0")
      if ! semver_compare "$cleaned" "$min_version"; then
        if [ "$optional" = "true" ]; then
          warn "$name found (${cleaned}) but version ${min_version}+ recommended"
          WARN=$((WARN + 1))
          return 0
        else
          error "$name version ${cleaned} is below minimum ${min_version}"
          FAIL=$((FAIL + 1))
          return 1
        fi
      fi
    fi

    local display
    display=$(echo "$version" | tr -d '\n' | head -c 80)
    success "$name found — ${display}"
    PASS=$((PASS + 1))
  else
    if [ "$optional" = "true" ]; then
      warn "$name not found (optional — recommended for development)"
      WARN=$((WARN + 1))
    else
      error "$name not found — install it to continue"
      FAIL=$((FAIL + 1))
    fi
    return 1
  fi
}

check_tool "Node.js" "node" "node --version" "20.0.0"
check_tool "npm" "npm" "npm --version" "10.0.0"
check_tool "Docker" "docker" "docker --version" "" "false"
check_tool "Docker Compose" "docker" "docker compose version" "" "false"
check_tool "Python 3" "python3" "python3 --version" "3.12.0" "false"
check_tool "OpenCode CLI" "opencode" "opencode --version 2>/dev/null || opencode --help 2>/dev/null || echo 'installed'" "" "true"
check_tool "git" "git" "git --version" "2.0.0" "false"

if command -v pip3 &>/dev/null || python3 -m pip --version &>/dev/null 2>&1; then
  success "pip (Python package manager) found"
  PASS=$((PASS + 1))
else
  warn "pip not found — Python packages may need manual installation"
  WARN=$((WARN + 1))
fi

echo ""
if [ "$FAIL" -gt 0 ]; then
  error "${FAIL} required tool(s) missing. Please install them and re-run."
  echo ""
  echo "  Quick install guide:"
  echo "    Node.js:   ${DIM}https://nodejs.org/en/download/${NC}"
  echo "    Python:    ${DIM}https://www.python.org/downloads/${NC}"
  echo "    Docker:    ${DIM}https://docs.docker.com/get-docker/${NC}"
  echo "    OpenCode:  ${DIM}npm install -g @opencode/cli${NC}"
  echo ""
  exit 1
fi

dim "  ${PASS} passed, ${WARN} warnings, ${FAIL} failures"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# STEP 2: npm install
# ═══════════════════════════════════════════════════════════════════════════════

header "Step 2: Installing Node.js Dependencies"

if [ -d "node_modules" ] && [ -f "package-lock.json" ]; then
  info "node_modules already exists — running npm ci for consistency"
  npm ci --silent 2>/dev/null || npm install --silent 2>/dev/null || npm install
else
  info "Installing dependencies with npm install..."
  npm install
fi

if [ -d "node_modules" ]; then
  success "Node.js dependencies installed"
else
  error "npm install did not create node_modules"
  exit 1
fi

# ═══════════════════════════════════════════════════════════════════════════════
# STEP 3: Environment Configuration
# ═══════════════════════════════════════════════════════════════════════════════

header "Step 3: Environment Configuration"

setup_env() {
  info "Generating .env with development defaults..."

  if [ -f ".env.example" ]; then
    cp ".env.example" ".env"
  else
    warn ".env.example not found — creating minimal .env"
    cat > ".env" << 'ENVEOF'
# STAS — Development Environment (auto-generated by npm run setup)
RUN_MODE=both
PORT=3000
NODE_ENV=development
LOG_LEVEL=debug
REDIS_URL=redis://localhost:6379
RABBITMQ_URL=amqp://guest:guest@localhost:5672/stas
OPENCODE_URL=http://localhost:4096
OPENCODE_MODEL=anthropic/claude-sonnet-4-20250514
STAS_LABEL=stas:fix
BOT_NAME=STAS
DEV_SKIP_WEBHOOK_SIGNATURE_VERIFY=true
QUEUE_BACKEND=rabbitmq
ENVEOF
  fi

  if [ -n "${GITHUB_APP_ID:-}" ]; then
    if [[ "$OSTYPE" == "darwin"* ]]; then
      sed -i '' "s/^GITHUB_APP_ID=.*/GITHUB_APP_ID=${GITHUB_APP_ID}/" ".env" 2>/dev/null || true
    else
      sed -i "s/^GITHUB_APP_ID=.*/GITHUB_APP_ID=${GITHUB_APP_ID}/" ".env" 2>/dev/null || true
    fi
    success "GITHUB_APP_ID set from environment"
  fi

  if [ -n "${GITHUB_WEBHOOK_SECRET:-}" ]; then
    local escaped
    escaped=$(printf '%s\n' "$GITHUB_WEBHOOK_SECRET" | sed 's/[\/&]/\\&/g')
    if [[ "$OSTYPE" == "darwin"* ]]; then
      sed -i '' "s/^GITHUB_WEBHOOK_SECRET=.*/GITHUB_WEBHOOK_SECRET=${escaped}/" ".env" 2>/dev/null || true
    else
      sed -i "s/^GITHUB_WEBHOOK_SECRET=.*/GITHUB_WEBHOOK_SECRET=${escaped}/" ".env" 2>/dev/null || true
    fi
    success "GITHUB_WEBHOOK_SECRET set from environment"
  fi

  if grep -q "^DEV_SKIP_WEBHOOK_SIGNATURE_VERIFY" ".env" 2>/dev/null; then
    if [[ "$OSTYPE" == "darwin"* ]]; then
      sed -i '' "s/^DEV_SKIP_WEBHOOK_SIGNATURE_VERIFY=.*/DEV_SKIP_WEBHOOK_SIGNATURE_VERIFY=true/" ".env" 2>/dev/null || true
    else
      sed -i "s/^DEV_SKIP_WEBHOOK_SIGNATURE_VERIFY=.*/DEV_SKIP_WEBHOOK_SIGNATURE_VERIFY=true/" ".env" 2>/dev/null || true
    fi
  else
    echo "" >> ".env"
    echo "# Development settings (auto-generated)" >> ".env"
    echo "DEV_SKIP_WEBHOOK_SIGNATURE_VERIFY=true" >> ".env"
  fi

  success ".env generated with development defaults"
  dim "  Edit .env to customize settings like GitHub App credentials"
  dim "  Run 'npm run doctor' to validate your configuration"
}

if [ "${SKIP_ENV:-}" = "true" ]; then
  info "Skipping .env generation (SKIP_ENV=true)"
elif [ -f ".env" ]; then
  if is_ci; then
    info ".env already exists — keeping existing configuration"
  else
    if confirm ".env already exists. Overwrite with development defaults?" "n"; then
      setup_env
    else
      info "Keeping existing .env — run ${BOLD}npm run doctor${NC} to validate"
    fi
  fi
else
  setup_env
fi

# ═══════════════════════════════════════════════════════════════════════════════
# STEP 4: Docker Services
# ═══════════════════════════════════════════════════════════════════════════════

header "Step 4: Docker Services (Redis + RabbitMQ)"

if [ "${SKIP_DOCKER:-}" = "true" ]; then
  info "Skipping Docker services (SKIP_DOCKER=true)"
elif ! command -v docker &>/dev/null; then
  warn "Docker not found — skipping Docker services"
  info "  You'll need Redis and RabbitMQ running manually for full functionality"
else
  if ! docker info &>/dev/null 2>&1; then
    warn "Docker daemon is not running — skipping Docker services"
    info "  Start Docker and re-run, or manually: docker compose up -d redis rabbitmq"
  else
    REDIS_RUNNING=false
    if command -v redis-cli &>/dev/null; then
      redis-cli ping &>/dev/null 2>&1 && REDIS_RUNNING=true || true
    fi

    if [ "$REDIS_RUNNING" = "true" ]; then
      info "Redis is already running on host — skipping Docker Redis"
    else
      if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "stas-redis"; then
        info "stas-redis container already running"
      else
        if confirm "Start Docker services (Redis, RabbitMQ)?" "y"; then
          info "Starting docker compose services..."
          if docker compose ps --services 2>/dev/null | grep -q .; then
            docker compose up -d redis rabbitmq 2>&1 || true
          else
            docker compose -f docker-compose.yml up -d redis rabbitmq 2>&1 || true
          fi
          success "Docker services started"
          dim "  Redis:     redis://localhost:6379"
          dim "  RabbitMQ:  amqp://guest:guest@localhost:5672/stas"
        else
          info "Skipping Docker services"
          dim "  Start them manually: docker compose up -d"
        fi
      fi
    fi
  fi
fi

# ═══════════════════════════════════════════════════════════════════════════════
# STEP 5: Python Virtual Environment
# ═══════════════════════════════════════════════════════════════════════════════

header "Step 5: Python Virtual Environment (Worker Dependencies)"

if [ "${SKIP_PYTHON:-}" = "true" ]; then
  info "Skipping Python venv creation (SKIP_PYTHON=true)"
elif ! command -v python3 &>/dev/null; then
  warn "python3 not found — skipping Python venv"
else
  VENV_DIR="$ROOT/.venv"

  if [ -d "$VENV_DIR" ] && [ -f "$VENV_DIR/bin/python3" ]; then
    info "Python virtual environment already exists at ${VENV_DIR}"
    if ! is_ci; then
      if confirm "Re-create Python virtual environment?" "n"; then
        rm -rf "$VENV_DIR"
        info "Removed existing virtual environment"
      fi
    fi
  fi

  if [ ! -d "$VENV_DIR" ]; then
    info "Creating Python virtual environment..."
    python3 -m venv "$VENV_DIR"
    success "Virtual environment created at .venv"
  fi

  if [ -f "$ROOT/workers/requirements.txt" ]; then
    info "Installing worker Python dependencies..."
    "$VENV_DIR/bin/pip" install --quiet --upgrade pip 2>/dev/null || true
    "$VENV_DIR/bin/pip" install --quiet -r "$ROOT/workers/requirements.txt" 2>&1 | tail -5 || {
      warn "Some Python packages failed to install"
      info "  Try manually: ${DIM}.venv/bin/pip install -r workers/requirements.txt${NC}"
    }
    if [ -f "$ROOT/requirements.txt" ]; then
      "$VENV_DIR/bin/pip" install --quiet -r "$ROOT/requirements.txt" 2>&1 | tail -3 || true
    fi
    success "Python worker dependencies installed"
  else
    warn "workers/requirements.txt not found — skipping Python dependency installation"
  fi

  dim "  Activate: source .venv/bin/activate"
  dim "  Run tests: .venv/bin/python -m pytest workers/tests/"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# STEP 6: Validate GitHub App Credentials (if provided)
# ═══════════════════════════════════════════════════════════════════════════════

header "Step 6: Validate GitHub App Credentials"

if [ -f ".env" ]; then
  set -a
  source ".env" 2>/dev/null || true
  set +a

  GITHUB_APP_ID_VAL="${GITHUB_APP_ID:-}"
  GITHUB_PRIVATE_KEY_VAL="${GITHUB_APP_PRIVATE_KEY:-}"
  GITHUB_PRIVATE_KEY_PATH_VAL="${GITHUB_APP_PRIVATE_KEY_PATH:-}"
  GITHUB_WEBHOOK_SECRET_VAL="${GITHUB_WEBHOOK_SECRET:-}"

  if [ -n "$GITHUB_APP_ID_VAL" ] && [ -n "$GITHUB_WEBHOOK_SECRET_VAL" ]; then
    success "GitHub App ID and webhook secret are configured"

    if [ -n "$GITHUB_PRIVATE_KEY_VAL" ]; then
      if echo "$GITHUB_PRIVATE_KEY_VAL" | grep -q "BEGIN.*RSA.*KEY"; then
        success "GitHub App private key appears valid (PEM format detected)"
      else
        warn "GITHUB_APP_PRIVATE_KEY may not be a valid PEM key"
        dim "  Expected format: -----BEGIN RSA PRIVATE KEY-----"
      fi
    elif [ -n "$GITHUB_PRIVATE_KEY_PATH_VAL" ]; then
      if [ -f "$GITHUB_PRIVATE_KEY_PATH_VAL" ]; then
        success "GitHub App private key found at $GITHUB_PRIVATE_KEY_PATH_VAL"
      else
        warn "Private key path set but file not found: ${GITHUB_PRIVATE_KEY_PATH_VAL}"
      fi
    else
      warn "GitHub App private key not configured"
      dim "  Set GITHUB_APP_PRIVATE_KEY or GITHUB_APP_PRIVATE_KEY_PATH in .env"
    fi
  else
    if [ -n "$GITHUB_APP_ID_VAL" ] || [ -n "$GITHUB_WEBHOOK_SECRET_VAL" ]; then
      warn "Partial GitHub App configuration — both GITHUB_APP_ID and GITHUB_WEBHOOK_SECRET are required"
    else
      info "GitHub App credentials not configured (required for production only)"
      dim "  For local development, you can skip this and use npm run dev"
      dim "  Configure later: npm run init"
    fi
  fi
fi

# ═══════════════════════════════════════════════════════════════════════════════
# DONE — Success Message
# ═══════════════════════════════════════════════════════════════════════════════

header "Setup Complete!"

echo -e "${GREEN}"
echo "  ┌──────────────────────────────────────────────────────┐"
echo "  │  ${BOLD}STAS Development Environment is Ready${NC}${GREEN}             │"
echo "  └──────────────────────────────────────────────────────┘"
echo -e "${NC}"

echo -e "${BOLD}Quick Start:${NC}"
echo ""
echo "  ${CYAN}1.${NC} Start OpenCode (agent backend):"
echo "     ${DIM}opencode serve --port 4096${NC}"
echo ""
echo "  ${CYAN}2.${NC} Start the bot (in another terminal):"
echo "     ${DIM}npm run dev${NC}"
echo ""
echo "  ${CYAN}3.${NC} Verify it's running:"
echo "     ${DIM}curl http://localhost:3000/health${NC}"
echo ""

echo -e "${BOLD}Useful Commands:${NC}"
echo ""
echo "  ${DIM}npm run doctor${NC}     — Check system health and configuration"
echo "  ${DIM}npm run init${NC}       — Interactive setup wizard"
echo "  ${DIM}npm run smee${NC}       — Start webhook proxy (smee.io)"
echo "  ${DIM}npm run test${NC}       — Run tests"
echo ""

echo -e "${BOLD}Documentation:${NC}"
echo ""
echo "  ${DIM}CONTRIBUTING.md${NC}    — Development guide"
echo "  ${DIM}DEVELOPMENT.md${NC}     — Deployment guide"
echo "  ${DIM}docs/SELF_HOSTING.md${NC} — Self-hosting guide"
echo ""

if [ -f ".env" ] && grep -q "^GITHUB_APP_ID=$" ".env" 2>/dev/null; then
  echo -e "${YELLOW}Reminder:${NC} Edit .env to add your GitHub App credentials"
  echo "  ${DIM}GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, GITHUB_WEBHOOK_SECRET${NC}"
  echo ""
fi

echo -e "${GREEN}Happy coding!${NC}"
echo ""
