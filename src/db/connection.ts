/**
 * Database connection pool management.
 *
 * Provides a configurable PostgreSQL connection pool with:
 * - Min/max pool size via DATABASE_POOL_MIN / DATABASE_POOL_MAX
 * - Automatic retry on connection failure (3 attempts, 1s delay)
 * - 30-second health check interval
 * - Statement timeout (30s default)
 * - SSL support for production (DATABASE_SSL env var)
 * - Graceful shutdown on SIGTERM
 */

import pg from 'pg';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';

const { Pool } = pg;

const log = rootLogger.child({ module: 'db' });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Pool factory
// ---------------------------------------------------------------------------

let pool: pg.Pool | null = null;

/**
 * Create or return the singleton connection pool.
 */
export function getPool(): pg.Pool {
  if (pool) return pool;

  const isSupabase = config.database.url.includes('supabase.co');
  const rejectUnauthorized = process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0' ? false : true;
  const sslConfig = config.database.ssl || isSupabase ? { ssl: { rejectUnauthorized: false } } : {};

  pool = new Pool({
    connectionString: config.database.url,
    min: config.database.poolMin,
    max: config.database.poolMax,
    statement_timeout: 30_000, // 30s statement timeout
    idle_in_transaction_session_timeout: 60_000,
    ...sslConfig,
  });

  // Log pool errors so they don't go unnoticed
  pool.on('error', (err) => {
    log.error({ err }, 'Unexpected database pool error');
  });

  log.info(
    {
      min: config.database.poolMin,
      max: config.database.poolMax,
      ssl: config.database.ssl,
    },
    'Database connection pool created',
  );

  return pool;
}

// ---------------------------------------------------------------------------
// Retryable query helper
// ---------------------------------------------------------------------------

/**
 * Execute a query with automatic retry on connection failure.
 * Retries up to 3 times with a 1-second delay between attempts.
 */
export function isTableNotFoundError(err: unknown): boolean {
  if (err instanceof Error) {
    const pgErr = err as any;
    return pgErr.code === '42P01' || (typeof pgErr.message === 'string' && pgErr.message.includes('relation') && pgErr.message.includes('does not exist'));
  }
  return false;
}

export async function queryWithRetry<T extends pg.QueryResultRow>(
  queryText: string,
  params?: unknown[],
  options?: { retries?: number; delayMs?: number },
): Promise<pg.QueryResult<T>> {
  const maxRetries = options?.retries ?? 3;
  const delayMs = options?.delayMs ?? 1000;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const client = await getPool().connect();
      try {
        const result = await client.query<T>(queryText, params);
        return result;
      } finally {
        client.release();
      }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      log.warn({ attempt, maxRetries, err: lastError.message }, 'Database query failed, retrying...');

      if (attempt < maxRetries) {
        await sleep(delayMs);
      }
    }
  }

  throw lastError ?? new Error('Database query failed after retries');
}

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

let healthInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start periodic database health checks (every 30s).
 * Each check runs `SELECT 1` and logs the result.
 */
export function startHealthChecks(): void {
  if (healthInterval) return;

  log.info('Starting database health checks (interval: 30s)');

  healthInterval = setInterval(async () => {
    try {
      const result = await queryWithRetry<{ ok: number }>('SELECT 1 AS ok');
      if (result.rows[0]?.ok !== 1) {
        log.warn('Database health check returned unexpected result');
      }
    } catch (err) {
      log.error({ err }, 'Database health check failed');
    }
  }, 30_000);

  // Allow the process to exit even if the interval is still running
  if (healthInterval && typeof healthInterval === 'object' && 'unref' in healthInterval) {
    healthInterval.unref();
  }
}

/**
 * Stop periodic health checks.
 */
export function stopHealthChecks(): void {
  if (healthInterval) {
    clearInterval(healthInterval);
    healthInterval = null;
  }
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

/**
 * Gracefully close the database pool.
 * Call this during shutdown (e.g., on SIGTERM).
 */
export async function closePool(): Promise<void> {
  stopHealthChecks();

  if (pool) {
    log.info('Closing database connection pool...');
    await pool.end();
    pool = null;
    log.info('Database connection pool closed');
  }
}

// ---------------------------------------------------------------------------
// SQL identifier validation — prevents injection via dynamic table/column names
// ---------------------------------------------------------------------------

const SQL_IDENTIFIER_RE = /^[a-z][a-z0-9_]*$/;

/**
 * Validate that a string is a safe SQL identifier (column name, table name, etc.).
 * Throws if the identifier contains unsafe characters.
 */
export function validateSqlIdentifier(name: string): string {
  if (!SQL_IDENTIFIER_RE.test(name)) {
    throw new Error(`Invalid SQL identifier: "${name}"`);
  }
  return name;
}

// ---------------------------------------------------------------------------
// Auto-register shutdown handler
// ---------------------------------------------------------------------------

process.once('SIGTERM', async () => {
  log.info('SIGTERM received — shutting down database pool');
  await closePool();
});

process.once('SIGINT', async () => {
  log.info('SIGINT received — shutting down database pool');
  await closePool();
});
