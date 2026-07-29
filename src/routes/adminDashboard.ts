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
} from '../db/repositories/index.js';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'routes:admin-dashboard' });

export const adminDashboardRouter: Router = Router();


function requireAdmin(req: Request, res: Response): boolean {
  const adminKey = req.headers['x-admin-key'] as string;
  if (!adminKey || adminKey !== config.security.adminApiKey) {
    res.status(401).json({ error: 'Unauthorized — valid x-admin-key header required' });
    return false;
  }
  return true;
}

function parseId(param: string): number | null {
  const id = Number(param);
  return Number.isFinite(id) && id > 0 ? id : null;
}

// ── Accounts ──────────────────────────────────────────────────────────────

adminDashboardRouter.get('/accounts', async (req: Request, res: Response) => {
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

adminDashboardRouter.get('/accounts/:id', async (req: Request, res: Response) => {
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

adminDashboardRouter.get('/accounts/by-installation/:installId', async (req: Request, res: Response) => {
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

// ── Teams ─────────────────────────────────────────────────────────────────

adminDashboardRouter.get('/teams', async (req: Request, res: Response) => {
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

adminDashboardRouter.get('/teams/:id', async (req: Request, res: Response) => {
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

adminDashboardRouter.get('/accounts/:accountId/teams', async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  try {
    const accountId = parseId(req.params.accountId);
    if (!accountId) { res.status(400).json({ error: 'Invalid account ID' }); return; }
    const results = await teamsRepository.getTeamsForAccount(accountId);
    res.json({ teams: results });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to list teams for account');
    res.status(500).json({ error: 'Failed to list teams' });
  }
});

// ── Repos ─────────────────────────────────────────────────────────────────

adminDashboardRouter.get('/accounts/:accountId/repos', async (req: Request, res: Response) => {
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

// ── Runs ──────────────────────────────────────────────────────────────────

adminDashboardRouter.get('/runs', async (req: Request, res: Response) => {
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

adminDashboardRouter.get('/accounts/:accountId/runs', async (req: Request, res: Response) => {
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

adminDashboardRouter.get('/accounts/:accountId/runs/stats', async (req: Request, res: Response) => {
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

// ── Billing ───────────────────────────────────────────────────────────────

adminDashboardRouter.get('/accounts/:accountId/billing', async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  try {
    const accountId = parseId(req.params.accountId);
    if (!accountId) { res.status(400).json({ error: 'Invalid account ID' }); return; }
    const billing = await billingRepository.findByAccountId(accountId);
    if (!billing) { res.status(404).json({ error: 'Billing record not found' }); return; }
    res.json({ billing });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to get billing');
    res.status(500).json({ error: 'Failed to get billing' });
  }
});

adminDashboardRouter.get('/accounts/:accountId/billing/usage', async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  try {
    const accountId = parseId(req.params.accountId);
    if (!accountId) { res.status(400).json({ error: 'Invalid account ID' }); return; }

    const billing = await billingRepository.findByAccountId(accountId);
    if (!billing) { res.status(404).json({ error: 'Billing record not found' }); return; }

    const planLimits: Record<string, number> = {
      free: Number(req.query.freeLimit) || 10,
      pro: Number(req.query.proLimit) || 100,
      enterprise: Number(req.query.enterpriseLimit) || 1000,
    };
    const limit = planLimits[billing.plan] ?? planLimits.free;

    res.json({
      allowed: billing.usageCount < limit,
      current: billing.usageCount,
      limit,
      plan: billing.plan,
    });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to check usage limit');
    res.status(500).json({ error: 'Failed to check usage limit' });
  }
});

// ── Audit Log ─────────────────────────────────────────────────────────────

adminDashboardRouter.get('/accounts/:accountId/audit-log', async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  try {
    const accountId = parseId(req.params.accountId);
    if (!accountId) { res.status(400).json({ error: 'Invalid account ID' }); return; }
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Number(req.query.offset) || 0;
    const action = req.query.action as string | undefined;

    let results;
    if (action) {
      const { rows } = await auditLogRepository.listFiltered({ action, actorId: String(accountId), limit, offset }); results = rows;
    } else {
      results = await auditLogRepository.listByAccount(String(accountId), limit, offset);
    }
    res.json({ auditLogs: results, limit, offset });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to get audit log');
    res.status(500).json({ error: 'Failed to get audit log' });
  }
});

// ── Usage / Metering ──────────────────────────────────────────────────────

adminDashboardRouter.get('/accounts/:accountId/usage', async (req: Request, res: Response) => {
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

adminDashboardRouter.get('/accounts/:accountId/usage/total', async (req: Request, res: Response) => {
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
