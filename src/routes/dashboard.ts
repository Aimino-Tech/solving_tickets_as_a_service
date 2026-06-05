/**
 * Dashboard API routes — multi-tenant data access for the hosted service dashboard.
 *
 * Provides REST endpoints for:
 *   - Accounts (CRUD + lookup by installation)
 *   - Teams (CRUD + member management)
 *   - Repos (CRUD + per-account listing)
 *   - Runs (listing, stats, per-issue lookup)
 *   - Billing (current plan, usage, Stripe integration)
 *   - Audit log (paginated, filtered)
 *   - Usage statistics (monthly breakdown)
 *
 * All routes are prefixed with /api/v1/dashboard
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  accountsRepository,
  auditLogRepository,
  billingRepository,
  reposRepository,
  runsRepository,
  teamsRepository,
  usageRepository,
} from '../db/index.js';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'routes:dashboard' });

export const dashboardRouter = Router();

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

/**
 * Require admin API key for dashboard routes.
 * The admin key is set via ADMIN_API_KEY env var.
 */
function requireAdmin(req: Request, res: Response): boolean {
  const adminKey = req.headers['x-admin-key'] as string;
  if (!adminKey || adminKey !== config.stas.adminApiKey) {
    res.status(401).json({ error: 'Unauthorized — valid x-admin-key header required' });
    return false;
  }
  return true;
}

/**
 * Extract numeric ID from route params.
 */
function parseId(param: string): number | null {
  const id = Number(param);
  return Number.isFinite(id) && id > 0 ? id : null;
}

// ============================================================================
// Accounts
// ============================================================================

/**
 * GET /api/v1/dashboard/accounts — List all accounts (paginated).
 * Query: ?limit=50&offset=0
 */
dashboardRouter.get('/accounts', async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Number(req.query.offset) || 0;
    const accounts = await accountsRepository.list(limit, offset);
    res.json({ accounts, limit, offset });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to list accounts');
    res.status(500).json({ error: 'Failed to list accounts' });
  }
});

/**
 * GET /api/v1/dashboard/accounts/:id — Get account by ID.
 */
dashboardRouter.get('/accounts/:id', async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  try {
    const id = parseId(req.params.id);
    if (!id) { res.status(400).json({ error: 'Invalid account ID' }); return; }
    const account = await accountsRepository.findById(id);
    if (!account) { res.status(404).json({ error: 'Account not found' }); return; }
    res.json({ account });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to get account');
    res.status(500).json({ error: 'Failed to get account' });
  }
});

/**
 * GET /api/v1/dashboard/accounts/by-installation/:installId — Lookup by GitHub installation ID.
 */
dashboardRouter.get('/accounts/by-installation/:installId', async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  try {
    const installId = parseId(req.params.installId);
    if (!installId) { res.status(400).json({ error: 'Invalid installation ID' }); return; }
    const account = await accountsRepository.findByInstallationId(installId);
    if (!account) { res.status(404).json({ error: 'Account not found' }); return; }
    res.json({ account });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to lookup account by installation');
    res.status(500).json({ error: 'Failed to lookup account' });
  }
});

// ============================================================================
// Teams
// ============================================================================

/**
 * GET /api/v1/dashboard/teams — List all teams.
 */
dashboardRouter.get('/teams', async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Number(req.query.offset) || 0;
    const results = await teamsRepository.list(limit, offset);
    res.json({ teams: results, limit, offset });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to list teams');
    res.status(500).json({ error: 'Failed to list teams' });
  }
});

/**
 * GET /api/v1/dashboard/teams/:id — Get team details.
 */
dashboardRouter.get('/teams/:id', async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  try {
    const id = parseId(req.params.id);
    if (!id) { res.status(400).json({ error: 'Invalid team ID' }); return; }
    const team = await teamsRepository.findById(id);
    if (!team) { res.status(404).json({ error: 'Team not found' }); return; }
    res.json({ team });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to get team');
    res.status(500).json({ error: 'Failed to get team' });
  }
});

/**
 * GET /api/v1/dashboard/accounts/:accountId/teams — List teams for an account.
 */
dashboardRouter.get('/accounts/:accountId/teams', async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  try {
    const accountId = parseId(req.params.accountId);
    if (!accountId) { res.status(400).json({ error: 'Invalid account ID' }); return; }
    const results = await teamsRepository.listByAccount(accountId);
    res.json({ teams: results });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to list teams for account');
    res.status(500).json({ error: 'Failed to list teams' });
  }
});

// ============================================================================
// Repos
// ============================================================================

/**
 * GET /api/v1/dashboard/accounts/:accountId/repos — List repos for an account.
 */
dashboardRouter.get('/accounts/:accountId/repos', async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  try {
    const accountId = parseId(req.params.accountId);
    if (!accountId) { res.status(400).json({ error: 'Invalid account ID' }); return; }
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Number(req.query.offset) || 0;
    const results = await reposRepository.listByAccount(accountId, limit, offset);
    res.json({ repos: results, limit, offset });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to list repos');
    res.status(500).json({ error: 'Failed to list repos' });
  }
});

// ============================================================================
// Runs
// ============================================================================

