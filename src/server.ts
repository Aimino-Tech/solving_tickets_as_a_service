/**
 * Express API server -- webhook receiver and health endpoint.
 *
 * Features:
 * - Raw body middleware for webhook signature verification
 * - Request ID middleware for log correlation
 * - Structured access logging with pino
 * - GET /health endpoint
 * - GET /metrics endpoint (Prometheus-style webhook metrics)
 * - POST /webhook -- GitHub webhook receiver via @octokit/webhooks
 * - POST /webhook/stripe -- Stripe webhook for credit purchase events
 * - Admin webhook management API at /admin/webhooks
 * - Webhook event logging to webhook_events table for all sources
 * - Idempotency via x-github-delivery / delivery_id deduplication
 * - Exponential backoff retry worker (1min, 5min, 30min, max 3)
 *
 * --- Error Handling Audit ---------------------------------------------------
 * - Global Express error middleware (4-arg handler) at bottom of chain
 * - Process-level uncaughtException and unhandledRejection handlers
 * - app.listen() error event handled (EADDRINUSE, EACCES, etc.)
 * - Server instance returned for graceful shutdown by caller
 * - Request ID middleware for log correlation
 * ---------------------------------------------------------------------------
 */

import crypto from 'node:crypto';
import type { EmitterWebhookEventName } from '@octokit/webhooks';
import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { createIssueQueue, enqueueIssue, pauseIssueQueue, resumeIssueQueue, isQueuePaused, getQueueMetrics } from './queue/issueQueue.js';
import { getSlackBoltApp } from './notifications/slack-bolt.js';
import { getTracker, initTrackers } from './trackers/index.js';
import { handleJiraWebhook, verifyJiraWebhookSignature } from './trackers/jira.js';
import { handleLinearWebhook, verifyLinearWebhookSignature } from './trackers/linear.js';
import { createStripeWebhookHandler } from './stripe/index.js';
import { creditRouter } from './credits/index.js';
import { rootLogger } from './utils/logger.js';
import { initMetering, usageRouter } from './metering/index.js';
import type { IssueJobData } from './utils/types.js';
import { validateWebhookPayload } from './validation.js';
import { rateLimitMiddleware } from './ratelimit/middleware.js';
import { createBitbucketWebhooks } from './webhooks/bitbucket.js';
import { createGithubWebhooks } from './webhooks/github.js';
import { createGitlabWebhooks } from './webhooks/gitlab.js';
import { featureFlagsRouter } from './routes/featureFlags.js';
import { dashboardRouter } from './routes/dashboard.js';
import { logWebhookReceived, logWebhookProcessed, logWebhookFailed } from './webhooks/eventLogger.js';
import { recordWebhookDuration, renderMetrics } from './webhooks/metrics.js';
import { adminWebhooksRouter } from './routes/adminWebhooks.js';
import { startWebhookRetryWorker } from './webhooks/retryWorker.js';
import { startHealthMonitor } from './webhooks/healthMonitor.js';
import { bridgeMetrics } from './bridge/metrics.js';

