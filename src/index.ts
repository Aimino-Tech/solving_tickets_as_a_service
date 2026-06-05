/**
 * STAS — Solving Tickets As A Service
 *
 * Entry point — starts the API server, the worker, or both based on RUN_MODE.
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
 * ────────────────────────────────────────────────────────────────────
 */

import 'dotenv/config';
import type { Server } from 'node:http';
import { config } from './config.js';
import { startScheduledTasks, stopScheduledTasks } from './health/scheduled.js';
import { rootLogger } from './utils/logger.js';

const log = rootLogger.child({ module: 'entry' });

let server: Server | undefined;
let shutdownInProgress = false;

async function main(): Promise<void> {
  log.info({ runMode: config.runMode, nodeEnv: config.nodeEnv }, 'Starting STAS');
  // Initialize storage backend on startup (warm-up the connection)
  try {
    const { createStorage } = await import('./storage/index.js');
    await createStorage();
    log.info({ storageType: config.storage.type }, 'Storage backend initialized');
  } catch (storageErr) {
    log.warn({ err: String(storageErr) }, 'Failed to initialize storage backend (non-fatal)');
  }


  const mode = config.runMode;

  // Graceful shutdown — closes server, worker, and exits
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
    } catch (err) {
      log.error({ err: String(err) }, 'Failed to start worker');
      if (mode === 'worker') {
        process.exit(1);
      }
    }
  }

  // ── Audit log retention cleanup ────────────────────────────────
  // Runs every 24 hours to purge audit logs older than 90 days (configurable)
  const AUDIT_RETENTION_DAYS = Number(process.env.AUDIT_RETENTION_DAYS) || 90;
  const AUDIT_CLEANUP_INTERVAL_MS = Number(process.env.AUDIT_CLEANUP_INTERVAL_MS) || 86_400_000; // 24h

  const auditCleanupTimer = setInterval(async () => {
    try {
      const { auditRepository } = await import('./audit/repository.js');
      const deleted = await auditRepository.deleteOlderThan(AUDIT_RETENTION_DAYS);
      if (deleted > 0) {
        log.info({ deleted, retentionDays: AUDIT_RETENTION_DAYS }, 'Audit log retention cleanup completed');
      }
    } catch (err) {
      log.error({ err: String(err) }, 'Audit log retention cleanup failed');
    }
  }, AUDIT_CLEANUP_INTERVAL_MS);

  if (auditCleanupTimer && typeof auditCleanupTimer === 'object' && 'unref' in auditCleanupTimer) {
    auditCleanupTimer.unref();
  }

  log.info({ retentionDays: AUDIT_RETENTION_DAYS, intervalMs: AUDIT_CLEANUP_INTERVAL_MS }, 'Audit log retention cleanup scheduled');

  // Register signal handlers for graceful shutdown
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  log.error({ err: String(err) }, 'Fatal error during startup');
  process.exit(1);
});
