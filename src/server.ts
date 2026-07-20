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
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import type { EmitterWebhookEventName } from '@octokit/webhooks';
import type { NextFunction, Request, Response } from 'express';
import express from 'express';

import cors from 'cors';
import helmet from 'helmet';
import { ipAllowlistMiddleware } from './security/ipAllowlist.js';
import { rateLimitMiddleware } from './ratelimit/middleware.js';
import { config } from './config.js';
import { getSlackBoltApp } from './notifications/slack-bolt.js';
import { registerSlackMentionHandler } from './channels/slack/handler.js';
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
import { teamRouter } from './team/routes.js';
import { initWizardStore } from './onboarding/wizard.js';
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
import { adminRunsRouter } from './routes/adminRuns.js';
import { kpiRouter } from './routes/kpi.js';
import healthRouter from './routes/health.js';
import { pipelineHistoryRouter } from './history/pipelineHistoryApi.js';
import { proxyRouter } from './routes/proxy.js';
import { approvalRouter, configureApprovalGate } from "./middleware/approvalGate.js";
import { streamAuditExportCsv, streamAuditExportJson } from "./audit/export.js";
import { de } from "./i18n/de.js";
import { workspaceRouter } from "./routes/workspace.js";

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
  }));

  // -- Health check route (consolidated) -----------------------------------
  app.get('/health', async (_req: Request, res: Response) => {
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
    try {
      const { isConnected } = await import('./queue/rabbitmq.js');
      checks.rabbitmq = isConnected() ? 'ok' : 'down';
    } catch { checks.rabbitmq = 'down'; }
    const allOk = Object.values(checks).every(v => v === 'ok');
    res.status(allOk ? 200 : 503).json({ status: allOk ? 'ok' : 'degraded', checks, timestamp: new Date().toISOString(), aiMode: config.stas.aiDisabled ? 'ai-disabled' : 'enabled' });
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
  registerSlackMentionHandler(bolt.app);

  // -- Initialize trackers --------------------------------------------------
  initTrackers();

  // ── Initialize metering ───────────────────────────────────────────
  initMetering();

  // ── Initialize onboarding wizard store ───────────────────────────
  initWizardStore();

  // ── DACH Market: Register German locale ────────────────────────────
  app.locals.locales = app.locals.locales || {};
  app.locals.locales["de-DE"] = de;
  app.locals.defaultLocale = "de-DE";

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
          name: event as any,
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
    const result = verifyWhatsAppWebhook(req as any);
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

  // -- MCP agent server (JSON-RPC protocol for AI agent discovery)
  const { default: agentServerRouter } = await import('./mcp/agentServer.js');
  app.use(agentServerRouter);

  // -- Health check endpoints --------------------------------------------------
  app.use(healthRouter);

  // -- Feature flags admin API ------------------------------------------------
  app.use('/api/v1/admin/feature-flags', featureFlagsRouter);

  // ── Admin API ────────────────────────────────────────
  app.use('/admin', adminRouter);

  // ── Admin Runs API (AI-Disabled Mode) ────────────
  app.use('/api/v1/admin', adminRunsRouter);

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

  // ── Team Management API ───────────────────────────────────────────
  // POST   /api/teams                          — Create a new team
  // GET    /api/teams                          — List teams for current account
  // GET    /api/teams/:id                       — Get team details with members
  // POST   /api/teams/:id/invite               — Invite a member
  // POST   /api/teams/:id/members/:userId/role  — Change member role
  // DELETE /api/teams/:id/members/:userId       — Remove member
  app.use('/api/teams', teamRouter);

  // Repos API (repo picker with webhook status)
  app.use('/api/repos', reposRouter);

  // ── Shareable run page API (public, no auth) ───────────────────────
  // GET /api/runs/:id — Public run detail JSON/HTML
  app.use('/api/runs', runsRouter);

  // ── Dashboard SPA (served from built dist/) ───────────────────────
  app.use('/dashboard', express.static(path.join(__dirname, '../../dashboard/dist')));
  app.get('/dashboard/*', (_req: Request, res: Response) => {
    res.sendFile(path.join(__dirname, '../../dashboard/dist/index.html'));
  });

  // ── Badge endpoint (public, no auth) ──────────────────────────────
  // GET /badge/:id.svg — shields.io-compatible status badge
  app.use('/badge', badgeRouter);

  // ── Viral discovery endpoints (public, no auth) ───────────────────
  // GET /discovery/mcp.json — MCP manifest for agent-to-agent discovery
  // GET /discovery          — Human-readable discovery landing page
  app.use(viralRouter);

  // ── MCP Well-Known Discovery (agent detection) ────────────────────
  // GET /.well-known/mcp-server-card.json — AI agent auto-discovery card
  // GET /.well-known/mcp/server-card.json — Alternative path
  // Serves the MCP server card so AI agents can discover STAS autonomously.
  app.get('/.well-known/mcp-server-card.json', (_req: Request, res: Response) => {
    const baseUrl = process.env.STAS_PUBLIC_URL || `${_req.protocol}://${_req.get('host')}`;
    const sseUrl = process.env.STAS_MCP_SERVER_URL
      ? `${process.env.STAS_MCP_SERVER_URL}/sse`
      : `${baseUrl}/sse`;
    const mcpUrl = process.env.STAS_MCP_SERVER_URL
      ? `${process.env.STAS_MCP_SERVER_URL}/mcp`
      : `${baseUrl}/mcp`;

    const card = {
      schemaVersion: '2024-11-05',
      server: {
        name: '@aimino/stas-mcp',
        version: '1.0.0',
        description:
          'STAS (Solving Tickets As A Service) — label a GitHub issue and get a pull request. Open-source AI bot backed by OpenCode.',
        homepage: 'https://github.com/tamnguyen08/solving_tickets_as_a_service',
        documentation: 'https://github.com/tamnguyen08/solving_tickets_as_a_service/blob/main/docs/ARCHITECTURE.md',
        license: 'MIT',
        author: { name: 'Aimino Tech', email: 'team@aimino.io', url: 'https://stas.aimino.io' },
      },
      capabilities: {
        tools: {
          stas_label_issue: {
            description: 'Label a GitHub issue with the STAS fix label. Triggers the fix pipeline.',
            inputSchema: {
              type: 'object',
              properties: {
                owner: { type: 'string', description: 'Repository owner' },
                repo: { type: 'string', description: 'Repository name' },
                issue_number: { type: 'integer', description: 'Issue number' },
                label: { type: 'string', description: 'Label to apply (default: stas:fix)' },
              },
              required: ['owner', 'repo', 'issue_number'],
            },
          },
          stas_run_fix: {
            description: 'Trigger the STAS fix pipeline for a GitHub issue URL.',
            inputSchema: {
              type: 'object',
              properties: { issue_url: { type: 'string', description: 'Full GitHub issue URL' } },
              required: ['issue_url'],
            },
          },
          stas_check_status: {
            description: 'Check status of a STAS fix run by run_id.',
            inputSchema: {
              type: 'object',
              properties: { run_id: { type: 'string', description: 'Run ID from stas_run_fix' } },
              required: ['run_id'],
            },
          },
          stas_get_pr: {
            description: 'Get PR URL and details for a completed fix run.',
            inputSchema: {
              type: 'object',
              properties: { run_id: { type: 'string', description: 'Run ID from stas_run_fix' } },
              required: ['run_id'],
            },
          },
        },
        resources: {
          'stas://runs/{run_id}': { description: 'Full run details with status, PR link, and test results.' },
          'stas://issues/{issue_id}': { description: 'Issue details with fix status, run history, and linked PRs.' },
          'stas://status': { description: 'Server health and capability overview.' },
          'stas://queue': { description: 'Current fix queue depth and status.' },
        },
      },
      transports: [
        { type: 'sse', url: sseUrl, description: 'Server-Sent Events transport' },
        { type: 'streamable-http', url: mcpUrl, description: 'Streamable HTTP transport' },
        {
          type: 'stdio',
          command: 'npx',
          args: ['-y', '@aimino/stas-mcp'],
          description: 'Stdio transport via npx',
        },
      ],
      install: {
        opencode: {
          config: { name: 'stas-agent', transport: 'stdio', command: 'npx', args: ['-y', '@aimino/stas-mcp'] },
        },
        claudeDesktop: {
          config: { mcpServers: { stas: { command: 'npx', args: ['-y', '@aimino/stas-mcp'] } } },
        },
        cursor: {
          config: { mcpServers: { stas: { command: 'npx', args: ['-y', '@aimino/stas-mcp'] } } },
        },
      },
      keywords: [
        'stas', 'github-bot', 'issue-fixer', 'automated-fix',
        'opencode', 'mcp', 'smithery', 'aimino', 'agent-discovery', 'agent-to-agent',
      ],
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json(card);
  });

  // GET /.well-known/mcp/server-card.json — Alternative MCP discovery path
  app.get('/.well-known/mcp/server-card.json', (_req: Request, res: Response) => {
    res.redirect(301, '/.well-known/mcp-server-card.json');
  });

  // GET /badge/agent-found.svg — "Agent Found STAS" badge for repo READMEs
  app.get('/badge/agent-found.svg', (_req: Request, res: Response) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="138" height="20" role="img" aria-label="Agent Found: STAS">
  <title>Agent Found: STAS</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r">
    <rect width="138" height="20" rx="3" fill="#fff"/>
  </clipPath>
  <g clip-path="url(#r)">
    <rect width="90" height="20" fill="#555"/>
    <rect x="90" width="48" height="20" fill="#8250DF"/>
    <rect width="138" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    <text x="45" y="15" fill="#010101" fill-opacity=".3">Agent Found</text>
    <text x="45" y="14">Agent Found</text>
    <text x="114" y="15" fill="#010101" fill-opacity=".3">STAS</text>
    <text x="114" y="14">STAS</text>
  </g>
</svg>`;
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(svg);
  });

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

    // ── Workspace Management API (AIM-3321) ──────────────────────────
  //   GET    /api/workspace              — List workspaces
  //   GET    /api/workspace/plans        — List pricing plans
  //   POST   /api/workspace/calculate-cost — Calculate workspace cost
  //   GET    /api/workspace/:id/status   — Workspace status
  //   POST   /api/workspace              — Create workspace (self-serve)
  //   POST   /api/workspace/:id/setup    — Automated Slack/RabbitMQ/DB setup
  //   DELETE /api/workspace/:id          — Cleanup workspace
  app.use('/api/workspace', workspaceRouter);

  // SAML 2.0 SSO routes (optional)
  try {
    const { default: samlRouter } = await import('./routes/saml.js');
    app.use('/api/v1/saml', samlRouter);
  } catch {
    log.warn('SAML routes not available');
  }

  // Enterprise routes (optional)
  try {
    const enterpriseModule = await import('./routes/enterprise.js');
    const enterpriseRouter = (enterpriseModule as any).default || enterpriseModule;
    app.use('/api/v1/enterprise', enterpriseRouter);
  } catch {
    log.warn('Enterprise routes not available');
  }

  app.get('/metrics', async (_req: Request, res: Response) => {
    const { bridgeMetrics } = await import('./bridge/metrics.js');
    const metrics = bridgeMetrics.render();
    res.type('text/plain; version=0.0.4').send(metrics);
  });

  app.get('/github-app-manifest.json', (_req: Request, res: Response) => {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    res.sendFile(path.join(__dirname, '..', 'public', 'github-app-manifest.json'), (err) => {
      if (err) res.status(404).json({ error: 'Manifest not found' });
    });
  });

  app.use('/api/v1/preview', previewRoutes);
  // ── Proxy API ──────────────────────────────────────────────
  app.use('/api/v1/proxy', proxyRouter);

  app.use('/api', pipelineRouter);

  // ── DACH Market: Configure approval gate ───────────────────────────
  configureApprovalGate({
    enabled: process.env.APPROVAL_GATE_ENABLED === "true",
    requiredOrgs: (process.env.APPROVAL_REQUIRED_ORGS || "").split(",").map((s) => s.trim()).filter(Boolean),
    requiredRepos: (process.env.APPROVAL_REQUIRED_REPOS || "").split(",").map((s) => s.trim()).filter(Boolean),
    triggerLabels: (process.env.APPROVAL_TRIGGER_LABELS || "production,stas:fix:approval").split(",").map((s) => s.trim()).filter(Boolean),
  });

  // ── DACH Market: Approval gate API ────────────────────────────────
  // GET    /api/approvals/pending     — List pending approvals
  // POST   /api/approvals/:id/approve — Approve a pending dispatch
  // POST   /api/approvals/:id/reject  — Reject a pending dispatch
  // GET    /api/approvals/config      — Get approval gate config
  app.use("/api", approvalRouter);

  // ── DACH Market: Audit export (GDPR-compliant) ────────────────────
  // GET /api/admin/audit/export?format=csv — Export audit logs as CSV
  // GET /api/admin/audit/export?format=json — Export audit logs as JSON
  app.get("/api/admin/audit/export", async (req, res) => {
    if (req.query.format === "json") {
      await streamAuditExportJson(res, req.query);
    } else {
      await streamAuditExportCsv(res, req.query);
    }
  });
  // ── Workspace Management API (AIM-3321) ──────────────────────────
  //   GET    /api/workspace              — List workspaces
  //   GET    /api/workspace/plans        — List pricing plans
  //   POST   /api/workspace/calculate-cost — Calculate workspace cost
  //   GET    /api/workspace/:id/status   — Workspace status
  //   POST   /api/workspace              — Create workspace (self-serve)
  //   POST   /api/workspace/:id/setup    — Automated Slack/RabbitMQ/DB setup
  //   DELETE /api/workspace/:id          — Cleanup workspace
  app.use('/api/workspace', workspaceRouter);

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
  log.error({ err: String(reason), stack: (reason as Error)?.stack }, 'Unhandled promise rejection');
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
