/**
 * Pino logger setup with job-context child logger support.
 *
 * ── Sentry Integration ─────────────────────────────────────────────
 * In production, error (50) and fatal (60) level log records are
 * forwarded to Sentry as captured exceptions. Warn (40) records are
 * added as Sentry breadcrumbs.
 *
 * This works via pino.multistream() — a custom write destination is
 * registered alongside the default stdout output.
 *
 * NOTE: Uses process.env directly to avoid circular dependency with
 * config.ts (which imports rootLogger for validation error output).
 * ───────────────────────────────────────────────────────────────────
 */

import pino from 'pino';

const level = process.env.LOG_LEVEL || 'info';
const sentryDsn = process.env.SENTRY_DSN;
const isProduction = process.env.NODE_ENV === 'production';

/**
 * Pino numeric level to level name mapping.
 */
const LEVEL_NAMES: Record<number, string> = {
  10: 'trace',
  20: 'debug',
  30: 'info',
  40: 'warn',
  50: 'error',
  60: 'fatal',
};

/**
 * Create a writable stream that parses pino JSON lines and forwards
 * warn+ records to the Sentry SDK (already initialized in src/index.ts).
 *
 * Uses require() for lazy evaluation to avoid ESM circular dependency issues
 * with @sentry/node (initialized in index.ts, not logger.ts).
 */
function createSentryStream(): { write: (data: string) => void } {
  return {
    write(data: string): void {
      try {
        const record = JSON.parse(data) as Record<string, unknown>;
        const levelNum = (record.level as number) ?? 30;
        const levelName = LEVEL_NAMES[levelNum] ?? 'info';
        const msg = (record.msg as string) ?? '';

        // Only process warn+ levels
        if (levelNum < 40) return;

        const err = record.err as
          | { message?: string; stack?: string; type?: string }
          | undefined;

        const moduleName = (record.module as string) ?? 'unknown';

        // Lazy-require Sentry — it is guaranteed to be initialized by
        // src/index.ts before any log records are produced at runtime.
        // We use a dynamic eval-style require to avoid build-time issues.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const Sentry = require('@sentry/node');

        if (levelNum >= 50) {
          // error (50) or fatal (60) — capture as exception
          const error = err
            ? Object.assign(new Error(err.message || msg), {
                stack: err.stack,
                name: err.type || 'Error',
              })
            : new Error(msg);

          Sentry.withScope((scope: Record<string, unknown>) => {
            // Attach non-standard fields as extra context
            const context: Record<string, unknown> = {};
            for (const [key, val] of Object.entries(record)) {
              if (!['msg', 'level', 'time', 'pid', 'hostname', 'err', 'module', 'name'].includes(key)) {
                context[key] = val;
              }
            }
            (scope as { setExtras: (data: Record<string, unknown>) => void }).setExtras(context);
            (scope as { setTag: (key: string, val: string) => void }).setTag('log_level', levelName);
            (scope as { setTag: (key: string, val: string) => void }).setTag('module', moduleName);
            (scope as { setLevel: (level: string) => void }).setLevel(levelNum === 60 ? 'fatal' : 'error');
            Sentry.captureException(error);
          });
        } else if (levelNum === 40) {
          // warn — add as breadcrumb
          Sentry.addBreadcrumb({
            category: 'log',
            message: msg,
            level: 'warning',
            data: record as Record<string, unknown>,
          });
        }
      } catch {
        // Silently ignore parse/forward errors — Sentry must not crash the app
      }
    },
  };
}

/**
 * The root logger instance.
 *
 * Uses pino.multistream() when Sentry DSN is configured to dual-write to
 * stdout and Sentry. Otherwise, falls back to a standard single-destination
 * logger for simplicity.
 */
export const rootLogger: pino.Logger = sentryDsn
  ? pino(
      {
        level,
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers["x-hub-signature-256"]',
          ],
          censor: '[REDACTED]',
        },
        serializers: {
          req: (req) => ({
            method: req.method,
            url: req.url,
            requestId: req.requestId,
          }),
          res: (res) => ({
            statusCode: res.statusCode,
          }),
          err: pino.stdSerializers.err,
        },
      },
      pino.multistream([
        { stream: pino.destination(1) }, // stdout
        { level: 'warn', stream: createSentryStream() },
      ]),
    )
  : pino({
      level,
      transport: !isProduction ? { target: 'pino-pretty', options: { colorize: true } } : undefined,
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers["x-hub-signature-256"]',
        ],
        censor: '[REDACTED]',
      },
      serializers: {
        req: (req) => ({
          method: req.method,
          url: req.url,
          requestId: req.requestId,
        }),
        res: (res) => ({
          statusCode: res.statusCode,
        }),
        err: pino.stdSerializers.err,
      },
    });

/**
 * Create a child logger with job-level context fields.
 */
export function jobLogger(fields: {
  jobId?: string;
  installationId?: number;
  repo?: string;
  issueNumber?: number;
}): pino.Logger {
  return rootLogger.child(fields);
}
