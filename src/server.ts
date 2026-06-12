/**
 * Express API server -- webhook receiver, health endpoints, and Sentry monitoring.
 *
 * Features:
 * - Raw body middleware for webhook signature verification
 * - Request ID middleware for log correlation
 * - Structured access logging with pino
 * - Sentry error handler (captures Express errors via setupExpressErrorHandler)
 * - GET /health — overall service health
 * - GET /health/queue — queue depth and worker health
 * - GET /health/ready — readiness probe (all dependencies connected)
 * - GET /health/live — liveness probe (process is alive)
 * - GET /metrics endpoint (Prometheus-style webhook metrics)
 * - POST /webhook -- GitHub webhook receiver via @octokit/webhooks
 * - POST /webhook/stripe -- Stripe webhook for credit purchase events
 * - GET /docs -- Swagger UI / OpenAPI documentation
 * - Admin webhook management API at /admin/webhooks
 * - Webhook event logging to webhook_events table for all sources
 * - Idempotency via x-github-delivery / delivery_id deduplication
 * - Exponential backoff retry worker (1min, 5min, 30min, max 3)
 * - Sentry error handler (captures Express errors)
 *
 * --- Error Handling Audit ---------------------------------------------------
 * - Sentry error handler via setupExpressErrorHandler (v8 API)
 * - Global Express error middleware (4-arg handler) at bottom of chain
 * - Process-level uncaughtException and unhandledRejection handlers
 * - app.listen() error event handled (EADDRINUSE, EACCES, etc.)
 * - Server instance returned for graceful shutdown by caller
 * - Request ID middleware for log correlation
 * ---------------------------------------------------------------------------
 */

import crypto from 'node:crypto';
import fs from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import swaggerUi from "swagger-ui-express";
import type { EmitterWebhookEventName } from '@octokit/webhooks';
import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import rateLimit from 'express-rate-limit';
import cors from 'cors';
import helmet from 'helmet';
import { buildHelmetConfig, handleCspViolationReport } from './security/securityHeaders.js';
import { ipAllowlistMiddleware } from './security/ipAllowlist.js';
import { config } from './config.js';
import { getQueueHealth } from './health/queueHealth.js';
import { bridgeMetrics } from './bridge/metrics.js';
import { enqueueIssue } from './queue/issueQueue.js';
import { getSlackBoltApp } from './notifications/slack-bolt.js';
import { getTracker, initTrackers } from './trackers/index.js';
import { handleJiraWebhook, verifyJiraWebhookSignature } from './trackers/jira.js';
import { handleLinearWebhook, verifyLinearWebhookSignature } from './trackers/linear.js';
import { createStripeWebhookHandler } from './stripe/index.js';
import { queryWithRetry } from './db/connection.js';
import { rootLogger } from './utils/logger.js';
import { initMetering, usageRouter } from './metering/index.js';
import type { IssueJobData } from './utils/types.js';
import { adminAuthMiddleware } from "./security/adminAuth.js";
import { initTierOverrides } from "./ratelimit/tiers.js";
import { validateWebhookPayload } from './validation.js';
import { rateLimitMiddleware } from './ratelimit/middleware.js';
import { createBitbucketWebhooks } from './webhooks/bitbucket.js';
import { createGithubWebhooks } from './webhooks/github.js';
import { createGitlabWebhooks } from './webhooks/gitlab.js';
import { linearWebhookRouter } from './webhooks/linear.js';
import { featureFlagsRouter } from './routes/featureFlags.js';
import { logWebhookReceived, logWebhookProcessed, logWebhookFailed } from './webhooks/eventLogger.js';
import { recordWebhookDuration } from './webhooks/metrics.js';
import { renderMetrics } from './webhooks/metrics.js';
import { renderFeatureFlagMetrics } from './featureFlags/metrics.js';
import { adminWebhooksRouter } from './routes/adminWebhooks.js';
import { startWebhookRetryWorker } from './webhooks/retryWorker.js';
import { adminRouter } from './routes/admin.js';
import { frontierRouter } from './routes/frontier.js';
import { dashboardRouter } from './routes/dashboard.js';
import { adminDashboardRouter } from './routes/adminDashboard.js';
import { billingRouter, initBilling } from './billing/index.js';
import { addBreadcrumb, setupSentryExpressErrorHandler } from './monitoring/sentry.js';
import { opencodeHealth } from './health/opencodeHealth.js';
import { getWorkersHealth } from './health/workers.js';
import { getDependenciesHealth } from './health/dependencies.js';
import rapidApiRouter from './api/router.js';

