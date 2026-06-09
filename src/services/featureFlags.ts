import { Redis } from 'ioredis';
import { queryWithRetry } from '../db/connection.js';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import { auditRepository } from '../audit/repository.js';

const log = rootLogger.child({ module: 'feature-flags' });

let redisClient: Redis | null = null;

const DEFAULT_TTL = config.featureFlags.defaultTtlSeconds;
const ERROR_WINDOW_MS = 5 * 60 * 1000;
const AUTO_DISABLE_THRESHOLD = config.featureFlags.autoDisableThreshold;

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

function callsKey(flag: string): string {
  return `stas:flags:metrics:${flag}:calls`;
}

function errorsKey(flag: string): string {
  return `stas:flags:metrics:${flag}:errors`;
}

// ── Error rate tracking ──────────────────────────────────────────────────────

export async function recordFlagCall(flag: string): Promise<void> {
  try {
    const redis = getRedis();
    const now = Date.now();
    const member = `${now}:${Math.random().toString(36).slice(2, 8)}`;
    await redis.zadd(callsKey(flag), now, member);
    await redis.expire(callsKey(flag), Math.ceil(ERROR_WINDOW_MS / 1000) + 60);
  } catch (err) {
    log.error({ err: String(err), flag }, 'Failed to record flag call');
  }
}

export async function recordFlagError(flag: string): Promise<void> {
  try {
    const redis = getRedis();
    const now = Date.now();
    const member = `${now}:${Math.random().toString(36).slice(2, 8)}`;
    await redis.zadd(errorsKey(flag), now, member);
    await redis.expire(errorsKey(flag), Math.ceil(ERROR_WINDOW_MS / 1000) + 60);
  } catch (err) {
    log.error({ err: String(err), flag }, 'Failed to record flag error');
  }
}

export async function getErrorRate(flag: string): Promise<number> {
  try {
    const redis = getRedis();
    const now = Date.now();
    const windowStart = now - ERROR_WINDOW_MS;

    await redis.zremrangebyscore(callsKey(flag), 0, windowStart).catch(() => {});
    await redis.zremrangebyscore(errorsKey(flag), 0, windowStart).catch(() => {});

    const [calls, errors] = await Promise.all([
      redis.zcard(callsKey(flag)),
      redis.zcard(errorsKey(flag)),
    ]);

    if (calls === 0) return 0;
    return errors / calls;
  } catch (err) {
    log.error({ err: String(err), flag }, 'Failed to get error rate');
    return 0;
  }
}

export async function checkAndAutoDisable(flag: string): Promise<boolean> {
  try {
    const rate = await getErrorRate(flag);
    if (rate <= AUTO_DISABLE_THRESHOLD) return false;

    await setFeatureFlag(flag, false);
    log.warn({
      flag, errorRate: rate, threshold: AUTO_DISABLE_THRESHOLD,
    }, 'Feature flag auto-disabled due to high error rate');

    await auditRepository.insert({
      actorType: 'system',
      actorId: 'feature-flags',
      action: 'feature_flag.auto_disabled',
      resourceType: 'feature_flag',
      resourceId: flag,
      details: { errorRate: rate, threshold: AUTO_DISABLE_THRESHOLD },
    });

    return true;
  } catch (err) {
    log.error({ err: String(err), flag }, 'Failed to check auto-disable');
    return false;
  }
}

// ── Flag resolution ──────────────────────────────────────────────────────────

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
        if (resolved.enabled) {
          const disabled = await checkAndAutoDisable(flag);
          if (disabled) return false;
        }
        return result.rows[0].enabled;
      }
    }

    const globalResult = await queryWithRetry<{ enabled: boolean }>(
      'SELECT enabled FROM feature_flags WHERE account_id IS NULL AND flag = $1 LIMIT 1',
      [flag],
    );
    if (globalResult.rows.length > 0) {
      log.debug({ flag, enabled: globalResult.rows[0].enabled, source: 'db_global' }, 'Feature flag resolved');
      if (globalResult.rows[0].enabled) {
        const disabled = await checkAndAutoDisable(flag);
        if (disabled) return false;
      }
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
