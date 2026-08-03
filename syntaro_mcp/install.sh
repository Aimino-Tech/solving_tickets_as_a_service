#!/usr/bin/env bash
# ============================================================================
# install.sh — Register SYNTARO MCP server with all major agent platforms.
#
# Supported agents:
#   - OpenCode         (opencode.json / mcp.json)
#   - Claude Desktop   (claude_desktop_config.json)
#   - Cursor           (via settings CLI when available)
#   - Codex CLI        (.codex/config.json)
#
# Usage:
#   bash install.sh                    # Install for all detected agents
#   bash install.sh --opencode         # OpenCode only
#   bash install.sh --claude           # Claude Desktop only
#   bash install.sh --cursor           # Cursor only
#   bash install.sh --codex            # Codex CLI only
#   bash install.sh --uninstall        # Remove from all agents
#   bash install.sh --mode sse         # Use SSE transport (default: stdio)
#   bash install.sh --port 4095        # SSE port (default: 4095)
#   bash install.sh --host 0.0.0.0     # SSE bind host (default: 0.0.0.0)
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

MCP_SERVER_NAME="syntaro-agent-discovery"
MCP_TRANSPORT="${SYNTARO_MCP_TRANSPORT:-stdio}"
MCP_PORT="${SYNTARO_MCP_PORT:-4095}"
MCP_HOST="${SYNTARO_MCP_HOST:-0.0.0.0}"

# Config directories
OPENCODE_CONFIG_DIR="${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}"
OPENCODE_PROJECT_CONFIG="${OPENCODE_PROJECT_CONFIG:-$PROJECT_DIR/opencode.json}"
CLAUDE_CONFIG_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.config/Claude}"
CODEX_CONFIG_DIR="${CODEX_CONFIG_DIR:-$PROJECT_DIR/.codex}"
CURSOR_CONFIG_DIR="${CURSOR_CONFIG_DIR:-$HOME/.cursor}"

PYTHON_BIN="$(command -v python3 || command -v python || true)"
if [ -z "$PYTHON_BIN" ]; then
    echo "ERROR: Python 3 not found. Install Python 3.11+ and try again."
    exit 1
fi
MCP_MODULE="syntaro_mcp.server"

INSTALL_OPENCODE=true
INSTALL_CLAUDE=true
INSTALL_CURSOR=false
INSTALL_CODEX=false
UNINSTALL=false

for arg in "$@"; do
    case "$arg" in
        --opencode) INSTALL_CLAUDE=false; INSTALL_CURSOR=false; INSTALL_CODEX=false ;;
        --claude) INSTALL_OPENCODE=false; INSTALL_CURSOR=false; INSTALL_CODEX=false ;;
        --cursor) INSTALL_OPENCODE=false; INSTALL_CLAUDE=false; INSTALL_CODEX=false ;;
        --codex) INSTALL_OPENCODE=false; INSTALL_CLAUDE=false; INSTALL_CURSOR=false ;;
        --uninstall) UNINSTALL=true ;;
        --mode) shift; MCP_TRANSPORT="$1" ;;
        --port) shift; MCP_PORT="$1" ;;
        --host) shift; MCP_HOST="$1" ;;
    esac
done

ensure_deps() {
    if ! python3 -c "import mcp" 2>/dev/null; then
        echo "Installing MCP SDK..."
        pip install "mcp>=1.0.0" httpx
    fi
    if ! python3 -c "import syntaro_mcp.server" 2>/dev/null; then
        export PYTHONPATH="$PROJECT_DIR:${PYTHONPATH:-}"
    fi
}

# ------------------------------------------------------------------
# OpenCode — inject into opencode.json (project-level) or mcp.json
# ------------------------------------------------------------------
install_opencode() {
    # Prefer project-level opencode.json, fall back to global mcp.json
    local config_file
    if [ -f "$OPENCODE_PROJECT_CONFIG" ]; then
        config_file="$OPENCODE_PROJECT_CONFIG"
    else
        config_file="$OPENCODE_CONFIG_DIR/mcp.json"
        mkdir -p "$OPENCODE_CONFIG_DIR"
    fi

    local server_config
    if [ "$MCP_TRANSPORT" = "sse" ]; then
        server_config=$(cat <<EOF
{
  "name": "$MCP_SERVER_NAME",
  "transport": "sse",
  "url": "http://$MCP_HOST:$MCP_PORT/sse"
}
EOF
)
    else
        server_config=$(cat <<EOF
{
  "name": "$MCP_SERVER_NAME",
  "transport": "stdio",
  "command": "$PYTHON_BIN",
  "args": ["-m", "$MCP_MODULE", "stdio"]
}
EOF
)
    fi

    local existing="{}"
    if [ -f "$config_file" ]; then
        existing=$(cat "$config_file")
    fi

    # Detect if this is an opencode.json (uses mcpServers key) or mcp.json (flat)
    local use_opencode_schema=false
    if echo "$existing" | python3 -c "import json,sys; d=json.load(sys.stdin); sys.exit(0 if 'mcpServers' in d else 1)" 2>/dev/null; then
        use_opencode_schema=true
    fi

    if [ "$use_opencode_schema" = true ]; then
        # opencode.json format: { "mcpServers": { ... } }
        python3 -c "
import json
with open('$config_file', 'w') as f:
    cfg = json.loads('''$existing''')
    cfg['mcpServers']['$MCP_SERVER_NAME'] = json.loads('''$server_config''')
    json.dump(cfg, f, indent=2)
"
        echo "Registered '$MCP_SERVER_NAME' in opencode.json (mcpServers.$MCP_SERVER_NAME)"
    else
        # mcp.json format: flat map
        python3 -c "
import json
with open('$config_file', 'w') as f:
    cfg = json.loads('''$existing''')
    cfg['$MCP_SERVER_NAME'] = json.loads('''$server_config''')
    json.dump(cfg, f, indent=2)
"
        echo "Registered '$MCP_SERVER_NAME' in mcp.json ($MCP_TRANSPORT mode)"
    fi
}