/**
 * GET /api/v1/dashboard/runs — List runs.
 * Query: ?accountId=1&status=completed&limit=50&offset=0
 */
dashboardRouter.get('/runs', async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Number(req.query.offset) || 0;
    const accountId = req.query.accountId ? Number(req.query.accountId) : undefined;
    const status = req.query.status as string | undefined;

    const results = await runsRepository.list({
      accountId: accountId && Number.isFinite(accountId) ? accountId : undefined,
      status,
      limit,
      offset,
    });
    res.json({ runs: results, limit, offset });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to list runs');
    res.status(500).json({ error: 'Failed to list runs' });
  }
});

/**
 * GET /api/v1/dashboard/accounts/:accountId/runs — List runs for an account.
 */
dashboardRouter.get('/accounts/:accountId/runs', async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  try {
    const accountId = parseId(req.params.accountId);
    if (!accountId) { res.status(400).json({ error: 'Invalid account ID' }); return; }
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Number(req.query.offset) || 0;
    const status = req.query.status as string | undefined;

    const results = await runsRepository.list({ accountId, status, limit, offset });
    res.json({ runs: results, limit, offset });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to list runs for account');
    res.status(500).json({ error: 'Failed to list runs' });
  }
});

/**
 * GET /api/v1/dashboard/accounts/:accountId/runs/stats — Run statistics for account.
 */
dashboardRouter.get('/accounts/:accountId/runs/stats', async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  try {
    const accountId = parseId(req.params.accountId);
    if (!accountId) { res.status(400).json({ error: 'Invalid account ID' }); return; }
    const stats = await runsRepository.stats(accountId);
    res.json({ stats });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to get run stats');
    res.status(500).json({ error: 'Failed to get run stats' });
  }
});

// ============================================================================
// Billing
// ============================================================================

/**
 * GET /api/v1/dashboard/accounts/:accountId/billing — Get billing record.
 */
dashboardRouter.get('/accounts/:accountId/billing', async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  try {
    const accountId = parseId(req.params.accountId);
    if (!accountId) { res.status(400).json({ error: 'Invalid account ID' }); return; }
    const billing = await billingRepository.getOrCreate(accountId);
    res.json({ billing });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to get billing');
    res.status(500).json({ error: 'Failed to get billing' });
  }
});

/**
 * GET /api/v1/dashboard/accounts/:accountId/billing/usage — Check usage limit.
 * Query: ?planLimit=100 (optional, default based on plan)
 */
dashboardRouter.get('/accounts/:accountId/billing/usage', async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  try {
    const accountId = parseId(req.params.accountId);
    if (!accountId) { res.status(400).json({ error: 'Invalid account ID' }); return; }

    const planLimits: Record<string, number> = {
      free: Number(req.query.freeLimit) || 10,
      pro: Number(req.query.proLimit) || 100,
      enterprise: Number(req.query.enterpriseLimit) || 1000,
    };

    const result = await billingRepository.checkUsageLimit(accountId, planLimits);
    res.json(result);
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to check usage limit');
    res.status(500).json({ error: 'Failed to check usage limit' });
  }
});

// ============================================================================
// Audit Log
// ============================================================================

/**
 * GET /api/v1/dashboard/accounts/:accountId/audit-log — Get audit log for account.
 * Query: ?action=account.created&limit=50&offset=0
 */
dashboardRouter.get('/accounts/:accountId/audit-log', async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  try {
    const accountId = parseId(req.params.accountId);
    if (!accountId) { res.status(400).json({ error: 'Invalid account ID' }); return; }
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Number(req.query.offset) || 0;
    const action = req.query.action as string | undefined;

    let results;
    if (action) {
      results = await auditLogRepository.listByAction(action, limit, offset);
    } else {
      results = await auditLogRepository.listByAccount(accountId, limit, offset);
    }
    res.json({ auditLogs: results, limit, offset });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to get audit log');
    res.status(500).json({ error: 'Failed to get audit log' });
  }
});

// ============================================================================
// Usage / Metering
// ============================================================================

/**
 * GET /api/v1/dashboard/accounts/:accountId/usage — Monthly usage breakdown.
 * Query: ?months=6
 */
dashboardRouter.get('/accounts/:accountId/usage', async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  try {
    const accountId = parseId(req.params.accountId);
    if (!accountId) { res.status(400).json({ error: 'Invalid account ID' }); return; }
    const months = Math.min(Number(req.query.months) || 6, 24);
    const stats = await usageRepository.monthlyStats(accountId, months);
    res.json({ usage: stats });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to get usage stats');
    res.status(500).json({ error: 'Failed to get usage stats' });
  }
});

/**
 * GET /api/v1/dashboard/accounts/:accountId/usage/total — Total credits used.
 */
dashboardRouter.get('/accounts/:accountId/usage/total', async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  try {
    const accountId = parseId(req.params.accountId);
    if (!accountId) { res.status(400).json({ error: 'Invalid account ID' }); return; }
    const total = await usageRepository.totalCreditsUsed(accountId);
    res.json({ totalCreditsUsed: total });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to get total usage');
    res.status(500).json({ error: 'Failed to get total usage' });
  }
});
