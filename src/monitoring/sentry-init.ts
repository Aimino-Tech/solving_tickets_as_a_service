/**
 * Sentry initialization — side-effect module.
 *
 * This module exists solely to be imported as the very first import in
 * index.ts. It ensures Sentry is initialized and configured before any
 * other application code runs, which allows Sentry to:
 *
 *   1. Capture errors during module loading/import time
 *   2. Instrument modules as they are loaded (auto-instrumentation)
 *   3. Set up uncaught exception / unhandled rejection handlers early
 *
 * Usage (must be FIRST import in index.ts):
 *   import './monitoring/sentry-init.js';
 *
 * ── Process-level Error Handlers ────────────────────────────────────
 * This module registers process.on('uncaughtException') and
 * process.on('unhandledRejection') handlers that forward errors to
 * Sentry before the default process exit behavior.
 * ────────────────────────────────────────────────────────────────────
 */

import { initSentry, setTag } from './sentry.js';
import { rootLogger } from '../utils/logger.js';

// Initialize Sentry immediately — this is the first module loaded
initSentry();

// Set environment-level tags
setTag('service', 'stas');
setTag('runtime', 'node');

// ── Uncaught Exception Handler ──────────────────────────────────────
// These are registered here (in addition to the ones in server.ts)
// to ensure Sentry captures process-level errors early.
process.on('uncaughtException', (err) => {
  rootLogger.error(
    { err: String(err), stack: (err as Error).stack },
    'Uncaught exception — shutting down',
  );
  // Give Sentry a moment to flush before exiting
  setTimeout(() => process.exit(1), 2000);
});

process.on('unhandledRejection', (reason) => {
  rootLogger.error(
    { err: String(reason), stack: (reason as Error)?.stack },
    'Unhandled promise rejection',
  );
});
