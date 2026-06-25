#!/usr/bin/env bash
# =============================================================================
# scripts/install-oss-guard.sh — Install OSS Prompt Injection Guard Tools
#
# Installs optional third-party libraries for ML-powered prompt injection
# detection:
#
#   - llm-guard   — Transformer-based prompt injection classifier
#   - rebuff      — Multi-layered injection detector with vector similarity
#   - garak       — LLM vulnerability probe suite (deep scan)
#
# Usage:
#   bash scripts/install-oss-guard.sh
#
# Environment:
#   STAS_SKIP_GARAK=true   — Skip garak installation (slow, large deps)
#   STAS_PIP_INDEX_URL     — Custom PyPI index URL (default: https://pypi.org/simple)
# =============================================================================

set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# -------------------------------------------------------------------------
# Colors
# -------------------------------------------------------------------------

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

info()  { printf "${BLUE}[INFO]${NC}  %s\n" "$*"; }
ok()    { printf "${GREEN}[OK]${NC}    %s\n" "$*"; }
warn()  { printf "${YELLOW}[WARN]${NC}  %s\n" "$*"; }
error() { printf "${RED}[ERROR]${NC} %s\n" "$*"; }

# -------------------------------------------------------------------------
# Detect Python
# -------------------------------------------------------------------------

PYTHON=""
for py in python3 python; do
    if command -v "$py" &>/dev/null; then
        PYTHON="$py"
        break
    fi
done

if [ -z "$PYTHON" ]; then
    error "Python not found. Please install Python >= 3.10."
    exit 1
fi

PY_VERSION=$("$PYTHON" --version 2>&1 | awk '{print $2}')
info "Using Python $PY_VERSION"

# -------------------------------------------------------------------------
# Determine pip
# -------------------------------------------------------------------------

PIP=""
if command -v pip3 &>/dev/null; then
    PIP="pip3"
elif command -v pip &>/dev/null; then
    PIP="pip"
else
    error "pip not found. Please install pip."
    exit 1
fi

# Check if we're inside a virtual environment
if [ -z "${VIRTUAL_ENV:-}" ]; then
    warn "Not inside a virtual environment. Installing packages globally may conflict."
    warn "Consider activating your venv first:"
    warn "  python3 -m venv .venv && source .venv/bin/activate"
    echo ""
fi

# -------------------------------------------------------------------------
# Install tools
# -------------------------------------------------------------------------

install_ok=true

info "Installing OSS prompt injection guard tools..."
echo ""

# --- llm-guard -----------------------------------------------------------
info "Installing llm-guard..."
if "$PIP" install llm-guard --quiet 2>&1; then
    ok "llm-guard installed successfully"
else
    warn "llm-guard installation failed (non-fatal)"
    install_ok=false
fi

# --- rebuff --------------------------------------------------------------
info "Installing rebuff..."
if "$PIP" install rebuff --quiet 2>&1; then
    ok "rebuff installed successfully"
else
    warn "rebuff installation failed (non-fatal)"
    install_ok=false
fi

# --- garak (optional) ----------------------------------------------------
if [ "${STAS_SKIP_GARAK:-}" = "true" ]; then
    warn "Skipping garak installation (STAS_SKIP_GARAK=true)"
else
    info "Installing garak..."
    # garak has many transitive dependencies (~200+ MB); install is slow
    if "$PIP" install garak --quiet 2>&1; then
        ok "garak installed successfully"
    else
        warn "garak installation failed (non-fatal)"
        install_ok=false
    fi
fi

echo ""

# -------------------------------------------------------------------------
# Verify
# -------------------------------------------------------------------------

info "Verifying installations..."

verify() {
    local module="$1"
    local label="$2"
    if "$PYTHON" -c "import $module" 2>/dev/null; then
        ok "$label — available"
        return 0
    else
        warn "$label — not available (check installation)"
        return 1
    fi
}

llm_guard_ok=false
rebuff_ok=false
garak_ok=false

verify "llm_guard"     "llm-guard"   && llm_guard_ok=true
verify "rebuff"        "rebuff"      && rebuff_ok=true
verify "garak"         "garak"       && garak_ok=true

echo ""

# -------------------------------------------------------------------------
# Summary
# -------------------------------------------------------------------------

echo "================================================"
echo "  OSS Guard Installation Summary"
echo "================================================"
echo ""
printf "  %-20s %s\n" "llm-guard" "$( $llm_guard_ok && echo '✓' || echo '✗')"
printf "  %-20s %s\n" "rebuff"    "$( $rebuff_ok && echo '✓' || echo '✗')"
printf "  %-20s %s\n" "garak"     "$( $garak_ok && echo '✓' || echo '✗')"
echo ""
printf "  %-20s %s\n" "Python"    "$PYTHON $PY_VERSION"
echo ""

if $llm_guard_ok || $rebuff_ok || $garak_ok; then
    ok "At least one OSS guard tool is available."
    echo ""
    echo "  To enable OSS guard integration, set:"
    echo "    export STAS_OSS_GUARD_ENABLED=true"
    echo ""
    echo "  To select specific tools (default: llm_guard,rebuff):"
    echo "    export STAS_OSS_GUARD_TOOLS=llm_guard,rebuff,garak"
else
    warn "No OSS guard tools were installed successfully."
    echo ""
    echo "  Check your Python environment and try again."
    echo "  If using a venv, activate it first:"
    echo "    source .venv/bin/activate"
    echo "    bash scripts/install-oss-guard.sh"
fi

echo ""

if $install_ok; then
    ok "Installation complete."
else
    warn "Some tools failed to install (see above for details)."
    warn "The OSS guard will fall back to the regex-based InjectionGuard."
fi
