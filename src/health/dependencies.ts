import { config } from '../config.js';
import { queryWithRetry } from '../db/connection.js';
import { checkRedisHealth } from './redisHealth.js';
import { opencodeHealth } from './opencodeHealth.js';
import * as rabbitmq from '../queue/rabbitmq.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'dependency-health' });

export interface DependencyCheckResult {
  name: string;
  status: 'ok' | 'error' | 'disabled';
  error?: string;
  latencyMs?: number;
}

export interface DependenciesHealthReport {
  status: 'ok' | 'degraded';
  dependencies: DependencyCheckResult[];
  timestamp: string;
}

export async function getDependenciesHealth(): Promise<DependenciesHealthReport> {
  const checks: DependencyCheckResult[] = [];

  const dbStart = Date.now();
  try {
    const result = await queryWithRetry<{ ok: number }>('SELECT 1 AS ok');
    checks.push({
      name: 'database',
      status: result.rows[0]?.ok === 1 ? 'ok' : 'error',
      latencyMs: Date.now() - dbStart,
    });
  } catch (err) {
    checks.push({
      name: 'database',
      status: 'error',
      error: String(err),
      latencyMs: Date.now() - dbStart,
    });
  }

  const redisResult = await checkRedisHealth();
  checks.push({
    name: 'redis',
    status: redisResult.status,
    error: redisResult.error ?? undefined,
    latencyMs: redisResult.latencyMs,
  });

  const rmqStart = Date.now();
  try {
    const connected = rabbitmq.isConnected();
    checks.push({
      name: 'rabbitmq',
      status: connected ? 'ok' : 'error',
      error: connected ? undefined : 'Not connected',
      latencyMs: Date.now() - rmqStart,
    });
  } catch (err) {
    checks.push({
      name: 'rabbitmq',
      status: 'error',
      error: String(err),
      latencyMs: Date.now() - rmqStart,
    });
  }

  const ocStatus = opencodeHealth.getStatus();
  checks.push({
    name: 'opencode',
    status: ocStatus.status === 'healthy' ? 'ok' : 'error',
    error: ocStatus.status !== 'healthy'
      ? `circuit=${ocStatus.circuit}, failures=${ocStatus.consecutiveFailures}, http=${ocStatus.httpStatus}`
      : undefined,
  });

  checks.push({
    name: 'sentry',
    status: config.sentry.dsn ? 'ok' : 'disabled',
  });

  const degraded = checks.some((c) => c.status === 'error');
  return {
    status: degraded ? 'degraded' : 'ok',
    dependencies: checks,
    timestamp: new Date().toISOString(),
  };
}
