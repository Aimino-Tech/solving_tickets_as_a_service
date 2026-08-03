#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Resolve the Python module: vendored copy ships inside the npm tarball;
// fall back to the monorepo checkout when running from the repo directly.
const projectRoot = resolve(__dirname, '../..');
const vendoredRoot = __dirname;
const serverPath = resolve(vendoredRoot, 'syntaro_mcp/server.py');
const pythonRoot = existsSync(serverPath) ? vendoredRoot : projectRoot;

function main() {
  const args = process.argv.slice(2);
  const mode = args[0] || 'stdio';

  const child = spawn('python3', ['-m', 'syntaro_mcp.server', mode], {
    cwd: pythonRoot,
    stdio: ['inherit', 'inherit', 'inherit'],
    env: {
      ...process.env,
      PYTHONPATH: pythonRoot,
      SYNTARO_MCP_PORT: process.env.SYNTARO_MCP_PORT || '4095',
    },
  });

  child.on('exit', (code) => process.exit(code ?? 1));
  child.on('error', (err) => {
    console.error('Failed to start SYNTARO MCP server:', err.message);
    process.exit(1);
  });
}

main();
