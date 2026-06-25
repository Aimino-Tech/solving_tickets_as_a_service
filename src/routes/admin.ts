/**
 * Admin API Routes — authenticated administrative endpoints.
 *
 * All routes are mounted at /admin and require a valid ADMIN_API_KEY
 * in the Authorization header as a Bearer token.
 * Rate limited to 10 requests per minute per IP.
 *
 * @module routes/admin
 */

import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { auditRepository } from '../audit/repository.js';
import { logAdminAction } from '../audit/service.js';
import { accountsRepository } from '../db/repositories/index.js';
import { creditsRepository } from '../db/repositories/index.js';
import { adminAuthMiddleware } from '../security/adminAuth.js';
import { queryWithRetry } from '../db/connection.js';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'admin-api' });

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const router: Router = Router();

// ---------------------------------------------------------------------------
// Admin API Key Authentication (shared middleware from security/adminAuth.ts)
// ---------------------------------------------------------------------------
// The adminAuthMiddleware supports both:
//   - Authorization: Bearer <key> header
//   - X-Admin-Key header
// Rate limited to 10 requests per minute per IP (configurable via ADMIN_RATE_LIMIT_MAX)

// ---------------------------------------------------------------------------
// Rate Limiting: 10 requests per minute on admin endpoints
// ---------------------------------------------------------------------------

const adminLimiter = rateLimit({
  windowMs: 60_000, // 1 minute
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many admin requests', retryAfter: 'see Retry-After header' },
});

// Apply auth + rate limit to all admin routes
router.use(adminAuthMiddleware);
router.use(adminLimiter);

// ---------------------------------------------------------------------------
// GET /admin/health — full system health
// ---------------------------------------------------------------------------

router.get('/health', async (_req: Request, res: Response) => {
  const health: Record<string, any> = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: process.env.npm_package_version ?? '0.1.0',
    services: {},
  };

  // Database health
  try {
    const dbResult = await queryWithRetry<{ ok: number }>('SELECT 1 AS ok');
    health.services.database = {
      status: dbResult.rows[0]?.ok === 1 ? 'ok' : 'degraded',
    };
  } catch (err) {
    health.services.database = { status: 'down', error: String(err) };
    health.status = 'degraded';
  }

  // Queue health (check Redis connectivity)
  try {
    const IORedis: any = (await import('ioredis')).default;
    const redis = new IORedis(config.queue.redisUrl, {
      maxRetriesPerRequest: 1,
      connectTimeout: 3000,
      lazyConnect: true,
    });
    await redis.connect();
    await redis.ping();
    health.services.queue = { status: 'ok' };
    await redis.quit();
  } catch (err) {
    health.services.queue = { status: 'down', error: String(err) };
    health.status = 'degraded';
  }

  res.json(health);
});

// ---------------------------------------------------------------------------
// GET /admin/stats — system statistics
// ---------------------------------------------------------------------------

router.get('/stats', async (_req: Request, res: Response) => {
  try {
    // Account count
    const accountCount = await queryWithRetry<{ total: number }>(
      'SELECT COUNT(*) as total FROM accounts',
    );

    // Total runs
    const totalRuns = await queryWithRetry<{ total: number }>(
      'SELECT COUNT(*) as total FROM run_history',
    );

    // Runs by status
    const runsByStatus = await queryWithRetry<{ status: string; count: number }>(
      `SELECT status, COUNT(*) as count FROM run_history GROUP BY status`,
    );

    // Total webhooks received
    const webhookCount = await queryWithRetry<{ total: number }>(
      'SELECT COUNT(*) as total FROM webhook_events',
    );

    // Total audit log entries
    const auditCount = await queryWithRetry<{ total: number }>(
      'SELECT COUNT(*) as total FROM audit_logs',
    );

    // Total credits issued
    const totalCredits = await queryWithRetry<{ total: number }>(
      'SELECT COALESCE(SUM(lifetime_credits), 0) as total FROM credit_balances',
    );

    res.json({
      accounts: Number(accountCount.rows[0]?.total ?? 0),
      runs: {
        total: Number(totalRuns.rows[0]?.total ?? 0),
        byStatus: runsByStatus.rows.map((r) => ({ status: r.status, count: Number(r.count) })),
      },
      webhooks: Number(webhookCount.rows[0]?.total ?? 0),
      auditLogEntries: Number(auditCount.rows[0]?.total ?? 0),
      totalCreditsIssued: Number(totalCredits.rows[0]?.total ?? 0),
    });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to fetch system stats');
    res.status(500).json({ error: 'Failed to fetch system stats' });
  }
});

