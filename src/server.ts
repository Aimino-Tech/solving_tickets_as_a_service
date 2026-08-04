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
 * - express-async-errors patches Express Router to forward async rejections
 *   to the global error middleware (prevents unhandled promise rejections)
 * - Global Express error middleware (4-arg handler) at bottom of chain
 * - Process-level uncaughtException and unhandledRejection handlers
 * - unhandledRejection handler calls process.exit(1) (prevents silent failure)
 * - app.listen() error event handled (EADDRINUSE, EACCES, etc.)
 * - Server instance returned for graceful shutdown by caller
 * - Request ID middleware for log correlation
 * ---------------------------------------------------------------------------
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import 'express-async-errors';
import type { EmitterWebhookEventName } from '@octokit/webhooks';
import cors from 'cors';
import type { NextFunction, Request, Response } from 'express';
import express, { Router } from 'express';
import helmet from 'helmet';
import { initAnalytics } from './analytics/tracker.js';
import previewRoutes from './api/routes/preview.js';
import { trustRouter } from './api/routes/trust.js';
import { streamAuditExportCsv, streamAuditExportJson } from './audit/export.js';
import { authRouter } from './auth/index.js';
import { oauthRouter } from './auth/oauth.js';
import { billingRouter } from './billing/index.js';
import { registerSlackMentionHandler } from './channels/slack/handler.js';
import { config } from './config.js';
import { pipelineHistoryRouter } from './history/pipelineHistoryApi.js';
import { de } from './i18n/de.js';
import { initMetering, usageRouter } from './metering/index.js';
import { approvalRouter, configureApprovalGate } from './middleware/approvalGate.js';
import { maintenanceMode } from './middleware/maintenance.js';
import { captureError, setupSentryExpressErrorHandler } from './monitoring/sentry.js';
import { getSlackBoltApp } from './notifications/slack-bolt.js';
import { initWizardStore } from './onboarding/wizard.js';
import { isConnected, publishMessage, QUEUES, connect as rmqConnect } from './queue/rabbitmq.js';
import { rateLimitMiddleware } from './ratelimit/middleware.js';
import { adminRouter } from './routes/admin.js';
import { adminAuditRouter } from './routes/admin_audit.js';
import { adminRunsRouter } from './routes/adminRuns.js';
import { adminWebhooksRouter } from './routes/adminWebhooks.js';
import { analyticsRouter } from './routes/analytics.js';
import { badgeRouter } from './routes/badge.js';
import { benchmarksRouter } from './routes/benchmarks.js';
import { configRouter, dashboardRouter } from './routes/dashboard.js';
import { dpaRouter } from './routes/dpa.js';
import { featureFlagsRouter } from './routes/featureFlags.js';
import { gitHubOAuthRouter } from './routes/githubOAuth.js';
import healthRouter from './routes/health.js';
import { kpiRouter } from './routes/kpi.js';
import { linearOAuthRouter } from './routes/linearOAuth.js';
import { litellmUsageRouter } from './routes/litellmUsage.js';
import mcpKeysRouter from './routes/mcpKeys.js';
import n8nRouter from './routes/n8n.js';
import { notificationsRouter } from './routes/notifications.js';
import { onboardingRouter } from './routes/onboarding.js';
import { pipelineRouter } from './routes/pipeline.js';
import { plgRouter } from './routes/plg.js';
import { pricingRouter } from './routes/pricing.js';
import { proxyRouter } from './routes/proxy.js';
import { qualityRouter } from './routes/quality.js';
import { reposRouter } from './routes/repos.js';
import { runFeedbackRouter } from './routes/runFeedback.js';
import { runsRouter } from './routes/runs.js';
import { runsApiRouter } from './routes/runsApi.js';
import { slaRouter } from './routes/sla.js';
import { viralRouter } from './routes/viral.js';
import { workspaceRouter } from './routes/workspace.js';
import { ipAllowlistMiddleware } from './security/ipAllowlist.js';
import { createStripeWebhookHandler } from './stripe/index.js';
import { teamRouter } from './team/routes.js';
import { getTracker, initTrackers } from './trackers/index.js';
import { handleJiraWebhook, verifyJiraWebhookSignature } from './trackers/jira.js';
import { handleLinearWebhook, verifyLinearWebhookSignature } from './trackers/linear.js';
import { rootLogger } from './utils/logger.js';
import { extractOrGenerateTraceId, runWithTraceId, TRACE_HEADER } from './utils/trace.js';
import type { IssueJobData } from './utils/types.js';
import { createBitbucketWebhooks } from './webhooks/bitbucket.js';
import { logWebhookFailed, logWebhookProcessed, logWebhookReceived } from './webhooks/eventLogger.js';
import { createGithubWebhooks } from './webhooks/github.js';
import { createGitlabWebhooks } from './webhooks/gitlab.js';
import { recordWebhookDuration } from './webhooks/metrics.js';
import { startWebhookRetryWorker } from './webhooks/retryWorker.js';

