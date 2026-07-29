/**
 * Capacity Metrics — daily aggregates for system capacity planning.
 *
 * Tracks daily snapshots across fixes, webhooks, workers, queue, DB,
 * storage, API calls, and costs. Snapshots are stored in-memory and
 * persisted to PostgreSQL via the capacity_metrics table.
 */

import { queryWithRetry } from '../db/connection.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'capacity-metrics' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CapacityFixMetrics {
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  avgDurationMs: number;
  p95DurationMs: number;
}

export interface CapacityWebhookMetrics {
  totalReceived: number;
  totalDelivered: number;
  failedDeliveries: number;
  avgLatencyMs: number;
}

export interface CapacityWorkerMetrics {
  activeWorkers: number;
  crashedWorkers: number;
  avgHeartbeatLatencyMs: number;
  maxConcurrentTasks: number;
}

export interface CapacityQueueMetrics {
  currentDepth: number;
  maxDepth: number;
  throughputPerMinute: number;
  avgWaitTimeMs: number;
}

export interface CapacityDatabaseMetrics {
  activeConnections: number;
  totalQueries: number;
  avgQueryTimeMs: number;
  slowQueries: number;
}

export interface CapacityStorageMetrics {
  totalBytes: number;
  dbSizeBytes: number;
  logSizeBytes: number;
  rowCount: number;
  growthBytes24h: number;
}

export interface CapacityApiMetrics {
  totalRequests: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  errorRatePercent: number;
}

export interface CapacityCostMetrics {
  totalMillicents: number;
  modelMillicents: number;
  sandboxMillicents: number;
  computeMillicents: number;
  avgCostPerFixMillicents: number;
}

export interface DailyCapacitySnapshot {
  snapshotDate: string;
  fixes: CapacityFixMetrics;
  webhooks: CapacityWebhookMetrics;
  workers: CapacityWorkerMetrics;
  queue: CapacityQueueMetrics;
  database: CapacityDatabaseMetrics;
  storage: CapacityStorageMetrics;
  api: CapacityApiMetrics;
  costs: CapacityCostMetrics;
}

