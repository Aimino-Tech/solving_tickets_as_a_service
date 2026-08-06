/**
 * Dashboard API Routes
 *
 * Provides REST endpoints for:
 *   - Current account info, usage, transactions (mounted at /api/v1/me)
 *   - Admin dashboard: accounts, teams, repos, runs, billing, audit log (mounted at /api/v1/dashboard)
 *
 * @module routes/dashboard
 */

import { Router, type Request, type Response } from 'express';
import { queryWithRetry } from '../db/connection.js';
import { rootLogger } from '../utils/logger.js';
import { config } from '../config.js';
import { requireAuth } from '../auth/middleware.js';

const log = rootLogger.child({ module: 'dashboard-api' });

const router: Router = Router();

// ---------------------------------------------------------------------------
// Rate Limiting: 60 requests per minute per IP on dashboard endpoints
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Helper: extract account ID from request
// ---------------------------------------------------------------------------

function getAccountId(req: Request): number | undefined {
  const headerId = req.headers['x-account-id'] as string | undefined;
  if (headerId) {
    const id = Number(headerId);
    if (!Number.isNaN(id)) return id;
  }
  const queryId = req.query.accountId as string | undefined;
  if (queryId) {
    const id = Number(queryId);
    if (!Number.isNaN(id)) return id;
  }
  return undefined;
}

function parseId(param: string): number | null {
  const id = Number(param);
  return Number.isFinite(id) && id > 0 ? id : null;
}

async function checkAdmin(req: Request, res: Response): Promise<boolean> {
  const { config } = await import('../config.js');
  const adminKey = req.headers['x-admin-key'] as string;
  if (!adminKey || adminKey !== config.security.adminApiKey) {
    res.status(401).json({ error: 'Unauthorized — valid x-admin-key header required' });
    return false;
  }
  return true;
}

// ============================================================================
// Current Account (mounted at /api/v1/me)
// ============================================================================

router.get('/', async (req: Request, res: Response) => {
  try {
    const { accountsRepository, creditsRepository } = await import('../db/repositories/index.js');
    const accountId = getAccountId(req);
    if (!accountId) {
      res.status(400).json({ error: 'Account identification required. Provide x-account-id header or accountId query param.' });
      return;
    }

    const account = await accountsRepository.findById(accountId);
    if (!account) {
      res.status(404).json({ error: 'Account not found' });
      return;
    }

    const balance = await creditsRepository.getBalance(accountId);

    res.json({
      id: account.id,
      githubInstallationId: account.githubInstallationId,
      email: account.email,
      name: account.name,
      tier: account.tier,
      creditBalance: balance.balance,
      lifetimeCredits: balance.lifetimeCredits,
      createdAt: account.createdAt,
    });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to fetch account info');
    res.status(500).json({ error: 'Failed to fetch account info' });
  }
});

router.get('/usage', async (req: Request, res: Response) => {
  try {
    const { usageRepository } = await import('../db/repositories/index.js');
    const accountId = getAccountId(req);
    if (!accountId) {
      res.status(400).json({ error: 'Account identification required.' });
      return;
    }

    const totalCreditsUsed = await usageRepository.totalCreditsUsed(accountId);
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthCredits = await usageRepository.creditsUsedInRange(accountId, startOfMonth, now);
    const monthlyStats = await usageRepository.monthlyStats(accountId, 6);
    const recentUsage = await usageRepository.listByAccount(accountId, 20, 0);

    res.json({
      totalCreditsUsed,
      currentMonth: { creditsUsed: monthCredits, startDate: startOfMonth.toISOString() },
      monthlyStats,
      recentUsage,
    });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to fetch usage stats');
    res.status(500).json({ error: 'Failed to fetch usage stats' });
  }
});

