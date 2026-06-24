/**
 * Database barrel export.
 *
 * Provides access to connection, migrations, types, and repositories.
 */

export { getPool, queryWithRetry, startHealthChecks, stopHealthChecks, closePool } from './connection.js';
export { runMigrations, rollbackLastBatch } from './migrate.js';

export * from './types/index.js';
export * from './repositories/index.js';
