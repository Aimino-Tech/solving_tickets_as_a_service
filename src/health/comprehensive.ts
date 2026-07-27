import { getDependenciesHealth, type DependenciesHealthReport } from './dependencies.js';
import { getQueueHealth, type QueueHealthReport } from './queueHealth.js';
import { rootLogger } from '../utils/logger.js';
import { queryWithRetry } from '../db/connection.js';

const log = rootLogger.child({ module: 'comprehensive-health' });

export interface PipelineHealthMetrics {
  activeRuns: number;
  stalledRuns: number;
  avgDurationMs: number;
  throughputPerHour: number;
  lastRunAt: string | null;
}

export interface ComprehensiveHealthReport {
  status: 'ok' | 'degraded' | 'critical';
  timestamp: string;
  uptime: number;
  version: string;
  dependencies: DependenciesHealthReport;
  queue: QueueHealthReport;
  pipeline: PipelineHealthMetrics;
}

const START_TIME = Date.now();

export async function getComprehensiveHealth(): Promise<ComprehensiveHealthReport> {
  const [deps, queue] = await Promise.all([
    getDependenciesHealth().catch((err) => {
      log.error({ err: String(err) }, 'Dependency health check failed');
      return { status: 'degraded', dependencies: [], timestamp: new Date().toISOString() } as DependenciesHealthReport;
    }),
    getQueueHealth().catch((err) => {
      log.error({ err: String(err) }, 'Queue health check failed');
      return {
        status: 'degraded', timestamp: new Date().toISOString(),
        summary: { totalMessages: 0, dlqMessages: 0, activeWorkers: 0, queuesWithWarnings: 0, queuesWithCritical: 0 },
        queues: [],
      } as QueueHealthReport;
    }),
  ]);

  let pipeline: PipelineHealthMetrics;
  try {
    const runsResult = await queryWithRetry<any>(
      `SELECT
        COUNT(*) FILTER (WHERE status = 'running' OR status = 'queued') as active_runs,
        COUNT(*) FILTER (WHERE status = 'running' AND updated_at < NOW() - INTERVAL '30 minutes') as stalled_runs,
        AVG(duration_ms) FILTER (WHERE status = 'completed' AND duration_ms IS NOT NULL) as avg_duration_ms,
        COUNT(*) FILTER (WHERE status = 'completed' AND created_at > NOW() - INTERVAL '1 hour') as completed_last_hour,
        MAX(completed_at) FILTER (WHERE status = 'completed') as last_run_at
       FROM runs`,
    );
    const row = runsResult.rows[0] || {};
    pipeline = {
      activeRuns: Number(row.active_runs ?? 0),
      stalledRuns: Number(row.stalled_runs ?? 0),
      avgDurationMs: row.avg_duration_ms ? Math.round(Number(row.avg_duration_ms)) : 0,
      throughputPerHour: Number(row.completed_last_hour ?? 0),
      lastRunAt: row.last_run_at ?? null,
    };
  } catch (err) {
    log.warn({ err: String(err) }, 'Pipeline health metrics unavailable');
    pipeline = { activeRuns: 0, stalledRuns: 0, avgDurationMs: 0, throughputPerHour: 0, lastRunAt: null };
  }

  const servicesDown = deps.dependencies.filter((d) => d.status === 'error').length;
  const criticalQueues = queue.queues.filter((q) => q.status === 'critical').length;
  const stalledPipelines = pipeline.stalledRuns > 0;

  let overallStatus: ComprehensiveHealthReport['status'] = 'ok';
  if (servicesDown > 0 || criticalQueues > 0 || stalledPipelines) {
    overallStatus = 'critical';
  } else if (deps.status === 'degraded' || queue.status === 'degraded') {
    overallStatus = 'degraded';
  }

  return {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    uptime: Math.floor((Date.now() - START_TIME) / 1000),
    version: process.env.npm_package_version || '0.1.0',
    dependencies: deps,
    queue,
    pipeline,
  };
}

export interface SlaMetrics {
  p50FixTimeMs: number;
  p95FixTimeMs: number;
  p99FixTimeMs: number;
  slaAttainmentRate: number;
  totalRuns: number;
  breachedCount: number;
}

export async function getSlaMetrics(): Promise<SlaMetrics> {
  try {
    const result = await queryWithRetry<any>(
      `SELECT
        percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms) as p50,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) as p95,
        percentile_cont(0.99) WITHIN GROUP (ORDER BY duration_ms) as p99,
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE duration_ms > 3600000) as breached
       FROM runs WHERE status = 'completed' AND duration_ms IS NOT NULL`,
    );
    const row = result.rows[0] || {};
    const total = Number(row.total ?? 0);
    const breached = Number(row.breached ?? 0);
    return {
      p50FixTimeMs: row.p50 ? Math.round(Number(row.p50)) : 0,
      p95FixTimeMs: row.p95 ? Math.round(Number(row.p95)) : 0,
      p99FixTimeMs: row.p99 ? Math.round(Number(row.p99)) : 0,
      slaAttainmentRate: total > 0 ? Math.round(((total - breached) / total) * 10000) / 100 : 100,
      totalRuns: total,
      breachedCount: breached,
    };
  } catch (err) {
    log.warn({ err: String(err) }, 'SLA metrics unavailable');
    return { p50FixTimeMs: 0, p95FixTimeMs: 0, p99FixTimeMs: 0, slaAttainmentRate: 100, totalRuns: 0, breachedCount: 0 };
  }
}
