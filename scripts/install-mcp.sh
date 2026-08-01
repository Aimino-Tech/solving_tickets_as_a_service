#!/usr/bin/env bash
# ============================================================================
# install-mcp.sh — One-command MCP install for any agent platform.
# Invoked via: npx stas install-mcp
#
# Detects the current project root and delegates to syntaro_mcp/install.sh.
# Supports all flags from install.sh.
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Delegate to the canonical install script
exec bash "$PROJECT_DIR/syntaro_mcp/install.sh" "$@"