router.get('/transactions', async (req: Request, res: Response) => {
  try {
    const { creditsRepository } = await import('../db/repositories/index.js');
    const accountId = getAccountId(req);
    if (!accountId) {
      res.status(400).json({ error: 'Account identification required.' });
      return;
    }

    const limit = Math.min(Math.abs(Number(req.query.limit) || 50), 200);
    const offset = Math.abs(Number(req.query.offset) || 0);

    const transactions = await creditsRepository.getTransactions(accountId, limit, offset);
    const countResult = await queryWithRetry<{ total: number }>(
      'SELECT COUNT(*) as total FROM credit_transactions WHERE account_id = $1',
      [accountId],
    );
    const total = Number(countResult.rows[0]?.total ?? 0);

    res.json({ transactions, total, limit, offset });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to fetch transactions');
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

// ============================================================================
// Settings (mounted at /api/v1/me)
// ============================================================================

// In-memory overrides for runtime settings. Defaults come from env/config.
const settingsStore: Record<string, string | number | boolean> = {};

// In-memory overrides for config/env — also persisted to .env on write
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
const envOverrides: Record<string, string> = {};

function persistEnvOverrides(): void {
  try {
    const envPath = resolve(process.cwd(), '.env');
    let content = '';
    try { content = readFileSync(envPath, 'utf8'); } catch { /* file may not exist */ }
    const lines = content.split('\n');
    const seen = new Set<string>();
    const out: string[] = [];
    for (const line of lines) {
      const eqIdx = line.indexOf('=');
      if (eqIdx > 0) {
        const k = line.slice(0, eqIdx).trim();
        seen.add(k);
        if (k in envOverrides) {
          out.push(`${k}=${envOverrides[k]}`);
        } else {
          out.push(line);
        }
      } else {
        out.push(line);
      }
    }
    for (const [k, v] of Object.entries(envOverrides)) {
      if (!seen.has(k)) {
        out.push(`${k}=${v}`);
      }
    }
    writeFileSync(envPath, out.join('\n') + '\n', 'utf8');
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to persist .env');
  }
}

router.get('/settings', (_req: Request, res: Response) => {
  const { config } = require('../config.js');
  res.json({
    label: (settingsStore.label as string) || config.label || process.env.SYNTARO_LABEL || 'syntaro:fix',
    model: (settingsStore.model as string) || 'claude-sonnet-4',
    maxConcurrent: (settingsStore.maxConcurrent as number) ?? 3,
    sandboxPoolSize: (settingsStore.sandboxPoolSize as number) ?? 2,
    auditLogEnabled: (settingsStore.auditLogEnabled as boolean) ?? true,
  });
});

router.put('/settings', (req: Request, res: Response) => {
  const { label, model, maxConcurrent, sandboxPoolSize, auditLogEnabled } = req.body || {};
  if (label !== undefined) settingsStore.label = String(label);
  if (model !== undefined) settingsStore.model = String(model);
  if (maxConcurrent !== undefined) settingsStore.maxConcurrent = Number(maxConcurrent);
  if (sandboxPoolSize !== undefined) settingsStore.sandboxPoolSize = Number(sandboxPoolSize);
  if (auditLogEnabled !== undefined) settingsStore.auditLogEnabled = Boolean(auditLogEnabled);
  res.json({ success: true });
});

// ============================================================================
// Admin Dashboard (mounted at /api/v1/dashboard)
// ============================================================================

async function getAdminRepos() {
  return import('../db/repositories/index.js');
}

router.get('/dashboard/accounts', async (req: Request, res: Response) => {
  if (!(await checkAdmin(req, res))) return;
  try {
    const { accountsRepository } = await getAdminRepos();
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Number(req.query.offset) || 0;
    const accounts = await accountsRepository.list(limit, offset);
    res.json({ accounts, limit, offset });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to list accounts');
    res.status(500).json({ error: 'Failed to list accounts' });
  }
});

router.get('/dashboard/accounts/:id', async (req: Request, res: Response) => {
  if (!(await checkAdmin(req, res))) return;
  try {
    const { accountsRepository } = await getAdminRepos();
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

router.get('/dashboard/accounts/by-installation/:installId', async (req: Request, res: Response) => {
  if (!(await checkAdmin(req, res))) return;
  try {
    const { accountsRepository } = await getAdminRepos();
    const installId = parseId(req.params.installId);
    if (!installId) { res.status(400).json({ error: 'Invalid installation ID' }); return; }
    const account = await accountsRepository.findByInstallationId(installId);
    if (!account) { res.status(404).json({ error: 'Account not found' }); return; }
    res.json({ account });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to lookup account');
    res.status(500).json({ error: 'Failed to lookup account' });
  }
});

router.get('/dashboard/teams', async (req: Request, res: Response) => {
  if (!(await checkAdmin(req, res))) return;
  try {
    const { teamsRepository } = await getAdminRepos();
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Number(req.query.offset) || 0;
    const results = await teamsRepository.list(limit, offset);
    res.json({ teams: results, limit, offset });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to list teams');
    res.status(500).json({ error: 'Failed to list teams' });
  }
});

router.get('/dashboard/teams/:id', async (req: Request, res: Response) => {
  if (!(await checkAdmin(req, res))) return;
  try {
    const { teamsRepository } = await getAdminRepos();
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

router.get('/dashboard/accounts/:accountId/teams', async (req: Request, res: Response) => {
  if (!(await checkAdmin(req, res))) return;
  try {
    const { teamsRepository } = await getAdminRepos();
    const accountId = parseId(req.params.accountId);
    if (!accountId) { res.status(400).json({ error: 'Invalid account ID' }); return; }
    const results = await teamsRepository.getTeamsForAccount(accountId);
    res.json({ teams: results });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to list teams for account');
    res.status(500).json({ error: 'Failed to list teams' });
  }
});

router.get('/dashboard/accounts/:accountId/repos', async (req: Request, res: Response) => {
  if (!(await checkAdmin(req, res))) return;
  try {
    const { reposRepository } = await getAdminRepos();
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

router.get('/dashboard/runs', async (req: Request, res: Response) => {
  if (!(await checkAdmin(req, res))) return;
  try {
    const { runsRepository } = await getAdminRepos();
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Number(req.query.offset) || 0;
    const accountId = req.query.accountId ? Number(req.query.accountId) : undefined;
    const status = req.query.status as string | undefined;
    const results = await runsRepository.list({
      accountId: accountId && Number.isFinite(accountId) ? accountId : undefined,
      status, limit, offset,
    });
    res.json({ runs: results, limit, offset });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to list runs');
    res.status(500).json({ error: 'Failed to list runs' });
  }
});

router.get('/dashboard/accounts/:accountId/runs', async (req: Request, res: Response) => {
  if (!(await checkAdmin(req, res))) return;
  try {
    const { runsRepository } = await getAdminRepos();
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

router.get('/dashboard/accounts/:accountId/runs/stats', async (req: Request, res: Response) => {
  if (!(await checkAdmin(req, res))) return;
  try {
    const { runsRepository } = await getAdminRepos();
    const accountId = parseId(req.params.accountId);
    if (!accountId) { res.status(400).json({ error: 'Invalid account ID' }); return; }
    const stats = await runsRepository.stats(accountId);
    res.json({ stats });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to get run stats');
    res.status(500).json({ error: 'Failed to get run stats' });
  }
});

router.get('/dashboard/accounts/:accountId/billing', async (req: Request, res: Response) => {
  if (!(await checkAdmin(req, res))) return;
  try {
    const { billingRepository } = await getAdminRepos();
    const accountId = parseId(req.params.accountId);
    if (!accountId) { res.status(400).json({ error: 'Invalid account ID' }); return; }
    const billing = await billingRepository.getOrCreate(accountId);
    res.json({ billing });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to get billing');
    res.status(500).json({ error: 'Failed to get billing' });
  }
});

router.get('/dashboard/accounts/:accountId/billing/usage', async (req: Request, res: Response) => {
  if (!(await checkAdmin(req, res))) return;
  try {
    const { billingRepository } = await getAdminRepos();
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

router.get('/dashboard/accounts/:accountId/audit-log', async (req: Request, res: Response) => {
  if (!(await checkAdmin(req, res))) return;
  try {
    const { auditLogRepository } = await getAdminRepos();
    const accountId = parseId(req.params.accountId);
    if (!accountId) { res.status(400).json({ error: 'Invalid account ID' }); return; }
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Number(req.query.offset) || 0;
    const action = req.query.action as string | undefined;
    let results;
    if (action) {
      results = await auditLogRepository.listByAction(action, limit, offset);
    } else {
      results = await auditLogRepository.listByAccount(String(accountId), limit, offset);
    }
    res.json({ auditLogs: results, limit, offset });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to get audit log');
    res.status(500).json({ error: 'Failed to get audit log' });
  }
});

router.get('/dashboard/accounts/:accountId/usage', async (req: Request, res: Response) => {
  if (!(await checkAdmin(req, res))) return;
  try {
    const { usageRepository } = await getAdminRepos();
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

router.get('/dashboard/accounts/:accountId/usage/total', async (req: Request, res: Response) => {
  if (!(await checkAdmin(req, res))) return;
  try {
    const { usageRepository } = await getAdminRepos();
    const accountId = parseId(req.params.accountId);
    if (!accountId) { res.status(400).json({ error: 'Invalid account ID' }); return; }
    const total = await usageRepository.totalCreditsUsed(accountId);
    res.json({ totalCreditsUsed: total });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to get total usage');
    res.status(500).json({ error: 'Failed to get total usage' });
  }
});

// ============================================================================
// Config API — separate router mounted at /api/v1/config
// ============================================================================

const configRouter: Router = Router();

configRouter.get('/', requireAuth, (_req: Request, res: Response) => {
  try {
    const env: Record<string, string> = {};
    const trackedKeys = ['LINEAR_API_KEY', 'BITBUCKET_APP_PASSWORD', 'JIRA_API_TOKEN', 'JIRA_URL', 'JIRA_EMAIL', 'GITHUB_TOKEN', 'SLACK_BOT_TOKEN', 'SLACK_APP_TOKEN'];
    for (const key of trackedKeys) {
      const val = key in envOverrides && envOverrides[key]
        ? envOverrides[key]
        : process.env[key] || '';
      if (val) {
        env[key] = val;
      }
    }

    const jiraConfigured = (k: string) => (k in envOverrides && envOverrides[k]) ? envOverrides[k] : process.env[k] || '';

    const integrations = [
      {
        id: 'github',
        name: 'GitHub',
        icon: 'github',
        connected: !!(config.github.appId && (config.github.privateKeyEnv || config.github.privateKeyPath)),
        configUrl: '',
      },
      {
        id: 'linear',
        name: 'Linear',
        icon: 'linear',
        connected: !!(process.env.LINEAR_API_KEY || envOverrides.LINEAR_API_KEY),
        configUrl: 'https://linear.app/settings/api',
      },
      {
        id: 'slack',
        name: 'Slack',
        icon: 'slack',
        connected: !!(process.env.SLACK_BOT_TOKEN || envOverrides.SLACK_BOT_TOKEN),
        configUrl: '',
      },
      {
        id: 'bitbucket',
        name: 'Bitbucket',
        icon: 'bitbucket',
        connected: !!(config.bitbucket.username && config.bitbucket.appPassword),
        configUrl: 'https://bitbucket.org/account/settings/app-passwords/',
      },
      {
        id: 'jira',
        name: 'Jira',
        icon: 'jira',
        connected: !!(jiraConfigured('JIRA_URL') && jiraConfigured('JIRA_EMAIL') && jiraConfigured('JIRA_API_TOKEN')),
        configUrl: '',
      },
    ];

    // SaaS base URL for MCP clients — must never fall back to a localhost dev URL.
const publicUrl = process.env.SYNTARO_PUBLIC_URL || 'https://api.syntaro.io';
const mcpApiUrl = process.env.SYNTARO_API_URL || 'https://api.syntaro.io';
    const mcpServerUrl = process.env.SYNTARO_MCP_SERVER_URL || '';

    res.json({
      env,
      rateLimits: [
        { endpoint: '/api/v1/*', limit: config.syntaro.rateLimitMax, window: `${config.syntaro.rateLimitWindowMs}ms` },
      ],
      tokens: [],
      symphonies: [],
      subscriptions: [],
      warnings: [],
      integrations,
      infrastructure: {},
      publicUrl,
      mcp: {
        apiUrl: mcpApiUrl,
        serverUrl: mcpServerUrl,
      },
    });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to get config');
    res.status(500).json({ error: 'Failed to load configuration' });
  }
});

configRouter.put('/env', requireAuth, (req: Request, res: Response) => {
  try {
    const updates = req.body || {};
    for (const [key, val] of Object.entries(updates)) {
      if (typeof val === 'string') {
        envOverrides[key] = val;
      }
    }
    log.info({ keys: Object.keys(updates) }, 'Config env overrides updated');
    persistEnvOverrides();
    res.json({ success: true });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to update config env');
    res.status(500).json({ error: 'Failed to update environment variables' });
  }
});

configRouter.post('/verify', requireAuth, async (req: Request, res: Response) => {
  try {
    const { service, apiKey } = req.body || {};
    if (!service || !apiKey) {
      res.status(400).json({ connected: false, error: 'service and apiKey are required' });
      return;
    }
    if (service === 'linear') {
      const { LinearClient } = await import('@linear/sdk');
      const client = new LinearClient({ apiKey });
      const viewer = await client.viewer;
      if (viewer?.id) {
        res.json({ connected: true, name: viewer.name || viewer.displayName || null });
      } else {
        res.json({ connected: false, error: 'Invalid API key — could not authenticate with Linear' });
      }
    } else if (service === 'slack') {
      if (!apiKey.startsWith('xoxb-')) {
        res.json({ connected: false, error: 'Invalid bot token format — must start with xoxb-' });
        return;
      }
      const { WebClient } = await import('@slack/web-api');
      const client = new WebClient(apiKey);
      const auth = await client.auth.test();
      if (auth.ok && auth.url) {
        res.json({ connected: true, name: auth.team || null });
      } else {
        res.json({ connected: false, error: 'Invalid bot token — could not authenticate with Slack' });
      }
    } else if (service === 'jira') {
      const { url, email } = req.body || {};
      if (!url || !email || !apiKey) {
        res.status(400).json({ connected: false, error: 'Jira site URL, email and API token are required' });
        return;
      }
      const baseUrl = String(url).trim().replace(/\/+$/, '');
      try {
        const resp = await fetch(`${baseUrl}/rest/api/3/myself`, {
          headers: {
            Accept: 'application/json',
            Authorization: 'Basic ' + Buffer.from(`${email}:${apiKey}`).toString('base64'),
          },
          signal: AbortSignal.timeout(10000),
        });
        if (resp.ok) {
          const data = await resp.json();
          res.json({ connected: true, name: data.displayName || data.name || null });
        } else if (resp.status === 401 || resp.status === 403) {
          res.json({ connected: false, error: `Invalid Jira credentials (status ${resp.status})` });
        } else {
          res.json({ connected: false, error: `Jira API returned status ${resp.status}` });
        }
      } catch (err) {
        const msg = (err as Error)?.message || String(err);
        res.json({ connected: false, error: `Could not reach Jira site — check the site URL (${msg})` });
      }
    } else {
      res.status(400).json({ connected: false, error: `Unknown service: ${service}` });
    }
  } catch (err: any) {
    const msg = err?.message || String(err);
    log.error({ err: msg, service: req.body?.service }, 'Service verification failed');
    res.json({ connected: false, error: msg });
  }
});

export { router as dashboardRouter, configRouter };

// Data Deletion (mounted at /api/v1/me)

router.post('/data/deletion-request', async (req: Request, res: Response) => {
  try {
    const accountId = getAccountId(req);
    if (!accountId) {
      res.status(400).json({ error: 'Account identification required.' });
      return;
    }
    const { requestDataDeletion } = await import('../security/dataRetention.js');
    const result = await requestDataDeletion(accountId);
    res.json({ deletionRequest: result });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to request data deletion');
    res.status(500).json({ error: 'Failed to request data deletion' });
  }
});

router.post('/data/deletion-request/cancel', async (req: Request, res: Response) => {
  try {
    const accountId = getAccountId(req);
    if (!accountId) {
      res.status(400).json({ error: 'Account identification required.' });
      return;
    }
    const { cancelDeletionRequest } = await import('../security/dataRetention.js');
    const cancelled = await cancelDeletionRequest(accountId);
    res.json({ cancelled });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to cancel deletion request');
    res.status(500).json({ error: 'Failed to cancel deletion request' });
  }
});

router.get('/data/deletion-status', async (req: Request, res: Response) => {
  try {
    const accountId = getAccountId(req);
    if (!accountId) {
      res.status(400).json({ error: 'Account identification required.' });
      return;
    }
    const { getDeletionStatus } = await import('../security/dataRetention.js');
    const status = await getDeletionStatus(accountId);
    res.json(status);
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to get deletion status');
    res.status(500).json({ error: 'Failed to get deletion status' });
  }
});
