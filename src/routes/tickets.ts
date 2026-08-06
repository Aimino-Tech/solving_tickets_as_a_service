import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { queryWithRetry } from '../db/connection.js';
import { PLANS } from '../billing/plans.js';
import type { PlanId } from '../billing/plans.js';
import { rootLogger } from '../utils/logger.js';
import { auditMiddleware } from '../audit/middleware.js';

const log = rootLogger.child({ module: 'tickets-api' });

const router: Router = Router();

/**
 * Account-level plan names (from accounts table) to billing PlanId mapping.
 * Mirrors src/billing/routes.ts: 'pro' maps to the 'solo' billing plan.
 */
const ACCOUNT_PLAN_TO_PLAN_ID: Record<string, PlanId> = {
  free: 'free',
  pro: 'solo',
  solo: 'solo',
  team: 'team',
  enterprise: 'enterprise',
  selfHosted: 'selfHosted',
};

/**
 * Resolve a numeric account ID from the authenticated user.
 * The JWT user ID is a UUID string — we need the numeric account_id.
 * Falls back to looking up by email if direct conversion fails.
 */
async function resolveAccountId(req: Request): Promise<number | null> {
  const directId = Number(req.user!.id);
  if (Number.isFinite(directId) && directId > 0 && Number.isInteger(directId)) {
    return directId;
  }
  if (req.user!.email) {
    try {
      const result = await queryWithRetry<{ id: number }>(
        'SELECT id FROM accounts WHERE email = $1 ORDER BY github_installation_id > 0 DESC, id ASC LIMIT 1',
        [req.user!.email],
      );
      if (result.rows.length > 0) return result.rows[0].id;
    } catch {
      // DB might not be available
    }
  }
  return null;
}

/**
 * Resolve the effective billing plan for an account.
 * Checks the dedicated billing table (Stripe-backed) first, then accounts.plan.
 */
async function resolvePlanId(accountId: number): Promise<PlanId> {
  try {
    const billingResult = await queryWithRetry<{ plan: string }>(
      'SELECT plan FROM billing WHERE account_id = $1',
      [accountId],
    );
    if (billingResult.rows.length > 0) {
      const dbPlan = billingResult.rows[0].plan as PlanId;
      if (PLANS[dbPlan]) return dbPlan;
    }
    const accountResult = await queryWithRetry<{ plan: string }>(
      'SELECT plan FROM accounts WHERE id = $1',
      [accountId],
    );
    if (accountResult.rows.length > 0) {
      const mappedPlanId = ACCOUNT_PLAN_TO_PLAN_ID[accountResult.rows[0].plan];
      if (mappedPlanId && PLANS[mappedPlanId]) return mappedPlanId;
    }
  } catch (err) {
    log.warn({ err: String(err), accountId }, 'Failed to resolve plan, defaulting to free');
  }
  return 'free';
}

/**
 * Count fix credits used in the current calendar month for an account.
 * Matches the monthly usage shown on the dashboard (usage_records.credits_used).
 */
async function monthlyCreditsUsed(accountId: number): Promise<number> {
  try {
    const result = await queryWithRetry<{ used: number | null }>(
      `SELECT COALESCE(SUM(credits_used), 0) AS used
       FROM usage_records
       WHERE account_id = $1 AND timestamp >= date_trunc('month', NOW())`,
      [accountId],
    );
    return Number(result.rows[0]?.used ?? 0);
  } catch (err) {
    log.warn({ err: String(err), accountId }, 'Failed to compute monthly usage');
    return 0;
  }
}

