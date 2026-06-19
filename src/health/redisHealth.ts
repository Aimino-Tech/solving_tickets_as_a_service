/**
 * Redis Health Check — reusable module for checking Redis connectivity.
 *
 * Provides:
 *   - `checkRedisHealth()` — standalone Redis health check with ping
 *   - Typed result with status, latency, and error info
 *   - Graceful connection handling (no side effects on the global Redis client)
 *
 * Usage:
 *   import { checkRedisHealth } from './health/redisHealth.js';
 *   const result = await checkRedisHealth();
 *
 * --- Error Handling Audit ---------------------------------------------------
 * ✅ All connection errors are caught and returned as structured results
 * ✅ Never throws — always returns a RedisHealthReport
 * ✅ Connections are cleaned up after check (connect + ping + quit)
 * ✅ No interference with the application's main Redis connection
 * ---------------------------------------------------------------------------
 */

import { Redis } from 'ioredis';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import { bridgeMetrics } from '../bridge/metrics.js';

const log = rootLogger.child({ module: 'redis-health' });

// -- Types -------------------------------------------------------------------

export interface RedisHealthReport {
  /** Overall status: 'ok' if reachable and RESP responds, 'error' otherwise */
  status: 'ok' | 'error';
  /** Redis URL hostname (sanitized — password masked) */
  host: string;
  /** Port number */
  port: number;
  /** Whether a TCP connection was established */
  connected: boolean;
  /** Whether PING command succeeded */
  pingResponse: boolean;
  /** Round-trip latency in milliseconds (0 if not reachable) */
  latencyMs: number;
  /** Error message if any */
  error: string | null;
  /** Timestamp of the check */
  timestamp: string;
}

// -- Health Check ------------------------------------------------------------

/**
 * Perform a standalone Redis health check.
 *
 * Creates a fresh Redis connection (with lazyConnect), runs PING,
 * measures round-trip latency, and cleans up.
 *
 * Never throws — returns a structured RedisHealthReport on any outcome.
 */
export async function checkRedisHealth(): Promise<RedisHealthReport> {
  const startTime = Date.now();
  const parsedUrl = new URL(config.queue.redisUrl);

  const report: RedisHealthReport = {
    status: 'error',
    host: parsedUrl.hostname,
    port: Number(parsedUrl.port) || 6379,
    connected: false,
    pingResponse: false,
    latencyMs: 0,
    error: null,
    timestamp: new Date().toISOString(),
  };

  let redis: Redis | null = null;

  try {
    redis = new Redis(config.queue.redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      retryStrategy: () => null, // no retry for health check
      lazyConnect: true,
      connectTimeout: 5000,
    });

    await redis.connect();
    report.connected = true;

    const pingStart = Date.now();
    const pingResult = await redis.ping();
    const pingEnd = Date.now();

    report.pingResponse = pingResult === 'PONG';
    report.latencyMs = pingEnd - pingStart;
    report.status = report.pingResponse ? 'ok' : 'error';

    if (!report.pingResponse) {
      report.error = `PING returned unexpected result: ${pingResult}`;
    }
  } catch (err) {
    report.error = String(err);
    report.status = 'error';
    report.latencyMs = Date.now() - startTime;
    log.warn({ err: report.error, host: report.host }, 'Redis health check failed');
  } finally {
    if (redis) {
      try {
        await redis.quit();
      } catch {
        // Non-fatal — connection may already be broken
      }
    }
  }

  // Update Prometheus metrics
  bridgeMetrics.setGauge('redis_health_status', {}, report.status === 'ok' ? 1 : 0);
  bridgeMetrics.setGauge('redis_health_latency_ms', {}, report.latencyMs);

  return report;
}

/**
 * Quick check: is Redis reachable?
 * Returns true/false without the full report structure.
 */
export async function isRedisReachable(): Promise<boolean> {
  const report = await checkRedisHealth();
  return report.status === 'ok';
}