const log = rootLogger.child({ module: 'server' });

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

  // -- Custom per-repo and per-account rate limit middleware ---------------
  app.use('/webhook', rateLimitMiddleware({
    getAccountId: (req, _res) => {
      const p = (req as any).parsedPayload;
      return p?.installation?.id ?? undefined;
    },
    getRepo: (req, _res) => {
      const p = (req as any).parsedPayload;
      if (p?.repository?.full_name) return p.repository.full_name;
      if (p?.repository?.owner?.login && p?.repository?.name) {
        return `${p.repository.owner.login}/${p.repository.name}`;
      }
      return undefined;
    },
  }));

  // -- Global rate limiter for webhook routes (IP-based) ---------------------
  const limiter = rateLimit({
    windowMs: config.stas.rateLimit.windowMs,
    limit: config.stas.rateLimit.max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests', retryAfter: 'see Retry-After header' },
  });
  app.use('/webhook', limiter);

  // -- Credit-based rate limiter (per-account, per-repo, per-IP) ----------
  app.use('/webhook', rateLimitMiddleware());

  // -- Slack Bolt receiver (interactive messages) ---------------------------
  const bolt = getSlackBoltApp();
  bolt.mountOn(app);

  // -- Health check (liveness, readiness, and simple health) -----------------
  app.get(['/health', '/health/live', '/health/ready'], (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      label: config.stas.label,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  });

  // -- Prometheus metrics endpoint -----------------------------------------
  app.get('/metrics', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    // Combine webhook and bridge metrics
    const webhookMetrics = renderMetrics();
    const bridgeMetricsOutput = bridgeMetrics.render();
    res.send([webhookMetrics, bridgeMetricsOutput].filter(Boolean).join('\n\n'));
  });

  // -- Initialize trackers --------------------------------------------------
  initTrackers();

  // ── Initialize metering ───────────────────────────────────────────
  initMetering();

  // ── Start webhook retry worker ────────────────────────────────────
  // Only start if we're running as API or both
  if (config.runMode === 'api' || config.runMode === 'both') {
    startWebhookRetryWorker();
  }

  // ── Start webhook health monitor ──────────────────────────────────
  // Periodically checks failure rate and alerts if > 5%
  if (config.runMode === 'api' || config.runMode === 'both') {
    startHealthMonitor();
  }

  // ── Webhook receiver ─────────────────────────────────────────────
  const queue = createIssueQueue();
  const githubWebhooks = createGithubWebhooks(queue);
  const gitlabHandler = createGitlabWebhooks(queue);
  const bitbucketHandler = createBitbucketWebhooks(queue);

  // -- GitHub webhook handler (shared between /webhook and /webhook/github) --
  async function handleGithubWebhook(req: Request, res: Response): Promise<void> {
    const startTime = Date.now();
    const event = req.headers['x-github-event'] as string;
    const deliveryId = req.headers['x-github-delivery'] as string;
    const signature = req.headers['x-hub-signature-256'] as string;
    const source = 'github';

    log.info({ event, deliveryId, requestId: req.requestId }, 'Received GitHub webhook');

    const rawBody = (req as { rawBody?: Buffer }).rawBody;
    let parsedPayload: unknown;
    try {
      parsedPayload = rawBody ? JSON.parse(rawBody.toString()) : req.body;
      // Store payload for downstream middleware (rate limit)
      (req as any).parsedPayload = parsedPayload;
    } catch (err) {
      log.error({ err: String(err) }, 'Failed to parse webhook payload');
      res.status(400).json({ error: 'Invalid JSON payload' });
      return;
    }

    // Log the webhook event BEFORE processing (for audit trail)
    const eventId = await logWebhookReceived({
      source,
      eventType: event,
      deliveryId,
      ...captureWebhookContext(req, parsedPayload as Record<string, unknown> | undefined),
      payload: parsedPayload,
    });

    const validation = validateWebhookPayload(event, parsedPayload);
    if (!validation.success) {
      log.warn(
        { event, errors: validation.errors, requestId: req.requestId },
        'Webhook payload validation failed',
      );
      if (eventId) await logWebhookFailed(eventId, `Validation failed: ${validation.errors?.join(', ')}`);
      res.status(400).json({ error: 'Invalid payload', details: validation.errors });
      return;
    }

    if (!config.stas.devSkipWebhookVerify && signature) {
      if (!rawBody) {
        log.error('Missing raw body for signature verification');
        if (eventId) await logWebhookFailed(eventId, 'Missing raw body for signature verification');
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
        if (eventId) await logWebhookFailed(eventId, `Signature verification failed: ${String(err)}`);
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
        if (eventId) await logWebhookFailed(eventId, `Processing error: ${String(err)}`);
        // Still respond 202 — we've logged the event for replay
      }
    }

    // Mark as processed on success
    if (eventId) {
      await logWebhookProcessed(eventId);
      recordWebhookDuration(source, Date.now() - startTime);
    }

    // Always respond 202 (accepted for async processing)
    res.status(202).json({ accepted: true });
  }

  // Legacy /webhook (backward compat) + explicit /webhook/github
  app.post('/webhook', handleGithubWebhook);
  app.post('/webhook/github', handleGithubWebhook);

  // -- GitLab webhook -------------------------------------------------------
  app.post('/webhook/gitlab', async (req: Request, res: Response) => {
    const startTime = Date.now();
    const event = req.headers['x-gitlab-event'] as string;
    const token = req.headers['x-gitlab-token'] as string;
    const rawBody = (req as { rawBody?: Buffer }).rawBody;
    const source = 'gitlab';

    log.info({ event, requestId: req.requestId }, 'Received GitLab webhook');

    if (!rawBody) {
      log.error('Missing raw body for GitLab webhook');
      res.status(400).json({ error: 'Missing raw body' });
      return;
    }

    let parsedPayload: unknown;
    try {
      parsedPayload = JSON.parse(rawBody.toString());
    } catch (err) {
      log.error({ err: String(err) }, 'Failed to parse GitLab webhook payload');
      res.status(400).json({ error: 'Invalid JSON payload' });
      return;
    }

    // Log the webhook event
    const eventId = await logWebhookReceived({
      source,
      eventType: event || 'unknown',
      ...captureWebhookContext(req, parsedPayload as Record<string, unknown> | undefined),
      payload: parsedPayload,
    });

    if (config.gitlab.webhookSecret) {
      const { gitlabWebhook: gw } = await import('./webhooks/gitlab.js');
      if (!gw.verify(rawBody.toString(), token, config.gitlab.webhookSecret)) {
        log.warn('GitLab webhook token verification failed');
        if (eventId) await logWebhookFailed(eventId, 'Token verification failed');
        res.status(401).json({ error: 'Invalid token' });
        return;
      }
    }

    try {
      await gitlabHandler.handle(event, parsedPayload);
      if (eventId) await logWebhookProcessed(eventId);
    } catch (err) {
      log.error({ err: String(err) }, 'GitLab webhook processing error');
      if (eventId) await logWebhookFailed(eventId, String(err));
    }

    recordWebhookDuration(source, Date.now() - startTime);
    res.status(202).json({ accepted: true });
  });

  // -- Bitbucket webhook ----------------------------------------------------
  app.post('/webhook/bitbucket', async (req: Request, res: Response) => {
    const startTime = Date.now();
    const signature = req.headers['x-hub-signature'] as string;
    const rawBody = (req as { rawBody?: Buffer }).rawBody;
    const source = 'bitbucket';

    log.info({ requestId: req.requestId }, 'Received Bitbucket webhook');

    if (!rawBody) {
      log.error('Missing raw body for Bitbucket webhook');
      res.status(400).json({ error: 'Missing raw body' });
      return;
    }

    let parsedPayload: unknown;
    try {
      parsedPayload = JSON.parse(rawBody.toString());
    } catch {
      res.status(400).json({ error: 'Invalid JSON payload' });
      return;
    }

    // Log the webhook event
    const eventId = await logWebhookReceived({
      source,
      eventType: 'push',
      ...captureWebhookContext(req, parsedPayload as Record<string, unknown> | undefined),
      payload: parsedPayload,
    });

    try {
      await bitbucketHandler.handle(rawBody.toString(), signature);
      if (eventId) await logWebhookProcessed(eventId);
    } catch (err) {
      log.error({ err: String(err) }, 'Bitbucket webhook processing error');
      if (eventId) await logWebhookFailed(eventId, String(err));
    }

    recordWebhookDuration(source, Date.now() - startTime);
    res.status(202).json({ accepted: true });
  });

  // -- Linear webhook --------------------------------------------------------
  app.post('/webhook/linear', async (req: Request, res: Response) => {
    const startTime = Date.now();
    const signature = req.headers['linear-signature'] as string;
    const rawBody = (req as { rawBody?: Buffer }).rawBody;
    const source = 'linear';

    if (!rawBody) {
      res.status(400).json({ error: 'Missing raw body' });
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody.toString());
    } catch {
      res.status(400).json({ error: 'Invalid JSON payload' });
      return;
    }

    // Log the webhook event
    const eventId = await logWebhookReceived({
      source,
      eventType: (payload as any)?.type || 'unknown',
      ...captureWebhookContext(req, payload as Record<string, unknown> | undefined),
      payload,
    });

    if (!verifyLinearWebhookSignature(rawBody, signature)) {
      if (eventId) await logWebhookFailed(eventId, 'Signature verification failed');
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }

    const result = await handleLinearWebhook(payload);
    if (!result) {
      if (eventId) await logWebhookFailed(eventId, 'Invalid webhook payload');
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
        if (eventId) await logWebhookFailed(eventId, String(err));
      }
    }

    if (eventId) await logWebhookProcessed(eventId);
    recordWebhookDuration(source, Date.now() - startTime);
    res.status(202).json({ accepted: true });
  });

  // -- Jira webhook ---------------------------------------------------------
  app.post('/webhook/jira', async (req: Request, res: Response) => {
    const startTime = Date.now();
    const signature = req.headers['x-hub-signature-256'] as string;
    const rawBody = (req as { rawBody?: Buffer }).rawBody;
    const source = 'jira';

    if (!rawBody) {
      res.status(400).json({ error: 'Missing raw body' });
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody.toString());
    } catch {
      res.status(400).json({ error: 'Invalid JSON payload' });
      return;
    }

    // Log the webhook event
    const eventId = await logWebhookReceived({
      source,
      eventType: (payload as any)?.webhookEvent || 'unknown',
      ...captureWebhookContext(req, payload as Record<string, unknown> | undefined),
      payload,
    });

    if (!verifyJiraWebhookSignature(rawBody, signature)) {
      if (eventId) await logWebhookFailed(eventId, 'Signature verification failed');
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }

    const result = await handleJiraWebhook(payload);
    if (!result) {
      if (eventId) await logWebhookFailed(eventId, 'Invalid webhook payload');
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
        if (eventId) await logWebhookFailed(eventId, String(err));
      }
    }

    if (eventId) await logWebhookProcessed(eventId);
    recordWebhookDuration(source, Date.now() - startTime);
    res.status(202).json({ accepted: true });
  });

  // -- Stripe webhook -------------------------------------------------------
  app.post('/webhook/stripe', async (req: Request, res: Response) => {
    const startTime = Date.now();
    const rawBody = (req as { rawBody?: Buffer }).rawBody;
    const source = 'stripe';

    // Log the event before processing (best-effort, raw body may not be parseable yet)
    let eventId: number | undefined;
    try {
      const stripeEventType = req.headers['stripe-signature'] ? 'stripe-event' : 'unknown';
      eventId = await logWebhookReceived({
        source,
        eventType: stripeEventType,
        ...captureWebhookContext(req, undefined),
        payload: { note: 'Stripe webhook payload parsed by handler' },
      });
    } catch {
      // Non-fatal — Stripe handler will manage its own errors
    }

    const stripeWebhookHandler = createStripeWebhookHandler();

    // Wrap the handler to capture success/failure for event logging
    const wrappedHandler = async (req2: Request, res2: Response, next2: NextFunction) => {
      try {
        await stripeWebhookHandler(req2, res2, next2);
        if (eventId) await logWebhookProcessed(eventId);
      } catch (err) {
        if (eventId) await logWebhookFailed(eventId, String(err));
        throw err;
      }
      recordWebhookDuration(source, Date.now() - startTime);
    };

    await wrappedHandler(req, res, () => {});
  });

  // -- Feature flags admin API ------------------------------------------------
  app.use('/api/v1/admin/feature-flags', featureFlagsRouter);

  // ── Dashboard API (multi-tenant data access) ────────────────────
  app.use('/api/v1/dashboard', dashboardRouter);

  // ── Usage metering API ──────────────────────────────────────────
  app.use('/api/v1/credits/usage', usageRouter);

  // ── Admin webhooks API ──────────────────────────────────────────
  // GET /admin/webhooks (paginated, filterable)
  // POST /admin/webhooks/:id/replay
  // POST /admin/webhooks/replay-range
  // GET /admin/webhooks/sources
  // GET /admin/webhooks/stats
  // GET /admin/webhooks/health
  app.use('/admin/webhooks', adminWebhooksRouter);

  // -- Credit REST API routes ------------------------------------------------
  app.use('/api/v1', creditRouter);


  // ── Queue management endpoints (pause/resume) ──────────────────
  async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
    const adminKey = req.headers['x-admin-key'] as string;
    if (!adminKey || adminKey !== config.stas.adminApiKey) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    next();
  }

  /**
   * POST /admin/queue/pause — Pause the issue queue.
   * Requires x-admin-key header.
   */
  app.post('/admin/queue/pause', requireAdmin, async (_req: Request, res: Response) => {
    try {
      await pauseIssueQueue(queue);
      res.json({ status: 'paused', queue: 'stas-issues' });
    } catch (err) {
      log.error({ err: String(err) }, 'Failed to pause queue');
      res.status(500).json({ error: 'Failed to pause queue' });
    }
  });

  /**
   * POST /admin/queue/resume — Resume the issue queue.
   * Requires x-admin-key header.
   */
  app.post('/admin/queue/resume', requireAdmin, async (_req: Request, res: Response) => {
    try {
      await resumeIssueQueue(queue);
      res.json({ status: 'resumed', queue: 'stas-issues' });
    } catch (err) {
      log.error({ err: String(err) }, 'Failed to resume queue');
      res.status(500).json({ error: 'Failed to resume queue' });
    }
  });

  /**
   * GET /admin/queue/status — Get queue metrics (waiting, active, completed, failed).
   * Requires x-admin-key header.
   */
  app.get('/admin/queue/status', requireAdmin, async (_req: Request, res: Response) => {
    try {
      const metrics = await getQueueMetrics(queue);
      res.json(metrics);
    } catch (err) {
      log.error({ err: String(err) }, 'Failed to get queue metrics');
      res.status(500).json({ error: 'Failed to get queue metrics' });
    }
  });

  // -- 404 handler ----------------------------------------------------------

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'Not found' });
  });

  // -- Global error handler -------------------------------------------------
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