// POST /api/v1/tickets — Create a fix ticket for a detected warning/alert.
//
// Ticket creation is free and unlimited for every plan (business model:
// detection + ticket creation is not gated; the monthly fix budget is
// enforced at fix-dispatch time in src/dispatch/osDispatch.ts). The plan
// info is returned so the dashboard can show remaining budget.
//
// Every ticket is persisted in the local `tickets` table (DB-first store) so
// it stays queryable independently of the source platform.
router.post(
  '/',
  requireAuth,
  auditMiddleware({ action: 'tickets.create', actorType: 'user' }),
  async (req: Request, res: Response) => {
    const { repoOwner, repoName, issueTitle, issueBody, source } = req.body as {
      repoOwner?: unknown;
      repoName?: unknown;
      issueTitle?: unknown;
      issueBody?: unknown;
      source?: unknown;
    };

    if (typeof repoOwner !== 'string' || !repoOwner.trim()) {
      res.status(400).json({ error: 'Missing required field: repoOwner' });
      return;
    }
    if (typeof repoName !== 'string' || !repoName.trim()) {
      res.status(400).json({ error: 'Missing required field: repoName' });
      return;
    }
    if (typeof issueTitle !== 'string' || !issueTitle.trim()) {
      res.status(400).json({ error: 'Missing required field: issueTitle' });
      return;
    }

    try {
      const accountId = await resolveAccountId(req);
      if (!accountId) {
        res.status(401).json({ error: 'Unable to resolve account for authenticated user' });
        return;
      }

      const planId = await resolvePlanId(accountId);
      const plan = PLANS[planId];
      const limit = plan ? plan.monthlyFixLimit : 10;
      const isUnlimited = limit >= 999_999;
      const used = await monthlyCreditsUsed(accountId);

      let ticketId: number | null = null;
      try {
        const { ticketsRepository } = await import('../db/repositories/index.js');
        const ticket = await ticketsRepository.create({
          accountId,
          repoOwner: repoOwner.trim(),
          repoName: repoName.trim(),
          title: issueTitle.trim(),
          body: typeof issueBody === 'string' ? issueBody : null,
          source: typeof source === 'string' ? source : 'dashboard',
        });
        ticketId = ticket.id;
      } catch (persistErr) {
        log.warn({ err: String(persistErr) }, 'Failed to persist ticket row — continuing with enqueue');
      }

      // Resolve the account's GitHub installation for the fix pipeline.
      let installationId = 0;
      try {
        const acct = await queryWithRetry<{ github_installation_id: number | null }>(
          'SELECT github_installation_id FROM accounts WHERE id = $1',
          [accountId],
        );
        if (acct.rows[0]?.github_installation_id != null) {
          installationId = Number(acct.rows[0].github_installation_id) || 0;
        }
      } catch (resolveErr) {
        log.warn({ err: String(resolveErr), accountId }, 'Failed to resolve account installation');
      }

      const runId = randomUUID();
      const now = new Date().toISOString();

      try {
        const { QUEUES, publishMessage, connect: rmqConnect, isConnected } = await import('../queue/rabbitmq.js');
        if (!isConnected()) await rmqConnect();
        const messageId = `${installationId}:${repoOwner}/${repoName}#0-${Date.now()}`;
        await publishMessage(QUEUES.issuesFix.exchange, QUEUES.issuesFix.routingKey, {
          installationId,
          repoOwner,
          repoName,
          repoPrivate: false,
          issueNumber: 0,
          issueTitle,
          issueBody: typeof issueBody === 'string' ? issueBody : undefined,
          source: source || 'dashboard',
          labels: [],
          _meta: { messageId, enqueuedAt: now, createdBy: 'dashboard-ticket', ticketId },
        });
      } catch (queueErr) {
        log.error({ err: String(queueErr), runId }, 'Failed to enqueue ticket issue');
      }

      log.info({ runId, accountId, planId, repoOwner, repoName, issueTitle, ticketId }, 'Ticket created');
      res.status(201).json({ runId, status: 'accepted', planId, isUnlimited, ticketId, used, limit });
    } catch (err) {
      log.error({ err: String(err) }, 'Failed to create ticket');
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// GET /api/v1/tickets — List internal tickets/warnings from the local store.
// DB-first retrieval: tickets stay queryable without fetching from the platform.
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const accountId = await resolveAccountId(req);
    if (!accountId) {
      res.status(401).json({ error: 'Unable to resolve account for authenticated user' });
      return;
    }
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const limitRaw = Number(req.query.limit);
    const offsetRaw = Number(req.query.offset);
    const { ticketsRepository } = await import('../db/repositories/index.js');
    const tickets = await ticketsRepository.listByAccount(accountId, {
      status,
      limit: Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 500) : 100,
      offset: Number.isFinite(offsetRaw) && offsetRaw > 0 ? offsetRaw : 0,
    });
    res.json({ tickets });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to list tickets');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export { router as ticketsRouter };
