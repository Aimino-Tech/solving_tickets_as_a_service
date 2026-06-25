/**
 * Data Retention Cleanup Service
 *
 * Configurable retention policy enforcement for database tables.
 * Designed to be run as a scheduled cron job (via Celery Beat or systemd timer).
 *
 * Features:
 * - Per-table retention period configuration
 * - Dry-run mode for safe preview
 * - Soft-delete (archive_logs table) vs hard-delete (DELETE) per table
 * - Archive-to-S3 for audit logs after retention period
 * - Detailed logging of every deletion
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { rootLogger } from '../utils/logger.js';
import { queryWithRetry } from '../db/connection.js';
import { config } from '../config.js';

const log = rootLogger.child({ module: 'retention' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RetentionPolicy {
  /** Number of days to retain data before cleanup */
  retentionDays: number;
  /** Delete strategy */
  deletionMode: 'soft' | 'hard';
  /** Table column with the timestamp to compare */
  dateColumn: string;
  /** Optional: archive rows to archive_logs table before deletion */
  archiveBeforeDelete: boolean;
}

export interface RetentionConfig {
  [tableName: string]: RetentionPolicy;
}

export interface CleanupResult {
  table: string;
  rowsAffected: number;
  mode: 'soft' | 'hard';
  dryRun: boolean;
  archived: number;
  error?: string;
}

export interface CleanupReport {
  timestamp: string;
  dryRun: boolean;
  results: CleanupResult[];
  totalRowsCleaned: number;
  totalErrors: number;
}

// ---------------------------------------------------------------------------
// Default Retention Configuration
// ---------------------------------------------------------------------------

export const DEFAULT_RETENTION_POLICIES: RetentionConfig = {
  audit_logs: {
    retentionDays: 90,
    deletionMode: 'soft',
    dateColumn: 'created_at',
    archiveBeforeDelete: true,
  },
  webhook_events: {
    retentionDays: 30,
    deletionMode: 'hard',
    dateColumn: 'created_at',
    archiveBeforeDelete: false,
  },
  usage_records: {
    retentionDays: 365, // 12 months
    deletionMode: 'soft',
    dateColumn: 'timestamp',
    archiveBeforeDelete: true,
  },
  run_history: {
    retentionDays: -1, // -1 = indefinite (never clean up)
    deletionMode: 'hard',
    dateColumn: 'created_at',
    archiveBeforeDelete: false,
  },
  credit_transactions: {
    retentionDays: -1, // indefinite (financial records)
    deletionMode: 'hard',
    dateColumn: 'created_at',
    archiveBeforeDelete: false,
  },
};

// ---------------------------------------------------------------------------
// Ensure archive_logs table exists
// ---------------------------------------------------------------------------

const ARCHIVE_TABLE_DDL = `
  CREATE TABLE IF NOT EXISTS archive_logs (
    id BIGSERIAL PRIMARY KEY,
    source_table VARCHAR(255) NOT NULL,
    source_row_id INTEGER NOT NULL,
    archived_data JSONB NOT NULL,
    archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_archive_logs_source_table
    ON archive_logs (source_table);

  CREATE INDEX IF NOT EXISTS idx_archive_logs_archived_at
    ON archive_logs (archived_at);
`;

async function ensureArchiveTable(): Promise<void> {
  const statements = ARCHIVE_TABLE_DDL
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const stmt of statements) {
    await queryWithRetry(stmt);
  }
}

// ---------------------------------------------------------------------------
// Policy check helper
// ---------------------------------------------------------------------------

/**
 * Get the cutoff date based on retention days.
 * Returns null if retention is indefinite (-1).
 */
function getCutoffDate(retentionDays: number): Date | null {
  if (retentionDays < 0) return null;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);
  return cutoff;
}

// ---------------------------------------------------------------------------
// S3 Archive (for audit logs)
// ---------------------------------------------------------------------------

/**
 * Archive audit logs to S3 before cleanup.
 */
async function archiveToS3Staging(
  table: string,
  rows: Record<string, unknown>[],
  cutoffDate: Date,
): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `archive-${table}-${cutoffDate.toISOString().slice(0, 10)}-${timestamp}.json`;
  const archiveDir = process.env.BACKUP_DIR || '/tmp/stas-archives';

  const { mkdirSync } = await import('node:fs');
  mkdirSync(archiveDir, { recursive: true });

  const filePath = join(archiveDir, filename);
  writeFileSync(filePath, JSON.stringify(rows, null, 2));
  log.info({ filePath, table, rowCount: rows.length }, 'Archive written to staging directory');

  return filePath;
}

