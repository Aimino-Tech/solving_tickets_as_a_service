/**
 * Admin Runs API — manual fix flow for AI-disabled mode.
 *
 * When STAS_AI_DISABLED=true, issues are stored in `pending` state without
 * dispatching to OpenCode. These endpoints allow operators to:
 *   - List queued runs (pending state)
 *   - Claim a run (assign to self)
 *   - Mark a run complete with a PR URL
 *
 * All routes require ADMIN_API_KEY authentication (shared middleware).
 *
 * @module routes/adminRuns
 */

import { Router, type Request, type Response } from 'express';
import { config } from '../config.js';
import { queryWithRetry, isDatabaseConnectionError } from '../db/connection.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'admin-runs-api' });

const router: Router = Router();

// ---------------------------------------------------------------------------
// Middleware: Admin API key check
// ---------------------------------------------------------------------------

router.use((req: Request, res: Response, next) => {
  const apiKey = config.admin.apiKey;
  if (!apiKey) {
    res.status(503).json({ error: 'Admin API not configured (ADMIN_API_KEY is empty)' });
    return;
  }

  const authHeader = req.headers.authorization;
  const xAdminKey = req.headers['x-admin-key'] as string | undefined;

  const providedKey = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : xAdminKey;

  if (!providedKey || providedKey !== apiKey) {
    res.status(401).json({ error: 'Unauthorized — valid ADMIN_API_KEY required' });
    return;
  }

  next();
});

// ---------------------------------------------------------------------------
// GET /api/v1/admin/runs — list queued runs (pending / claimed)
// ---------------------------------------------------------------------------

