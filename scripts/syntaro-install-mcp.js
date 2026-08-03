#!/usr/bin/env node
/**
 * syntaro-install-mcp.js — One-command MCP install via `npx syntaro install-mcp`.
 *
 * Usage:
 *   npx syntaro install-mcp              # Install for all agent platforms
 *   npx syntaro install-mcp --opencode   # OpenCode only
 *   npx syntaro install-mcp --claude     # Claude Desktop only
 *   npx syntaro install-mcp --cursor     # Cursor only
 *   npx syntaro install-mcp --codex      # Codex CLI only
 *   npx syntaro install-mcp --uninstall  # Remove from all agents
 *   npx syntaro install-mcp --claude --url https://api.syntaro.io   # Remote SaaS MCP server
 *
 * This script resolves the project root and delegates to syntaro_mcp/install.sh.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "..");

const installScript = resolve(PROJECT_ROOT, "syntaro_mcp", "install.sh");

if (!existsSync(installScript)) {
  console.error(`Error: install.sh not found at ${installScript}`);
  console.error("Make sure you're running this from the SYNTARO project root.");
  process.exit(1);
}

const args = process.argv.slice(2);

try {
  execFileSync("bash", [installScript, ...args], {
    cwd: PROJECT_ROOT,
    stdio: "inherit",
    env: { ...process.env, PYTHONPATH: `${PROJECT_ROOT}:${process.env.PYTHONPATH || ""}` },
  });
} catch (err) {
  console.error(`Installation failed: ${err.message}`);
  process.exit(1);
}
