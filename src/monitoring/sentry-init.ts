/**
 * Sentry initialization — side-effect module.
 *
 * This module exists solely to be imported as the very first import in
 * index.ts. It ensures Sentry is initialized and configured before any
 * other application code runs, which allows Sentry to:
 *
 *   1. Capture errors during module loading/import time
 *   2. Instrument modules as they are loaded (auto-instrumentation)
 *
 * Process-level error handlers (uncaughtException, unhandledRejection)
 * are centralized in server.ts to avoid duplicate handlers and ensure
 * consistent logging with module context.
 * are centralized in server.ts to provide consistent module context
 * and Sentry integration. The Sentry SDK automatically captures these
 * events through its own instrumentation.
 *
 * A startup-time uncaughtException handler is kept here for early
 * error protection before server.ts is loaded.
 *
 * Usage (must be FIRST import in index.ts):
 *   import './monitoring/sentry-init.js';
 */

import { initSentry, setTag } from './sentry.js';
import { rootLogger } from '../utils/logger.js';

// Initialize Sentry immediately — this is the first module loaded
initSentry();

// Set environment-level tags
setTag('service', 'syntaro');
setTag('runtime', 'node');

// ── Startup Uncaught Exception Handler ─────────────────────────────
// Provides early error protection before server.ts registers its
// more comprehensive handler. This handler exits the process to
// prevent continued execution in an undefined state.
process.on('uncaughtException', (err) => {
  rootLogger.error(
    { err: String(err), stack: (err as Error).stack },
    'Uncaught exception at startup — shutting down',
  );
  // Give Sentry a moment to flush before exiting
  setTimeout(() => process.exit(1), 2000);
});

process.on('unhandledRejection', (reason) => {
  rootLogger.error(
    { err: String(reason), stack: (reason as Error)?.stack },
    'Unhandled promise rejection — shutting down',
  );
  // Give Sentry a moment to flush before exiting
  setTimeout(() => process.exit(1), 2000);
});