router.get('/runs', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Math.abs(Number(req.query.limit) || 50), 200);
    const offset = Math.abs(Number(req.query.offset) || 0);
    const status = req.query.status as string | undefined;
    const repo = req.query.repo as string | undefined;

    const conditions: string[] = [];
    const values: unknown[] = [];
    let paramIdx = 1;

    if (status) {
      conditions.push(`status = $${paramIdx++}`);
      values.push(status);
    } else {
      // Default: only pending and claimed runs
      conditions.push(`status IN ('pending', 'claimed')`);
    }

    if (repo) {
      conditions.push(`(repo_owner || '/' || repo_name) ILIKE $${paramIdx++}`);
      values.push(`%${repo}%`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Count total
    const countResult = await queryWithRetry<{ total: number }>(
      `SELECT COUNT(*) as total FROM run_history ${whereClause}`,
      values,
    );
    const total = Number(countResult.rows[0]?.total ?? 0);

    // Fetch runs
    const result = await queryWithRetry(
      `SELECT * FROM run_history ${whereClause} ORDER BY COALESCE(updated_at, created_at) DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
      [...values, limit, offset],
    );

    res.json({
      runs: result.rows,
      total,
      limit,
      offset,
      aiDisabled: config.stas.aiDisabled,
    });
  } catch (err) {
    if (isDatabaseConnectionError(err)) {
      log.warn({ err: String(err) }, 'Database unavailable — returning degraded response for admin runs list');
      res.json({ runs: [], total: 0, limit, offset, degraded: true });
      return;
    }
    log.error({ err: String(err) }, 'Failed to list admin runs');
    res.status(500).json({ error: 'Failed to list runs' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/v1/admin/runs/pending — list only pending runs (alias)
// ---------------------------------------------------------------------------

router.get('/runs/pending', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Math.abs(Number(req.query.limit) || 50), 200);
    const offset = Math.abs(Number(req.query.offset) || 0);

    // Count total pending
    const countResult = await queryWithRetry<{ total: number }>(
      `SELECT COUNT(*) as total FROM run_history WHERE status = 'pending'`,
    );
    const total = Number(countResult.rows[0]?.total ?? 0);

    // Fetch pending runs
    const result = await queryWithRetry(
      `SELECT * FROM run_history WHERE status = 'pending' ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset],
    );

    res.json({
      runs: result.rows,
      total,
      limit,
      offset,
      aiDisabled: config.stas.aiDisabled,
    });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to list pending runs');
    res.status(500).json({ error: 'Failed to list pending runs' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/v1/admin/runs/:id/claim — claim a run
// ---------------------------------------------------------------------------

router.post('/runs/:id/claim', async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      res.status(400).json({ error: 'Invalid run ID' });
      return;
    }

    // Verify the run exists and is in pending state
    const existing = await queryWithRetry(
      'SELECT * FROM run_history WHERE id = $1',
      [id],
    );

    if (existing.rows.length === 0) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }

    const run = existing.rows[0];
    if (run.status !== 'pending') {
      res.status(409).json({
        error: `Run is not in pending state (current: ${run.status})`,
        currentStatus: run.status,
      });
      return;
    }

    const claimedBy = req.body.claimedBy || 'admin';

    // Update the run to claimed status
    const result = await queryWithRetry(
      `UPDATE run_history
       SET status = 'claimed',
           updated_at = NOW(),
           metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{claimed_by}', to_jsonb($2::text))
       WHERE id = $1
       RETURNING *`,
      [id, claimedBy],
    );

    log.info({ runId: id, claimedBy }, 'Run claimed');
    res.json({ run: result.rows[0], claimed: true });
  } catch (err) {
    log.error({ err: String(err), runId: req.params.id }, 'Failed to claim run');
    res.status(500).json({ error: 'Failed to claim run' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/v1/admin/runs/:id/complete — mark run complete with PR URL
// ---------------------------------------------------------------------------

router.post('/runs/:id/complete', async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      res.status(400).json({ error: 'Invalid run ID' });
      return;
    }

    const { prUrl } = req.body;
    if (!prUrl || typeof prUrl !== 'string') {
      res.status(400).json({ error: 'prUrl is required (string)' });
      return;
    }

    // Verify the run exists
    const existing = await queryWithRetry(
      'SELECT * FROM run_history WHERE id = $1',
      [id],
    );

    if (existing.rows.length === 0) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }

    // Update the run to completed with PR URL
    const result = await queryWithRetry(
      `UPDATE run_history
       SET status = 'completed',
           pr_url = $2,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id, prUrl],
    );

    log.info({ runId: id, prUrl }, 'Run marked as complete');
    res.json({ run: result.rows[0], completed: true });
  } catch (err) {
    log.error({ err: String(err), runId: req.params.id }, 'Failed to complete run');
    res.status(500).json({ error: 'Failed to complete run' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/v1/admin/runs/:id/cancel — cancel a pending/claimed run
// ---------------------------------------------------------------------------

router.post('/runs/:id/cancel', async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      res.status(400).json({ error: 'Invalid run ID' });
      return;
    }

    const existing = await queryWithRetry(
      'SELECT * FROM run_history WHERE id = $1',
      [id],
    );

    if (existing.rows.length === 0) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }

    const result = await queryWithRetry(
      `UPDATE run_history
       SET status = 'cancelled',
           updated_at = NOW()
       WHERE id = $1 AND status IN ('pending', 'claimed')
       RETURNING *`,
      [id],
    );

    if (result.rows.length === 0) {
      res.status(409).json({
        error: 'Run could not be cancelled (not in pending/claimed state)',
        currentStatus: existing.rows[0].status,
      });
      return;
    }

    log.info({ runId: id }, 'Run cancelled');
    res.json({ run: result.rows[0], cancelled: true });
  } catch (err) {
    log.error({ err: String(err), runId: req.params.id }, 'Failed to cancel run');
    res.status(500).json({ error: 'Failed to cancel run' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/v1/admin/runs/stats — run statistics for operator dashboard
// ---------------------------------------------------------------------------

router.get('/runs/stats', async (_req: Request, res: Response) => {
  try {
    const result = await queryWithRetry<{ status: string; count: number }>(
      `SELECT status, COUNT(*) as count FROM run_history GROUP BY status ORDER BY status`,
    );

    const stats: Record<string, number> = {};
    for (const row of result.rows) {
      stats[row.status] = Number(row.count);
    }

    res.json({
      stats,
      aiDisabled: config.stas.aiDisabled,
      mode: config.stas.aiDisabled ? 'ai-disabled' : 'normal',
    });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to fetch run stats');
    res.status(500).json({ error: 'Failed to fetch run stats' });
  }
});

export { router as adminRunsRouter };
