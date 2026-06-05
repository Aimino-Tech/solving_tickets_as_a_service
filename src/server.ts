/**
 * Express API server -- webhook receiver and health endpoint.
 *
 * Features:
 * - Raw body middleware for webhook signature verification
 * - Request ID middleware for log correlation
 * - Structured access logging with pino
 * - GET /health endpoint
 * - POST /webhook -- GitHub webhook receiver via @octokit/webhooks
 * - POST /webhook/stripe -- Stripe webhook for credit purchase events
 *
 * --- Error Handling Audit ---------------------------------------------------
 * - Global Express error middleware (4-arg handler) at bottom of chain
 * - Process-level uncaughtException and unhandledRejection handlers
 * - app.listen() error event handled (EADDRINUSE, EACCES, etc.)
 * - Server instance returned for graceful shutdown by caller
 * - Request ID middleware for log correlation
 * ---------------------------------------------------------------------------
 */

/**
 * ── Sentry Alerting Rules ─────────────────────────────────────────────
 * Configure these in the Sentry dashboard (Settings > Alerts) after deployment:
 *
 * 1. Error Rate Spike Alert
 *    - Metric: errors() FILTER WHERE level >= error
 *    - Threshold: > 10 errors in 5 minutes
 *    - Action: Notify #stas-alerts (Slack/PagerDuty/Email)
 *    - Why: Catches unexpected spikes like webhook signature bursts or agent crashes
 *
 * 2. Webhook Processing Failure Alert
 *    - Metric: errors() FILTER WHERE transaction = "/webhook"
 *    - Threshold: > 5 failures in 15 minutes
 *    - Action: Notify #stas-alerts
 *    - Why: Downstream webhook verification or GitHub API issues
 *
 * 3. Queue Health Degradation Alert
 *    - Tag: queue.status = "degraded"
 *    - Threshold: Any occurrence
 *    - Action: Notify #stas-alerts
 *    - Why: Redis or RabbitMQ connection issues impact all job processing
 *
 * 4. Agent Pipeline Failure Alert
 *    - Tag: agent.phase = failing
 *    - Threshold: > 3 failures in 30 minutes
 *    - Action: Notify #stas-alerts
 *    - Why: OpenCode agent dispatch failures indicate upstream model issues
 *
 * 5. Unhandled Error Alert (process-level)
 *    - Filter: unhandled = true
 *    - Threshold: Any occurrence
 *    - Action: Immediate PagerDuty + #stas-alerts
 *    - Why: Process-level crashes (uncaughtException / unhandledRejection)
 *
 * 6. Health Check Degradation
 *    - Monitor: /health/ready returns 503
 *    - Threshold: > 3 consecutive failures
 *    - Action: Notify #stas-alerts
 *    - Why: Readiness probe failures mean the service is not accepting traffic
 *
 * 7. Performance Degradation (if tracing enabled)
 *    - Metric: transaction.duration for /webhook
 *    - Threshold: p95 > 5s in 15 minutes
 *    - Action: Notify #stas-alerts
 *    - Why: Slow webhook processing indicates downstream API or queue backpressure
 * ──────────────────────────────────────────────────────────────────────
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
import { createStripeWebhookHandler } from './stripe/index.js';
import { rootLogger } from './utils/logger.js';
import * as Sentry from '@sentry/node';
import type { IssueJobData } from './utils/types.js';
import { validateWebhookPayload } from './validation.js';
import { createBitbucketWebhooks } from './webhooks/bitbucket.js';
import { createGithubWebhooks } from './webhooks/github.js';
import { createGitlabWebhooks } from './webhooks/gitlab.js';

const log = rootLogger.child({ module: 'server' });

// ── Health status tracker ─────────────────────────────────────────────
// Tracks per-service status, last error timestamps, and queue depths for
// the enhanced /health endpoint.
const healthState = {
  startedAt: Date.now(),
  webhook: { status: 'healthy' as 'healthy' | 'degraded' | 'unknown', lastError: null as string | null, lastErrorAt: null as string | null },
  worker: { status: 'unknown' as 'healthy' | 'degraded' | 'unknown', lastError: null as string | null, lastErrorAt: null as string | null },
  queue: { status: 'unknown' as 'healthy' | 'degraded' | 'unknown', lastError: null as string | null, lastErrorAt: null as string | null },
  db: { status: 'unknown' as 'healthy' | 'degraded' | 'unknown', lastError: null as string | null, lastErrorAt: null as string | null },
  opencode: { status: 'unknown' as 'healthy' | 'degraded' | 'unknown', lastError: null as string | null, lastErrorAt: null as string | null },
};

/**
 * Create and configure the Express application.
 */