// ---------------------------------------------------------------------------
// GET /admin/accounts — list all accounts
// ---------------------------------------------------------------------------

router.get('/accounts', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Math.abs(Number(req.query.limit) || 50), 200);
    const offset = Math.abs(Number(req.query.offset) || 0);
    const accounts = await accountsRepository.list(limit, offset);

    // Get total count
    const countResult = await queryWithRetry<{ total: number }>(
      'SELECT COUNT(*) as total FROM accounts',
    );
    const total = Number(countResult.rows[0]?.total ?? 0);

    // Attach credit balances
    const accountsWithBalance = await Promise.all(
      accounts.map(async (acct) => {
        try {
          const balance = await creditsRepository.getBalance(acct.id);
          return { ...acct, creditBalance: balance.balance };
        } catch {
          return { ...acct, creditBalance: 0 };
        }
      }),
    );

    res.json({ accounts: accountsWithBalance, total, limit, offset });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to list accounts');
    res.status(500).json({ error: 'Failed to list accounts' });
  }
});

// ---------------------------------------------------------------------------
// GET /admin/accounts/:id — account details
// ---------------------------------------------------------------------------

router.get('/accounts/:id', async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      res.status(400).json({ error: 'Invalid account ID' });
      return;
    }

    const account = await accountsRepository.findById(id);
    if (!account) {
      res.status(404).json({ error: 'Account not found' });
      return;
    }

    const balance = await creditsRepository.getBalance(id);
    const transactions = await creditsRepository.getTransactions(id, 20, 0);
    const runHistory = await queryWithRetry(
      `SELECT * FROM run_history WHERE account_id = $1 ORDER BY COALESCE(started_at, created_at) DESC LIMIT 20`,
      [id],
    );

    res.json({
      account,
      creditBalance: balance.balance,
      lifetimeCredits: balance.lifetimeCredits,
      recentTransactions: transactions,
      recentRuns: runHistory.rows,
    });
  } catch (err) {
    log.error({ err: String(err), accountId: req.params.id }, 'Failed to get account details');
    res.status(500).json({ error: 'Failed to get account details' });
  }
});

// ---------------------------------------------------------------------------
// POST /admin/accounts/:id/adjust-credits — adjust credit balance
// ---------------------------------------------------------------------------

router.post('/accounts/:id/adjust-credits', async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      res.status(400).json({ error: 'Invalid account ID' });
      return;
    }

    const { amount, reason } = req.body;
    if (typeof amount !== 'number' || amount === 0) {
      res.status(400).json({ error: 'amount must be a non-zero integer' });
      return;
    }

    const account = await accountsRepository.findById(id);
    if (!account) {
      res.status(404).json({ error: 'Account not found' });
      return;
    }

    let newBalance;
    if (amount > 0) {
      newBalance = await creditsRepository.credit(id, amount, {
        type: 'adjustment',
        description: reason ?? 'Admin adjustment',
      });
    } else {
      newBalance = await creditsRepository.deduct(id, Math.abs(amount), {
        description: reason ?? 'Admin adjustment',
      });
    }

    // Audit log
    await logAdminAction({
      adminId: 'admin:api-key',
      action: 'admin.credits.adjust',
      resourceType: 'account',
      resourceId: String(id),
      details: { amount, reason, newBalance: newBalance.balance },
      ipAddress: req.ip,
      correlationId: req.requestId,
    });

    log.info({ accountId: id, amount, reason }, 'Admin adjusted credits');
    res.json({ accountId: id, previousBalance: newBalance.balance - amount, newBalance: newBalance.balance });
  } catch (err) {
    log.error({ err: String(err), accountId: req.params.id }, 'Failed to adjust credits');
    res.status(500).json({ error: String(err) });
  }
});

// ---------------------------------------------------------------------------
// POST /admin/accounts/:id/change-tier — change subscription tier
// ---------------------------------------------------------------------------