// -- Process-level error handlers --------------------------------------------

process.on('uncaughtException', (err) => {
  log.error({ err: String(err), stack: (err as Error).stack }, 'Uncaught exception -- shutting down');
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  log.error({ err: String(reason), stack: (reason as Error)?.stack }, 'Unhandled promise rejection -- shutting down');
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

/**
 * Extract webhook context for event logging from request and parsed payload.
 * Captures installation_id, repo name, raw_body_snippet (first 1KB), and headers.
 */
function captureWebhookContext(
  req: Request,
  parsedPayload: Record<string, unknown> | undefined,
): {
  installationId?: string;
  repo?: string;
  rawBodySnippet?: string;
  headers?: Record<string, string>;
} {
  const rawBody = (req as { rawBody?: Buffer }).rawBody;
  const rawStr = rawBody?.toString() || '';

  // Extract relevant headers (omit auth tokens, cookies)
  const headers: Record<string, string> = {};
  const relevantHeaders = [
    'x-github-event', 'x-github-delivery', 'x-hub-signature-256',
    'x-gitlab-event', 'x-gitlab-token',
    'x-hub-signature',
    'linear-signature',
    'stripe-signature',
    'content-type', 'user-agent', 'x-request-id',
  ];
  for (const h of relevantHeaders) {
    const val = req.headers[h.toLowerCase()];
    if (val) headers[h] = Array.isArray(val) ? val.join(', ') : val;
  }

  // First 1KB of raw body as snippet
  const rawBodySnippet = rawStr.length > 1024 ? rawStr.slice(0, 1024) : rawStr || undefined;

  // Extract installation_id and repo from payload if available
  let installationId: string | undefined;
  let repo: string | undefined;

  if (parsedPayload) {
    // GitHub-like payload: installation?.id, repository?.full_name
    const payload = parsedPayload as Record<string, unknown>;
    const installation = payload.installation as Record<string, unknown> | undefined;
    if (installation?.id) {
      installationId = String(installation.id);
    }
    const repository = payload.repository as Record<string, unknown> | undefined;
    if (repository?.full_name) {
      repo = String(repository.full_name);
    } else if (repository?.name) {
      // Some providers may have just a name and we need the owner
      const owner = (repository.owner as Record<string, unknown> | undefined)?.login || (repository.owner as Record<string, unknown> | undefined)?.name;
      if (owner) {
        repo = `${owner}/${repository.name}`;
      }
    }

    // GitLab: project?.path_with_namespace
    if (!repo) {
      const project = payload.project as Record<string, unknown> | undefined;
      if (project?.path_with_namespace) {
        repo = String(project.path_with_namespace);
      }
    }
  }

  return { installationId, repo, rawBodySnippet, headers: Object.keys(headers).length > 0 ? headers : undefined };
}

// Extend Express Request to include requestId
declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}
