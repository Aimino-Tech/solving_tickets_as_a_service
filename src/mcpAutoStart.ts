/**
 * MCP Server Auto-Start — spawns the Python FastMCP server as a child process
 * alongside the main STAS Express app.
 *
 * The MCP server can run in two modes:
 *   - SSE (default): Exposes MCP via HTTP SSE at STAS_MCP_PORT
 *   - stdio: For local tools like OpenCode and Claude Desktop (not auto-started)
 *
 * Environment variables:
 *   STAS_MCP_AUTO_START  — Set to "false" to disable auto-start (default: true)
 *   STAS_MCP_PORT        — Port for the SSE server (default: 4095)
 *   STAS_MCP_SERVER_URL  — Public URL for the MCP server (default: http://localhost:4095)
 *   MCP_API_KEY          — API key for MCP auth
 */

import { spawn, type ChildProcess, execFileSync } from 'node:child_process';
import path from 'node:path';
import { rootLogger } from './utils/logger.js';

const log = rootLogger.child({ module: 'mcp-autostart' });

let mcpProcess: ChildProcess | null = null;

function isPythonAvailable(): boolean {
  try {
    execFileSync('python3', ['--version'], { stdio: 'ignore', timeout: 3000 });
    execFileSync('python3', ['-c', 'import mcp.server.fastmcp'], {
      stdio: 'ignore',
      timeout: 5000,
      env: { ...process.env, PYTHONWARNINGS: 'ignore' },
    });
    return true;
  } catch {
    return false;
  }
}

export function startMcpServer(): ChildProcess | null {
  const autoStart = process.env.STAS_MCP_AUTO_START !== 'false';

  if (!autoStart) {
    log.info('MCP server auto-start disabled via STAS_MCP_AUTO_START=false');
    return null;
  }

  if (!isPythonAvailable()) {
    log.warn(
      'Python 3 or mcp package not available — MCP server will not start. '
      + 'Install python3 and run: pip install "mcp>=1.0.0"',
    );
    return null;
  }

  const port = process.env.STAS_MCP_PORT || '4095';
  const host = '0.0.0.0';
  const projectRoot = path.resolve(import.meta.dirname ?? process.cwd(), '..');

  log.info({ port, host, projectRoot }, 'Auto-starting MCP server...');

  try {
    mcpProcess = spawn('python3', ['-m', 'stas_mcp.server', 'sse', '--host', host, '--port', port], {
      cwd: projectRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PYTHONPATH: `${projectRoot}:${process.env.PYTHONPATH || ''}`,
        STAS_MCP_PORT: port,
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
      log.warn({ err: String(err) }, 'MCP server process error');
    });

    mcpProcess.on('exit', (code: number | null, signal: string | null) => {
      log.warn({ code, signal }, 'MCP server process exited');
      mcpProcess = null;
    });

    setTimeout(() => {
      if (mcpProcess && mcpProcess.exitCode === null) {
        log.info({ port, pid: mcpProcess.pid }, `MCP server started on :${port} (SSE mode)`);
      } else {
        log.warn({ port }, 'MCP server failed to start — continuing without it');
      }
    }, 2000);

    return mcpProcess;
  } catch (err) {
    log.warn({ err: String(err) }, 'Failed to spawn MCP server process');
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