const log = rootLogger.child({ module: 'server' });

export async function createApp(): Promise<express.Application> {
  const app = express();

  // -- Request ID + Trace ID middleware -------------------------------------
  app.use((req: Request, res: Response, next: NextFunction) => {
    const requestId = (req.headers['x-request-id'] as string) || crypto.randomUUID();
    req.requestId = requestId;
    res.setHeader('x-request-id', requestId);

    // Generate or extract trace ID for cross-system correlation
    const traceId = extractOrGenerateTraceId(req.headers as Record<string, string | string[] | undefined>);
    req.traceId = traceId;
    res.setHeader(TRACE_HEADER, traceId);

    runWithTraceId(traceId, () => next());
  });

  // -- Security headers (Helmet) -------------------------------------------
  // Sets various HTTP headers for security: CSP, X-Frame-Options,
  // X-Content-Type-Options, Strict-Transport-Security, etc.
  app.use(helmet());

  // -- CORS -----------------------------------------------------------------
  app.use(
    cors({
      origin: config.security.corsOrigin === '*' ? '*' : config.security.corsOrigin.split(',').map((s) => s.trim()),
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-key', 'x-api-key', 'x-request-id'],
      exposedHeaders: ['x-request-id'],
    }),
  );

  // -- Health check route (consolidated, handled by health router) ----------
  // GET /health, /health/verbose, /health/queue, /health/dependencies
  // are mounted via healthRouter below.

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

  // -- Slack chat gateway (AIM-4442) — route inbound DMs through it ----------
  if (bolt.app && config.slack.chatEnabled) {
    try {
      const { registerSlackChatHandler } = await import('./channels/slack/chat.js');
      const { ChatGateway } = await import('./chat/gateway.js');
      const { createSessionStore } = await import('./chat/sessionStore.js');
      registerSlackChatHandler(bolt.app, {
        gateway: new ChatGateway(createSessionStore('postgres')),
      });
      log.info('Slack chat gateway enabled (SLACK_CHAT_ENABLED)');
    } catch (err) {
      log.error({ err: String(err) }, 'Failed to initialize Slack chat gateway');
    }
  }

  // Start Slack Socket Mode connection (no-op for HTTP mode)
  bolt.start().catch((err: unknown) => log.warn({ err: String(err) }, 'Slack Bolt start failed'));

  // -- Initialize trackers --------------------------------------------------
  initTrackers();

  // ── Initialize metering ───────────────────────────────────────────
  initMetering();

  // ── Initialize analytics ────────────────────────────────────────
  initAnalytics();

  // ── Initialize onboarding wizard store ───────────────────────────
  initWizardStore();

  // ── DACH Market: Register German locale ────────────────────────────
  app.locals.locales = app.locals.locales || {};
  app.locals.locales['de-DE'] = de;
  app.locals.defaultLocale = 'de-DE';

  // ── Start webhook retry worker ────────────────────────────────────
  // Only start if we're running as API or both
  if (config.runMode === 'api' || config.runMode === 'both') {
    startWebhookRetryWorker();
  }

  // ── Webhook receiver ─────────────────────────────────────────────
  // OpenSymphony dispatch function for webhook handlers
  async function enqueueIssue(data: IssueJobData): Promise<string | undefined> {
    const { guardIssueJobData } = await import('./guardrails/commonSenseGate.js');
    const gate = guardIssueJobData(data);
    if (!gate.passed) {
      const detail = gate.checks
        .filter((c) => !c.valid)
        .map((c) => `${c.check}: ${c.error ?? 'invalid'}`)
        .join('; ');
      log.warn(
        { repo: `${data.repoOwner}/${data.repoName}`, issueNumber: data.issueNumber, detail },
        'Common-sense gate rejected issue — not dispatching',
      );
      return undefined;
    }
    const { dispatchToOpenSymphony } = await import('./dispatch/osDispatch.js');
    const result = await dispatchToOpenSymphony(data);
    if (result.success) {
      log.info({ runId: result.runId }, 'Dispatched issue to OpenSymphony');
      return result.runId;
    }
    log.error({ errors: result.errors }, 'Failed to dispatch issue to OpenSymphony');
    return undefined;
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
      // No signature — fail closed
      log.warn('GitHub webhook signature missing — rejecting');
      if (eventId) await logWebhookFailed(eventId, 'Signature missing');
      res.status(401).json({ error: 'Signature required' });
      return;
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

    if (!config.gitlab.webhookSecret) {
      log.error('GITLAB_WEBHOOK_SECRET not configured — cannot verify webhook');
      if (eventId) await logWebhookFailed(eventId, 'Webhook secret not configured');
      res.status(500).json({ error: 'Webhook secret not configured' });
      return;
    }
    {
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
    try {
      const { handleTelegramWebhook } = await import('./channels/telegram.js');
      const result = await handleTelegramWebhook(payload);
      res.status(result.ok ? 200 : 500).json(result);
    } catch (err) {
      log.error({ err: String(err) }, 'Telegram webhook handler error');
      res.status(500).json({ ok: false, error: 'Internal error' });
    }
  });

  app.get('/webhook/whatsapp', async (req: Request, res: Response) => {
    try {
      const { verifyWhatsAppWebhook } = await import('./channels/whatsapp.js');
      const result = verifyWhatsAppWebhook(req as any);
      if (result.verified && result.challenge) {
        res.type('text/plain').send(result.challenge);
      } else {
        res.status(403).send('Verification failed');
      }
    } catch (err) {
      log.error({ err: String(err) }, 'WhatsApp webhook verification error');
      res.status(500).send('Verification error');
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
    try {
      const { handleWhatsAppWebhook } = await import('./channels/whatsapp.js');
      const result = await handleWhatsAppWebhook(payload);
      res.status(result.ok ? 200 : 500).json(result);
    } catch (err) {
      log.error({ err: String(err) }, 'WhatsApp webhook handler error');
      res.status(500).json({ ok: false, error: 'Internal error' });
    }
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
        next2(err as Error);
        return;
      }
      recordWebhookDuration(source, Date.now() - startTime);
    };

    await wrappedHandler(req, res, () => {});
  });

  // -- MCP server routes (OpenClaw multi-channel API)
  let mcpRouter: Router;
  try {
    const mod = await import('./routes/mcp.js');
    mcpRouter = mod.default;
  } catch (err) {
    log.warn({ err: String(err) }, 'Failed to load MCP routes — using empty router');
    mcpRouter = Router();
  }
  app.use(mcpRouter);

  // -- MCP agent discovery routes (FastMCP integration)
  let mcpDiscoveryRouter: Router;
  try {
    const mod = await import('./mcp.js');
    mcpDiscoveryRouter = mod.default;
  } catch (err) {
    log.warn({ err: String(err) }, 'Failed to load MCP discovery routes — using empty router');
    mcpDiscoveryRouter = Router();
  }
  app.use(mcpDiscoveryRouter);

  // -- MCP agent server (JSON-RPC protocol for AI agent discovery)
  let agentServerRouter: Router;
  try {
    const mod = await import('./mcp/agentServer.js');
    agentServerRouter = mod.default;
  } catch (err) {
    log.warn({ err: String(err) }, 'Failed to load MCP agent server routes — using empty router');
    agentServerRouter = Router();
  }
  app.use(agentServerRouter);

  // -- Maintenance mode gate ----------------------------------------------------
  // Returns 503 while maintenance mode is enabled; health, auth and webhook
  // paths stay open so checks and event ingestion keep working.
  app.use(maintenanceMode);

  // -- Health check endpoints --------------------------------------------------
  app.use(healthRouter);

  // ── Monitoring Loop Status ────────────────────────────────────────
  // GET /api/monitoring/status — Monitoring loop stats (JSON)
  // GET /monitoring           — Monitoring dashboard (HTML)
  app.get('/api/monitoring/status', async (_req: Request, res: Response) => {
    try {
      const mod = await import('./loops/monitoringLoop.js');
      const stats = mod.monitoringLoop?.getStats();
      if (!stats) {
        res.json({ status: 'not_started' });
        return;
      }
      res.json({
        status: stats.enabled ? (stats.running ? 'running' : 'idle') : 'disabled',
        ...stats,
      });
    } catch {
      res.json({ status: 'error', message: 'Monitoring loop module not available' });
    }
  });
  app.get('/monitoring', async (_req: Request, res: Response) => {
    try {
      const mod = await import('./routes/monitoringUi.js');
      res.send(mod.html);
    } catch {
      res.status(500).send('Monitoring UI not available');
    }
  });

  // -- Feature flags admin API ------------------------------------------------
  app.use('/api/v1/admin/feature-flags', featureFlagsRouter);

  // ── Admin API ────────────────────────────────────────
  app.use('/admin', adminRouter);

  // ── Admin Runs API (AI-Disabled Mode) ────────────
  app.use('/api/v1/admin', adminRunsRouter);

  app.use('/api/admin/audit', adminAuditRouter);

  // ── Dashboard API ──────────────────────────────────────
  app.use('/api/v1/me', dashboardRouter);

  // ── Config API ──────────────────────────────────────────
  app.use('/api/v1/config', configRouter);

  // ── MCP API Keys (per-user agent keys) ─────────────────────
  app.use('/api/v1/mcp-keys', mcpKeysRouter);

  // ── Stats & Audit API ──────────────────────────────────
  const { statsRouter, auditRouter } = await import('./routes/statsAndAudit.js');
  app.use('/api/v1/stats', statsRouter);
  app.use('/api/v1/audit', auditRouter);

  // ── DPA API ──────────────────────────────────────────────
  app.use('/api/v1/billing', dpaRouter);
  // ── Billing API (subscriptions, plans, checkout) ─────────
  app.use('/api/v1/billing', billingRouter);

  // ── Auth API (JWT) — MUST be before /api/v1 catch-all routers ────────
  app.use('/api/v1/auth', authRouter);

  // GitHub OAuth — before /api/v1 catch-all to avoid requireAuth conflict
  app.use('/api/v1/auth/github', gitHubOAuthRouter);
  app.use('/api/v1/auth/linear', linearOAuthRouter);

  // Social OAuth (Google + Microsoft via Supabase) — before /api/v1 catch-all
  app.use('/api/v1/auth/oauth', oauthRouter);

  // Privacy API (GDPR: erasure, portability, consent, anonymization)
  const { default: privacyRouter } = await import('./routes/privacy.js');
  app.use('/api/v1/privacy', privacyRouter);

  // Invites API (invite-by-email)
  const { inviteRouter } = await import('./routes/invites.js');
  app.use('/api/v1/invites', inviteRouter);

  app.use('/api/v1', slaRouter);

  // ── Credits API ──────────────────────────────────────────
  // GET  /api/v1/credits/balance
  // GET  /api/v1/credits/transactions
  // POST /api/v1/credits/top-up
  // GET  /api/v1/credits/usage
  let creditRouter: Router;
  try {
    const mod = await import('./credits/index.js');
    creditRouter = mod.creditRouter;
  } catch (err) {
    log.warn({ err: String(err) }, 'Failed to load credits API — using empty router');
    creditRouter = Router();
  }
  app.use('/api/v1', creditRouter);

  // ── Usage metering API ──────────────────────────────────────────
  app.use('/api/v1/credits/usage', usageRouter);

  app.use('/api/v1', litellmUsageRouter);

  // ── Admin webhooks API ──────────────────────────────────────────
  // GET /admin/webhooks (paginated, filterable)
  // POST /admin/webhooks/:id/replay
  // POST /admin/webhooks/replay-range
  // GET /admin/webhooks/sources
  // GET /admin/webhooks/stats
  app.use('/admin/webhooks', adminWebhooksRouter);

  // ── Onboarding API ──────────────────────────────────────────────
  app.use('/api/v1/onboarding', onboardingRouter);

  // ── Notifications API ────────────────────────────────────────────
  // GET    /api/v1/notifications/preferences         — List user preferences
  // PUT    /api/v1/notifications/preferences         — Upsert preference
  // GET    /api/v1/notifications/history             — List notification history
  // PUT    /api/v1/notifications/history/:id/read    — Mark one as read
  // PUT    /api/v1/notifications/history/read-all    — Mark all as read
  app.use('/api/v1/notifications', notificationsRouter);

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

  // GitHub Installation & Webhook Management
  const { githubRouter } = await import('./routes/github.js');
  app.use('/api/v1/github', githubRouter);

  // ── Shareable run page API (public, no auth) ───────────────────────
  // GET /api/runs/:id — Public run detail JSON/HTML
  app.use('/api/runs', runsRouter);

  // ── Dashboard SPA (served from built dist/) ───────────────────────
  // Served at root `/` — all routes except /api/* and /health go to dashboard
  // Resolve dashboard/dist robustly: local tsc emits to <repo>/dist (so
  // __dirname = <repo>/dist), while Vercel's @vercel/node places included
  // files at the function root (__dirname = <repo>).
  const dashboardDist =
    [path.join(__dirname, '../dashboard/dist'), path.join(__dirname, 'dashboard/dist')].find((p) =>
      fs.existsSync(path.join(p, 'index.html')),
    ) ?? path.join(__dirname, '../dashboard/dist');
  const viteDevUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
  if (fs.existsSync(path.join(dashboardDist, 'index.html'))) {
    app.use(express.static(dashboardDist));
    app.get('*', (req: Request, res: Response, next: NextFunction) => {
      if (req.path.startsWith('/api/') || req.path.startsWith('/health')) {
        next();
        return;
      }
      res.sendFile(path.join(dashboardDist, 'index.html'));
    });
  } else {
    log.info({ viteDevUrl }, 'dashboard/dist not found — proxying to Vite dev server');
    app.use((req: Request, res: Response, next: NextFunction) => {
      // Don't proxy API, health, badge or other backend routes
      if (
        req.path.startsWith('/api/') ||
        req.path.startsWith('/health') ||
        req.path.startsWith('/badge/') ||
        req.path.startsWith('/discovery') ||
        req.path.startsWith('/.well-known')
      ) {
        next();
        return;
      }
      const targetUrl = `${viteDevUrl}${req.originalUrl}`;
      const proxyReq = http.request(targetUrl, { method: req.method, headers: req.headers }, (proxyRes) => {
        res.writeHead(proxyRes.statusCode!, proxyRes.headers);
        proxyRes.pipe(res);
      });
      proxyReq.on('error', (err) => {
        log.error({ err: String(err), targetUrl }, 'Vite dev proxy error');
        res.status(502).send('Dashboard not available — is Vite dev server running?');
      });
      if (req.body) {
        proxyReq.write(JSON.stringify(req.body));
      }
      proxyReq.end();
    });
  }

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
  // Serves the MCP server card so AI agents can discover SYNTARO autonomously.
  app.get('/.well-known/mcp-server-card.json', (_req: Request, res: Response) => {
    const baseUrl = process.env.SYNTARO_PUBLIC_URL || `${_req.protocol}://${_req.get('host')}`;
    const sseUrl = process.env.SYNTARO_MCP_SERVER_URL ? `${process.env.SYNTARO_MCP_SERVER_URL}/sse` : `${baseUrl}/sse`;
    const mcpUrl = process.env.SYNTARO_MCP_SERVER_URL ? `${process.env.SYNTARO_MCP_SERVER_URL}/mcp` : `${baseUrl}/mcp`;

    const card = {
      schemaVersion: '2024-11-05',
      server: {
        name: '@aimino/syntaro-mcp',
        version: '1.0.0',
        description:
          'SYNTARO (Solving Tickets As A Service) — label a GitHub issue and get a pull request. Open-source AI bot for automated bug fixing.',
        homepage: 'https://github.com/tamnguyen08/solving_tickets_as_a_service',
        documentation: 'https://github.com/tamnguyen08/solving_tickets_as_a_service/blob/main/docs/ARCHITECTURE.md',
        license: 'MIT',
        author: { name: 'Aimino Tech', email: 'team@aimino.io', url: 'https://syntaro.io' },
      },
      capabilities: {
        tools: {
          syntaro_label_issue: {
            description: 'Label a GitHub issue with the SYNTARO fix label. Triggers the fix pipeline.',
            inputSchema: {
              type: 'object',
              properties: {
                owner: { type: 'string', description: 'Repository owner' },
                repo: { type: 'string', description: 'Repository name' },
                issue_number: { type: 'integer', description: 'Issue number' },
                label: { type: 'string', description: 'Label to apply (default: syntaro:fix)' },
              },
              required: ['owner', 'repo', 'issue_number'],
            },
          },
          syntaro_run_fix: {
            description: 'Trigger the SYNTARO fix pipeline for a GitHub issue URL.',
            inputSchema: {
              type: 'object',
              properties: { issue_url: { type: 'string', description: 'Full GitHub issue URL' } },
              required: ['issue_url'],
            },
          },
          syntaro_check_status: {
            description: 'Check status of a SYNTARO fix run by run_id.',
            inputSchema: {
              type: 'object',
              properties: { run_id: { type: 'string', description: 'Run ID from syntaro_run_fix' } },
              required: ['run_id'],
            },
          },
          syntaro_get_pr: {
            description: 'Get PR URL and details for a completed fix run.',
            inputSchema: {
              type: 'object',
              properties: { run_id: { type: 'string', description: 'Run ID from syntaro_run_fix' } },
              required: ['run_id'],
            },
          },
        },
        resources: {
          'syntaro://runs/{run_id}': { description: 'Full run details with status, PR link, and test results.' },
          'syntaro://issues/{issue_id}': { description: 'Issue details with fix status, run history, and linked PRs.' },
          'syntaro://status': { description: 'Server health and capability overview.' },
          'syntaro://queue': { description: 'Current fix queue depth and status.' },
        },
      },
      transports: [
        { type: 'sse', url: sseUrl, description: 'Server-Sent Events transport' },
        { type: 'streamable-http', url: mcpUrl, description: 'Streamable HTTP transport' },
        {
          type: 'stdio',
          command: 'npx',
          args: ['-y', '@aimino/syntaro-mcp'],
          description: 'Stdio transport via npx',
        },
      ],
      install: {
        opencode: {
          config: { name: 'syntaro-agent', transport: 'stdio', command: 'npx', args: ['-y', '@aimino/syntaro-mcp'] },
        },
        claudeDesktop: {
          config: { mcpServers: { syntaro: { command: 'npx', args: ['-y', '@aimino/syntaro-mcp'] } } },
        },
        cursor: {
          config: { mcpServers: { syntaro: { command: 'npx', args: ['-y', '@aimino/syntaro-mcp'] } } },
        },
      },
      keywords: [
        'syntaro',
        'github-bot',
        'issue-fixer',
        'automated-fix',
        'opencode',
        'mcp',
        'smithery',
        'aimino',
        'agent-discovery',
        'agent-to-agent',
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

  // GET /badge/agent-found.svg — "Agent Found SYNTARO" badge for repo READMEs
  app.get('/badge/agent-found.svg', (_req: Request, res: Response) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="138" height="20" role="img" aria-label="Agent Found: SYNTARO">
  <title>Agent Found: SYNTARO</title>
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
    <text x="114" y="15" fill="#010101" fill-opacity=".3">SYNTARO</text>
    <text x="114" y="14">SYNTARO</text>
  </g>
</svg>`;
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(svg);
  });

  // ── Quality Score Card API ───────────────────────────────────────
  app.use('/api/quality', qualityRouter);

  // ── Benchmarks API (public) ──────────────────────────────────────
  app.use('/api/v1/benchmarks', benchmarksRouter);

  // ── PLG self-serve onboarding API ─────────────────────────────────
  app.use('/plg', plgRouter);

  // ── Pricing API (public) ─────────────────────────────────────────
  app.use('/api/v1/pricing', pricingRouter);

  // ── Preview API (public, no auth) ────────────────────────────────
  let previewRouter: Router;
  try {
    const mod = await import('./routes/preview.js');
    previewRouter = mod.previewRouter;
  } catch (err) {
    log.warn({ err: String(err) }, 'Failed to load preview API — using empty router');
    previewRouter = Router();
  }
  app.use('/api/v1', previewRouter);

  // Ticket Result API (non-code ticket results)
  let ticketResultRouter: Router;
  try {
    const mod = await import('./routes/ticketResult.js');
    ticketResultRouter = mod.default;
  } catch (err) {
    log.warn({ err: String(err) }, 'Failed to load ticket result API — using empty router');
    ticketResultRouter = Router();
  }
  app.use(ticketResultRouter);

  // Public Status API
  let statusRouter: Router;
  try {
    const mod = await import('./routes/status.js');
    statusRouter = mod.default;
  } catch (err) {
    log.warn({ err: String(err) }, 'Failed to load status API — using empty router');
    statusRouter = Router();
  }
  app.use(statusRouter);

  // KPI Dashboard API
  app.use('/api/v1/admin/kpi', kpiRouter);
  app.use('/api/v1/n8n', n8nRouter);

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

  // ── Runs API (authenticated, paginated fix history) ────────────
  app.use('/api/v1/runs', runsApiRouter);
  app.use('/api/v1/runs', runFeedbackRouter);

  // SAML 2.0 SSO routes (optional)
  try {
    const { default: samlRouter } = await import('./routes/saml.js');
    app.use('/api/v1/saml', samlRouter);
  } catch (err) {
    log.warn({ err: String(err) }, 'SAML routes not available — skipping');
  }

  // Enterprise routes (optional)
  try {
    const enterpriseModule = await import('./routes/enterprise.js');
    const enterpriseRouter = (enterpriseModule as any).default || enterpriseModule;
    app.use('/api/v1/enterprise', enterpriseRouter);
  } catch (err) {
    log.warn({ err: String(err) }, 'Enterprise routes not available — skipping');
  }

  app.get('/metrics', async (_req: Request, res: Response) => {
    try {
      const { bridgeMetrics } = await import('./bridge/metrics.js');
      const metrics = bridgeMetrics.render();
      res.type('text/plain; version=0.0.4').send(metrics);
    } catch (err) {
      log.error({ err: String(err) }, 'Failed to load metrics');
      res.status(500).send('# Metrics unavailable\n');
    }
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
    enabled: process.env.APPROVAL_GATE_ENABLED === 'true',
    requiredOrgs: (process.env.APPROVAL_REQUIRED_ORGS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    requiredRepos: (process.env.APPROVAL_REQUIRED_REPOS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    triggerLabels: (process.env.APPROVAL_TRIGGER_LABELS || 'production,syntaro:fix:approval')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  });

  // ── DACH Market: Approval gate API ────────────────────────────────
  // GET    /api/approvals/pending     — List pending approvals
  // POST   /api/approvals/:id/approve — Approve a pending dispatch
  // POST   /api/approvals/:id/reject  — Reject a pending dispatch
  // GET    /api/approvals/config      — Get approval gate config
  app.use('/api', approvalRouter);

  // ── DACH Market: Audit export (GDPR-compliant) ────────────────────
  // GET /api/admin/audit/export?format=csv — Export audit logs as CSV
  // GET /api/admin/audit/export?format=json — Export audit logs as JSON
  app.get('/api/admin/audit/export', async (req, res) => {
    if (req.query.format === 'json') {
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

  // -- Sentry error handler (must be before the fallback error handler) ------
  setupSentryExpressErrorHandler(app);

  // -- Global error handler -------------------------------------------------
  app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
    const errorContext = {
      err: String(err),
      stack: err.stack,
      requestId: req.requestId,
      method: req.method,
      path: req.path,
    };
    log.error(errorContext, 'Unhandled error');
    captureError(err, { requestId: req.requestId, method: req.method, path: req.path });
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error', correlation_id: req.requestId },
    });
  });

  return app;
}

const MAX_PORT_RETRIES = 5;

async function tryListen(app: express.Application, port: number, attempt: number): Promise<import('http').Server> {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, '0.0.0.0', async () => {
      log.info({ port, label: config.syntaro.label, env: config.nodeEnv }, `SYNTARO server listening on :${port}`);

      // Start the RabbitMQ issue consumer — dispatches to OpenSymphony
      try {
        const { consumeQueue, getChannel } = await import('./queue/rabbitmq.js');
        const { dispatchToOpenSymphony } = await import('./dispatch/osDispatch.js');
        const { perAccountConcurrency } = await import('./queue/concurrencyLimiter.js');
        await consumeQueue(QUEUES.issuesFix.name, async (msg) => {
          if (!msg) return;
          const content = msg.content.toString();
          let data: IssueJobData & { _meta?: { slackChannel?: string; slackThreadTs?: string } };
          try {
            data = JSON.parse(content);
          } catch {
            log.error({ content }, 'Failed to parse RabbitMQ message');
            return;
          }
          const accountKey = String(data.installationId ?? 0) || data.repoOwner;
          try {
            const { guardIssueJobData } = await import('./guardrails/commonSenseGate.js');
            const gate = guardIssueJobData(data);
            if (!gate.passed) {
              const detail = gate.checks
                .filter((c) => !c.valid)
                .map((c) => `${c.check}: ${c.error ?? 'invalid'}`)
                .join('; ');
              log.warn(
                { repo: `${data.repoOwner}/${data.repoName}`, issueNumber: data.issueNumber, detail },
                'Common-sense gate rejected queued issue — not dispatching',
              );
              return;
            }
            if (!perAccountConcurrency.acquire(accountKey, config.queue.maxConcurrentPerAccount)) {
              log.warn(
                {
                  accountKey,
                  max: config.queue.maxConcurrentPerAccount,
                  repo: `${data.repoOwner}/${data.repoName}`,
                  issueNumber: data.issueNumber,
                },
                'Per-account concurrency limit reached — requeueing',
              );
              getChannel().nack(msg, false, true);
              return;
            }
            const result = await dispatchToOpenSymphony(data);
            if (!result.success) {
              log.error({ errors: result.errors }, 'OpenSymphony dispatch failed');
            } else {
              log.info({ runId: result.runId, prUrl: result.prUrl }, 'OpenSymphony dispatch completed');
              // Post result back to Slack thread if the original request came from Slack
              const slackMeta = data._meta;
              if (slackMeta?.slackChannel) {
                try {
                  const bolt = getSlackBoltApp();
                  if (bolt.app) {
                    const statusEmoji = result.prUrl ? ':rocket:' : ':white_check_mark:';
                    const prLine = result.prUrl ? `\nPR: ${result.prUrl}` : '';
                    await bolt.app.client.chat.postMessage({
                      channel: slackMeta.slackChannel,
                      thread_ts: slackMeta.slackThreadTs,
                      text: `${statusEmoji} *Fix ${result.prUrl ? 'created' : 'dispatched'}*${prLine}\n\`\`\`${result.summary || ''}\`\`\``,
                    });
                  }
                } catch (slackErr) {
                  log.warn({ err: String(slackErr) }, 'Failed to post dispatch result to Slack');
                }
              }
            }
          } catch (err) {
            log.error({ err: String(err) }, 'OpenSymphony dispatch error');
          } finally {
            perAccountConcurrency.release(accountKey);
          }
        });
        log.info('RabbitMQ issue consumer started — dispatching to OpenSymphony');
      } catch (err) {
        log.warn({ err: String(err) }, 'Failed to start RabbitMQ issue consumer');
      }

      resolve(server);
    });

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        if (attempt < MAX_PORT_RETRIES) {
          const nextPort = port + 1;
          log.warn(
            { port, nextPort, attempt, maxRetries: MAX_PORT_RETRIES },
            `Port ${port} is already in use — trying ${nextPort}`,
          );
          server.close(() => {
            tryListen(app, nextPort, attempt + 1).then(resolve, reject);
          });
        } else {
          log.error(
            { port, attempt, maxRetries: MAX_PORT_RETRIES },
            `Port ${port} is already in use — exhausted all retries`,
          );
          reject(err);
        }
      } else if (err.code === 'EACCES') {
        log.error({ port }, `Permission denied for port ${port}`);
        reject(err);
      } else {
        log.error({ err: String(err) }, 'Server failed to start');
        reject(err);
      }
    });
  });
}

