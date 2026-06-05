/**
 * Express API server — webhook receiver and health endpoint.
 *
 * Features:
 * - Raw body middleware for webhook signature verification
 * - Request ID middleware for log correlation
 * - Structured access logging with pino
 * - GET /health endpoint
 * - POST /webhook — GitHub webhook receiver via @octokit/webhooks
 *
 * ── Error Handling Audit ────────────────────────────────────────────
 * ✅ Global Express error middleware (4-arg handler) at bottom of chain
 * ✅ Process-level uncaughtException and unhandledRejection handlers
 * ✅ app.listen() error event handled (EADDRINUSE, EACCES, etc.)
 * ✅ Server instance returned for graceful shutdown by caller
 * ✅ Request ID middleware for log correlation
 * ────────────────────────────────────────────────────────────────────
 */

import crypto from 'node:crypto';
import type { EmitterWebhookEventName } from '@octokit/webhooks';
import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { createIssueQueue, enqueueIssue } from './queue/issueQueue.js';
import { getSlackBoltApp } from './notifications/slack-bolt.js';
import { getTracker, initTrackers } from './trackers/index.js';
import { handleJiraWebhook, verifyJiraWebhookSignature } from './trackers/jira.js';
import { handleLinearWebhook, verifyLinearWebhookSignature } from './trackers/linear.js';
import { rootLogger } from './utils/logger.js';
import type { IssueJobData } from './utils/types.js';
import { validateWebhookPayload } from './validation.js';
import { createGithubWebhooks } from './webhooks/github.js';

const log = rootLogger.child({ module: 'server' });

/**
 * Create and configure the Express application.
 */
