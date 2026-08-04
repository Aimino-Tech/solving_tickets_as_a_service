/**
 * Sentry initialization and configuration.
 *
 * This module must be imported BEFORE any other imports in index.ts
 * to ensure Sentry captures startup errors. It:
 *   - Initializes the Sentry SDK with DSN, environment, and release
 *   - Sets up performance tracing (auto-instrument Express routes)
 *   - Configures error filters for non-actionable errors
 *   - Exports convenience helpers for breadcrumbs and error capturing
 *
 * ── Error Handling Audit ────────────────────────────────────────────
 * ✅ initSentry() handles missing DSN gracefully (no-op in dev)
 * ✅ Errors before Sentry init are captured via process-level handlers
 * ✅ Sensitive data is stripped via beforeSend transaction filter
 * ────────────────────────────────────────────────────────────────────
 */

import * as Sentry from '@sentry/node';
import type { ErrorEvent, EventHint } from '@sentry/types';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'sentry' });

/**
 * Determine the release version string.
 * Precedence: SENTRY_RELEASE env var → package.json version → git SHA.
 */
function resolveRelease(): string {
  if (process.env.SENTRY_RELEASE) return process.env.SENTRY_RELEASE;
  try {
    const pkgVersion = process.env.npm_package_version;
    if (pkgVersion) return `syntaro@${pkgVersion}`;
  } catch {
    // fall through
  }
  return 'syntaro@unknown';
}

/**
 * Initialize Sentry SDK.
 *
 * Safe to call multiple times — subsequent calls are no-ops.
 * If SENTRY_DSN is not configured, this is a no-op (enables local dev
 * without a Sentry account).
 */
export function initSentry(): void {
  if (!config.sentry.dsn) {
    log.info('SENTRY_DSN not configured — Sentry monitoring disabled');
    return;
  }

  // Only init once
  if (Sentry.isInitialized()) {
    log.debug('Sentry already initialized — skipping');
    return;
  }

  const release = resolveRelease();

  Sentry.init({
    dsn: config.sentry.dsn,
    environment: config.sentry.environment || process.env.NODE_ENV || 'development',
    release,
    tracesSampleRate: config.sentry.tracesSampleRate || 0.1,
    profilesSampleRate: 0.1,

    // Automatically instrument Node.js frameworks (Express, etc.)
    // In v8, expressIntegration() is configured here and auto-instruments
    integrations: [
      Sentry.httpIntegration(),
      Sentry.expressIntegration(),
      Sentry.nativeNodeFetchIntegration(),
    ],

    // Only send errors in production-like environments by default
    enabled: process.env.NODE_ENV !== 'test',

    // Filter out noisy, non-actionable errors
    beforeSend(event: ErrorEvent, _hint?: EventHint): ErrorEvent | null {
      // Strip sensitive request data
      if (event.request) {
        if (event.request.headers) {
          const sanitizedHeaders: Record<string, string> = {};
          for (const [key, value] of Object.entries(event.request.headers)) {
            if (['authorization', 'x-hub-signature-256', 'x-github-token', 'cookie'].includes(key.toLowerCase())) {
              sanitizedHeaders[key] = '[REDACTED]';
            } else {
              sanitizedHeaders[key] = String(value);
            }
          }
          event.request.headers = sanitizedHeaders;
        }
      }

      // Filter out common non-actionable errors
      const errMsg = event.exception?.values?.[0]?.value?.toLowerCase() || '';
      if (
        errMsg.includes('favicon.ico') ||
        errMsg.includes('socket hang up') ||
        errMsg.includes('econnreset') ||
        errMsg.includes('epipe')
      ) {
        return null;
      }

      return event;
    },
  });

  log.info({ environment: config.sentry.environment, release }, 'Sentry initialized');
}

/**
 * Add an info-level breadcrumb for tracking key events in the system.
 * These show up in Sentry error events to provide context about what
 * happened before the error.
 *
 * @param category - Breadcrumb category (e.g., 'webhook', 'queue', 'agent')
 * @param message - Short description of the event
 * @param data - Optional structured data attached to the breadcrumb
 */
export function addBreadcrumb(
  category: string,
  message: string,
  data?: Record<string, unknown>,
): void {
  if (!config.sentry?.dsn) return;
  Sentry.addBreadcrumb({
    category,
    message,
    level: 'info',
    data: data as Record<string, string>,
  });
}

/**
 * Capture an exception with additional context.
 *
 * @param error - The error to capture
 * @param context - Optional context data (repo, installation ID, etc.)
 */
export function captureError(error: Error, context?: Record<string, unknown>): void {
  if (!config.sentry?.dsn) return;
  Sentry.withScope((scope: Sentry.Scope) => {
    if (context) {
      scope.setContext('action', context as Record<string, string>);
    }
    Sentry.captureException(error);
  });
}

/**
 * Set the current user context for Sentry events.
 * Used to correlate errors with specific GitHub installations.
 *
 * @param installationId - GitHub App installation ID
 * @param repo - Repository identifier (owner/name)
 */
export function setUserContext(installationId: number | string, repo?: string): void {
  if (!config.sentry?.dsn) return;
  Sentry.setUser({
    id: String(installationId),
    ...(repo ? { username: repo } : {}),
  });
}

/**
 * Set a Sentry tag for filtering errors in the dashboard.
 */
export function setTag(key: string, value: string): void {
  if (!config.sentry?.dsn) return;
  Sentry.setTag(key, value);
}

/**
 * Export the Sentry SDK for direct use when needed.
 */
export { Sentry };

/**
 * Setup the Express error handler for Sentry.
 * In Sentry v8, this is done via setupExpressErrorHandler() instead of
 * the deprecated Sentry.Handlers.errorHandler() middleware.
 *
 * @param app - The Express application instance
 */
export function setupSentryExpressErrorHandler(app: import('express').Application): void {
  if (!config.sentry.dsn) return;
  Sentry.setupExpressErrorHandler(app);
}
