/**
 * Storage backend factory.
 *
 * Reads the active storage type from config and returns the appropriate
 * `StorageBackend` implementation.
 *
 * Usage:
 *   import { createStorage } from './storage/index.js';
 *   const storage = await createStorage();
 *   await storage.saveRun({ ... });
 */

import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import type { StorageBackend } from './types.js';
import { SQLiteStorage } from './sqlite.js';
import { PostgresStorage } from './postgres/index.js';

const log = rootLogger.child({ module: 'storage:factory' });

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let storageInstance: StorageBackend | null = null;

/**
 * Create (or return the existing) storage backend based on the active config.
 *
 * The backend is determined by `config.storage.type`:
 *   - `'sqlite'`    → `SQLiteStorage` (default for OSS / self-hosted)
 *   - `'postgres'`  → `PostgresStorage` (production / hosted)
 *
 * The instance is cached so subsequent calls return the same object.
 */
export async function createStorage(): Promise<StorageBackend | undefined> {
  if (storageInstance) return storageInstance;

  const storageType = config.storage.type;

  log.info({ storageType }, 'Creating storage backend');

  switch (storageType) {
    case 'sqlite': {
      const dbPath = config.storage.sqlitePath;
      log.info({ dbPath }, 'Initializing SQLite storage');
      storageInstance = new SQLiteStorage(dbPath);
      break;
    }

    case 'postgres': {
      log.info('Initializing Postgres storage');
      storageInstance = new PostgresStorage();
      break;
    }

    default: {
      const msg = `Unknown storage type: ${storageType}`;
      log.error({ storageType }, msg);
      throw new Error(msg);
    }
  }

  return storageInstance;
}

/**
 * Close / tear down the active storage backend (e.g. on graceful shutdown).
 */
export async function closeStorage(): Promise<void> {
  if (storageInstance && typeof storageInstance.close === 'function') {
    await storageInstance.close();
  }
  storageInstance = null;
  log.info('Storage backend closed');
}
