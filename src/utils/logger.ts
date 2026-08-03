/**
 * Pino logger setup with job-context child logger support.
 * Optionally writes JSON logs to a file for monitoring/scanner tools.
 */

import pino from 'pino';

export type Logger = pino.Logger;

const level = process.env.LOG_LEVEL || 'info';
const logFilePath = process.env.SYNTARO_LOG_FILE || '';
const nodeEnv = process.env.NODE_ENV;

const targets: { target: string; options?: Record<string, unknown>; level?: string }[] = [];

if (nodeEnv !== 'production') {
  targets.push({ target: 'pino-pretty', options: { colorize: true }, level });
}

if (logFilePath) {
  targets.push({ target: 'pino/file', options: { destination: logFilePath, mkdir: true }, level });
}

const pinoOpts: Record<string, unknown> = {
  level,
  redact: {
    paths: ['req.headers.authorization', 'req.headers["x-hub-signature-256"]'],
    censor: '[REDACTED]',
  },
  serializers: {
    req: (req: Record<string, unknown>) => ({
      method: req.method,
      url: req.url,
      requestId: req.requestId,
    }),
    res: (res: Record<string, unknown>) => ({
      statusCode: res.statusCode,
    }),
    err: pino.stdSerializers.err,
  },
};
if (targets.length > 0) {
  (pinoOpts as Record<string, unknown>).transport = { targets };
}

export const rootLogger = pino(pinoOpts);

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