export interface DailyCapacityRecord {
  id: number;
  snapshotDate: string;
  fixTotalRuns: number;
  fixSuccessfulRuns: number;
  fixFailedRuns: number;
  fixAvgDurationMs: number;
  fixP95DurationMs: number;
  webhookTotalReceived: number;
  webhookTotalDelivered: number;
  webhookFailedDeliveries: number;
  webhookAvgLatencyMs: number;
  workerActiveWorkers: number;
  workerCrashedWorkers: number;
  workerAvgHeartbeatLatencyMs: number;
  workerMaxConcurrentTasks: number;
  queueCurrentDepth: number;
  queueMaxDepth: number;
  queueThroughputPerMinute: number;
  queueAvgWaitTimeMs: number;
  dbActiveConnections: number;
  dbTotalQueries: number;
  dbAvgQueryTimeMs: number;
  dbSlowQueries: number;
  storageTotalBytes: number;
  storageDbSizeBytes: number;
  storageLogSizeBytes: number;
  storageRowCount: number;
  storageGrowthBytes24h: number;
  apiTotalRequests: number;
  apiP50LatencyMs: number;
  apiP95LatencyMs: number;
  apiP99LatencyMs: number;
  apiErrorRatePercent: number;
  costTotalMillicents: number;
  costModelMillicents: number;
  costSandboxMillicents: number;
  costComputeMillicents: number;
  costAvgPerFixMillicents: number;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// In-memory store
// ---------------------------------------------------------------------------

const snapshots: DailyCapacitySnapshot[] = [];

// ---------------------------------------------------------------------------
// Snapshot factory
// ---------------------------------------------------------------------------

export function createSnapshot(
  date: string,
  overrides?: Partial<DailyCapacitySnapshot>,
): DailyCapacitySnapshot {
  const zero = (): DailyCapacitySnapshot => ({
    snapshotDate: date,
    fixes: { totalRuns: 0, successfulRuns: 0, failedRuns: 0, avgDurationMs: 0, p95DurationMs: 0 },
    webhooks: { totalReceived: 0, totalDelivered: 0, failedDeliveries: 0, avgLatencyMs: 0 },
    workers: { activeWorkers: 0, crashedWorkers: 0, avgHeartbeatLatencyMs: 0, maxConcurrentTasks: 0 },
    queue: { currentDepth: 0, maxDepth: 0, throughputPerMinute: 0, avgWaitTimeMs: 0 },
    database: { activeConnections: 0, totalQueries: 0, avgQueryTimeMs: 0, slowQueries: 0 },
    storage: { totalBytes: 0, dbSizeBytes: 0, logSizeBytes: 0, rowCount: 0, growthBytes24h: 0 },
    api: { totalRequests: 0, p50LatencyMs: 0, p95LatencyMs: 0, p99LatencyMs: 0, errorRatePercent: 0 },
    costs: { totalMillicents: 0, modelMillicents: 0, sandboxMillicents: 0, computeMillicents: 0, avgCostPerFixMillicents: 0 },
  });

  const base = zero();
  if (!overrides) return base;

  return {
    snapshotDate: date,
    fixes: { ...base.fixes, ...overrides.fixes },
    webhooks: { ...base.webhooks, ...overrides.webhooks },
    workers: { ...base.workers, ...overrides.workers },
    queue: { ...base.queue, ...overrides.queue },
    database: { ...base.database, ...overrides.database },
    storage: { ...base.storage, ...overrides.storage },
    api: { ...base.api, ...overrides.api },
    costs: { ...base.costs, ...overrides.costs },
  };
}

// ---------------------------------------------------------------------------
// Record and persist
// ---------------------------------------------------------------------------

export async function recordSnapshot(snapshot: DailyCapacitySnapshot): Promise<DailyCapacitySnapshot> {
  const existingIndex = snapshots.findIndex((s) => s.snapshotDate === snapshot.snapshotDate);
  if (existingIndex >= 0) {
    snapshots[existingIndex] = snapshot;
  } else {
    snapshots.push(snapshot);
  }

  try {
    await persistSnapshot(snapshot);
  } catch (err) {
    log.error({ err: String(err), snapshotDate: snapshot.snapshotDate }, 'Failed to persist capacity snapshot to DB');
  }

  log.info(
    {
      snapshotDate: snapshot.snapshotDate,
      fixCount: snapshot.fixes.totalRuns,
      totalCost: snapshot.costs.totalMillicents,
    },
    'Capacity snapshot recorded',
  );

  return snapshot;
}

async function persistSnapshot(snapshot: DailyCapacitySnapshot): Promise<void> {
  const { snapshotDate, fixes, webhooks, workers, queue, database, storage, api, costs } = snapshot;

  await queryWithRetry(
    `INSERT INTO capacity_metrics (
      snapshot_date,
      fix_total_runs, fix_successful_runs, fix_failed_runs, fix_avg_duration_ms, fix_p95_duration_ms,
      webhook_total_received, webhook_total_delivered, webhook_failed_deliveries, webhook_avg_latency_ms,
      worker_active_workers, worker_crashed_workers, worker_avg_heartbeat_latency_ms, worker_max_concurrent_tasks,
      queue_current_depth, queue_max_depth, queue_throughput_per_minute, queue_avg_wait_time_ms,
      db_active_connections, db_total_queries, db_avg_query_time_ms, db_slow_queries,
      storage_total_bytes, storage_db_size_bytes, storage_log_size_bytes, storage_row_count, storage_growth_bytes_24h,
      api_total_requests, api_p50_latency_ms, api_p95_latency_ms, api_p99_latency_ms, api_error_rate_percent,
      cost_total_millicents, cost_model_millicents, cost_sandbox_millicents, cost_compute_millicents, cost_avg_per_fix_millicents
    ) VALUES (
      $1, $2, $3, $4, $5, $6,
      $7, $8, $9, $10,
      $11, $12, $13, $14,
      $15, $16, $17, $18,
      $19, $20, $21, $22,
      $23, $24, $25, $26, $27,
      $28, $29, $30, $31, $32,
      $33, $34, $35, $36, $37
    ) ON CONFLICT (snapshot_date) DO UPDATE SET
      fix_total_runs = EXCLUDED.fix_total_runs,
      fix_successful_runs = EXCLUDED.fix_successful_runs,
      fix_failed_runs = EXCLUDED.fix_failed_runs,
      fix_avg_duration_ms = EXCLUDED.fix_avg_duration_ms,
      fix_p95_duration_ms = EXCLUDED.fix_p95_duration_ms,
      webhook_total_received = EXCLUDED.webhook_total_received,
      webhook_total_delivered = EXCLUDED.webhook_total_delivered,
      webhook_failed_deliveries = EXCLUDED.webhook_failed_deliveries,
      webhook_avg_latency_ms = EXCLUDED.webhook_avg_latency_ms,
      worker_active_workers = EXCLUDED.worker_active_workers,
      worker_crashed_workers = EXCLUDED.worker_crashed_workers,
      worker_avg_heartbeat_latency_ms = EXCLUDED.worker_avg_heartbeat_latency_ms,
      worker_max_concurrent_tasks = EXCLUDED.worker_max_concurrent_tasks,
      queue_current_depth = EXCLUDED.queue_current_depth,
      queue_max_depth = EXCLUDED.queue_max_depth,
      queue_throughput_per_minute = EXCLUDED.queue_throughput_per_minute,
      queue_avg_wait_time_ms = EXCLUDED.queue_avg_wait_time_ms,
      db_active_connections = EXCLUDED.db_active_connections,
      db_total_queries = EXCLUDED.db_total_queries,
      db_avg_query_time_ms = EXCLUDED.db_avg_query_time_ms,
      db_slow_queries = EXCLUDED.db_slow_queries,
      storage_total_bytes = EXCLUDED.storage_total_bytes,
      storage_db_size_bytes = EXCLUDED.storage_db_size_bytes,
      storage_log_size_bytes = EXCLUDED.storage_log_size_bytes,
      storage_row_count = EXCLUDED.storage_row_count,
      storage_growth_bytes_24h = EXCLUDED.storage_growth_bytes_24h,
      api_total_requests = EXCLUDED.api_total_requests,
      api_p50_latency_ms = EXCLUDED.api_p50_latency_ms,
      api_p95_latency_ms = EXCLUDED.api_p95_latency_ms,
      api_p99_latency_ms = EXCLUDED.api_p99_latency_ms,
      api_error_rate_percent = EXCLUDED.api_error_rate_percent,
      cost_total_millicents = EXCLUDED.cost_total_millicents,
      cost_model_millicents = EXCLUDED.cost_model_millicents,
      cost_sandbox_millicents = EXCLUDED.cost_sandbox_millicents,
      cost_compute_millicents = EXCLUDED.cost_compute_millicents,
      cost_avg_per_fix_millicents = EXCLUDED.cost_avg_per_fix_millicents
    `,
    [
      snapshotDate,
      fixes.totalRuns, fixes.successfulRuns, fixes.failedRuns, fixes.avgDurationMs, fixes.p95DurationMs,
      webhooks.totalReceived, webhooks.totalDelivered, webhooks.failedDeliveries, webhooks.avgLatencyMs,
      workers.activeWorkers, workers.crashedWorkers, workers.avgHeartbeatLatencyMs, workers.maxConcurrentTasks,
      queue.currentDepth, queue.maxDepth, queue.throughputPerMinute, queue.avgWaitTimeMs,
      database.activeConnections, database.totalQueries, database.avgQueryTimeMs, database.slowQueries,
      storage.totalBytes, storage.dbSizeBytes, storage.logSizeBytes, storage.rowCount, storage.growthBytes24h,
      api.totalRequests, api.p50LatencyMs, api.p95LatencyMs, api.p99LatencyMs, api.errorRatePercent,
      costs.totalMillicents, costs.modelMillicents, costs.sandboxMillicents, costs.computeMillicents, costs.avgCostPerFixMillicents,
    ],
  );
}

// ---------------------------------------------------------------------------
// Query methods
// ---------------------------------------------------------------------------

export function getSnapshots(): DailyCapacitySnapshot[] {
  return [...snapshots].sort(
    (a, b) => b.snapshotDate.localeCompare(a.snapshotDate),
  );
}

export function getSnapshot(date: string): DailyCapacitySnapshot | undefined {
  return snapshots.find((s) => s.snapshotDate === date);
}

export function getRecentSnapshots(days: number): DailyCapacitySnapshot[] {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  return snapshots
    .filter((s) => s.snapshotDate >= cutoffStr)
    .sort((a, b) => b.snapshotDate.localeCompare(a.snapshotDate));
}

export async function loadHistory(limit = 90): Promise<number> {
  try {
    const result = await queryWithRetry<DailyCapacityRecord>(
      `SELECT * FROM capacity_metrics ORDER BY snapshot_date DESC LIMIT $1`,
      [limit],
    );

    for (const row of result.rows) {
      const snapshot = rowToSnapshot(row);
      const existingIndex = snapshots.findIndex((s) => s.snapshotDate === snapshot.snapshotDate);
      if (existingIndex >= 0) {
        snapshots[existingIndex] = snapshot;
      } else {
        snapshots.push(snapshot);
      }
    }

    log.info({ loaded: result.rows.length }, 'Historical capacity snapshots loaded');
    return result.rows.length;
  } catch (err) {
    log.warn({ err: String(err) }, 'Could not load capacity history (table may not exist yet)');
    return 0;
  }
}

export function projectCapacity(
  daysAhead: number,
): Array<{ date: string; estimatedFixes: number; estimatedCostMillicents: number; estimatedStorageBytes: number }> {
  const sorted = [...snapshots].sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate));
  if (sorted.length < 2) {
    return [];
  }

  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const dayCount = sorted.length;

  const fixGrowthPerDay = (last.fixes.totalRuns - first.fixes.totalRuns) / Math.max(dayCount - 1, 1);
  const costGrowthPerDay = (last.costs.totalMillicents - first.costs.totalMillicents) / Math.max(dayCount - 1, 1);
  const storageGrowthPerDay = (last.storage.totalBytes - first.storage.totalBytes) / Math.max(dayCount - 1, 1);

  const lastDate = new Date(last.snapshotDate);
  const projections: Array<{ date: string; estimatedFixes: number; estimatedCostMillicents: number; estimatedStorageBytes: number }> = [];

  for (let i = 1; i <= daysAhead; i++) {
    const d = new Date(lastDate);
    d.setDate(d.getDate() + i);
    projections.push({
      date: d.toISOString().slice(0, 10),
      estimatedFixes: Math.max(0, Math.round(last.fixes.totalRuns + fixGrowthPerDay * i)),
      estimatedCostMillicents: Math.max(0, Math.round(last.costs.totalMillicents + costGrowthPerDay * i)),
      estimatedStorageBytes: Math.max(0, Math.round(last.storage.totalBytes + storageGrowthPerDay * i)),
    });
  }

  return projections;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rowToSnapshot(row: DailyCapacityRecord): DailyCapacitySnapshot {
  return {
    snapshotDate: row.snapshotDate,
    fixes: {
      totalRuns: row.fixTotalRuns,
      successfulRuns: row.fixSuccessfulRuns,
      failedRuns: row.fixFailedRuns,
      avgDurationMs: row.fixAvgDurationMs,
      p95DurationMs: row.fixP95DurationMs,
    },
    webhooks: {
      totalReceived: row.webhookTotalReceived,
      totalDelivered: row.webhookTotalDelivered,
      failedDeliveries: row.webhookFailedDeliveries,
      avgLatencyMs: row.webhookAvgLatencyMs,
    },
    workers: {
      activeWorkers: row.workerActiveWorkers,
      crashedWorkers: row.workerCrashedWorkers,
      avgHeartbeatLatencyMs: row.workerAvgHeartbeatLatencyMs,
      maxConcurrentTasks: row.workerMaxConcurrentTasks,
    },
    queue: {
      currentDepth: row.queueCurrentDepth,
      maxDepth: row.queueMaxDepth,
      throughputPerMinute: row.queueThroughputPerMinute,
      avgWaitTimeMs: row.queueAvgWaitTimeMs,
    },
    database: {
      activeConnections: row.dbActiveConnections,
      totalQueries: row.dbTotalQueries,
      avgQueryTimeMs: row.dbAvgQueryTimeMs,
      slowQueries: row.dbSlowQueries,
    },
    storage: {
      totalBytes: row.storageTotalBytes,
      dbSizeBytes: row.storageDbSizeBytes,
      logSizeBytes: row.storageLogSizeBytes,
      rowCount: row.storageRowCount,
      growthBytes24h: row.storageGrowthBytes24h,
    },
    api: {
      totalRequests: row.apiTotalRequests,
      p50LatencyMs: row.apiP50LatencyMs,
      p95LatencyMs: row.apiP95LatencyMs,
      p99LatencyMs: row.apiP99LatencyMs,
      errorRatePercent: row.apiErrorRatePercent,
    },
    costs: {
      totalMillicents: row.costTotalMillicents,
      modelMillicents: row.costModelMillicents,
      sandboxMillicents: row.costSandboxMillicents,
      computeMillicents: row.costComputeMillicents,
      avgCostPerFixMillicents: row.costAvgPerFixMillicents,
    },
  };
}

export function clearSnapshots(): void {
  snapshots.length = 0;
}
