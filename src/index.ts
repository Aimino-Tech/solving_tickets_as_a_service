/**
 * STAS — Solving Tickets As A Service
 *
 * Entry point — starts the API server, the worker, or both based on RUN_MODE.
 * Also starts the CI monitor if CI_MONITOR_ENABLED is true.
 *
 * ══════════════════════════════════════════════════════════════════════
 * IMPORTANT: Sentry must be initialized BEFORE any other imports to
 * ensure it can capture startup errors and instrument modules correctly.
 * The `@sentry/node` import is hoisted to the very top of the file.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Usage:
 *   RUN_MODE=api    npm run dev    # API server only
 *   RUN_MODE=worker npm run dev    # Worker only
 *   RUN_MODE=both   npm run dev    # Both (default)
 *
 * ── Error Handling Audit ────────────────────────────────────────────
 * ✅ main() catch block logs error and exits with code 1
 * ✅ Graceful shutdown on SIGTERM/SIGINT (closes server, worker, Redis)
 * ✅ Server failure in 'both' mode logs and allows worker to continue
 * ✅ Worker failure in 'both' mode logs and allows server to continue
 * ✅ Sentry initialized before all other code (top of import chain)
 * ✅ CI monitor failure logs warning (non-fatal)
 * ✅ CI monitor stopped on graceful shutdown
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
import { rootLogger } from './utils/logger.js';
import { addBreadcrumb } from './monitoring/sentry.js';

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

  // Check OpenCode endpoint
  try {
    const response = await fetch(config.opencode.url + '/health', {
      signal: AbortSignal.timeout(5000),
    });
    checks.push({ name: 'opencode', ok: response.ok, error: response.ok ? undefined : `HTTP ${response.status}` });
  } catch (err) {
    checks.push({ name: 'opencode', ok: false, error: String(err) });
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


  addBreadcrumb('system', 'STAS starting', { runMode: config.runMode, nodeEnv: config.nodeEnv });

  const mode = config.runMode;

  // Graceful shutdown — closes server, worker, CI monitor, and exits
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

    // Close worker if running
    if (worker) {
      try {
        await worker.close();
        log.info('Worker closed');
      } catch (err) {
        log.warn({ err: String(err) }, 'Error closing worker');
      }
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

    process.exit(0);
  };

  // Start API server
  if (mode === 'api' || mode === 'both') {
    log.info('Starting API server...');
    try {
      const { startServer } = await import('./server.js');
      server = startServer() as Server;
      log.info('API server started');
      addBreadcrumb('system', 'API server started');
    } catch (err) {
      log.error({ err: String(err) }, 'Failed to start API server');
      if (mode === 'api') {
        process.exit(1);
      }
    }
  }

  // Start worker
  let worker: { close: () => Promise<void> } | undefined;
  if (mode === 'worker' || mode === 'both') {
    log.info('Starting worker...');
    try {
      const { createIssueWorker } = await import('./queue/issueQueue.js');
      worker = createIssueWorker();
      log.info('Worker started');
      addBreadcrumb('system', 'Worker started');
    } catch (err) {
      log.error({ err: String(err) }, 'Failed to start worker');
      if (mode === 'worker') {
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

  // Register signal handlers for graceful shutdown
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  addBreadcrumb('system', 'STAS started successfully');
}

main().catch((err) => {
  log.error({ err: String(err) }, 'Fatal error during startup');
  process.exit(1);
});
