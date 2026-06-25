/**
 * Shared Redis client utility.
 *
 * Provides a singleton Redis client for use across the codebase.
 * Uses lazy initialization and reuses the same connection options
 * pattern found throughout the STAS TypeScript codebase.
 *
 * Usage:
 *   import { getRedis, closeRedis } from '../utils/redis.js';
 *   const redis = getRedis();
 *   await redis.set('key', 'value');
 */

import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'redis-util' });

let redisInstance: import('ioredis').Redis | null = null;

export function getRedis(): import('ioredis').Redis {
  if (!redisInstance) {
    // Dynamic import to avoid top-level dependency issues
    const { Redis } = require('ioredis') as typeof import('ioredis');
    redisInstance = new Redis(config.queue.redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 100, 3000);
        log.warn({ attempt: times }, `Redis connection retry in ${delay}ms`);
        return delay;
      },
      lazyConnect: true,
    });

    redisInstance.on('error', (err: Error) => {
      log.error({ err: String(err) }, 'Redis client error');
    });

    redisInstance.on('connect', () => {
      log.debug('Redis client connected');
    });

    log.debug('Redis client initialized');
  }
  return redisInstance;
}

export async function closeRedis(): Promise<void> {
  if (redisInstance) {
    try {
      await redisInstance.quit();
    } catch (err) {
      log.warn({ err: String(err) }, 'Error closing Redis client');
    }
    redisInstance = null;
    log.debug('Redis client closed');
  }
}
