import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { queryWithRetry, isTableNotFoundError } from '../db/connection.js';
import { runsRepository } from '../db/repositories/index.js';
import { rootLogger } from '../utils/logger.js';
import { auditMiddleware } from '../audit/middleware.js';

const log = rootLogger.child({ module: 'runs-api' });

const router: Router = Router();

/**
 * Resolve a numeric account ID from the authenticated user.
 * The JWT user ID is a UUID string (Supabase) — we need the numeric account_id.
 * Falls back to looking up by email if direct conversion fails.
 */
async function resolveAccountId(req: Request): Promise<number | null> {
  const directId = Number(req.user!.id);
  if (Number.isFinite(directId) && directId > 0 && Number.isInteger(directId)) {
    return directId;
  }
  // Look up by email from JWT
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

router.get('/', requireAuth, auditMiddleware({ action: 'runs.list', actorType: 'user' }), async (req: Request, res: Response) => {
  let page = 1;
  let limit = 20;
  let status: string | undefined;
  try {
    const accountId = await resolveAccountId(req);
    if (!accountId) {
      res.json({ data: [], total: 0, page: 1, perPage: limit, totalPages: 0 });
      return;
    }
    page = Math.max(1, Number(req.query.page) || 1);
    limit = Math.min(Math.max(1, Number(req.query.perPage) || 20), 100);
    const offset = (page - 1) * limit;
    status = req.query.status as string | undefined;
    const repo = (req.query.repo as string | undefined)?.trim();
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;

    // Build WHERE clauses dynamically; accountId is always $1.
    const whereParts = ['a.id = $1'];
    const listParams: unknown[] = [accountId];
    if (status) {
      whereParts.push(`rh.status = $${listParams.length + 1}`);
      listParams.push(status);
    }
    if (repo) {
      whereParts.push(`(rh.repo_name ILIKE $${listParams.length + 1} OR rh.repo_owner ILIKE $${listParams.length + 1})`);
      listParams.push(`%${repo}%`);
    }
    if (from && !Number.isNaN(Date.parse(from))) {
      whereParts.push(`rh.created_at >= $${listParams.length + 1}`);
      listParams.push(new Date(from).toISOString());
    }
    if (to && !Number.isNaN(Date.parse(to))) {
      whereParts.push(`rh.created_at <= $${listParams.length + 1}`);
      listParams.push(new Date(to).toISOString());
    }
    const whereClause = whereParts.join(' AND ');

    // run_history is the live run table (runs is legacy/unwritten).
    const runs = await queryWithRetry<any>(
      `SELECT rh.*
       FROM run_history rh
       JOIN accounts a ON rh.installation_id = a.github_installation_id
       WHERE ${whereClause}
       ORDER BY rh.created_at DESC
       LIMIT $${listParams.length + 1} OFFSET $${listParams.length + 2}`,
      [...listParams, limit, offset],
    );

    const countResult = await queryWithRetry<{ total: number }>(
      `SELECT COUNT(*) as total
       FROM run_history rh
       JOIN accounts a ON rh.installation_id = a.github_installation_id
       WHERE ${whereClause}`,
      listParams,
    );
    const total = Number(countResult.rows[0]?.total ?? 0);

    const runsWithCredits = await Promise.all(
      runs.rows.map(async (run: any) => {
        try {
          const txResult = await queryWithRetry<any>(
            `SELECT COALESCE(ABS(amount), 0) as credits_used
             FROM credit_transactions
             WHERE account_id = $1 AND description LIKE $2 AND type = 'usage'
             ORDER BY created_at DESC LIMIT 1`,
            [accountId, `%${run.id}%`],
          );
          return { ...run, creditsUsed: Number(txResult.rows[0]?.credits_used ?? 0) };
        } catch {
          return { ...run, creditsUsed: 0 };
        }
      }),
    );

    const mapped = runsWithCredits.map((r: any) => ({
      id: r.id,
      status: r.status,
      issueNumber: r.issue_number,
      issueTitle: r.summary || '',
      repoOwner: (r as any).repo_owner || '',
      repoName: (r as any).repo_name || '',
      durationSeconds: r.duration_ms ? Math.round(r.duration_ms / 1000) : null,
      costCents: r.cost_cents ?? null,
      creditsUsed: r.creditsUsed ?? 0,
      confidence: r.confidence,
      prUrl: r.pr_url,
      branchName: r.branch_name,
      errorMessage: r.error,
      modelUsed: r.model_used,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));

    res.json({
      data: mapped,
      total,
      page,
      perPage: limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    if (isTableNotFoundError(err)) {
      res.json({ data: [], total: 0, page, perPage: limit, totalPages: 0 });
      return;
    }
    log.error(
      {
        err: String(err),
        accountId: (req as any).user?.accountId,
        page,
        limit,
        statusFilter: status,
      },
      'Failed to list runs',
    );
    res.status(500).json({ error: 'Failed to list runs' });
  }
});

router.get('/:id', requireAuth, auditMiddleware({ action: 'runs.view', actorType: 'user' }), async (req: Request, res: Response) => {
  try {
    const runId = Number(req.params.id);
    if (!Number.isFinite(runId)) {
      res.status(400).json({ error: 'Invalid run ID' });
      return;
    }

    const run = await queryWithRetry<any>(
      'SELECT * FROM run_history WHERE id = $1',
      [runId],
    );
    if (run.rows.length === 0) {
      const legacy = await runsRepository.findById(runId);
      if (!legacy) {
        res.status(404).json({ error: 'Run not found' });
        return;
      }
      res.json({ ...legacy, creditsUsed: 0 });
      return;
    }
    const runRow = run.rows[0];

    let creditsUsed = 0;
    try {
      const txResult = await queryWithRetry<any>(
        `SELECT COALESCE(ABS(amount), 0) as credits_used
         FROM credit_transactions
         WHERE description LIKE $1 AND type = 'usage'
         ORDER BY created_at DESC LIMIT 1`,
        [`%${runRow.id}%`],
      );
      creditsUsed = Number(txResult.rows[0]?.credits_used ?? 0);
    } catch {
      // Non-fatal
    }

    res.json({
      id: runRow.id,
      status: runRow.status,
      issueNumber: runRow.issue_number,
      issueTitle: runRow.summary || '',
      repoOwner: runRow.repo_owner || '',
      repoName: runRow.repo_name || '',
      durationSeconds: runRow.duration_ms ? Math.round(runRow.duration_ms / 1000) : null,
      costCents: runRow.cost_cents ?? null,
      creditsUsed,
      confidence: runRow.confidence,
      prUrl: runRow.pr_url,
      branchName: runRow.branch_name,
      errorMessage: runRow.error,
      modelUsed: runRow.model_used,
      createdAt: runRow.created_at,
      updatedAt: runRow.updated_at,
    });
  } catch (err) {
    log.error({ err: String(err), runId: req.params.id }, 'Failed to fetch run');
    res.status(500).json({ error: 'Failed to fetch run' });
  }
});

export { router as runsApiRouter };
