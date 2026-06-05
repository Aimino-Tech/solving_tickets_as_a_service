/**
 * Pino logger setup with job-context child logger support.
 */

import pino from "pino";

const level = process.env.LOG_LEVEL || "info";

export const rootLogger = pino({
  level,
  transport: process.env.NODE_ENV !== "production" ? { target: "pino-pretty", options: { colorize: true } } : undefined,
  redact: {
    paths: ["req.headers.authorization", 'req.headers["x-hub-signature-256"]'],
    censor: "[REDACTED]",
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
