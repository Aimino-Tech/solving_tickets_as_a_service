#!/usr/bin/env bash
# ============================================================================
# install.sh — Register STAS MCP server with OpenCode and Claude Desktop.
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

MCP_SERVER_NAME="stas-agent-discovery"
MCP_TRANSPORT="${STAS_MCP_TRANSPORT:-stdio}"
MCP_PORT="${STAS_MCP_PORT:-4095}"
MCP_HOST="${STAS_MCP_HOST:-0.0.0.0}"
OPENCODE_CONFIG_DIR="${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}"
CLAUDE_CONFIG_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.config/Claude}"
PYTHON_BIN="$(command -v python3 || command -v python || true)"
if [ -z "$PYTHON_BIN" ]; then
    echo "ERROR: Python 3 not found. Install Python 3.11+ and try again."
    exit 1
fi
MCP_MODULE="stas_mcp.server"

INSTALL_OPENCODE=true
INSTALL_CLAUDE=true
UNINSTALL=false

for arg in "$@"; do
    case "$arg" in
        --opencode) INSTALL_CLAUDE=false ;;
        --claude) INSTALL_OPENCODE=false ;;
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
    if ! python3 -c "import stas_mcp.server" 2>/dev/null; then
        export PYTHONPATH="$PROJECT_DIR:${PYTHONPATH:-}"
    fi
}

install_opencode() {
    local config_file="$OPENCODE_CONFIG_DIR/mcp.json"
    mkdir -p "$OPENCODE_CONFIG_DIR"
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
    python3 -c "
import json
with open('$config_file', 'w') as f:
    cfg = json.loads('''$existing''')
    cfg['$MCP_SERVER_NAME'] = json.loads('''$server_config''')
    json.dump(cfg, f, indent=2)
"
    echo "Registered '$MCP_SERVER_NAME' with OpenCode ($MCP_TRANSPORT mode)"
}

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
    cfg['mcpServers']['stas'] = json.loads('''$server_config''')
    json.dump(cfg, f, indent=2)
"
    echo "Registered 'stas' with Claude Desktop ($MCP_TRANSPORT mode)"
}

uninstall_all() {
    local oc_config="$OPENCODE_CONFIG_DIR/mcp.json"
    if [ -f "$oc_config" ]; then
        python3 -c "
import json
with open('$oc_config') as f:
    cfg = json.load(f)
cfg.pop('$MCP_SERVER_NAME', None)
with open('$oc_config', 'w') as f:
    json.dump(cfg, f, indent=2)
" 2>/dev/null || true
        echo "Removed '$MCP_SERVER_NAME' from OpenCode config"
    fi
    local claude_config="$CLAUDE_CONFIG_DIR/claude_desktop_config.json"
    if [ -f "$claude_config" ]; then
        python3 -c "
import json
with open('$claude_config') as f:
    cfg = json.load(f)
cfg.get('mcpServers', {}).pop('stas', None)
with open('$claude_config', 'w') as f:
    json.dump(cfg, f, indent=2)
" 2>/dev/null || true
        echo "Removed 'stas' from Claude Desktop config"
    fi
    echo "Done."
    exit 0
}

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
echo ""
echo "STAS MCP server is now discoverable."
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
