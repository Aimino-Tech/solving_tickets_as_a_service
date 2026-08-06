import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { queryWithRetry } from '../db/connection.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'stats-audit' });

export const statsRouter: Router = Router();
export const auditRouter: Router = Router();

statsRouter.use(requireAuth);
auditRouter.use(requireAuth);

// GET / — Dashboard stats
statsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const email = req.user?.email;
    let accountId: number | undefined;

    if (email) {
      try {
        const result = await queryWithRetry<{ id: number }>(
          'SELECT id FROM accounts WHERE email = $1 ORDER BY github_installation_id > 0 DESC, id ASC LIMIT 1',
          [email],
        );
        if (result.rows.length > 0) accountId = result.rows[0].id;
      } catch {
        // DB may not be available
      }
    }

    if (!accountId) {
      // Return empty stats when no account found
      res.json({
        totalRuns: 0,
        passRate: 0,
        avgDurationSeconds: 0,
        activeRepos: 0,
        runsByDay: [],
        costByDay: [],
        fixRateByWeek: [],
      });
      return;
    }

    const runsResult = await queryWithRetry<{
      total: number;
      passed: number;
      avg_duration: number | null;
      active_repos: number;
    }>(
      `SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE rh.status IN ('completed', 'success')) as passed,
        AVG(rh.duration_ms::float / 1000) as avg_duration,
        COUNT(DISTINCT (rh.repo_owner, rh.repo_name)) as active_repos
      FROM run_history rh
      JOIN accounts a ON rh.installation_id = a.github_installation_id
      WHERE a.id = $1`,
      [accountId],
    );
    const row = runsResult.rows[0];

    const runsByDayResult = await queryWithRetry<{ date: string; count: number; passed: number }>(
      `SELECT
        DATE(rh.created_at) as date,
        COUNT(*) as count,
        COUNT(*) FILTER (WHERE rh.status = 'success') as passed
      FROM run_history rh
      JOIN accounts a ON rh.installation_id = a.github_installation_id
      WHERE a.id = $1 AND rh.created_at >= NOW() - INTERVAL '30 days'
      GROUP BY DATE(rh.created_at) ORDER BY date`,
      [accountId],
    );

    const usageResult = await queryWithRetry<{ used: number | null }>(
      `SELECT COALESCE(SUM(credits_used), 0) AS used
       FROM usage_records
       WHERE account_id = $1 AND timestamp >= date_trunc('month', NOW())`,
      [accountId],
    );

    res.json({
      totalRuns: Number(row?.total ?? 0),
      passRate: Number(row?.total ?? 0) > 0 ? Math.round((Number(row?.passed ?? 0) / Number(row?.total ?? 1)) * 100) : 0,
      avgDurationSeconds: row?.avg_duration ? Math.round(Number(row.avg_duration)) : 0,
      activeRepos: Number(row?.active_repos ?? 0),
      runsByDay: runsByDayResult.rows.map((r) => ({ date: String(r.date), count: Number(r.count), passed: Number(r.passed) })),
      costByDay: [],
      fixRateByWeek: [],
      fixesUsedThisMonth: Number(usageResult.rows[0]?.used ?? 0),
    });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to get stats');
    res.json({
      totalRuns: 0,
      passRate: 0,
      avgDurationSeconds: 0,
      activeRepos: 0,
      runsByDay: [],
      costByDay: [],
      fixRateByWeek: [],
      fixesUsedThisMonth: 0,
    });
  }
});

// GET / — List audit entries
auditRouter.get('/', async (req: Request, res: Response) => {
  try {
    const email = req.user?.email;
    const page = Math.max(1, Number(req.query.page) || 1);
    const perPage = Math.min(Math.max(1, Number(req.query.perPage) || 50), 200);
    const offset = (page - 1) * perPage;

    let accountId: number | undefined;
    if (email) {
      try {
        const result = await queryWithRetry<{ id: number }>(
          'SELECT id FROM accounts WHERE email = $1 ORDER BY github_installation_id > 0 DESC, id ASC LIMIT 1',
          [email],
        );
        if (result.rows.length > 0) accountId = result.rows[0].id;
      } catch {
        // DB not available
      }
    }

    if (!accountId) {
      res.json({ data: [], total: 0, page, perPage, totalPages: 0 });
      return;
    }

    const countResult = await queryWithRetry<{ total: number }>(
      'SELECT COUNT(*) as total FROM audit_log WHERE account_id = $1',
      [accountId],
    );

    const dataResult = await queryWithRetry<{
      id: string;
      action: string;
      actor: string;
      target: string | null;
      details: unknown;
      created_at: string;
    }>(
      `SELECT id, action, actor, target, details, created_at
      FROM audit_log WHERE account_id = $1
      ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [accountId, perPage, offset],
    );

    const total = Number(countResult.rows[0]?.total ?? 0);
    res.json({
      data: dataResult.rows.map((r) => ({
        id: String(r.id),
        action: r.action,
        actor: r.actor,
        target: r.target ?? undefined,
        details: r.details as Record<string, unknown> | undefined,
        createdAt: String(r.created_at),
      })),
      total,
      page,
      perPage,
      totalPages: Math.ceil(total / perPage),
    });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to list audit entries');
    res.json({ data: [], total: 0, page: 1, perPage: 50, totalPages: 0 });
  }
});
