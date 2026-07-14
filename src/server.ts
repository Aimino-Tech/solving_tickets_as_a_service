/**
 * Express API server -- webhook receiver.
 *
 * Features:
 * - Raw body middleware for webhook signature verification
 * - Request ID middleware for log correlation
 * - Structured access logging with pino
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

import cors from 'cors';
import helmet from 'helmet';
import { ipAllowlistMiddleware } from './security/ipAllowlist.js';
import { rateLimitMiddleware } from './ratelimit/middleware.js';
import { config } from './config.js';
import { getSlackBoltApp } from './notifications/slack-bolt.js';
import type { IssueJobData } from './utils/types.js';
import { QUEUES, publishMessage, connect as rmqConnect, isConnected } from './queue/rabbitmq.js';
import { getTracker, initTrackers } from './trackers/index.js';
import { handleJiraWebhook, verifyJiraWebhookSignature } from './trackers/jira.js';
import { handleLinearWebhook, verifyLinearWebhookSignature } from './trackers/linear.js';
import { createStripeWebhookHandler } from './stripe/index.js';
import { rootLogger } from './utils/logger.js';
import { initMetering, usageRouter } from './metering/index.js';
import { createBitbucketWebhooks } from './webhooks/bitbucket.js';
import { createGithubWebhooks } from './webhooks/github.js';
import { createGitlabWebhooks } from './webhooks/gitlab.js';
import { featureFlagsRouter } from './routes/featureFlags.js';
import { logWebhookReceived, logWebhookProcessed, logWebhookFailed } from './webhooks/eventLogger.js';
import { recordWebhookDuration } from './webhooks/metrics.js';
import { adminWebhooksRouter } from './routes/adminWebhooks.js';
import { pipelineRouter } from './routes/pipeline.js';
import { startWebhookRetryWorker } from './webhooks/retryWorker.js';
import { adminRouter } from './routes/admin.js';
import { adminAuditRouter } from './routes/admin_audit.js';
import { dashboardRouter } from './routes/dashboard.js';
import { dpaRouter } from './routes/dpa.js';
import { slaRouter } from './routes/sla.js';
import { onboardingRouter } from './routes/onboarding.js';
import { benchmarksRouter } from './routes/benchmarks.js';
import { pricingRouter } from './routes/pricing.js';
import { trustRouter } from './api/routes/trust.js';
import { plgRouter } from './routes/plg.js';
import { reposRouter } from './routes/repos.js';
import { runsRouter } from './routes/runs.js';
import { badgeRouter } from './routes/badge.js';
import { analyticsRouter } from './routes/analytics.js';
import { viralRouter } from './routes/viral.js';
import { qualityRouter } from './routes/quality.js';
import previewRoutes from './api/routes/preview.js';
import { kpiRouter } from './routes/kpi.js';
import { pipelineHistoryRouter } from './history/pipelineHistoryApi.js';
import previewRoutes from './api/routes/preview.js';

const log = rootLogger.child({ module: 'server' });

export async function createApp(): Promise<express.Application> {
  const app = express();

  // -- Request ID middleware ------------------------------------------------
  app.use((req: Request, res: Response, next: NextFunction) => {
    const requestId = (req.headers['x-request-id'] as string) || crypto.randomUUID();
    req.requestId = requestId;
    res.setHeader('x-request-id', requestId);
    next();
  });

  // -- Security headers (Helmet) -------------------------------------------
  // Sets various HTTP headers for security: CSP, X-Frame-Options,
  // X-Content-Type-Options, Strict-Transport-Security, etc.
  app.use(helmet());

  // -- CORS -----------------------------------------------------------------
  app.use(cors({
    origin: config.security.corsOrigin === '*'
      ? '*'
      : config.security.corsOrigin.split(',').map(s => s.trim()),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-key', 'x-request-id'],
    exposedHeaders: ['x-request-id'],
    credentials: true,
    maxAge: 86400, // 24 hours
  }));

  // -- Health check endpoint ------------------------------------------------
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString(), uptime: process.uptime() });
  });
  app.get('/health/ready', async (_req: Request, res: Response) => {
    const checks: Record<string, string> = {};
    try {
      const { queryWithRetry } = await import('./db/connection.js');
      await queryWithRetry('SELECT 1');
      checks.database = 'ok';
    } catch { checks.database = 'down'; }
    try {
      const { Redis } = await import('ioredis');
      const redis = new Redis(config.queue.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 3000 });
      await redis.connect();
      await redis.ping();
      checks.redis = 'ok';
      await redis.quit().catch(() => {});
    } catch { checks.redis = 'down'; }
    const allOk = Object.values(checks).every(v => v === 'ok');
    res.status(allOk ? 200 : 503).json({ status: allOk ? 'ok' : 'degraded', checks, timestamp: new Date().toISOString() });
  });

  // -- IP Allowlist for webhook endpoints -----------------------------------
  app.use('/webhook', ipAllowlistMiddleware);

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
      '/webhook/telegram',
      '/webhook/whatsapp',
    ],
    express.raw({ type: 'application/json', verify: addRawBody }),
  );

  // -- JSON parsing for all other routes -------------------------------------
  app.use(express.json());

  // -- URL-encoded body parsing ---------------------------------------------
  app.use(express.urlencoded({ extended: true }));

  // -- Governance Proxy rate limiting (per-account, per-repo, per-IP) ----------
  app.use('/webhook', rateLimitMiddleware());

  // -- Slack Bolt receiver (interactive messages) ---------------------------
  const bolt = getSlackBoltApp();
  bolt.mountOn(app);

  // -- Initialize trackers --------------------------------------------------
  initTrackers();

  // ── Initialize metering ───────────────────────────────────────────
  initMetering();

  // ── Start webhook retry worker ────────────────────────────────────
  // Only start if we're running as API or both
  if (config.runMode === 'api' || config.runMode === 'both') {
    startWebhookRetryWorker();
  }

  // ── Webhook receiver ─────────────────────────────────────────────
  // RabbitMQ enqueue function for webhook handlers
  async function enqueueIssue(data: IssueJobData): Promise<string | undefined> {
    if (!isConnected()) {
      await rmqConnect();
    }
    const messageId = `${data.installationId}:${data.repoOwner}/${data.repoName}#${data.issueNumber}-${Date.now()}`;
    try {
      await publishMessage(QUEUES.issuesFix.exchange, QUEUES.issuesFix.routingKey, {
        ...data,
        _meta: { messageId, enqueuedAt: new Date().toISOString() },
      });
      return messageId;
    } catch (err) {
      log.error({ err: String(err) }, 'Failed to enqueue issue via RabbitMQ');
      return undefined;
    }
  }

  const githubWebhooks = createGithubWebhooks(enqueueIssue);
  const gitlabHandler = createGitlabWebhooks(enqueueIssue);
  const bitbucketHandler = createBitbucketWebhooks(enqueueIssue);

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

    if (signature) {
      // Signature present — verify it
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
      // No signature — receive without verification (dev mode or unsigned transport)
      try {
        await githubWebhooks.receive({
          id: deliveryId || crypto.randomUUID(),
          name: event as EmitterWebhookEventName,
          payload: JSON.parse((rawBody || Buffer.from(JSON.stringify(req.body))).toString()),
        });
      } catch (err) {
        log.warn({ err: String(err) }, 'Webhook processing error (no signature)');
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
      eventType: (payload as { type?: string })?.type ?? 'unknown',
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

          await enqueueIssue(jobData);
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
      eventType: (payload as { webhookEvent?: string })?.webhookEvent ?? 'unknown',
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

          await enqueueIssue(jobData);
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

  app.post('/webhook/telegram', async (req: Request, res: Response) => {
    const rawBody = (req as { rawBody?: Buffer }).rawBody;
    let payload: Record<string, unknown>;
    try {
      payload = rawBody ? JSON.parse(rawBody.toString()) : req.body;
    } catch {
      res.status(400).json({ error: 'Invalid JSON' });
      return;
    }
    const { handleTelegramWebhook } = await import('./channels/telegram.js');
    const result = await handleTelegramWebhook(payload);
    res.status(result.ok ? 200 : 500).json(result);
  });

  app.get('/webhook/whatsapp', async (req: Request, res: Response) => {
    const { verifyWhatsAppWebhook } = await import('./channels/whatsapp.js');
    const result = verifyWhatsAppWebhook(req);
    if (result.verified && result.challenge) {
      res.type('text/plain').send(result.challenge);
    } else {
      res.status(403).send('Verification failed');
    }
  });

  app.post('/webhook/whatsapp', async (req: Request, res: Response) => {
    const rawBody = (req as { rawBody?: Buffer }).rawBody;
    let payload: Record<string, unknown>;
    try {
      payload = rawBody ? JSON.parse(rawBody.toString()) : req.body;
    } catch {
      res.status(400).json({ error: 'Invalid JSON' });
      return;
    }
    const { handleWhatsAppWebhook } = await import('./channels/whatsapp.js');
    const result = await handleWhatsAppWebhook(payload);
    res.status(result.ok ? 200 : 500).json(result);
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

  // -- MCP server routes (OpenClaw multi-channel API)
  const { default: mcpRouter } = await import('./routes/mcp.js');
  app.use(mcpRouter);

  // -- MCP agent discovery routes (FastMCP integration)
  const { default: mcpDiscoveryRouter } = await import('./mcp.js');
  app.use(mcpDiscoveryRouter);

  // -- Feature flags admin API ------------------------------------------------
  app.use('/api/v1/admin/feature-flags', featureFlagsRouter);

  // ── Admin API ────────────────────────────────────────
  app.use('/admin', adminRouter);

  app.use('/api/admin/audit', adminAuditRouter);

  // ── Dashboard API ──────────────────────────────────────
  app.use('/api/v1/me', dashboardRouter);

  // ── DPA API ──────────────────────────────────────────────
  app.use('/api/v1/billing', dpaRouter);

  app.use('/api/v1', slaRouter);

  // ── Usage metering API ──────────────────────────────────────────
  app.use('/api/v1/credits/usage', usageRouter);

  // ── Admin webhooks API ──────────────────────────────────────────
  // GET /admin/webhooks (paginated, filterable)
  // POST /admin/webhooks/:id/replay
  // POST /admin/webhooks/replay-range
  // GET /admin/webhooks/sources
  // GET /admin/webhooks/stats
  app.use('/admin/webhooks', adminWebhooksRouter);

  // ── Onboarding API ──────────────────────────────────────────────
  app.use('/onboarding', onboardingRouter);

  // Repos API (repo picker with webhook status)
  app.use('/api/repos', reposRouter);

  // ── Shareable run page API (public, no auth) ───────────────────────
  // GET /api/runs/:id — Public run detail JSON/HTML
  app.use('/api/runs', runsRouter);

  // ── Badge endpoint (public, no auth) ──────────────────────────────
  // GET /badge/:id.svg — shields.io-compatible status badge
  app.use('/badge', badgeRouter);

  // ── Viral discovery endpoints (public, no auth) ───────────────────
  // GET /discovery/mcp.json — MCP manifest for agent-to-agent discovery
  // GET /discovery          — Human-readable discovery landing page
  app.use(viralRouter);

  // ── Quality Score Card API ───────────────────────────────────────
  app.use('/api/quality', qualityRouter);

  // ── Benchmarks API (public) ──────────────────────────────────────
  app.use('/api/benchmarks', benchmarksRouter);

  // ── PLG self-serve onboarding API ─────────────────────────────────
  app.use('/plg', plgRouter);

  // ── Pricing API (public) ─────────────────────────────────────────
  app.use('/api/pricing', pricingRouter);

  // ── Preview API (public, no auth) ────────────────────────────────
  const { previewRouter } = await import('./routes/preview.js');
  app.use('/api/v1', previewRouter);

  // KPI Dashboard API
  app.use('/api/kpi', kpiRouter);

  // Agent Performance Analytics API
  app.use('/api/analytics', analyticsRouter);

  // Pipeline Run History API
  app.use('/api/history', pipelineHistoryRouter);

  // SAML 2.0 SSO routes (optional)
  try {
    const { default: samlRouter } = await import('./routes/saml.js');
    app.use('/api/v1/saml', samlRouter);
  } catch {
    log.warn('SAML routes not available');
  }

  // Enterprise routes (optional)
  try {
    const { default: enterpriseRouter } = await import('./routes/enterprise.js');
    app.use('/api/v1/enterprise', enterpriseRouter);
  } catch {
    log.warn('Enterprise routes not available');
  }

  // ── Preview API (public, rate-limited per IP) ──────────────────────────
  // POST /api/v1/preview — Demo preview of fixable issues
  app.use('/api/v1/preview', previewRoutes);

  app.use('/api', pipelineRouter);
  // -- 404 handler ----------------------------------------------------------

  app.use((req: Request, res: Response) => {
    res.status(404).json({
      error: { code: 'NOT_FOUND', message: 'Not found', correlation_id: req.requestId },
    });
  });

  // -- Global error handler -------------------------------------------------
  app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
    log.error({ err: String(err), requestId: req.requestId }, 'Unhandled error');
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error', correlation_id: req.requestId },
    });
  });

  return app;
}

/**
 * Start the Express server on the configured port.
 * Returns the server instance so callers can close it during graceful shutdown.
 */
export async function startServer(): Promise<import('http').Server> {
  const app = await createApp();

  const server = app.listen(config.port, '0.0.0.0', async () => {
    log.info(
      { port: config.port, label: config.stas.label, env: config.nodeEnv },
      `STAS server listening on :${config.port}`,
    );

    // Start the RabbitMQ issue consumer
    try {
      const { consumeQueue } = await import('./queue/rabbitmq.js');
      const { runIssueAgent } = await import('./agent/issueAgent.js');
      await consumeQueue(QUEUES.issuesFix.name, async (msg) => {
        if (!msg) return;
        const content = msg.content.toString();
        let data: IssueJobData;
        try {
          data = JSON.parse(content) as IssueJobData;
        } catch {
          log.error({ content }, 'Failed to parse RabbitMQ message');
          return;
        }
        try {
          await runIssueAgent(data);
        } catch (err) {
          log.error({ err: String(err) }, 'Issue agent run failed');
        }
      });
      log.info('RabbitMQ issue consumer started');
    } catch (err) {
      log.error({ err: String(err) }, 'Failed to start RabbitMQ issue consumer');
    }
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

// Extend Express Request to include requestId
declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}
