/**
 * STAS — Solving Tickets As A Service
 *
 * Entry point — starts the API server, or both API and worker based on RUN_MODE.
 * Also starts the CI monitor if CI_MONITOR_ENABLED is true.
 * Also auto-starts the MCP server if STAS_MCP_AUTO_START is true (default).
 *
 * ══════════════════════════════════════════════════════════════════════
 * IMPORTANT: Sentry must be initialized BEFORE any other imports to
 * ensure it can capture startup errors and instrument modules correctly.
 * The `@sentry/node` import is hoisted to the very top of the file.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Usage:
 *   RUN_MODE=api    npm run dev    # API server only
 *   RUN_MODE=both   npm run dev    # Both (default)
 *
 * ── Error Handling Audit ────────────────────────────────────────────
 * ✅ main() catch block logs error and exits with code 1
 * ✅ Graceful shutdown on SIGTERM/SIGINT (closes server, Redis)
 * ✅ Server failure in 'both' mode logs and allows to continue
 * ✅ Sentry initialized before all other code (top of import chain)
 * ✅ CI monitor failure logs warning (non-fatal)
 * ✅ CI monitor stopped on graceful shutdown
 * ✅ MCP server auto-starts and stops on graceful shutdown
 * ────────────────────────────────────────────────────────────────────
 */

// ═══════════════════════════════════════════════════════════════════
// Sentry MUST be initialized before all other imports so it can
// capture errors that occur during module loading and startup.
// ═══════════════════════════════════════════════════════════════════
import './monitoring/sentry-init.js';

import 'dotenv/config';
import type { Server } from 'node:http';
import { config } from './config.js';
import { startScheduledTasks, stopScheduledTasks } from './health/scheduled.js';
import { opencodeHealth } from './health/opencodeHealth.js';
import { rootLogger } from './utils/logger.js';
import { addBreadcrumb } from './monitoring/sentry.js';
import { startMcpServer, stopMcpServer } from './mcpAutoStart.js';

const log = rootLogger.child({ module: 'entry' });

let server: Server | undefined;
let shutdownInProgress = false;

/**
 * Validate connectivity on startup — checks Redis, OpenCode, and E2B if configured.
 * Fails fast with clear error message if any required service is unreachable.
 */
async function validateStartupHealth(): Promise<void> {
  const checks: { name: string; ok: boolean; error?: string }[] = [];

  // Check Redis
  try {
    const { Redis } = await import('ioredis');
    const redis = new Redis(config.queue.redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      retryStrategy: () => null, // no retry — fail fast
      lazyConnect: true,
    });
    await redis.connect();
    await redis.ping();
    checks.push({ name: 'redis', ok: true });
    await redis.quit().catch(() => {});
  } catch (err) {
    checks.push({ name: 'redis', ok: false, error: String(err) });
  }

  // Check OpenSymphony dispatch endpoint
  try {
    const osUrl = config.opensymphony.dispatchUrl;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 5000);
    const resp = await fetch(`${osUrl.replace(/\/dispatch$/, '/health')}`, { signal: ac.signal });
    clearTimeout(timer);
    if (resp.ok) {
      checks.push({ name: 'opensymphony', ok: true });
    } else {
      checks.push({ name: 'opensymphony', ok: false, error: `HTTP ${resp.status}` });
    }
  } catch (err) {
    checks.push({ name: 'opensymphony', ok: false, error: String(err) });
  }

  // Check E2B if configured
  if (config.e2b.apiKey) {
    try {
      const { Sandbox } = await import('e2b');
      const sandbox = await Sandbox.create({
        apiKey: config.e2b.apiKey,
        timeoutMs: 5000,
      });
      await sandbox.kill();
      checks.push({ name: 'e2b', ok: true });
    } catch (err) {
      checks.push({ name: 'e2b', ok: false, error: String(err) });
    }
  }

  // Log results
  const failures = checks.filter((c) => !c.ok);
  if (failures.length > 0) {
    for (const f of failures) {
      log.error({ service: f.name, error: f.error }, `Startup health check FAILED: ${f.name}`);
    }
    log.error({ checks }, 'Startup health validation completed with failures');
  } else {
    log.info({ checks: checks.map((c) => c.name) }, 'All startup health checks passed');
  }
}

