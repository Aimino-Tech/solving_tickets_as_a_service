#!/usr/bin/env bash
set -euo pipefail

echo "=== OpenClaw One-Person Data Company Setup ==="
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

step() { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
fail() { echo -e "${RED}[✗]${NC} $1"; exit 1; }

# 1. Check prerequisites
echo "--- Checking prerequisites ---"
command -v node >/dev/null 2>&1 || fail "Node.js not found. Install v20+"
command -v npm >/dev/null 2>&1 || fail "npm not found."
command -v docker >/dev/null 2>&1 || fail "Docker not found."
command -v git >/dev/null 2>&1 || fail "git not found."
step "Prerequisites OK (node $(node --version), docker)"

# 2. Install OpenClaw CLI if missing
if ! command -v openclaw >/dev/null 2>&1; then
    echo ""
    echo "--- Installing OpenClaw CLI ---"
    npm install -g openclaw@latest
    step "OpenClaw CLI installed"
else
    step "OpenClaw CLI already installed ($(openclaw --version 2>/dev/null || echo 'unknown'))"
fi

# 3. Environment file
if [ ! -f .env ]; then
    cp .env.example .env
    warn ".env created from template — fill in your API keys before continuing!"
    echo ""
    echo "  Required keys:"
    echo "    OPENCODE_API_KEY    - from your opencode setup"
    echo "    OPENCLAW_GATEWAY_TOKEN - run: openssl rand -hex 32"
    echo "    VNC_PASSWORD        - any password for browser VNC access"
    echo ""
    echo "  Optional keys:"
    echo "    TELEGRAM_BOT_TOKEN  - from @BotFather"
    echo "    TAVILY_API_KEY      - from tavily.com (free 1000 req/mo)"
    echo ""
    read -p "Press Enter after editing .env (or Ctrl+C to exit)..."
fi
step ".env configured"

# 4. Generate gateway token if placeholder
if grep -q "your-gateway-token-here" .env 2>/dev/null; then
    TOKEN=$(openssl rand -hex 32)
    sed -i "s/your-gateway-token-here/$TOKEN/" .env
    step "Gateway token auto-generated"
fi

# 5. Install Python dependencies for engagement modules
echo ""
echo "--- Installing Python Engagement Dependencies ---"
pip install -r scripts/requirements.txt --break-system-packages 2>/dev/null || \
pip install -r scripts/requirements.txt 2>/dev/null || \
warn "pip install failed — run manually: pip install -r scripts/requirements.txt"
python3 -m playwright install chromium 2>/dev/null || true
step "Python engagement dependencies installed"

# 5b. Run onboarding wizard
echo ""
echo "--- OpenClaw Onboarding ---"
openclaw onboard \
    --workspace ./workspace \
    --config ./config/gateway.json \
    --install-daemon || warn "Onboarding had warnings (may need manual config)"

# 6. Install Phase 1 skills
echo ""
echo "--- Installing Phase 1 Skills ---"
SKILLS=(agent-browser tavily duckdb-cli csv-pipeline clarity-gate)
for skill in "${SKILLS[@]}"; do
    echo "  Installing: $skill"
    openclaw skills install "$skill" --sandbox=strict || warn "Failed to install $skill"
done
step "Phase 1 skills installed"

# 7. Start Docker services
echo ""
echo "--- Starting Docker Services ---"
docker compose up -d
step "Docker services started"

# 8. Verify
echo ""
echo "--- Verification ---"
sleep 3
if curl -sf http://127.0.0.1:18789/health >/dev/null 2>&1; then
    step "Gateway healthy at :18789"
else
    warn "Gateway not responding yet — check: docker compose logs openclaw-gateway"
fi

if curl -sf http://127.0.0.1:6080 >/dev/null 2>&1; then
    step "noVNC accessible at :6080"
else
    warn "noVNC not responding yet — check: docker compose logs novnc"
fi

echo ""
echo "=== Setup Complete ==="
echo ""
echo "  Dashboard:  http://127.0.0.1:18789/"
echo "  noVNC:      http://127.0.0.1:6080/"
echo "  DuckDB API: http://127.0.0.1:8642/docs"
echo ""
echo "  Next steps:"
echo "  1. Fill in .env with your API keys"
echo "  2. Configure Telegram: openclaw channel add telegram"
echo "  3. Test agent: openclaw chat 'Hello, summarize PLAN.md'"
echo "  4. SSH tunnel for remote: ssh -NL 18789:127.0.0.1:18789 -L 6080:127.0.0.1:6080 your-server"
echo ""