/**
 * Start the Express server on the configured port.
 * Retries with port+1 on EADDRINUSE up to MAX_PORT_RETRIES times.
 * Returns the server instance so callers can close it during graceful shutdown.
 */
export async function startServer(): Promise<import('http').Server> {
  const app = await createApp();
  return tryListen(app, config.port, 1);
}

// -- Process-level error handlers --------------------------------------------

let shuttingDown = false;

process.on('uncaughtException', (err) => {
  log.error(
    { module: 'server', err: String(err), stack: (err as Error).stack },
    'Uncaught exception -- attempting graceful shutdown',
  );

  captureError(err instanceof Error ? err : new Error(String(err)), {
    module: 'server',
    type: 'uncaughtException',
  });

  if (shuttingDown) return;
  shuttingDown = true;

  const forceExitTimer = setTimeout(() => {
    log.error('Graceful shutdown timed out — forcing exit');
    process.exit(1);
  }, 10_000);
  forceExitTimer.unref();

  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  log.error(
    { module: 'server', err: String(reason), stack: (reason as Error)?.stack },
    'Unhandled promise rejection — shutting down',
  );

  if (shuttingDown) return;
  shuttingDown = true;

  const forceExitTimer = setTimeout(() => {
    log.error('Graceful shutdown timed out — forcing exit');
    process.exit(1);
  }, 10_000);
  forceExitTimer.unref();

  captureError(reason instanceof Error ? reason : new Error(String(reason)), {
    module: 'server',
    type: 'unhandledRejection',
  });
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

// Extend Express Request to include requestId and traceId
declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      traceId?: string;
    }
  }
}