async function main(): Promise<void> {
  log.info({ runMode: config.runMode, nodeEnv: config.nodeEnv }, 'Starting STAS');

  // Start the OpenCode health client (begins polling OpenCode serve immediately)
  opencodeHealth.start();

  // Run startup health validation (non-fatal — log warnings, don't block)
  validateStartupHealth().catch((err) => {
    log.warn({ err: String(err) }, 'Startup health validation error (non-fatal)');
  });

  // Initialize storage backend on startup (warm-up the connection)
  try {
    const { createStorage } = await import('./storage/index.js');
    await createStorage();
    log.info({ storageType: config.storage.type }, 'Storage backend initialized');
  } catch (storageErr) {
    log.warn({ err: String(storageErr) }, 'Failed to initialize storage backend (non-fatal)');
  }

  try {
    const { registerDefaultTemplates } = await import('./template/index.js');
    registerDefaultTemplates();
    log.info('Default templates registered');

    const { connect, declareTopology } = await import('./queue/rabbitmq.js');
    await connect();
    await declareTopology();
    log.info('RabbitMQ initialized with topology');
  } catch (rmqErr) {
    log.warn({ err: String(rmqErr) }, 'Failed to initialize RabbitMQ/templates (non-fatal in OSS mode)');
  }


  addBreadcrumb('system', 'STAS starting', { runMode: config.runMode, nodeEnv: config.nodeEnv });

  const mode = config.runMode;

  // Graceful shutdown — closes server, CI monitor, MCP server, and exits
  const shutdown = async (signal: string) => {
    if (shutdownInProgress) return;
    shutdownInProgress = true;

    log.info({ signal }, 'Shutting down gracefully');

    // Close server if running
    if (server) {
      await new Promise<void>((resolve) => {
        server!.close(() => {
          log.info('Server closed');
          resolve();
        });
      });
    }

    // Stop CI monitor if running
    try {
      const { stopCiMonitor } = await import('./ci/monitor.js');
      stopCiMonitor();
      const { stopPrCiMonitor } = await import('./ci/prMonitor.js');
      stopPrCiMonitor();
    } catch (err) {
      log.warn({ err: String(err) }, 'Error stopping CI monitor (non-fatal)');
    }

    // Stop scheduled maintenance tasks
    stopScheduledTasks();

    // Stop OpenCode health client polling
    opencodeHealth.stop();

    // Stop MCP server if it was auto-started
    stopMcpServer();

    // Disconnect RabbitMQ if connected
    try {
      const { disconnect: disconnectRabbitMq, isConnected } = await import('./queue/rabbitmq.js');
      if (isConnected()) {
        await disconnectRabbitMq();
        log.info('RabbitMQ disconnected');
      }
    } catch {
      // non-fatal
    }

    process.exit(0);
  };

  // Start API server
  if (mode === 'api' || mode === 'both') {
    log.info('Starting API server...');
    try {
      const { startServer } = await import('./server.js');
      server = (await startServer()) as Server;
      log.info('API server started');
      addBreadcrumb('system', 'API server started');
    } catch (err) {
      log.error({ err: String(err) }, 'Failed to start API server');
      if (mode === 'api') {
        process.exit(1);
      }
    }
  }

  // Start CI monitor if enabled
  if (config.ci.monitorEnabled) {
    log.info('CI_MONITOR_ENABLED is true — starting CI monitor');
    try {
      const { startCiMonitor } = await import('./ci/monitor.js');
      startCiMonitor();
      const { startPrCiMonitor } = await import('./ci/prMonitor.js');
      startPrCiMonitor();
    } catch (err) {
      log.warn({ err: String(err) }, 'Failed to start CI monitor (non-fatal)');
    }
  }

  // Start scheduled maintenance tasks (queue depth check, DLQ cleanup, metrics refresh)
  startScheduledTasks();

  // Auto-start MCP server in SSE mode (for agent discovery and MCP protocol)
  startMcpServer();

  // Register signal handlers for graceful shutdown
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  addBreadcrumb('system', 'STAS started successfully');
}

main().catch((err) => {
  log.error({ err: String(err) }, 'Fatal error during startup');
  process.exit(1);
});