# Generate an opencode.json snippet for the README
generate_opencode_snippet() {
    cat <<EOF
\`\`\`json
{
  "mcpServers": {
    "syntaro": {
      "command": "$PYTHON_BIN",
      "args": ["-m", "$MCP_MODULE", "stdio"]
    }
  }
}
\`\`\`
EOF
}

# ------------------------------------------------------------------
# Claude Desktop — inject into claude_desktop_config.json
# ------------------------------------------------------------------
install_claude() {
    local config_file="$CLAUDE_CONFIG_DIR/claude_desktop_config.json"
    mkdir -p "$CLAUDE_CONFIG_DIR"
    local server_config
    if [ "$MCP_TRANSPORT" = "sse" ]; then
        server_config=$(cat <<EOF
{
  "command": "$PYTHON_BIN",
  "args": ["-m", "$MCP_MODULE", "sse", "--host", "$MCP_HOST", "--port", "$MCP_PORT"]
}
EOF
)
    else
        server_config=$(cat <<EOF
{
  "command": "$PYTHON_BIN",
  "args": ["-m", "$MCP_MODULE", "stdio"]
}
EOF
)
    fi
    local existing="{}"
    if [ -f "$config_file" ]; then
        existing=$(cat "$config_file")
    fi
    python3 -c "
import json
with open('$config_file', 'w') as f:
    cfg = json.loads('''$existing''')
    if 'mcpServers' not in cfg:
        cfg['mcpServers'] = {}
    cfg['mcpServers']['syntaro'] = json.loads('''$server_config''')
    json.dump(cfg, f, indent=2)
"
    echo "Registered 'syntaro' with Claude Desktop ($MCP_TRANSPORT mode)"
}

# ------------------------------------------------------------------
# Cursor — inject into ~/.cursor/mcp.json
# ------------------------------------------------------------------
install_cursor() {
    local config_file="$HOME/.cursor/mcp.json"
    mkdir -p "$HOME/.cursor"
    local server_config
    if [ "$MCP_TRANSPORT" = "sse" ]; then
        server_config=$(cat <<EOF
{
  "name": "syntaro",
  "transport": "sse",
  "url": "http://$MCP_HOST:$MCP_PORT/sse"
}
EOF
)
    else
        server_config=$(cat <<EOF
{
  "name": "syntaro",
  "transport": "stdio",
  "command": "$PYTHON_BIN",
  "args": ["-m", "$MCP_MODULE", "stdio"]
}
EOF
)
    fi
    local existing="{}"
    if [ -f "$config_file" ]; then
        existing=$(cat "$config_file")
    fi
    python3 -c "
import json
with open('$config_file', 'w') as f:
    cfg = json.loads('''$existing''')
    if 'mcpServers' not in cfg:
        cfg['mcpServers'] = {}
    cfg['mcpServers']['syntaro'] = json.loads('''$server_config''')
    json.dump(cfg, f, indent=2)
"
    echo "Registered 'syntaro' with Cursor ($MCP_TRANSPORT mode)"
}

# ------------------------------------------------------------------
# Codex CLI — inject into .codex/config.json
# ------------------------------------------------------------------
install_codex() {
    local config_file="$CODEX_CONFIG_DIR/config.json"
    mkdir -p "$CODEX_CONFIG_DIR"
    local server_config
    if [ "$MCP_TRANSPORT" = "sse" ]; then
        server_config=$(cat <<EOF
{
  "transport": "sse",
  "url": "http://$MCP_HOST:$MCP_PORT/sse"
}
EOF
)
    else
        server_config=$(cat <<EOF
{
  "command": "$PYTHON_BIN",
  "args": ["-m", "$MCP_MODULE", "stdio"]
}
EOF
)
    fi
    local existing="{}"
    if [ -f "$config_file" ]; then
        existing=$(cat "$config_file")
    fi
    python3 -c "
import json
with open('$config_file', 'w') as f:
    cfg = json.loads('''$existing''')
    if 'mcpServers' not in cfg:
        cfg['mcpServers'] = {}
    cfg['mcpServers']['syntaro'] = json.loads('''$server_config''')
    json.dump(cfg, f, indent=2)
"
    echo "Registered 'syntaro' with Codex CLI ($MCP_TRANSPORT mode)"
}

# ------------------------------------------------------------------
# Uninstall — remove from all known agent configs
# ------------------------------------------------------------------
uninstall_all() {
    # OpenCode mcp.json
    local oc_config="$OPENCODE_CONFIG_DIR/mcp.json"
    if [ -f "$oc_config" ]; then
        python3 -c "
import json
with open('$oc_config') as f:
    cfg = json.load(f)
cfg.pop('$MCP_SERVER_NAME', None)
cfg.get('mcpServers', {}).pop('$MCP_SERVER_NAME', None)
with open('$oc_config', 'w') as f:
    json.dump(cfg, f, indent=2)
" 2>/dev/null || true
        echo "Removed '$MCP_SERVER_NAME' from OpenCode config"
    fi

    # opencode.json
    if [ -f "$OPENCODE_PROJECT_CONFIG" ]; then
        python3 -c "
import json
with open('$OPENCODE_PROJECT_CONFIG') as f:
    cfg = json.load(f)
cfg.get('mcpServers', {}).pop('$MCP_SERVER_NAME', None)
with open('$OPENCODE_PROJECT_CONFIG', 'w') as f:
    json.dump(cfg, f, indent=2)
" 2>/dev/null || true
        echo "Removed '$MCP_SERVER_NAME' from opencode.json"
    fi

    # Claude Desktop
    local claude_config="$CLAUDE_CONFIG_DIR/claude_desktop_config.json"
    if [ -f "$claude_config" ]; then
        python3 -c "
import json
with open('$claude_config') as f:
    cfg = json.load(f)
cfg.get('mcpServers', {}).pop('syntaro', None)
with open('$claude_config', 'w') as f:
    json.dump(cfg, f, indent=2)
" 2>/dev/null || true
        echo "Removed 'syntaro' from Claude Desktop config"
    fi

    # Cursor
    local cursor_config="$HOME/.cursor/mcp.json"
    if [ -f "$cursor_config" ]; then
        python3 -c "
import json
with open('$cursor_config') as f:
    cfg = json.load(f)
cfg.get('mcpServers', {}).pop('syntaro', None)
with open('$cursor_config', 'w') as f:
    json.dump(cfg, f, indent=2)
" 2>/dev/null || true
        echo "Removed 'syntaro' from Cursor config"
    fi

    # Codex CLI
    local codex_config="$CODEX_CONFIG_DIR/config.json"
    if [ -f "$codex_config" ]; then
        python3 -c "
import json
with open('$codex_config') as f:
    cfg = json.load(f)
cfg.get('mcpServers', {}).pop('syntaro', None)
with open('$codex_config', 'w') as f:
    json.dump(cfg, f, indent=2)
" 2>/dev/null || true
        echo "Removed 'syntaro' from Codex CLI config"
    fi

    echo "Done."
    exit 0
}

# ============================================================================
# Main
# ============================================================================

if [ "$UNINSTALL" = true ]; then
    uninstall_all
fi

ensure_deps

if [ "$INSTALL_OPENCODE" = true ]; then
    install_opencode
fi
if [ "$INSTALL_CLAUDE" = true ]; then
    install_claude
fi
if [ "$INSTALL_CURSOR" = true ]; then
    install_cursor
fi
if [ "$INSTALL_CODEX" = true ]; then
    install_codex
fi

echo ""
echo "SYNTARO MCP server is now discoverable."
echo ""
echo "Quick start:"
echo "  # Run in stdio mode (for tools like OpenCode):"
echo "  python -m $MCP_MODULE stdio"
echo ""
echo "  # Run in SSE mode (for remote discovery):"
echo "  python -m $MCP_MODULE sse --port $MCP_PORT"
echo ""
echo "  # Verify:"
echo "  python -m $MCP_MODULE stdio <<< '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\"}'"
echo ""
echo "Agent install snippets (add to config):"
echo ""
echo "  OpenCode (opencode.json):"
generate_opencode_snippet
echo ""
echo "  Cursor (~/.cursor/mcp.json):"
echo "    { \"mcpServers\": { \"syntaro\": { \"command\": \"$PYTHON_BIN\", \"args\": [\"-m\", \"$MCP_MODULE\", \"stdio\"] } } }"
echo ""
echo "  Codex CLI (.codex/config.json):"
echo "    { \"mcpServers\": { \"syntaro\": { \"command\": \"$PYTHON_BIN\", \"args\": [\"-m\", \"$MCP_MODULE\", \"stdio\"] } } }"
