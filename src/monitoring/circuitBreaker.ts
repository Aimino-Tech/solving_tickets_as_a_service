/**
 * Circuit Breaker — pauses a task type after N consecutive failures.
 *
 * Mirrors the Python circuit breaker in workers/orchestrator/circuit_breaker.py
 * for use by TypeScript components (webhook server, queue consumers).
 *
 * States: CLOSED (normal) -> OPEN (paused) -> HALF_OPEN (testing) -> CLOSED/OPEN
 *
 * After 5 consecutive failures of the same task type, the circuit opens
 * (pauses) for 60 seconds. After that, it transitions to half-open, allows one
 * test execution, and either closes (success) or re-opens (failure).
 *
 * Redis Keys:
 *   syntaro:circuit:{taskType}:state         - CLOSED | OPEN | HALF_OPEN
 *   syntaro:circuit:{taskType}:failure_count - integer
 *   syntaro:circuit:{taskType}:opened_at     - Unix timestamp (seconds)
 */

import { Redis } from 'ioredis';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'circuit-breaker' });

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const THRESHOLD = Number(process.env.CIRCUIT_BREAKER_THRESHOLD) || 5;
const OPEN_SECONDS = Number(process.env.CIRCUIT_BREAKER_OPEN_SECONDS) || 60;
const HALF_OPEN_MAX = Number(process.env.CIRCUIT_BREAKER_HALF_OPEN_MAX) || 1;
const REDIS_PREFIX = 'syntaro:circuit:';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitInfo {
  state: CircuitState;
  failureCount: number;
  threshold: number;
  openedAt?: number;
  halfOpenAt?: number;
}

// ---------------------------------------------------------------------------
// Redis client (lazy singleton)
// ---------------------------------------------------------------------------

let _redis: Redis | null = null;

function getRedis(): Redis {
  if (!_redis) {
    _redis = new Redis(config.queue.redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 100, 3000);
        log.warn({ attempt: times }, `Redis connection retry in ${delay}ms`);
        return delay;
      },
      lazyConnect: true,
    });
    _redis.on('error', (err) => {
      log.error({ err: String(err) }, 'Circuit breaker Redis error');
    });
  }
  return _redis;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stateKey(taskType: string): string {
  return `${REDIS_PREFIX}${taskType}:state`;
}

function failCountKey(taskType: string): string {
  return `${REDIS_PREFIX}${taskType}:failure_count`;
}

function openedAtKey(taskType: string): string {
  return `${REDIS_PREFIX}${taskType}:opened_at`;
}

function halfOpenTestKey(taskType: string): string {
  return `${REDIS_PREFIX}${taskType}:half_open_tests`;
}

// ---------------------------------------------------------------------------
// State Management
// ---------------------------------------------------------------------------

/**
 * Get the current circuit breaker state for a task type.
 * Automatically transitions OPEN -> HALF_OPEN after OPEN_SECONDS.
 */
export async function getState(taskType: string): Promise<CircuitState> {
  const redis = getRedis();

  try {
    const state = await redis.get(stateKey(taskType));
    if (!state) return 'CLOSED';

    if (state === 'OPEN') {
      const openedAt = await redis.get(openedAtKey(taskType));
      if (openedAt) {
        const elapsed = Date.now() / 1000 - Number(openedAt);
        if (elapsed >= OPEN_SECONDS) {
          await setState(taskType, 'HALF_OPEN');
          log.info(
            { taskType, elapsedSec: Math.round(elapsed) },
            'Circuit auto-transitioned to HALF_OPEN',
          );
          return 'HALF_OPEN';
        }
      }
      return 'OPEN';
    }

    if (state === 'HALF_OPEN') return 'HALF_OPEN';

    return 'CLOSED';
  } catch (err) {
    log.debug({ err: String(err), taskType }, 'Failed to get circuit state');
    return 'CLOSED';
  }
}

async function setState(taskType: string, state: CircuitState): Promise<void> {
  const redis = getRedis();

  try {
    await redis.set(stateKey(taskType), state, 'EX', OPEN_SECONDS * 4);
  } catch (err) {
    log.debug({ err: String(err), taskType }, 'Failed to set circuit state');
  }
}

/**
 * Check whether a task is allowed to execute.
 * @returns Object with `allowed` and `reason`.
 */