const log = rootLogger.child({ module: 'server' });

const START_TIME = Date.now();
const REQUEST_SIZE_LIMIT = parseSize(config.security.requestBodyLimit);
const WEBHOOK_SIZE_LIMIT = parseSize(config.security.webhookBodyLimit);

function parseSize(size: string): number {
  const match = size.match(/^(\d+)\s*(b|kb|mb|gb)$/i);
  if (!match) return 0;
  const num = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const multipliers: Record<string, number> = { b: 1, kb: 1024, mb: 1024 * 1024, gb: 1024 * 1024 * 1024 };
  return num * (multipliers[unit] || 1);
}

/**
 * Create and configure the Express application.
 */

export function createApp(): express.Application {
  const app = express();

  // -- Security headers (Helmet with explicit CSP and security headers) ---------
  //
  // The buildHelmetConfig() function detects whether the dashboard build
  // is present and generates CSP directives accordingly:
  //   - Dashboard mode: allows scripts/styles from 'self' for SPA functionality
  //   - API-only mode:  maximally restrictive (default-src 'none')
  //
  // Additional headers added:
  //   - Cross-Origin-Embedder-Policy: require-corp
  //   - Cross-Origin-Opener-Policy: same-origin
  //   - Permissions-Policy: camera=(), microphone=(), geolocation=()
  //   - Strict-Transport-Security (production only)
  //   - Referrer-Policy: strict-origin-when-cross-origin
  //   - Standard helmet headers (X-Frame-Options, X-Content-Type-Options, etc.)
  // ---------------------------------------------------------------------------------
  app.use(helmet(buildHelmetConfig()));

  // -- CORS -----------------------------------------------------------------
  app.use(cors({
    origin: config.security.corsOrigin === '*'
      ? '*'
      : config.security.corsOrigin.split(',').map(s => s.trim()),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-key', 'x-request-id'],
    exposedHeaders: ['x-request-id'],
    credentials: true,
    maxAge: 86400,
  }));

  // -- IP Allowlist for webhook endpoints -----------------------------------
  app.use('/webhook', ipAllowlistMiddleware);

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
      '/api/v1/billing/webhook',
    ],
    express.raw({ type: 'application/json', limit: WEBHOOK_SIZE_LIMIT, verify: addRawBody }),
  );

  // -- JSON parsing for all other routes (with size limit) --------------------
  app.use(express.json({ limit: REQUEST_SIZE_LIMIT }));

  // -- URL-encoded body parsing (with size limit) ---------------------------
  app.use(express.urlencoded({ extended: true, limit: REQUEST_SIZE_LIMIT }));

  // -- Rate limiter for webhook routes ---------------------------------------
  const limiter = rateLimit({
    windowMs: config.stas.rateLimit.windowMs,
    limit: config.stas.rateLimit.max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests', retryAfter: 'see Retry-After header' },
  });
  app.use('/webhook', limiter);

  // -- CSP violation report endpoint --------------------------------------------
  // Browsers POST violation reports here when CSP directives are breached.
  // Logged at WARN level for security monitoring.
  app.post('/api/v1/csp-violation-report', handleCspViolationReport);

  // -- Slack Bolt receiver (interactive messages) ---------------------------
  const bolt = getSlackBoltApp();
  bolt.mountOn(app);

  // -- Health check ---------------------------------------------------------
  app.get('/health', async (_req: Request, res: Response) => {
    let dbStatus = 'unknown';
    try {
      const result = await queryWithRetry<{ ok: number }>('SELECT 1 AS ok');
      dbStatus = result.rows[0]?.ok === 1 ? 'ok' : 'degraded';
    } catch (err) {
      dbStatus = 'error';
      log.error({ err: String(err) }, 'Health check: database unreachable');
    }

    res.json({
      status: dbStatus === 'ok' ? 'ok' : 'degraded',
      label: config.stas.label,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      lastError: lastError,
      services: {
        webhook: { status: 'ok' },
        worker: { status: 'ok' },
        queue: { status: 'unknown' },
        database: { status: dbStatus },
        opencode: { status: opencodeHealth.getStatus().status },
        sentry: { status: config.sentry.dsn ? 'connected' : 'disabled' },
      },
    });
  });

  // -- Readiness probe (all dependencies connected) --------------------------
  app.get('/health/ready', async (_req: Request, res: Response) => {
    const checks: Record<string, { status: string; error?: string }> = {};

    // Check database connectivity
    try {
      const { getPool } = await import('./db/connection.js');
      const pool = getPool();
      const client = await pool.connect();
      await client.query('SELECT 1');
      client.release();
      checks.database = { status: 'ok' };
    } catch (err) {
      checks.database = { status: 'error', error: String(err) };
    }

    // Check Redis / queue connectivity
    try {
      const { Redis } = await import('ioredis');
      const redis = new Redis(config.queue.redisUrl, {
        maxRetriesPerRequest: null,
        enableReadyCheck: true,
        lazyConnect: true,
        retryStrategy: () => null, // no retry for health check
      });
      await redis.connect();
      await redis.ping();
      checks.queue = { status: 'ok' };
      await redis.quit();
    } catch (err) {
      checks.queue = { status: 'error', error: String(err) };
    }

    // Check OpenCode connectivity (from cached health client)
    const ocStatus = opencodeHealth.getStatus();
    checks.opencode = {
      status: ocStatus.status === 'healthy' ? 'ok' : ocStatus.status,
      ...(ocStatus.status === 'healthy'
        ? {}
        : { error: `circuit=${ocStatus.circuit}, failures=${ocStatus.consecutiveFailures}, http=${ocStatus.httpStatus}` }),
    };

    // Overall readiness — all checks must pass
    const allOk = Object.values(checks).every((c) => c.status === 'ok');
    const httpStatus = allOk ? 200 : 503;

    res.status(httpStatus).json({
      status: allOk ? 'ok' : 'degraded',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      checks,
    });
  });

  // -- Liveness probe (process is alive) -------------------------------------
  app.get('/health/live', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      uptime: process.uptime(),
      startedAt: new Date(START_TIME).toISOString(),
      timestamp: new Date().toISOString(),
    });
  });

  // -- Queue health endpoint ------------------------------------------------
  app.get('/health/queue', async (_req: Request, res: Response) => {
    try {
      const report = await getQueueHealth();
      const httpStatus = report.status === 'critical' ? 503 : report.status === 'degraded' ? 200 : 200;
      res.status(httpStatus).json(report);
    } catch (err) {
      res.status(500).json({ error: 'Failed to get queue health', details: String(err) });
    }
  });

  // -- OpenCode health endpoint ---------------------------------------------
  app.get('/health/opencode', async (_req: Request, res: Response) => {
    try {
      const status = await opencodeHealth.checkNow();
      const httpStatus = status.status === 'healthy' ? 200 : status.status === 'degraded' ? 503 : 503;
      res.status(httpStatus).json(status);
    } catch (err) {
      res.status(500).json({ error: 'Failed to get OpenCode health', details: String(err) });
    }
  });

  // -- Worker health endpoint ------------------------------------------------
  app.get('/health/workers', (_req: Request, res: Response) => {
    try {
      const report = getWorkersHealth();
      const httpStatus = report.status === 'ok' ? 200 : 503;
      res.status(httpStatus).json(report);
    } catch (err) {
      res.status(500).json({ error: 'Failed to get workers health', details: String(err) });
    }
  });

  // -- Dependencies health endpoint -----------------------------------------
  app.get('/health/dependencies', async (_req: Request, res: Response) => {
    try {
      const report = await getDependenciesHealth();
      const httpStatus = report.status === 'ok' ? 200 : 503;
      res.status(httpStatus).json(report);
    } catch (err) {
      res.status(500).json({ error: 'Failed to get dependencies health', details: String(err) });
    }
  });

  // -- Prometheus metrics endpoint ------------------------------------------
  app.get('/metrics', (_req: Request, res: Response) => {
    const webhookMetrics = renderMetrics();
    const bridgeMetricsOutput = bridgeMetrics.render();
    const featureFlagMetrics = renderFeatureFlagMetrics();
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(webhookMetrics + '\n' + bridgeMetricsOutput + '\n' + featureFlagMetrics);

  });

  // -- Initialize trackers --------------------------------------------------
  initTrackers();
  initTierOverrides();

  // ── Initialize metering ───────────────────────────────────────────
  initMetering();

  // ── Initialize billing ────────────────────────────────────────────
  initBilling();

  // ── Start webhook retry worker ────────────────────────────────────
  // Only start if we're running as API or both
  if (config.runMode === 'api' || config.runMode === 'both') {
    startWebhookRetryWorker();
  }

  // ── Webhook receiver ─────────────────────────────────────────────
  
  const githubWebhooks = createGithubWebhooks();
  const gitlabHandler = createGitlabWebhooks();
  const bitbucketHandler = createBitbucketWebhooks();

  // -- GitHub webhook handler (shared between /webhook and /webhook/github) --
  async function handleGithubWebhook(req: Request, res: Response): Promise<void> {
    const startTime = Date.now();
    const event = req.headers['x-github-event'] as string;
    const deliveryId = req.headers['x-github-delivery'] as string;
    const signature = req.headers['x-hub-signature-256'] as string;
    const source = 'github';

    log.info({ event, deliveryId, requestId: req.requestId }, 'Received GitHub webhook');

    addBreadcrumb('webhook', 'GitHub webhook received', {
      event,
      deliveryId,
      source,
    });

    const rawBody = (req as { rawBody?: Buffer }).rawBody;
    let parsedPayload: unknown;
    try {
      parsedPayload = rawBody ? JSON.parse(rawBody.toString()) : req.body;
      // Store payload for downstream middleware (rate limit)
      (req as unknown as Record<string, unknown>).parsedPayload = parsedPayload;
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
          name: event as EmitterWebhookEventName,
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
          name: event as EmitterWebhookEventName,
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

    addBreadcrumb('webhook', 'GitHub webhook processed', {
      event,
      deliveryId,
      source,
      durationMs: String(Date.now() - startTime),
    });

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

    addBreadcrumb('webhook', 'GitLab webhook received', { event, source });

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
      deliveryId: undefined,
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

    addBreadcrumb('webhook', 'Bitbucket webhook received', { source });

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
      deliveryId: undefined,
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
      eventType: (payload as Record<string, unknown>)?.type as string || 'unknown',
      deliveryId: undefined,
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

          await enqueueIssue(undefined, jobData);
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
      eventType: (payload as Record<string, unknown>)?.webhookEvent as string || 'unknown',
      deliveryId: undefined,
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

          await enqueueIssue(undefined, jobData);
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
        deliveryId: undefined,
        payload: { note: 'Stripe webhook payload parsed by handler' },
      });
    } catch {
      // Non-fatal — Stripe handler will manage its own errors
    }

    const stripeWebhookHandler = createStripeWebhookHandler();

    // Wrap the handler to capture success/failure for event logging
    const wrappedHandler = async (req2: Request, res2: Response, next2: NextFunction) => {
      try {
        await stripeWebhookHandler(req2, res2);
        if (eventId) await logWebhookProcessed(eventId);
      } catch (err) {
        if (eventId) await logWebhookFailed(eventId, String(err));
        throw err;
      }
      recordWebhookDuration(source, Date.now() - startTime);
    };

    await wrappedHandler(req, res, () => {});
  });

  // -- Linear webhook -------------------------------------------------------
  app.use(linearWebhookRouter);

  // -- Feature flags admin API ------------------------------------------------
  app.use('/api/v1/admin/feature-flags', featureFlagsRouter);

  // ── Admin API ────────────────────────────────────────
  app.use('/admin', adminRouter);

  // ── Dashboard API (user-facing) ────────────────────────
  app.use('/api/v1/me', dashboardRouter);

  // ── Admin Dashboard API ────────────────────────────────
  app.use('/api/v1/dashboard', adminDashboardRouter);

  // ── Usage metering API ──────────────────────────────────────────
  app.use('/api/v1/credits/usage', usageRouter);

  // ── Billing API ───────────────────────────────────────────────────
  app.use('/api/v1/billing', billingRouter);

  // ── Frontier API ────────────────────────────────────────────────
  app.use('/frontier', frontierRouter);

  // ── Admin webhooks API ──────────────────────────────────────────
  // GET /admin/webhooks (paginated, filterable)
  // POST /admin/webhooks/:id/replay
  // POST /admin/webhooks/replay-range
  // GET /admin/webhooks/sources
  // GET /admin/webhooks/stats
  app.use('/admin/webhooks', adminWebhooksRouter);

  // ── Swagger UI / OpenAPI documentation ──────────────────────────────
  const thisFilename = fileURLToPath(import.meta.url);
  const thisDirname = dirname(thisFilename);
  const specPath = resolve(thisDirname, '../openapi.yaml');
  const openApiSpec = yaml.load(fs.readFileSync(specPath, 'utf8')) as Record<string, unknown>;
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiSpec));

  // ── RapidAPI ─────────────────────────────────────────────────
  app.use(rapidApiRouter);

  // Serve dashboard static build (production only)
  const dashboardDistPath = resolve(__dirname, '../dashboard/dist');
  if (fs.existsSync(dashboardDistPath)) {
    app.use(express.static(dashboardDistPath));
    // SPA fallback - all non-API routes serve index.html
    app.get('*', (req, res) => {
      if (!req.path.startsWith('/api') && !req.path.startsWith('/health') && !req.path.startsWith('/webhook') && !req.path.startsWith('/docs') && !req.path.startsWith('/metrics') && !req.path.startsWith('/slack') && !req.path.startsWith('/admin') && !req.path.startsWith('/flower')) {
        res.sendFile(resolve(dashboardDistPath, 'index.html'));
      }
    });
  }

    // -- 404 handler ----------------------------------------------------------
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'Not found' });
  });

  let lastError: string | null = null;
  function setLastError(err: Error): void {
    lastError = err.message;
  }

  // -- Global error handler -------------------------------------------------
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    setLastError(err);
    log.error({ err: String(err) }, 'Unhandled error');
    res.status(500).json({ error: 'Internal server error' });
  });

  // -- Sentry error handler (must be last middleware) -----------------------
  // Uses Sentry v8 setupExpressErrorHandler API
  setupSentryExpressErrorHandler(app);

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

if (process.env.NODE_ENV !== 'test') {
  process.on('uncaughtException', (err) => {
    log.error({ err: String(err), stack: (err as Error).stack }, 'Uncaught exception -- shutting down');
    process.exit(1);
  });
}

if (process.env.NODE_ENV !== 'test') {
  process.on('unhandledRejection', (reason) => {
    log.error({ err: String(reason), stack: (reason as Error)?.stack }, 'Unhandled promise rejection -- shutting down');
    process.exit(1);
  });
}

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