router.post('/accounts/:id/change-tier', async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      res.status(400).json({ error: 'Invalid account ID' });
      return;
    }

    const { tier } = req.body;
    const validTiers = ['free', 'pro', 'enterprise'];
    if (!tier || !validTiers.includes(tier)) {
      res.status(400).json({ error: `tier must be one of: ${validTiers.join(', ')}` });
      return;
    }

    const account = await accountsRepository.findById(id);
    if (!account) {
      res.status(404).json({ error: 'Account not found' });
      return;
    }

    const previousTier = account.tier;
    await accountsRepository.update(id, { tier });

    // Audit log
    await logAdminAction({
      adminId: 'admin:api-key',
      action: 'admin.account.change_tier',
      resourceType: 'account',
      resourceId: String(id),
      details: { previousTier, newTier: tier },
      ipAddress: req.ip,
      correlationId: req.requestId,
    });

    log.info({ accountId: id, previousTier, newTier: tier }, 'Admin changed account tier');
    res.json({ accountId: id, previousTier, newTier: tier });
  } catch (err) {
    log.error({ err: String(err), accountId: req.params.id }, 'Failed to change tier');
    res.status(500).json({ error: 'Failed to change tier' });
  }
});

// ---------------------------------------------------------------------------
// GET /admin/audit-logs — query audit logs (paginated, filterable)
// ---------------------------------------------------------------------------

router.get('/audit-logs', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Math.abs(Number(req.query.limit) || 50), 200);
    const offset = Math.abs(Number(req.query.offset) || 0);
    const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
    const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;

    const result = await auditRepository.query({
      actorType: req.query.actorType as string | undefined,
      actorId: req.query.actorId as string,
      action: req.query.action as string,
      resourceType: req.query.resourceType as string,
      resourceId: req.query.resourceId as string,
      startDate,
      endDate,
      correlationId: req.query.correlationId as string,
      limit,
      offset,
    });

    res.json({
      entries: result.rows,
      total: result.total,
      limit,
      offset,
    });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to query audit logs');
    res.status(500).json({ error: 'Failed to query audit logs' });
  }
});

// ---------------------------------------------------------------------------
// GET /admin/webhooks — webhook event log
// ---------------------------------------------------------------------------