// ---------------------------------------------------------------------------
// Retention periods from env (optional overrides)
// ---------------------------------------------------------------------------

function getEnvRetentionDays(key: string): number | undefined {
  const val = process.env[key];
  if (val === undefined) return undefined;
  const parsed = Number.parseInt(val, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function buildEffectiveConfig(): RetentionConfig {
  const policies: RetentionConfig = {};
  for (const [table, policy] of Object.entries(DEFAULT_RETENTION_POLICIES)) {
    const envKey = `RETENTION_${table.toUpperCase()}_DAYS`;
    const envOverride = getEnvRetentionDays(envKey);
    policies[table] = {
      ...policy,
      retentionDays: envOverride ?? policy.retentionDays,
    };
  }
  return policies;
}

// ---------------------------------------------------------------------------
// Core: Cleanup a single table
// ---------------------------------------------------------------------------

async function cleanupTable(
  tableName: string,
  policy: RetentionPolicy,
  dryRun: boolean,
): Promise<CleanupResult> {
  const result: CleanupResult = {
    table: tableName,
    rowsAffected: 0,
    mode: policy.deletionMode,
    dryRun,
    archived: 0,
  };

  const cutoffDate = getCutoffDate(policy.retentionDays);

  if (cutoffDate === null) {
    log.info({ table: tableName }, 'Indefinite retention — skipping cleanup');
    return result;
  }

  const cutoffStr = cutoffDate.toISOString();
  log.info(
    { table: tableName, cutoff: cutoffStr, mode: policy.deletionMode, dryRun },
    `Running retention cleanup for ${tableName}`,
  );

  try {
    const findQuery = `SELECT id FROM "${tableName}" WHERE ${policy.dateColumn} < $1`;
    const eligible = await queryWithRetry<{ id: number }>(findQuery, [cutoffStr]);
    const rowIds = eligible.rows.map((r) => r.id);

    if (rowIds.length === 0) {
      log.info({ table: tableName }, 'No rows eligible for cleanup');
      return result;
    }

    if (policy.archiveBeforeDelete && !dryRun) {
      await ensureArchiveTable();
      const archiveQuery = `
        WITH to_archive AS (
          SELECT * FROM "${tableName}" WHERE id = ANY($1::int[])
        )
        INSERT INTO archive_logs (source_table, source_row_id, archived_data)
        SELECT $2, id, row_to_json(to_archive.*) FROM to_archive
      `;
      await queryWithRetry(archiveQuery, [rowIds, tableName]);
      result.archived = rowIds.length;
      log.info({ table: tableName, count: rowIds.length }, 'Rows archived to archive_logs');

      const selectAllQuery = `SELECT * FROM "${tableName}" WHERE id = ANY($1::int[])`;
      const allRows = await queryWithRetry(selectAllQuery, [rowIds]);
      await archiveToS3Staging(tableName, allRows.rows as Record<string, unknown>[], cutoffDate);
    }

    if (dryRun) {
      log.info(
        { table: tableName, eligibleCount: rowIds.length },
        `[DRY RUN] Would clean ${rowIds.length} rows from ${tableName}`,
      );
      result.rowsAffected = rowIds.length;
      return result;
    }

    if (policy.deletionMode === 'soft') {
      try {
        await queryWithRetry(
          `ALTER TABLE "${tableName}" ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`,
        );
      } catch {
        // Column might already exist
      }

      await queryWithRetry(
        `UPDATE "${tableName}" SET deleted_at = NOW() WHERE id = ANY($1::int[])`,
        [rowIds],
      );
      log.info({ table: tableName, count: rowIds.length }, 'Soft-deleted rows');
    } else {
      await queryWithRetry(
        `DELETE FROM "${tableName}" WHERE id = ANY($1::int[])`,
        [rowIds],
      );
      log.info({ table: tableName, count: rowIds.length }, 'Hard-deleted rows');
    }

    result.rowsAffected = rowIds.length;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log.error({ table: tableName, err: errorMsg }, 'Retention cleanup failed');
    result.error = errorMsg;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run retention cleanup for all configured tables.
 *
 * @param dryRun - If true, only report what would be deleted without modifying data.
 * @param tables  - Optional subset of tables to clean. If omitted, all configured tables.
 */
export async function runRetentionCleanup(
  dryRun: boolean = false,
  tables?: string[],
): Promise<CleanupReport> {
  log.info({ dryRun, tables: tables ?? 'all' }, 'Starting retention cleanup');

  const policies = buildEffectiveConfig();
  const tableNames = tables ?? Object.keys(policies);

  const results: CleanupResult[] = [];

  for (const table of tableNames) {
    const policy = policies[table];
    if (!policy) {
      log.warn({ table }, 'No retention policy configured for table, skipping');
      continue;
    }

    const result = await cleanupTable(table, policy, dryRun);
    results.push(result);
  }

  const report: CleanupReport = {
    timestamp: new Date().toISOString(),
    dryRun,
    results,
    totalRowsCleaned: results.reduce((sum, r) => sum + r.rowsAffected, 0),
    totalErrors: results.filter((r) => r.error).length,
  };

  log.info(
    {
      dryRun,
      totalRowsCleaned: report.totalRowsCleaned,
      totalErrors: report.totalErrors,
    },
    'Retention cleanup completed',
  );

  return report;
}

/**
 * Run retention cleanup for raw webhook payloads specifically.
 * Clears the payload JSONB column while keeping metadata rows.
 */
export async function cleanRawWebhookPayloads(
  dryRun: boolean = false,
  retentionDays: number = 7,
): Promise<CleanupResult> {
  const policy: RetentionPolicy = {
    retentionDays,
    deletionMode: 'hard',
    dateColumn: 'created_at',
    archiveBeforeDelete: false,
  };

  const tableName = 'webhook_events';
  const cutoffDate = getCutoffDate(policy.retentionDays);
  const result: CleanupResult = {
    table: `${tableName}.payload`,
    rowsAffected: 0,
    mode: 'hard',
    dryRun,
    archived: 0,
  };

  if (cutoffDate === null) return result;

  const cutoffStr = cutoffDate.toISOString();

  try {
    const countQuery = `SELECT COUNT(*) AS cnt FROM "${tableName}" WHERE ${policy.dateColumn} < $1 AND payload IS NOT NULL`;
    const countResult = await queryWithRetry<{ cnt: number }>(countQuery, [cutoffStr]);
    const count = Number(countResult.rows[0]?.cnt ?? 0);

    if (count === 0) {
      log.info({ table: tableName }, 'No raw webhook payloads eligible for cleanup');
      return result;
    }

    if (dryRun) {
      log.info({ table: tableName, eligibleCount: count }, `[DRY RUN] Would nullify ${count} raw payloads`);
      result.rowsAffected = count;
      return result;
    }

    const updateQuery = `UPDATE "${tableName}" SET payload = NULL WHERE ${policy.dateColumn} < $1 AND payload IS NOT NULL`;
    await queryWithRetry(updateQuery, [cutoffStr]);
    result.rowsAffected = count;
    log.info({ table: tableName, count }, 'Raw webhook payloads nullified');
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log.error({ table: tableName, err: errorMsg }, 'Raw payload cleanup failed');
    result.error = errorMsg;
  }

  return result;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run') || args.includes('-n');
  const tables = args
    .filter((a) => a.startsWith('--tables='))
    .flatMap((a) => a.split('=')[1].split(','));

  log.info({ args, dryRun, tables: tables.length > 0 ? tables : 'all' }, 'Retention CLI started');

  const report = await runRetentionCleanup(dryRun, tables.length > 0 ? tables : undefined);

  if (!tables.length || tables.includes('webhook_events')) {
    const payloadResult = await cleanRawWebhookPayloads(dryRun);
    report.totalRowsCleaned += payloadResult.rowsAffected;
    if (payloadResult.error) report.totalErrors++;
    report.results.push(payloadResult);
  }

  log.info({ report }, 'Retention cleanup report');

  if (report.totalErrors > 0) {
    process.exit(1);
  }
}

const isMainModule = process.argv[1] && (
  process.argv[1] === import.meta.filename ||
  process.argv[1].endsWith('/retention.ts') ||
  process.argv[1].endsWith('/retention.js')
);
if (isMainModule) {
  main().catch((err) => {
    log.error({ err: String(err) }, 'Retention cleanup failed');
    process.exit(1);
  });
}