export async function checkCircuit(taskType: string): Promise<{ allowed: boolean; reason: string }> {
  const state = await getState(taskType);

  if (state === 'OPEN') {
    const redis = getRedis();
    let openedAt: string | null = null;
    try {
      openedAt = await redis.get(openedAtKey(taskType));
    } catch (err) {
      log.warn({ err: String(err), taskType }, 'Failed to read circuit breaker opened timestamp');
    }
    const reason = `Circuit OPEN for '${taskType}' - paused for ${OPEN_SECONDS}s (opened at ${openedAt ?? 'unknown'})`;
    log.warn({ taskType, state, openedAt }, 'Circuit breaker blocked task');
    return { allowed: false, reason };
  }

  if (state === 'HALF_OPEN') {
    const redis = getRedis();
    let testCount = 0;
    try {
      testCount = Number(await redis.get(halfOpenTestKey(taskType))) || 0;
      if (testCount >= HALF_OPEN_MAX) {
        const reason = `Circuit HALF_OPEN for '${taskType}' - used ${testCount}/${HALF_OPEN_MAX} test attempts`;
        return { allowed: false, reason };
      }
      await redis.incr(halfOpenTestKey(taskType));
      await redis.expire(halfOpenTestKey(taskType), OPEN_SECONDS + 10);
    } catch (err) {
      log.warn({ err: String(err), taskType }, 'Failed to update half-open test count');
    }
    return { allowed: true, reason: 'half_open_test' };
  }

  return { allowed: true, reason: 'circuit_closed' };
}

/**
 * Record a task failure and potentially open the circuit.
 */
export async function recordFailure(taskType: string): Promise<CircuitInfo> {
  const redis = getRedis();

  try {
    const failCount = await redis.incr(failCountKey(taskType));
    await redis.expire(failCountKey(taskType), OPEN_SECONDS * 4);

    const currentState = await getState(taskType);

    if (currentState === 'HALF_OPEN') {
      await setState(taskType, 'OPEN');
      await redis.set(openedAtKey(taskType), String(Date.now() / 1000));
      log.warn({ taskType, failCount, threshold: THRESHOLD }, 'Circuit re-opened from HALF_OPEN');
      return { state: 'OPEN', failureCount: failCount, threshold: THRESHOLD, openedAt: Date.now() / 1000 };
    }

    if (failCount >= THRESHOLD && currentState === 'CLOSED') {
      await setState(taskType, 'OPEN');
      await redis.set(openedAtKey(taskType), String(Date.now() / 1000));
      log.warn(
        { taskType, failCount, threshold: THRESHOLD, pauseDuration: OPEN_SECONDS },
        'Circuit opened',
      );
      return { state: 'OPEN', failureCount: failCount, threshold: THRESHOLD, openedAt: Date.now() / 1000 };
    }

    return { state: failCount >= THRESHOLD ? 'OPEN' : 'CLOSED', failureCount: failCount, threshold: THRESHOLD };
  } catch (err) {
    log.error({ err: String(err), taskType }, 'Failed to record failure');
    return { state: 'CLOSED', failureCount: 0, threshold: THRESHOLD };
  }
}

/**
 * Record a task success and potentially close the circuit.
 */
export async function recordSuccess(taskType: string): Promise<CircuitInfo> {
  const redis = getRedis();

  try {
    await redis.del(failCountKey(taskType));
    const currentState = await getState(taskType);

    if (currentState === 'HALF_OPEN') {
      await setState(taskType, 'CLOSED');
      await redis.del(openedAtKey(taskType));
      await redis.del(halfOpenTestKey(taskType));
      log.info({ taskType }, 'Circuit closed after successful half-open test');
      return { state: 'CLOSED', failureCount: 0, threshold: THRESHOLD };
    }

    return { state: currentState, failureCount: 0, threshold: THRESHOLD };
  } catch (err) {
    log.error({ err: String(err), taskType }, 'Failed to record success');
    return { state: 'CLOSED', failureCount: 0, threshold: THRESHOLD };
  }
}

/**
 * Get the state of all tracked circuit breakers.
 */
export async function getAllCircuits(): Promise<Record<string, CircuitInfo>> {
  const redis = getRedis();
  const circuits: Record<string, CircuitInfo> = {};

  try {
    const keys = await redis.keys(`${REDIS_PREFIX}*:state`);
    for (const key of keys) {
      const taskType = key.slice(REDIS_PREFIX.length, -6); // strip prefix and ":state"
      const [state, failCountRaw, openedAt] = await Promise.all([
        redis.get(key),
        redis.get(failCountKey(taskType)),
        redis.get(openedAtKey(taskType)),
      ]);
      circuits[taskType] = {
        state: (state as CircuitState) || 'CLOSED',
        failureCount: Number(failCountRaw) || 0,
        threshold: THRESHOLD,
        openedAt: openedAt ? Number(openedAt) : undefined,
      };
    }
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to list circuits');
  }

  return circuits;
}

/**
 * Manually reset a circuit breaker to CLOSED.
 */
export async function resetCircuit(taskType: string): Promise<boolean> {
  const redis = getRedis();

  try {
    await redis.del(stateKey(taskType));
    await redis.del(failCountKey(taskType));
    await redis.del(openedAtKey(taskType));
    await redis.del(halfOpenTestKey(taskType));
    log.info({ taskType }, 'Circuit manually reset');
    return true;
  } catch (err) {
    log.error({ err: String(err), taskType }, 'Failed to reset circuit');
    return false;
  }
}
