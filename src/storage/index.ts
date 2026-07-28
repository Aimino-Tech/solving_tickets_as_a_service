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

import { rootLogger } from '../utils/logger.js';
import type { StorageBackend } from './types.js';
import { PostgresStorage } from './postgres/index.js';

const log = rootLogger.child({ module: 'storage:factory' });

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let storageInstance: StorageBackend | undefined = undefined;

/**
 * Create (or return the existing) storage backend.
 *
 * Always uses PostgresStorage.  The instance is cached so subsequent
 * calls return the same object.
 */
export async function createStorage(): Promise<StorageBackend | undefined> {
  if (storageInstance) return storageInstance;

  log.info('Initializing Postgres storage');
  storageInstance = new PostgresStorage() as unknown as StorageBackend;

  return storageInstance;
}

/**
 * Close / tear down the active storage backend (e.g. on graceful shutdown).
 */
export async function closeStorage(): Promise<void> {
  if (storageInstance && typeof storageInstance.close === 'function') {
    await storageInstance.close();
  }
  storageInstance = undefined;
  log.info('Storage backend closed');
}
