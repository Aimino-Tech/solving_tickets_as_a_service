import { Router, Request, Response } from 'express';
import { getQueueHealth } from '../health/queueHealth.js';
import { getDependenciesHealth } from '../health/dependencies.js';
import { checkRedisHealth } from '../health/redisHealth.js';
import { opencodeHealth } from '../health/opencodeHealth.js';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import { queryWithRetry } from '../db/connection.js';

const log = rootLogger.child({ module: 'health-routes' });
const healthRouter: Router = Router();

async function recordHealthCheck(status: string, responseTimeMs: number): Promise<void> {
  try {
    await queryWithRetry(
      'INSERT INTO health_checks (status, response_time_ms) VALUES ($1, $2)',
      [status, Math.round(responseTimeMs)],
    );
  } catch {
    // Non-fatal — recording is best-effort
  }
}

async function checkComponentHealth(): Promise<{
  checks: Record<string, { status: string; latencyMs?: number; error?: string }>;
  allOk: boolean;
}> {
  const checks: Record<string, { status: string; latencyMs?: number; error?: string }> = {};

  // Database
  const dbStart = Date.now();
  try {
    const { queryWithRetry } = await import('../db/connection.js');
    await queryWithRetry('SELECT 1');
    checks.database = { status: 'ok', latencyMs: Date.now() - dbStart };
  } catch (err) {
    checks.database = { status: 'error', latencyMs: Date.now() - dbStart, error: String(err) };
  }

  // Redis
  try {
    const redisResult = await checkRedisHealth();
    checks.redis = {
      status: redisResult.status,
      latencyMs: redisResult.latencyMs,
      error: redisResult.error ?? undefined,
    };
  } catch (err) {
    checks.redis = { status: 'error', error: String(err) };
  }

  // RabbitMQ
  const rmqStart = Date.now();
  try {
    const { isConnected } = await import('../queue/rabbitmq.js');
    checks.rabbitmq = { status: isConnected() ? 'ok' : 'error', latencyMs: Date.now() - rmqStart };
  } catch (err) {
    checks.rabbitmq = { status: 'error', latencyMs: Date.now() - rmqStart, error: String(err) };
  }

  // OpenCode
  const ocStatus = opencodeHealth.getStatus();
  checks.opencode = {
    status: ocStatus.status === 'healthy' ? 'ok' : ocStatus.status === 'degraded' ? 'degraded' : 'error',
  };

  // Sentry
  checks.sentry = {
    status: config.sentry.dsn ? 'ok' : 'disabled',
  };

  const allOk = Object.values(checks).every((c) => c.status === 'ok' || c.status === 'disabled');
  return { checks, allOk };
}

/**
 * GET /health
 * Consolidated health check with per-component status.
 */
healthRouter.get('/health', async (_req: Request, res: Response) => {
  const startTime = Date.now();
  const { checks, allOk } = await checkComponentHealth();

  // Record health check result to the database
  recordHealthCheck(allOk ? 'healthy' : 'degraded', Date.now() - startTime);

  res.status(allOk ? 200 : 503).json({
    status: allOk ? 'ok' : 'degraded',
    checks,
    timestamp: new Date().toISOString(),
    aiMode: config.stas.aiDisabled ? 'ai-disabled' : 'enabled',
  });
});

/**
 * GET /health/verbose
 * Detailed diagnostics with latency per component.
 */
healthRouter.get('/health/verbose', async (_req: Request, res: Response) => {
  const { checks, allOk } = await checkComponentHealth();
  res.json({
    status: allOk ? 'ok' : 'degraded',
    checks,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage(),
    nodeVersion: process.version,
  });
});

/**
 * GET /health/queue
 * Returns queue-specific health information.
 */
healthRouter.get('/health/queue', async (_req: Request, res: Response) => {
  try {
    const queueHealth = await getQueueHealth();
    res.json(queueHealth);
  } catch (err) {
    log.error({ err }, 'Queue health check failed');
    res.status(503).json({ status: 'error', error: 'Queue health check failed' });
  }
});

/**
 * GET /health/dependencies
 * Returns dependency health information.
 */
healthRouter.get('/health/dependencies', async (_req: Request, res: Response) => {
  try {
    const depsHealth = await getDependenciesHealth();
    res.json(depsHealth);
  } catch (err) {
    log.error({ err }, 'Dependencies health check failed');
    res.status(503).json({ status: 'error', error: 'Dependencies health check failed' });
  }
});

export default healthRouter;
