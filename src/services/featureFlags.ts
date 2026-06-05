import { Redis } from 'ioredis';
import { queryWithRetry } from '../db/connection.js';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'feature-flags' });

let redisClient: Redis | null = null;

const DEFAULT_TTL = config.featureFlags.defaultTtlSeconds;

type FlagResolution = 'db_account' | 'db_global' | 'env';

interface ResolvedFlag {
  flag: string;
  enabled: boolean;
  source: FlagResolution;
}

function getRedis(): Redis {
  if (!redisClient) {
    redisClient = new Redis(config.queue.redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => {
        if (times > 3) return null;
        return Math.min(times * 200, 2000);
      },
      lazyConnect: true,
    });
    redisClient.on('error', (err) => {
      log.error({ err: String(err) }, 'Feature flags Redis error');
    });
  }
  return redisClient;
}

export async function closeRedis(): Promise<void> {
  if (redisClient) {
    try { await redisClient.quit(); } catch { /* ok */ }
    redisClient = null;
  }
}

function cacheKey(accountId: number | null, flag: string): string {
  const scope = accountId ? `account:${accountId}` : 'global';
  return `stas:flags:${scope}:${flag}`;
}

export async function isFeatureEnabled(flag: string, accountId?: number): Promise<boolean> {
  try {
    if (accountId) {
      const result = await queryWithRetry<{ enabled: boolean }>(
        'SELECT enabled FROM feature_flags WHERE account_id = $1 AND flag = $2 LIMIT 1',
        [accountId, flag],
      );
      if (result.rows.length > 0) {
        const resolved: ResolvedFlag = { flag, enabled: result.rows[0].enabled, source: 'db_account' };
        log.debug({ flag, accountId, enabled: resolved.enabled, source: resolved.source }, 'Feature flag resolved');
        return result.rows[0].enabled;
      }
    }

    const globalResult = await queryWithRetry<{ enabled: boolean }>(
      'SELECT enabled FROM feature_flags WHERE account_id IS NULL AND flag = $1 LIMIT 1',
      [flag],
    );
    if (globalResult.rows.length > 0) {
      log.debug({ flag, enabled: globalResult.rows[0].enabled, source: 'db_global' }, 'Feature flag resolved');
      return globalResult.rows[0].enabled;
    }

    const envValue = process.env[`FLAG_${flag.toUpperCase()}`];
    if (envValue !== undefined) {
      const enabled = envValue === '1' || envValue.toLowerCase() === 'true';
      log.debug({ flag, enabled, source: 'env' }, 'Feature flag resolved');
      return enabled;
    }

    return false;
  } catch (err) {
    log.error({ err: String(err), flag, accountId }, 'Feature flag resolution failed');
    return false;
  }
}

export async function setFeatureFlag(
  flag: string,
  enabled: boolean,
  accountId?: number,
): Promise<void> {
  try {
    if (accountId) {
      await queryWithRetry(
        `INSERT INTO feature_flags (account_id, flag, enabled, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW())
         ON CONFLICT (account_id, flag)
         DO UPDATE SET enabled = $3, updated_at = NOW()`,
        [accountId, flag, enabled],
      );
    } else {
      await queryWithRetry(
        `INSERT INTO feature_flags (flag, enabled, created_at, updated_at)
         VALUES ($1, $2, NOW(), NOW())
         ON CONFLICT (flag) WHERE account_id IS NULL
         DO UPDATE SET enabled = $2, updated_at = NOW()`,
        [flag, enabled],
      );
    }
    log.info({ flag, enabled, accountId }, 'Feature flag updated');
  } catch (err) {
    log.error({ err: String(err), flag, enabled, accountId }, 'Failed to set feature flag');
    throw err;
  }
}

export async function deleteFeatureFlag(flag: string, accountId?: number): Promise<void> {
  try {
    if (accountId) {
      await queryWithRetry(
        'DELETE FROM feature_flags WHERE flag = $1 AND account_id = $2',
        [flag, accountId],
      );
    } else {
      await queryWithRetry(
        'DELETE FROM feature_flags WHERE flag = $1 AND account_id IS NULL',
        [flag],
      );
    }
    log.info({ flag, accountId }, 'Feature flag deleted');
  } catch (err) {
    log.error({ err: String(err), flag, accountId }, 'Failed to delete feature flag');
  }
}

export async function listFeatureFlags(accountId?: number): Promise<Array<{ flag: string; enabled: boolean; accountId: number | null }>> {
  try {
    if (accountId) {
      const result = await queryWithRetry<{ flag: string; enabled: boolean; account_id: number | null }>(
        'SELECT flag, enabled, account_id FROM feature_flags WHERE account_id = $1 OR account_id IS NULL ORDER BY flag',
        [accountId],
      );
      return result.rows.map((r) => ({ flag: r.flag, enabled: r.enabled, accountId: r.account_id }));
    }
    const result = await queryWithRetry<{ flag: string; enabled: boolean; account_id: number | null }>(
      'SELECT flag, enabled, account_id FROM feature_flags ORDER BY flag',
    );
    return result.rows.map((r) => ({ flag: r.flag, enabled: r.enabled, accountId: r.account_id }));
  } catch (err) {
    log.error({ err: String(err), accountId }, 'Failed to list feature flags');
    return [];
  }
}
