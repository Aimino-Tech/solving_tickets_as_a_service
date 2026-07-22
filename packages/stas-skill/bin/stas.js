#!/usr/bin/env node
/**
 * STAS CLI — install the STAS skill for any MCP-compatible agent.
 *
 * Usage:
 *   npx @aimino/stas install              # Interactive install
 *   npx @aimino/stas install --opencode   # OpenCode only
 *   npx @aimino/stas install --claude     # Claude Desktop only
 *   npx @aimino/stas install --cursor     # Cursor only
 *   npx @aimino/stas install --codex      # Codex CLI only
 *   npx @aimino/stas --version            # Print version
 */

const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const VERSION = "1.0.0";
const SCRIPT_DIR = __dirname;
const PROJECT_DIR = path.resolve(SCRIPT_DIR, "..");

function runInstallScript(args) {
  const installSh = path.resolve(PROJECT_DIR, "../../stas_mcp/install.sh");
  if (!fs.existsSync(installSh)) {
    console.error("Error: install.sh not found at", installSh);
    console.error("Make sure you're running from within the STAS project.");
    process.exit(1);
  }
  const cmd = `bash "${installSh}" ${args.join(" ")}`;
  console.log(`Running: ${cmd}\n`);
  execSync(cmd, { stdio: "inherit" });
}

function printVersion() {
  console.log(`@aimino/stas v${VERSION}`);
}

function printHelp() {
  console.log(`
STAS — Solving Tickets As A Service
Version ${VERSION}

Usage:
  npx @aimino/stas install [flags]    Install the STAS MCP server
  npx @aimino/stas --version           Print version
  npx @aimino/stas --help              Print this help

Install Flags:
  --opencode    OpenCode only
  --claude      Claude Desktop only
  --cursor      Cursor only
  --codex       Codex CLI only
  --uninstall   Remove STAS from all agents
  --mode sse    Use SSE transport (default: stdio)
  --port N      SSE port (default: 4095)
  --host H      SSE bind host (default: 0.0.0.0)

Examples:
  npx @aimino/stas install
  npx @aimino/stas install --opencode
  npx @aimino/stas install --mode sse --port 4095
  npx @aimino/stas install --uninstall
`);
}

const args = process.argv.slice(2);

if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
  printHelp();
  process.exit(0);
}

if (args.includes("--version") || args.includes("-v")) {
  printVersion();
  process.exit(0);
}

if (args[0] === "install") {
  runInstallScript(args.slice(1));
} else {
  console.error(`Unknown command: ${args[0]}`);
  printHelp();
  process.exit(1);
}