export function createApp(): express.Application {
  const app = express();

  // -- Request ID middleware ------------------------------------------------
  app.use((req: Request, res: Response, next: NextFunction) => {
    const requestId = (req.headers['x-request-id'] as string) || crypto.randomUUID();
    req.requestId = requestId;
    res.setHeader('x-request-id', requestId);
    next();
  });

  // -- Sentry user context (set from webhook headers if available) ----------
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const installationId = req.headers['x-github-hook-installation-target-id'] as string | undefined;
    const repo = req.headers['x-github-repo'] as string | undefined;
    if (installationId || repo) {
      Sentry.setUser({
        id: installationId || 'unknown',
        data: repo ? { repo } : undefined,
      });
    }
    next();
  });
  // -- Structured access log middleware -------------------------------------
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

  // -- Raw body capture for webhook verification ----------------------------
  app.use(
    [
      '/webhook',
      '/webhook/github',
      '/webhook/gitlab',
      '/webhook/bitbucket',
      '/webhook/linear',
      '/webhook/jira',
      '/webhook/stripe',
    ],
    express.raw({ type: 'application/json', verify: addRawBody }),
  );

  // -- JSON parsing for all other routes ------------------------------------
  app.use(express.json());

  // -- Rate limiter for webhook routes ---------------------------------------
  const limiter = rateLimit({
    windowMs: config.stas.rateLimitWindowMs,
    limit: config.stas.rateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests', retryAfter: 'see Retry-After header' },
  });
  app.use('/webhook', limiter);

  // -- Slack Bolt receiver (interactive messages) ---------------------------
  const bolt = getSlackBoltApp();
  bolt.mountOn(app);

  // -- Health check endpoints ------------------------------------------------
  /**
   * Enhanced /health — returns detailed service status including per-service
   * health, last error timestamps, queue depths, and uptime.
   */
  app.get('/health', async (_req: Request, res: Response) => {
    // Attempt to check queue health
    let queueDepth: number | undefined;
    let queueWaiting: number | undefined;
    try {
      const { default: IORedis } = await import('ioredis');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const redis = new (IORedis as any)(config.queue.redisUrl || 'redis://localhost:6379', {
        maxRetriesPerRequest: 1,
        retryStrategy: () => null,
        lazyConnect: true,
      });
      try {
        await redis.connect();
        // Use KEYS/LLEN as a lightweight health check — counts pending jobs
        queueWaiting = await redis.llen('bull:stas-issues:wait') || 0;
        queueDepth = await redis.llen('bull:stas-issues:active') || 0;
        healthState.queue.status = 'healthy';
      } catch {
        healthState.queue.status = 'degraded';
        healthState.queue.lastError = 'Redis unreachable';
        healthState.queue.lastErrorAt = new Date().toISOString();
      } finally {
        redis.disconnect();
      }
    } catch {
      healthState.queue.status = 'degraded';
    }

    res.json({
      status: 'ok',
      service: 'stas',
      version: process.env.npm_package_version || '0.1.0',
      label: config.stas.label,
      uptime: process.uptime(),
      startedAt: new Date(healthState.startedAt).toISOString(),
      timestamp: new Date().toISOString(),
      services: {
        webhook: healthState.webhook,
        worker: healthState.worker,
        queue: healthState.queue,
        db: healthState.db,
        opencode: healthState.opencode,
      },
      queue: {
        waiting: queueWaiting ?? null,
        active: queueDepth ?? null,
      },
    });
  });

  /**
   * /health/ready — readiness probe.
   * Returns 200 when all critical dependencies (queue) are connected, 503 otherwise.
   */
  app.get('/health/ready', async (_req: Request, res: Response) => {
    const ready = healthState.queue.status === 'healthy';
    res.status(ready ? 200 : 503).json({
      status: ready ? 'ready' : 'not ready',
      services: {
        queue: healthState.queue.status,
      },
    });
  });

  /**
   * /health/live — liveness probe.
   * Always returns 200 as long as the process is alive.
   */
  app.get('/health/live', (_req: Request, res: Response) => {
    res.json({
      status: 'alive',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  });

  // -- Initialize trackers --------------------------------------------------
  initTrackers();

  // -- Webhook receiver -----------------------------------------------------
  const queue = createIssueQueue();
  const githubWebhooks = createGithubWebhooks(queue);
  const gitlabHandler = createGitlabWebhooks(queue);
  const bitbucketHandler = createBitbucketWebhooks(queue);

  // -- GitHub webhook handler (shared between /webhook and /webhook/github) --
  async function handleGithubWebhook(req: Request, res: Response): Promise<void> {
    const event = req.headers['x-github-event'] as string;
    const deliveryId = req.headers['x-github-delivery'] as string;
    const signature = req.headers['x-hub-signature-256'] as string;

    log.info({ event, deliveryId, requestId: req.requestId }, 'Received GitHub webhook');
    Sentry.addBreadcrumb({
      category: 'webhook',
      message: `GitHub webhook received: ${event}`,
      level: 'info',
      data: { event, deliveryId, requestId: req.requestId },
    });
    Sentry.setTag('webhook.event', event);
    Sentry.setTag('webhook.delivery_id', deliveryId);

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

    if (!config.stas.devSkipWebhookVerify && signature) {
      if (!rawBody) {
        log.error('Missing raw body for signature verification');
        res.status(400).json({ error: 'Missing raw body' });
        return;
      }

      try {
        await githubWebhooks.verifyAndReceive({
          id: deliveryId,
          name: event as any,
          payload: rawBody.toString(),
          signature,
        });
      } catch (err) {
        log.warn({ err: String(err) }, 'GitHub webhook verification failed');
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }
    } else {
      const payload = rawBody ? rawBody.toString() : JSON.stringify(req.body);

      try {
        await githubWebhooks.verifyAndReceive({
          id: deliveryId || crypto.randomUUID(),
          name: event as any,
          payload,
          signature: signature || '',
        });
      } catch (err) {
        log.error({ err: String(err) }, 'Webhook processing error');
      }
    }

    res.status(202).json({ accepted: true });
  }

  // Legacy /webhook (backward compat) + explicit /webhook/github
  app.post('/webhook', handleGithubWebhook);
  app.post('/webhook/github', handleGithubWebhook);

  // -- GitLab webhook -------------------------------------------------------
  app.post('/webhook/gitlab', async (req: Request, res: Response) => {
    const event = req.headers['x-gitlab-event'] as string;
    const token = req.headers['x-gitlab-token'] as string;
    const rawBody = (req as { rawBody?: Buffer }).rawBody;

    log.info({ event, requestId: req.requestId }, 'Received GitLab webhook');
    Sentry.addBreadcrumb({
      category: 'webhook',
      message: `GitLab webhook received: ${event}`,
      level: 'info',
      data: { event, platform: 'gitlab', requestId: req.requestId },
    });

    if (!rawBody) {
      log.error('Missing raw body for GitLab webhook');
      res.status(400).json({ error: 'Missing raw body' });
      return;
    }

    if (config.gitlab.webhookSecret) {
      const { gitlabWebhook: gw } = await import('./webhooks/gitlab.js');
      if (!gw.verify(rawBody.toString(), token, config.gitlab.webhookSecret)) {
        log.warn('GitLab webhook token verification failed');
        res.status(401).json({ error: 'Invalid token' });
        return;
      }
    }

    let parsedPayload: unknown;
    try {
      parsedPayload = JSON.parse(rawBody.toString());
    } catch (err) {
      log.error({ err: String(err) }, 'Failed to parse GitLab webhook payload');
      res.status(400).json({ error: 'Invalid JSON payload' });
      return;
    }

    try {
      await gitlabHandler.handle(event, parsedPayload);
    } catch (err) {
      log.error({ err: String(err) }, 'GitLab webhook processing error');
    }

    res.status(202).json({ accepted: true });
  });

  // -- Bitbucket webhook ----------------------------------------------------
  app.post('/webhook/bitbucket', async (req: Request, res: Response) => {
    const signature = req.headers['x-hub-signature'] as string;
    const rawBody = (req as { rawBody?: Buffer }).rawBody;

    log.info({ requestId: req.requestId }, 'Received Bitbucket webhook');
    Sentry.addBreadcrumb({
      category: 'webhook',
      message: 'Bitbucket webhook received',
      level: 'info',
      data: { platform: 'bitbucket', requestId: req.requestId },
    });

    if (!rawBody) {
      log.error('Missing raw body for Bitbucket webhook');
      res.status(400).json({ error: 'Missing raw body' });
      return;
    }

    try {
      await bitbucketHandler.handle(rawBody.toString(), signature);
    } catch (err) {
      log.error({ err: String(err) }, 'Bitbucket webhook processing error');
    }

    res.status(202).json({ accepted: true });
  });

  // -- Linear webhook --------------------------------------------------------
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
            'TRACKER_DEFAULT_REPO_OWNER/NAME or TRACKER_INSTALLATION_ID not configured -- Linear ticket not enqueued',
          );
        }
      } catch (err) {
        log.error({ err: String(err), ticketId: result.ticketId }, 'Failed to process Linear webhook');
      }
    }

    res.status(202).json({ accepted: true });
  });

  // -- Jira webhook ---------------------------------------------------------
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
            'TRACKER_DEFAULT_REPO_OWNER/NAME or TRACKER_INSTALLATION_ID not configured -- Jira ticket not enqueued',
          );
        }
      } catch (err) {
        log.error({ err: String(err), ticketId: result.ticketId }, 'Failed to process Jira webhook');
      }
    }

    res.status(202).json({ accepted: true });
  });

  // -- Stripe webhook -------------------------------------------------------
  const stripeWebhookHandler = createStripeWebhookHandler();
  app.post('/webhook/stripe', stripeWebhookHandler);

  // -- 404 handler ----------------------------------------------------------
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'Not found' });
  });

  // -- Sentry error handler (must be before generic 500 handler) -------------
  // Captures Express request errors and sends them to Sentry.
  if (typeof Sentry.setupExpressErrorHandler === 'function') {
    Sentry.setupExpressErrorHandler(app);
  } else if (typeof Sentry.expressErrorHandler === 'function') {
    app.use(Sentry.expressErrorHandler() as any);
  }

  // -- Global error handler -------------------------------------------------
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    log.error({ err: String(err) }, 'Unhandled error');
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
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

// -- Process-level error handlers --------------------------------------------

process.on('uncaughtException', (err) => {
  log.error({ err: String(err), stack: (err as Error).stack }, 'Uncaught exception -- shutting down');
  Sentry.captureException(err);
  Sentry.flush(2000).catch(() => {});
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  log.error({ err: String(reason), stack: (reason as Error)?.stack }, 'Unhandled promise rejection -- shutting down');
  Sentry.captureException(reason instanceof Error ? reason : new Error(String(reason)));
  Sentry.flush(2000).catch(() => {});
  process.exit(1);
});

// -- Helper: Capture raw body for webhook signature verification -------------

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
