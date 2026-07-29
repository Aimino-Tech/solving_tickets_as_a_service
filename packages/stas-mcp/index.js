#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function main() {
  const args = process.argv.slice(2);
  const mode = args[0] || 'stdio';

  const projectRoot = resolve(__dirname, '../..');
  const serverPath = resolve(projectRoot, 'stas_mcp/server.py');

  const child = spawn('python3', ['-m', 'stas_mcp.server', mode], {
    cwd: projectRoot,
    stdio: ['inherit', 'inherit', 'inherit'],
    env: {
      ...process.env,
      PYTHONPATH: projectRoot,
      STAS_MCP_PORT: process.env.STAS_MCP_PORT || '4095',
    },
  });

  child.on('exit', (code) => process.exit(code ?? 1));
  child.on('error', (err) => {
    console.error('Failed to start STAS MCP server:', err.message);
    process.exit(1);
  });
}

main();
