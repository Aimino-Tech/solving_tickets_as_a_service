/**
 * Pino logger setup with job-context child logger support
 * and automatic secret redaction via pino's built-in `redact` configuration.
 *
 * The redact config ensures that sensitive fields in structured logs are
 * automatically replaced with `[REDACTED]` before leaving the process.
 */

import pino from 'pino';

const level = process.env.LOG_LEVEL || 'info';

export const rootLogger = pino({
  level,
  transport: process.env.NODE_ENV !== 'production' ? { target: 'pino-pretty', options: { colorize: true } } : undefined,
  redact: {
    paths: [
      // HTTP headers that carry auth
      'req.headers.authorization',
      'req.headers["x-hub-signature-256"]',
      'req.headers["x-hub-signature"]',
      'req.headers.cookie',
      'req.headers["set-cookie"]',
      'req.headers["x-api-key"]',

      // Known secret keys in any object
      '*.apiKey',
      '*.api_key',
      '*.apikey',
      '*.API_KEY',
      '*.token',
      '*.TOKEN',
      '*.password',
      '*.PASSWORD',
      '*.secret',
      '*.SECRET',
      '*.privateKey',
      '*.private_key',
      '*.PRIVATE_KEY',
      '*.auth',
      '*.AUTH',
      '*.authorization',
      '*.authorization',
      '*.credential',
      '*.CREDENTIAL',
      '*.webhookSecret',
      '*.webhook_secret',
      '*.WEBHOOK_SECRET',
      '*.installationToken',
      '*.installation_token',
      '*.accessToken',
      '*.access_token',
      '*.refreshToken',
      '*.refresh_token',

      // Connection strings
      '*.redisUrl',
      '*.redis_url',
      '*.rabbitmqUrl',
      '*.rabbitmq_url',
      '*.databaseUrl',
      '*.database_url',
      '*.DATABASE_URL',

      // Top-level env values
      'err.config.*',
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
