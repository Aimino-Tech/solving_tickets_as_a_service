/**
 * MCP Server Auto-Start — spawns the Python FastMCP server as a child process
 * alongside the main SYNTARO Express app.
 *
 * The MCP server can run in two modes:
 *   - SSE (default): Exposes MCP via HTTP SSE at SYNTARO_MCP_PORT
 *   - stdio: For local tools like OpenCode and Claude Desktop (not auto-started)
 *
 * Environment variables:
 *   SYNTARO_MCP_AUTO_START  — Set to "false" to disable auto-start (default: true)
 *   SYNTARO_MCP_PORT        — Port for the SSE server (default: 4095)
 *   SYNTARO_MCP_SERVER_URL  — Public URL for the MCP server (default: http://localhost:4095)
 *   MCP_API_KEY          — API key for MCP auth
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { rootLogger } from './utils/logger.js';

const log = rootLogger.child({ module: 'mcp-autostart' });

let mcpProcess: ChildProcess | null = null;

function checkPythonDeps(): boolean {
  try {
    execSync('python3 -c "import mcp"', { stdio: 'pipe', timeout: 5000 });
    return true;
  } catch {
    log.warn(
      'Python package "mcp" not found — MCP server auto-start skipped. Install with: pip install "mcp>=1.0.0"',
    );
    return false;
  }
}

/**
 * Start the MCP server as a child process in SSE mode.
 * Returns the child process reference, or null if auto-start is disabled.
 */
export function startMcpServer(): ChildProcess | null {
  const autoStart = process.env.SYNTARO_MCP_AUTO_START !== 'false';

  if (!autoStart) {
    log.info('MCP server auto-start disabled via SYNTARO_MCP_AUTO_START=false');
    return null;
  }

  if (!checkPythonDeps()) {
    return null;
  }

  const port = process.env.SYNTARO_MCP_PORT || '4095';
  const host = '0.0.0.0';
  const projectRoot = path.resolve(import.meta.dirname ?? process.cwd(), '..');

  log.info({ port, host, projectRoot }, 'Auto-starting MCP server...');

  try {
    mcpProcess = spawn('python3', ['-m', 'syntaro_mcp.server', 'sse', '--host', host, '--port', port], {
      cwd: projectRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PYTHONPATH: `${projectRoot}:${process.env.PYTHONPATH || ''}`,
        SYNTARO_MCP_PORT: port,
        MCP_API_KEY: process.env.MCP_API_KEY || '',
      },
    });

    mcpProcess.stdout?.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg) log.info({ mcp: 'stdout' }, msg);
    });

    mcpProcess.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg) {
        if (msg.includes('Error') || msg.includes('Traceback')) {
          log.warn({ mcp: 'stderr' }, msg);
        } else {
          log.info({ mcp: 'stderr' }, msg);
        }
      }
    });

    mcpProcess.on('error', (err: Error) => {
      log.error({ err: String(err) }, 'MCP server process error');
    });

    mcpProcess.on('exit', (code: number | null, signal: string | null) => {
      log.warn({ code, signal }, 'MCP server process exited');
      mcpProcess = null;
    });

    // Give it a moment to start, then log status
    setTimeout(() => {
      if (mcpProcess && mcpProcess.exitCode === null) {
        log.info({ port, pid: mcpProcess.pid }, `MCP server started on :${port} (SSE mode)`);
      } else {
        log.warn({ port }, 'MCP server failed to start — continuing without it');
        log.info('Run manually: python -m syntaro_mcp.server sse --port ' + port);
      }
    }, 2000);

    return mcpProcess;
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to spawn MCP server process');
    log.info('Run manually: python -m syntaro_mcp.server sse --port ' + port);
    return null;
  }
}

/**
 * Stop the MCP server child process gracefully.
 */
export function stopMcpServer(): void {
  if (mcpProcess && mcpProcess.exitCode === null) {
    log.info({ pid: mcpProcess.pid }, 'Stopping MCP server...');
    mcpProcess.kill('SIGTERM');
    // Force kill after 5 seconds if still alive
    setTimeout(() => {
      if (mcpProcess && mcpProcess.exitCode === null) {
        mcpProcess.kill('SIGKILL');
      }
    }, 5000);
    mcpProcess = null;
  }
}
