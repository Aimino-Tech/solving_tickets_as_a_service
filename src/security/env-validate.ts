/**
 * Environment validation at startup (dotenv-safe style).
 *
 * Checks that all required env vars are present and non-empty, then exits
 * with a clear message if any are missing.  Called once during module load
 * via the `validateRequiredEnvOnStartup()` export.
 *
 * Use this instead of ad-hoc `if (!process.env.X)` checks scattered
 * across the codebase.
 */

import { rootLogger } from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Required env vars
// ---------------------------------------------------------------------------

/**
 * These env vars are **critical** for STAS to function.  If any are missing
 * the process will exit with a clear diagnostic message.
 *
 * The list is intentionally conservative — only truly critical vars.
 * Optional vars (e.g. `SENTRY_DSN`) are validated by the Zod schema in
 * `config.ts` instead.
 */
const CRITICAL_VARS: string[] = [
  'GITHUB_APP_ID',
  'GITHUB_WEBHOOK_SECRET',
];

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate that all critical environment variables are set.
 *
 * Logs each missing var and exits the process if any are absent.
 * Designed to be called once at startup, e.g. from `src/index.ts` or
 * `src/config.ts`.
 */
export function validateRequiredEnvOnStartup(): void {
  const missing: string[] = [];

  for (const key of CRITICAL_VARS) {
    const value = process.env[key];
    if (!value || value.trim() === '') {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    rootLogger.error('Missing required environment variables — cannot start');
    for (const key of missing) {
      rootLogger.error({ key }, `  ${key} is not set or is empty`);
    }
    rootLogger.error(
      'Set these variables in your .env file or environment before starting STAS.',
    );
    process.exit(1);
  }
}

/**
 * Return the list of critical vars (useful for tests / introspection).
 */
export function getCriticalVars(): ReadonlyArray<string> {
  return [...CRITICAL_VARS];
}