export function createApp(): express.Application {
  const app = express();

  // ── Request ID middleware ────────────────────────────────────────
  app.use((req: Request, res: Response, next: NextFunction) => {
    const requestId = (req.headers['x-request-id'] as string) || crypto.randomUUID();
    req.requestId = requestId;
    res.setHeader('x-request-id', requestId);
    next();
  });

  // ── Structured access log middleware ─────────────────────────────
  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    res.on('finish', () => {
      const latency = Date.now() - start;
      log.info(
        {
          method: req.method,
          path: req.path,
          statusCode: res.statusCode,
          latency,
          requestId: req.requestId,
          contentLength: req.headers['content-length'],
          userAgent: req.headers['user-agent'],
        },
        `${req.method} ${req.path} ${res.statusCode} ${latency}ms`,
      );
    });
    next();
  });

  // ── Raw body capture for webhook verification ────────────────────
  app.use(
    ['/webhook', '/webhook/linear', '/webhook/jira'],
    express.raw({ type: 'application/json', verify: addRawBody }),
  );

  // ── JSON parsing for all other routes ────────────────────────────
  app.use(express.json());

  // ── Rate limiter for webhook routes ───────────────────────────────
  const limiter = rateLimit({
    windowMs: config.stas.rateLimitWindowMs,
    limit: config.stas.rateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests', retryAfter: 'see Retry-After header' },
  });
  app.use('/webhook', limiter);

  // ── Slack Bolt receiver (interactive messages) ───────────────────
  const bolt = getSlackBoltApp();
  bolt.mountOn(app);

  // ── Health check ─────────────────────────────────────────────────
  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      label: config.stas.label,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  });

  // ── Initialize trackers ──────────────────────────────────────────
  initTrackers();

  // ── Webhook receiver ─────────────────────────────────────────────
  const queue = createIssueQueue();
  const webhooks = createGithubWebhooks(queue);

  app.post('/webhook', async (req: Request, res: Response) => {
    const event = req.headers['x-github-event'] as string;
    const deliveryId = req.headers['x-github-delivery'] as string;
    const signature = req.headers['x-hub-signature-256'] as string;

    log.info({ event, deliveryId, requestId: req.requestId }, 'Received webhook');

    // ── Parse and validate payload before processing ──────────────
    const rawBody = (req as { rawBody?: Buffer }).rawBody;
    let parsedPayload: unknown;
    try {
      parsedPayload = rawBody ? JSON.parse(rawBody.toString()) : req.body;
    } catch (err) {
      log.error({ err: String(err) }, 'Failed to parse webhook payload');
      res.status(400).json({ error: 'Invalid JSON payload' });
      return;
    }

    const validation = validateWebhookPayload(event, parsedPayload);
    if (!validation.success) {
      log.warn(
        {
          event,
          errors: validation.errors,
          requestId: req.requestId,
        },
        'Webhook payload validation failed',
      );
      res.status(400).json({ error: 'Invalid payload', details: validation.errors });
      return;
    }

    // ── Verify signature (skip in dev mode if configured) ─────────
    if (!config.stas.devSkipWebhookVerify && signature) {
      if (!rawBody) {
        log.error('Missing raw body for signature verification');
        res.status(400).json({ error: 'Missing raw body' });
        return;
      }

      try {
        await webhooks.verifyAndReceive({
          id: deliveryId,
          name: event as EmitterWebhookEventName,
          payload: rawBody.toString(),
          signature,
        });
      } catch (err) {
        log.warn({ err: String(err) }, 'Webhook verification failed');
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }
    } else {
      // Dev mode: process without verification
      const payload = rawBody ? rawBody.toString() : JSON.stringify(req.body);

      try {
        await webhooks.verifyAndReceive({
          id: deliveryId || crypto.randomUUID(),
          name: event as EmitterWebhookEventName,
          payload,
          signature: signature || '',
        });
      } catch (err) {
        log.error({ err: String(err) }, 'Webhook processing error');
        // Don't return 401 in dev mode — just log the error
      }
    }

    // Always return 202 Accepted for webhooks
    res.status(202).json({ accepted: true });
  });

  // ── Linear webhook ────────────────────────────────────────────────
  app.post('/webhook/linear', async (req: Request, res: Response) => {
    const signature = req.headers['linear-signature'] as string;
    const rawBody = (req as { rawBody?: Buffer }).rawBody;

    if (!rawBody) {
      res.status(400).json({ error: 'Missing raw body' });
      return;
    }

    if (!verifyLinearWebhookSignature(rawBody, signature)) {
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody.toString());
    } catch {
      res.status(400).json({ error: 'Invalid JSON payload' });
      return;
    }

    const result = await handleLinearWebhook(payload);
    if (!result) {
      res.status(400).json({ error: 'Invalid webhook payload' });
      return;
    }

    const tracker = getTracker('linear');
    if (tracker) {
      try {
        const ticket = await tracker.getTicket(result.ticketId);
        log.info({ ticketId: result.ticketId, title: ticket.title }, 'Fetched Linear ticket details');

        const repoOwner = config.trackers.defaultRepoOwner;
        const repoName = config.trackers.defaultRepoName;
        const installationId = config.trackers.installationId;

        if (repoOwner && repoName && installationId) {
          const jobData: IssueJobData = {
            installationId,
            repoOwner,
            repoName,
            repoPrivate: false,
            issueNumber: 0,
            issueTitle: ticket.title,
            issueBody: ticket.description,
            source: 'linear',
            trackerType: 'linear',
            trackerTicketId: ticket.id,
          };

          await enqueueIssue(queue, jobData);
        } else {
          log.warn(
            'TRACKER_DEFAULT_REPO_OWNER/NAME or TRACKER_INSTALLATION_ID not configured — Linear ticket not enqueued',
          );
        }
      } catch (err) {
        log.error({ err: String(err), ticketId: result.ticketId }, 'Failed to process Linear webhook');
      }
    }

    res.status(202).json({ accepted: true });
  });

  // ── Jira webhook ─────────────────────────────────────────────────
  app.post('/webhook/jira', async (req: Request, res: Response) => {
    const signature = req.headers['x-hub-signature-256'] as string;
    const rawBody = (req as { rawBody?: Buffer }).rawBody;

    if (!rawBody) {
      res.status(400).json({ error: 'Missing raw body' });
      return;
    }

    if (!verifyJiraWebhookSignature(rawBody, signature)) {
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody.toString());
    } catch {
      res.status(400).json({ error: 'Invalid JSON payload' });
      return;
    }

    const result = await handleJiraWebhook(payload);
    if (!result) {
      res.status(400).json({ error: 'Invalid webhook payload' });
      return;
    }

    const tracker = getTracker('jira');
    if (tracker) {
      try {
        const ticket = await tracker.getTicket(result.ticketId);
        log.info({ ticketId: result.ticketId, title: ticket.title }, 'Fetched Jira ticket details');

        const repoOwner = config.trackers.defaultRepoOwner;
        const repoName = config.trackers.defaultRepoName;
        const installationId = config.trackers.installationId;

        if (repoOwner && repoName && installationId) {
          const jobData: IssueJobData = {
            installationId,
            repoOwner,
            repoName,
            repoPrivate: false,
            issueNumber: 0,
            issueTitle: ticket.title,
            issueBody: ticket.description,
            source: 'jira',
            trackerType: 'jira',
            trackerTicketId: ticket.id,
          };

          await enqueueIssue(queue, jobData);
        } else {
          log.warn(
            'TRACKER_DEFAULT_REPO_OWNER/NAME or TRACKER_INSTALLATION_ID not configured — Jira ticket not enqueued',
          );
        }
      } catch (err) {
        log.error({ err: String(err), ticketId: result.ticketId }, 'Failed to process Jira webhook');
      }
    }

    res.status(202).json({ accepted: true });
  });

  // ── 404 handler ──────────────────────────────────────────────────
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'Not found' });
  });

  // ── Global error handler ─────────────────────────────────────────
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    log.error({ err: String(err) }, 'Unhandled error');
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

/**
 * Start the Express server on the configured port.
 * Returns the server instance so callers can close it during graceful shutdown.
 */
export function startServer(): import('http').Server {
  const app = createApp();

  const server = app.listen(config.port, '0.0.0.0', () => {
    log.info(
      { port: config.port, label: config.stas.label, env: config.nodeEnv },
      `STAS server listening on :${config.port}`,
    );
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      log.error({ port: config.port }, `Port ${config.port} is already in use`);
    } else if (err.code === 'EACCES') {
      log.error({ port: config.port }, `Permission denied for port ${config.port}`);
    } else {
      log.error({ err: String(err) }, 'Server failed to start');
    }
    process.exit(1);
  });

  return server;
}

// ── Process-level error handlers ────────────────────────────────────

process.on('uncaughtException', (err) => {
  log.error({ err: String(err), stack: (err as Error).stack }, 'Uncaught exception — shutting down');
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  log.error({ err: String(reason), stack: (reason as Error)?.stack }, 'Unhandled promise rejection — shutting down');
  process.exit(1);
});

// ── Helper: Capture raw body for webhook signature verification ────

/**
 * Express verify callback that stores the raw body buffer on the request
 * object so it can be used for webhook signature verification.
 */
function addRawBody(req: Request, _res: Response, buf: Buffer): void {
  (req as { rawBody?: Buffer }).rawBody = buf;
}

// Extend Express Request to include requestId
declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}
