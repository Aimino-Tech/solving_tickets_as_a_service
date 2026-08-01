import { Router, type Request, type Response } from 'express';
import fs from 'node:fs';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import {
  setMaintenanceMode,
  getMaintenanceInfo,
} from '../monitoring/maintenance.js';
import { queryWithRetry } from '../db/connection.js';

const log = rootLogger.child({ module: 'ops-api' });
const router: Router = Router();

function requireAdminKey(req: Request, res: Response): boolean {
  const adminKey = req.headers['x-admin-key'] as string;
  if (!adminKey || adminKey !== config.security.adminApiKey) {
    res.status(401).json({ error: 'Unauthorized — valid x-admin-key header required' });
    return false;
  }
  return true;
}

// GET /api/v1/ops/maintenance — current maintenance state
router.get('/maintenance', (req: Request, res: Response) => {
  if (!requireAdminKey(req, res)) return;
  res.json(getMaintenanceInfo());
});

// PUT /api/v1/ops/maintenance — enable/disable maintenance mode
router.put('/maintenance', (req: Request, res: Response) => {
  if (!requireAdminKey(req, res)) return;
  const active = Boolean(req.body?.active);
  const message = typeof req.body?.message === 'string' ? req.body.message : undefined;
  setMaintenanceMode(active, message);
  log.warn({ active, message }, 'Maintenance mode set via admin API');
  res.json(getMaintenanceInfo());
});

// GET /api/v1/ops/logs/tail?lines=100 — tail the STAS log file
router.get('/logs/tail', (req: Request, res: Response) => {
  if (!requireAdminKey(req, res)) return;
  const lines = Math.min(Math.abs(Number(req.query.lines) || 100), 2000);
  const logFile = config.logFile || process.env.STAS_LOG_FILE;
  if (!logFile || !fs.existsSync(logFile)) {
    res.status(404).json({ error: 'No log file configured (STAS_LOG_FILE)' });
    return;
  }
  const content = fs.readFileSync(logFile, 'utf-8');
  const tail = content.split('\n').filter(Boolean).slice(-lines).join('\n');
  res.type('text/plain').send(tail);
});

// GET /api/v1/ops/logs/stream?lines=50 — SSE log stream (real-time tailing)
router.get('/logs/stream', (req: Request, res: Response) => {
  if (!requireAdminKey(req, res)) return;
  const logFile = config.logFile || process.env.STAS_LOG_FILE;
  if (!logFile || !fs.existsSync(logFile)) {
    res.status(404).json({ error: 'No log file configured (STAS_LOG_FILE)' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  let position = Math.max(0, fs.statSync(logFile).size - 32_000);
  const sendLines = () => {
    const size = fs.statSync(logFile).size;
    if (size < position) position = 0;
    const handle = fs.openSync(logFile, 'r');
    try {
      const buffer = Buffer.alloc(size - position);
      fs.readSync(handle, buffer, 0, buffer.length, position);
      const text = buffer.toString('utf-8');
      for (const line of text.split('\n').filter(Boolean)) {
        res.write(`data: ${JSON.stringify(line)}\n\n`);
      }
    } finally {
      fs.closeSync(handle);
    }
    position = size;
  };

  const interval = setInterval(sendLines, 2000);
  req.on('close', () => clearInterval(interval));
});

// GET /api/v1/ops/usage/:tenantId — tenant-scoped usage metrics
router.get('/usage/:tenantId', async (req: Request, res: Response) => {
  if (!requireAdminKey(req, res)) return;
  const tenantId = req.params.tenantId;
  const days = Math.min(Math.abs(Number(req.query.days) || 30), 365);
  try {
    const [runs, feedback, usage] = await Promise.all([
      queryWithRetry<Record<string, unknown>>(
        `SELECT
           COUNT(*)::int AS total_runs,
           COUNT(*) FILTER (WHERE status = 'success')::int AS successful_runs,
           COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_runs,
           COALESCE(AVG(duration_ms), 0)::float8 AS avg_duration_ms
         FROM run_history
         WHERE account_id = $1::int AND started_at >= NOW() - ($2::int * INTERVAL '1 day')`,
        [tenantId, days],
      ),
      queryWithRetry<Record<string, unknown>>(
        `SELECT verdict, COUNT(*)::int AS count
         FROM run_feedback f
         JOIN run_history r ON r.id = f.run_id
         WHERE r.account_id = $1::int AND f.created_at >= NOW() - ($2::int * INTERVAL '1 day')
         GROUP BY verdict`,
        [tenantId, days],
      ),
      queryWithRetry<Record<string, unknown>>(
        `SELECT
           COUNT(*)::int AS credits_transactions,
           COALESCE(SUM(credits_used), 0)::int AS credits_used
         FROM usage_records
         WHERE account_id = $1::int AND timestamp >= NOW() - ($2::int * INTERVAL '1 day')`,
        [tenantId, days],
      ),
    ]);

    res.json({
      tenantId,
      days,
      runs: runs.rows[0] ?? {},
      feedback: feedback.rows,
      usage: usage.rows[0] ?? {},
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    log.error({ err: String(err), tenantId }, 'Failed to fetch tenant usage');
    res.status(500).json({ error: 'Failed to fetch tenant usage' });
  }
});

export { router as opsRouter };
