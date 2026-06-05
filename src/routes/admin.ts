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

const router = Router();

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
      actorType: req.query.actorType as any,
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
      const { createIssueQueue } = await import('../queue/issueQueue.js');
      const queue = createIssueQueue();
      const githubWebhooks: any = createGithubWebhooks(queue);

      const payload = typeof webhookEvent.payload === 'string'
        ? webhookEvent.payload
        : JSON.stringify(webhookEvent.payload);

      await (githubWebhooks as any).verifyAndReceive({
        id: `replay-${webhookEvent.id}-${Date.now()}`,
        name: webhookEvent.event_type as any,
        payload,
        signature: '', // Skip verification for replay
      });

      if (typeof (githubWebhooks as any).close === 'function') {
        await (githubWebhooks as any).close();
      }
      await queue.close();
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
// GET /admin/queue — queue status
// ---------------------------------------------------------------------------

router.get('/queue', async (_req: Request, res: Response) => {
  try {
    const { Queue } = await import('bullmq');
    const { Queue: QueueRmq } = await import('bullmq');

    const mainQueue = new Queue('stas-issues', {
      connection: { url: config.queue.redisUrl, maxRetriesPerRequest: null, enableReadyCheck: true },
    });
    const dlq = new QueueRmq('stas-issues-dlq', {
      connection: { url: config.queue.redisUrl, maxRetriesPerRequest: null, enableReadyCheck: true },
    });

    try {
      const [waiting, active, completed, failed, delayed, dlqCount] = await Promise.all([
        mainQueue.getWaitingCount(),
        mainQueue.getActiveCount(),
        mainQueue.getCompletedCount(),
        mainQueue.getFailedCount(),
        mainQueue.getDelayedCount(),
        dlq.getCompletedCount().catch(() => 0),
      ]);

      res.json({
        main: {
          waiting,
          active,
          completed,
          failed,
          delayed,
          total: waiting + active + delayed,
        },
        deadLetter: {
          count: dlqCount,
        },
      });

      await mainQueue.close();
      await dlq.close();
    } catch (err) {
      await mainQueue.close().catch(() => {});
      await dlq.close().catch(() => {});
      throw err;
    }
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to get queue status');
    res.status(500).json({ error: 'Failed to get queue status' });
  }
});

// ---------------------------------------------------------------------------
// POST /admin/queue/clear-dlq — clear dead letter queue
// ---------------------------------------------------------------------------

router.post('/queue/clear-dlq', async (_req: Request, res: Response) => {
  try {
    const { Queue } = await import('bullmq');
    const dlq = new Queue('stas-issues-dlq', {
      connection: { url: config.queue.redisUrl, maxRetriesPerRequest: null, enableReadyCheck: true },
    });

    try {
      await dlq.obliterate({ force: true });
      log.info('Admin cleared dead-letter queue');
      res.json({ cleared: true });
      await dlq.close();
    } catch (err) {
      await dlq.close().catch(() => {});
      throw err;
    }
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to clear dead-letter queue');
    res.status(500).json({ error: 'Failed to clear dead-letter queue' });
  }
});

export { router as adminRouter };