router.get('/webhooks', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Math.abs(Number(req.query.limit) || 50), 200);
    const offset = Math.abs(Number(req.query.offset) || 0);
    const source = req.query.source as string | undefined;
    const status = req.query.status as string | undefined;

    const conditions: string[] = [];
    const values: unknown[] = [];
    let paramIdx = 1;

    if (source) {
      conditions.push(`source = $${paramIdx++}`);
      values.push(source);
    }
    // Check if status column exists (webhook_events may or may not have been migrated)
    if (status) {
      conditions.push(`status = $${paramIdx++}`);
      values.push(status);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await queryWithRetry<{ total: number }>(
      `SELECT COUNT(*) as total FROM webhook_events ${where}`,
      values,
    );
    const total = Number(countResult.rows[0]?.total ?? 0);

    const result = await queryWithRetry(
      `SELECT * FROM webhook_events ${where} ORDER BY created_at DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
      [...values, limit, offset],
    );

    res.json({ webhooks: result.rows, total, limit, offset });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to list webhook events');
    res.status(500).json({ error: 'Failed to list webhook events' });
  }
});

// ---------------------------------------------------------------------------
// POST /admin/webhooks/:id/replay — replay a webhook
// ---------------------------------------------------------------------------

router.post('/webhooks/:id/replay', async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      res.status(400).json({ error: 'Invalid webhook event ID' });
      return;
    }

    // Fetch the webhook event
    const webhookResult = await queryWithRetry<any>(
      'SELECT * FROM webhook_events WHERE id = $1',
      [id],
    );
    const webhookEvent = webhookResult.rows[0];
    if (!webhookEvent) {
      res.status(404).json({ error: 'Webhook event not found' });
      return;
    }

    // Re-enqueue based on source
    if (webhookEvent.source === 'github') {
      const { createGithubWebhooks } = await import('../webhooks/github.js');
      const { enqueueIssue } = await import('../queue/issueQueue.js');
      const githubWebhooks = createGithubWebhooks();

      const payload = typeof webhookEvent.payload === 'string'
        ? webhookEvent.payload
        : JSON.stringify(webhookEvent.payload);

      await githubWebhooks.verifyAndReceive({
        id: `replay-${webhookEvent.id}-${Date.now()}`,
        name: webhookEvent.event_type as any,
        payload,
        signature: '', // Skip verification for replay
      });

      if (typeof githubWebhooks.close === 'function') {
        await githubWebhooks.close();
      }
    } else {
      res.status(400).json({ error: `Replay not supported for source: ${webhookEvent.source}` });
      return;
    }

    // Audit the replay
    await logAdminAction({
      adminId: 'admin:api-key',
      action: 'admin.webhook.replay',
      resourceType: 'webhook',
      resourceId: String(id),
      details: { source: webhookEvent.source, eventType: webhookEvent.event_type },
      ipAddress: req.ip,
      correlationId: req.requestId,
    });

    log.info({ webhookId: id, source: webhookEvent.source }, 'Admin replayed webhook event');
    res.json({ replayed: true, webhookId: id, source: webhookEvent.source });
  } catch (err) {
    log.error({ err: String(err), webhookId: req.params.id }, 'Failed to replay webhook');
    res.status(500).json({ error: String(err) });
  }
});

// ---------------------------------------------------------------------------
// GET /admin/queue — queue status (RabbitMQ)
// ---------------------------------------------------------------------------

router.get('/queue', async (_req: Request, res: Response) => {
  try {
    const { isConnected, getPublishChannel, QUEUES } = await import('../queue/rabbitmq.js');

    if (!isConnected()) {
      res.json({ status: 'not_connected', queues: {} });
      return;
    }

    const channel = getPublishChannel();
    const queueStatuses: Record<string, { name: string; messageCount: number; consumerCount: number }> = {};

    for (const [key, q] of Object.entries(QUEUES)) {
      try {
        const info = await channel.checkQueue(q.name);
        queueStatuses[key] = {
          name: q.name,
          messageCount: info.messageCount,
          consumerCount: info.consumerCount,
        };
      } catch {
        queueStatuses[key] = { name: q.name, messageCount: -1, consumerCount: 0 };
      }
    }

    res.json({
      status: 'connected',
      rabbitmq: true,
      queues: queueStatuses,
    });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to get queue status');
    res.status(500).json({ error: 'Failed to get queue status' });
  }
});

// ---------------------------------------------------------------------------
// POST /admin/queue/clear-dlq — purge dead letter queues (RabbitMQ)
// ---------------------------------------------------------------------------

router.post('/queue/clear-dlq', async (_req: Request, res: Response) => {
  try {
    const { isConnected, getPublishChannel, QUEUES } = await import('../queue/rabbitmq.js');

    if (!isConnected()) {
      res.status(503).json({ error: 'RabbitMQ not connected' });
      return;
    }

    const channel = getPublishChannel();
    const purged: string[] = [];

    for (const [, q] of Object.entries(QUEUES)) {
      const dlqName = `${q.name}.dlq`;
      try {
        const result = await channel.purgeQueue(dlqName);
        if (result.messageCount > 0) {
          purged.push(dlqName);
        }
      } catch {
        // Queue might not exist
      }
    }

    log.info({ purgedCount: purged.length, queues: purged }, 'Admin purged dead-letter queues');
    res.json({ cleared: true, purgedQueues: purged });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to clear dead-letter queues');
    res.status(500).json({ error: 'Failed to clear dead-letter queues' });
  }
});

// ---------------------------------------------------------------------------
// POST /admin/gc/sweep — trigger sandbox container GC sweep
// ---------------------------------------------------------------------------

router.post('/gc/sweep', async (_req: Request, res: Response) => {
  try {
    const { SandboxGC } = await import('../sandbox/gc.js');
    const gc = new SandboxGC();
    const cleaned = await gc.sweep();
    log.info({ cleaned }, 'Admin triggered sandbox GC sweep');
    res.json({ cleaned, timestamp: new Date().toISOString() });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to run sandbox GC sweep');
    res.status(500).json({ error: 'GC sweep failed' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// DLQ (Dead Letter Queue) Admin Endpoints
// ═══════════════════════════════════════════════════════════════════════════
//
// Provides a dashboard for viewing, acknowledging, and replaying dead
// messages in the issue queue DLQ.
//
// Endpoints:
//   GET    /admin/dlq           — List all DLQ entries (filterable by ?acknowledged=true/false)
//   GET    /admin/dlq/stats     — DLQ summary statistics
//   GET    /admin/dlq/:id       — Get a single DLQ entry
//   POST   /admin/dlq/:id/ack   — Acknowledge a DLQ entry (marks as reviewed)
//   POST   /admin/dlq/:id/replay — Replay a DLQ entry (re-enqueue for processing)
//   DELETE /admin/dlq/:id       — Remove a DLQ entry from tracking
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /admin/dlq — List all DLQ entries.
 *
 * Query parameters:
 *   ?acknowledged=true|false — Filter by acknowledged status
 *   ?limit=50               — Page size (max 200)
 *   ?offset=0               — Page offset
 */
router.get('/dlq', async (req: Request, res: Response) => {
  try {
    const { dlqStore, formatDeadLetterEntry } = await import('../queue/deadLetterQueue.js');

    const acknowledgedParam = req.query.acknowledged;
    let acknowledged: boolean | undefined;
    if (acknowledgedParam === 'true') acknowledged = true;
    else if (acknowledgedParam === 'false') acknowledged = false;

    const limit = Math.min(Math.abs(Number(req.query.limit) || 50), 200);
    const offset = Math.abs(Number(req.query.offset) || 0);

    let entries = dlqStore.list(acknowledged);
    const total = entries.length;

    // Apply pagination
    entries = entries.slice(offset, offset + limit);

    res.json({
      entries: entries.map(formatDeadLetterEntry),
      total,
      limit,
      offset,
    });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to list DLQ entries');
    res.status(500).json({ error: 'Failed to list DLQ entries' });
  }
});

/**
 * GET /admin/dlq/stats — DLQ summary statistics.
 */
router.get('/dlq/stats', async (_req: Request, res: Response) => {
  try {
    const { dlqStore } = await import('../queue/deadLetterQueue.js');
    const stats = dlqStore.stats();
    res.json({
      ...stats,
      queue: 'stas-issues',
      retentionDays: config.monitoring.dlqRetentionDays,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to get DLQ stats');
    res.status(500).json({ error: 'Failed to get DLQ stats' });
  }
});

/**
 * GET /admin/dlq/:id — Get a single DLQ entry.
 */
router.get('/dlq/:id', async (req: Request, res: Response) => {
  try {
    const { dlqStore, formatDeadLetterEntry } = await import('../queue/deadLetterQueue.js');
    const entry = dlqStore.get(req.params.id);

    if (!entry) {
      res.status(404).json({ error: 'DLQ entry not found' });
      return;
    }

    res.json({ entry: formatDeadLetterEntry(entry) });
  } catch (err) {
    log.error({ err: String(err), id: req.params.id }, 'Failed to get DLQ entry');
    res.status(500).json({ error: 'Failed to get DLQ entry' });
  }
});

/**
 * POST /admin/dlq/:id/ack — Acknowledge a DLQ entry.
 *
 * Marks the dead message as reviewed/acknowledged by an admin.
 * This does NOT re-enqueue the message — use /replay for that.
 *
 * Body: { acknowledgedBy?: string }
 */
router.post('/dlq/:id/ack', async (req: Request, res: Response) => {
  try {
    const { dlqStore, formatDeadLetterEntry } = await import('../queue/deadLetterQueue.js');

    const adminId = req.body.acknowledgedBy || 'admin:api-key';
    const success = dlqStore.acknowledge(req.params.id, adminId);

    if (!success) {
      res.status(404).json({ error: 'DLQ entry not found' });
      return;
    }

    const entry = dlqStore.get(req.params.id);

    // Audit log
    await logAdminAction({
      adminId,
      action: 'admin.dlq.acknowledge',
      resourceType: 'dlq',
      resourceId: req.params.id,
      details: { entryId: req.params.id, acknowledgedAt: entry?.acknowledgedAt },
      ipAddress: req.ip,
      correlationId: req.requestId,
    });

    log.info({ dlqId: req.params.id, adminId }, 'DLQ entry acknowledged');

    res.json({
      acknowledged: true,
      entry: entry ? formatDeadLetterEntry(entry) : null,
    });
  } catch (err) {
    log.error({ err: String(err), id: req.params.id }, 'Failed to acknowledge DLQ entry');
    res.status(500).json({ error: 'Failed to acknowledge DLQ entry' });
  }
});

/**
 * POST /admin/dlq/:id/replay — Replay a DLQ entry.
 *
 * Re-enqueues the dead message for processing.
 * The entry must first be acknowledged (POST /admin/dlq/:id/ack).
 * After replay, the entry is removed from the DLQ store.
 *
 * Body: { delayMs?: number }
 */
router.post('/dlq/:id/replay', async (req: Request, res: Response) => {
  try {
    const { dlqStore } = await import('../queue/deadLetterQueue.js');
    const { createIssueQueue } = await import('../queue/issueQueue.js');

    // Get the entry first for audit logging
    const entry = dlqStore.get(req.params.id);
    if (!entry) {
      res.status(404).json({ error: 'DLQ entry not found' });
      return;
    }

    if (!entry.acknowledged) {
      res.status(400).json({
        error: 'DLQ entry must be acknowledged before replay',
        hint: 'POST /admin/dlq/:id/ack first',
      });
      return;
    }

    // Extract job data and remove from DLQ store
    const jobData = dlqStore.replay(req.params.id);
    if (!jobData) {
      res.status(500).json({ error: 'Failed to extract job data from DLQ entry' });
      return;
    }

    // Re-enqueue the job
    const queue = createIssueQueue();
    try {
      await queue.add('process-issue', jobData, {
        deduplication: {
          id: `replay-${req.params.id}`,
          ttl: 60_000, // 60s TTL to prevent immediate re-dedup
        },
        delay: Number(req.body.delayMs) || 0,
      });
      log.info(
        { dlqId: req.params.id, repo: `${jobData.repoOwner}/${jobData.repoName}`, issueNumber: jobData.issueNumber },
        'DLQ entry replayed',
      );
    } finally {
      await queue.close();
    }

    // Audit log
    await logAdminAction({
      adminId: 'admin:api-key',
      action: 'admin.dlq.replay',
      resourceType: 'dlq',
      resourceId: req.params.id,
      details: {
        entryId: req.params.id,
        repo: `${jobData.repoOwner}/${jobData.repoName}`,
        issueNumber: jobData.issueNumber,
        delayMs: Number(req.body.delayMs) || 0,
      },
      ipAddress: req.ip,
      correlationId: req.requestId,
    });

    res.json({
      replayed: true,
      dlqId: req.params.id,
      entry: {
        repo: `${jobData.repoOwner}/${jobData.repoName}`,
        issueNumber: jobData.issueNumber,
        delayMs: Number(req.body.delayMs) || 0,
      },
    });
  } catch (err) {
    log.error({ err: String(err), id: req.params.id }, 'Failed to replay DLQ entry');
    res.status(500).json({ error: 'Failed to replay DLQ entry' });
  }
});

/**
 * DELETE /admin/dlq/:id — Remove a DLQ entry from tracking.
 *
 * Unlike acknowledge, this permanently removes the entry from the
 * in-memory store. Use this for entries that should be discarded entirely.
 */
router.delete('/dlq/:id', async (req: Request, res: Response) => {
  try {
    const { dlqStore: dlqStoreModule } = await import('../queue/deadLetterQueue.js');

    const success = dlqStoreModule.remove(req.params.id);

    if (!success) {
      res.status(404).json({ error: 'DLQ entry not found' });
      return;
    }

    // Audit log
    await logAdminAction({
      adminId: 'admin:api-key',
      action: 'admin.dlq.dismiss',
      resourceType: 'dlq',
      resourceId: req.params.id,
      details: { entryId: req.params.id },
      ipAddress: req.ip,
      correlationId: req.requestId,
    });

    log.info({ dlqId: req.params.id }, 'DLQ entry dismissed');

    res.json({ dismissed: true, dlqId: req.params.id });
  } catch (err) {
    log.error({ err: String(err), id: req.params.id }, 'Failed to dismiss DLQ entry');
    res.status(500).json({ error: 'Failed to dismiss DLQ entry' });
  }
});

export { router as adminRouter };
