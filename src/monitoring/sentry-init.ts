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
 *
 * Usage (must be FIRST import in index.ts):
 *   import './monitoring/sentry-init.js';
 */

import { initSentry, setTag } from './sentry.js';

// Initialize Sentry immediately — this is the first module loaded
initSentry();

// Set environment-level tags
setTag('service', 'stas');
setTag('runtime', 'node');
