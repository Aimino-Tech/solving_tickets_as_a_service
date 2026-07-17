import { Router, type Request, type Response } from 'express';
import { queryWithRetry } from '../db/connection.js';
import { rootLogger } from '../utils/logger.js';
import type { KpiMetrics } from '../db/types/kpiMetrics.js';

const log = rootLogger.child({ module: 'kpi-api' });

const router: Router = Router();


async function checkAdmin(req: Request, res: Response): Promise<boolean> {
  const { config } = await import('../config.js');
  const adminKey = req.headers['x-admin-key'] as string;
  if (!adminKey || adminKey !== config.security.adminApiKey) {
    res.status(401).json({ error: 'Unauthorized — valid x-admin-key header required' });
    return false;
  }
  return true;
}

function rowToMetric(row: Record<string, unknown>): KpiMetrics {
  return {
    id: Number(row.id),
    snapshotDate: String(row.snapshot_date ?? ''),
    activeReposMa: Number(row.active_repos_ma ?? 0),
    fixCompletionRate: Number(row.fix_completion_rate ?? 0),
    totalRuns: Number(row.total_runs ?? 0),
    successfulRuns: Number(row.successful_runs ?? 0),
    failedRuns: Number(row.failed_runs ?? 0),
    freeAccounts: Number(row.free_accounts ?? 0),
    paidAccounts: Number(row.paid_accounts ?? 0),
    freeToPaidConversion: Number(row.free_to_paid_conversion ?? 0),
    netRevenueCents: Number(row.net_revenue_cents ?? 0),
    churnRate: Number(row.churn_rate ?? 0),
    churnedAccounts: Number(row.churned_accounts ?? 0),
    viralCoefficient: Number(row.viral_coefficient ?? 0),
    referredAccounts: Number(row.referred_accounts ?? 0),
    totalNewAccounts: Number(row.total_new_accounts ?? 0),
    createdAt: String(row.created_at ?? ''),
  };
}

router.get('/', async (req: Request, res: Response) => {
  if (!(await checkAdmin(req, res))) return;

  try {
    const days = Math.min(Math.abs(Number(req.query.days) || 30), 365);
    const fromDate = req.query.from as string | undefined;
    const toDate = req.query.to as string | undefined;

    let sql: string;
    let params: unknown[];

    if (fromDate) {
      const endDate = toDate || new Date().toISOString().split('T')[0];
      sql = `SELECT * FROM kpi_metrics WHERE snapshot_date >= $1 AND snapshot_date <= $2 ORDER BY snapshot_date DESC`;
      params = [fromDate, endDate];
    } else {
      sql = `SELECT * FROM kpi_metrics WHERE snapshot_date >= CURRENT_DATE - $1::integer ORDER BY snapshot_date DESC`;
      params = [days];
    }

    const result = await queryWithRetry(sql, params);
    const metrics = result.rows.map(rowToMetric);

    res.json({
      metrics,
      count: metrics.length,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to fetch KPI metrics');
    res.status(500).json({ error: 'Failed to fetch KPI metrics' });
  }
});

router.get('/export', async (req: Request, res: Response) => {
  if (!(await checkAdmin(req, res))) return;

  try {
    const days = Math.min(Math.abs(Number(req.query.days) || 90), 365);

    const result = await queryWithRetry(
      `SELECT * FROM kpi_metrics WHERE snapshot_date >= CURRENT_DATE - $1::integer ORDER BY snapshot_date ASC`,
      [days],
    );

    const rows = result.rows;

    if (rows.length === 0) {
      res.status(404).json({ error: 'No KPI data available for export' });
      return;
    }

    const headers = [
      'snapshot_date',
      'active_repos_ma',
      'fix_completion_rate',
      'total_runs',
      'successful_runs',
      'failed_runs',
      'free_accounts',
      'paid_accounts',
      'free_to_paid_conversion',
      'net_revenue_cents',
      'churn_rate',
      'churned_accounts',
      'viral_coefficient',
      'referred_accounts',
      'total_new_accounts',
    ];

    const csvHeader = headers.join(',');
    const csvRows = rows.map((row: Record<string, unknown>) =>
      headers.map((h) => String(row[h] ?? '')).join(','),
    );
    const csv = `${csvHeader}\n${csvRows.join('\n')}\n`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="kpi_metrics_${new Date().toISOString().split('T')[0]}.csv"`);
    res.send(csv);
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to export KPI metrics');
    res.status(500).json({ error: 'Failed to export KPI metrics' });
  }
});

export { router as kpiRouter };
