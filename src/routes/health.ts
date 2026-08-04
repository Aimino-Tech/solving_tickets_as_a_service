import { Router, Request, Response } from 'express';
import { getQueueHealth } from '../health/queueHealth.js';
import { getDependenciesHealth } from '../health/dependencies.js';
import { checkRedisHealth } from '../health/redisHealth.js';
import { opencodeHealth } from '../health/opencodeHealth.js';
import { config } from '../config.js';
import { getComprehensiveHealth, getSlaMetrics } from '../health/comprehensive.js';
import { rootLogger } from '../utils/logger.js';
import { queryWithRetry } from '../db/connection.js';

const log = rootLogger.child({ module: 'health-routes' });
const healthRouter: Router = Router();

// Seed health_checks table on startup so uptime SLO has data
recordHealthCheck('healthy', 0).catch(() => {});

async function recordHealthCheck(status: string, responseTimeMs: number): Promise<void> {
  try {
    await queryWithRetry(
      'INSERT INTO health_checks (status, response_time_ms) VALUES ($1, $2)',
      [status, Math.round(responseTimeMs)],
    );
  } catch {
    // Non-fatal
  }
}

async function checkComponentHealth(): Promise<{
  checks: Record<string, { status: string; latencyMs?: number; error?: string }>;
  allOk: boolean;
}> {
  const checks: Record<string, { status: string; latencyMs?: number; error?: string }> = {};

  const dbStart = Date.now();
  try {
    await queryWithRetry('SELECT 1');
    checks.database = { status: 'ok', latencyMs: Date.now() - dbStart };
  } catch (err) {
    checks.database = { status: 'error', latencyMs: Date.now() - dbStart, error: String(err) };
  }

  try {
    const redisResult = await checkRedisHealth();
    checks.redis = { status: redisResult.status, latencyMs: redisResult.latencyMs, error: redisResult.error ?? undefined };
  } catch (err) {
    checks.redis = { status: 'error', error: String(err) };
  }

  const rmqStart = Date.now();
  try {
    const { ensureConnected } = await import('../queue/rabbitmq.js');
    const connected = await ensureConnected();
    checks.rabbitmq = { status: connected ? 'ok' : 'error', latencyMs: Date.now() - rmqStart };
  } catch (err) {
    checks.rabbitmq = { status: 'error', latencyMs: Date.now() - rmqStart, error: String(err) };
  }

  const ocStatus = opencodeHealth.getStatus();
  checks.opencode = { status: ocStatus.status === 'healthy' ? 'ok' : ocStatus.status === 'degraded' ? 'degraded' : 'error' };
  checks.sentry = { status: config.sentry.dsn ? 'ok' : 'disabled' };

  const allOk = Object.values(checks).every((c) => c.status === 'ok' || c.status === 'disabled');
  return { checks, allOk };
}

healthRouter.get('/health', async (_req: Request, res: Response) => {
  const startTime = Date.now();
  const { checks, allOk } = await checkComponentHealth();
  recordHealthCheck(allOk ? 'healthy' : 'degraded', Date.now() - startTime);
  res.status(allOk ? 200 : 503).json({
    status: allOk ? 'ok' : 'degraded',
    checks,
    timestamp: new Date().toISOString(),
    aiMode: config.syntaro.aiDisabled ? 'ai-disabled' : 'enabled',
  });
});

healthRouter.get('/health/verbose', async (_req: Request, res: Response) => {
  try {
    const report = await getComprehensiveHealth();
    const sla = await getSlaMetrics();
    res.json({ ...report, sla });
  } catch (err) {
    log.error({ err }, 'Verbose health check failed');
    res.status(503).json({ status: 'error', error: 'Verbose health check failed' });
  }
});

healthRouter.get('/health/queue', async (_req: Request, res: Response) => {
  try {
    const queueHealth = await getQueueHealth();
    res.json(queueHealth);
  } catch (err) {
    log.error({ err }, 'Queue health check failed');
    res.status(503).json({ status: 'error', error: 'Queue health check failed' });
  }
});

healthRouter.get('/health/dependencies', async (_req: Request, res: Response) => {
  try {
    const depsHealth = await getDependenciesHealth();
    res.json(depsHealth);
  } catch (err) {
    log.error({ err }, 'Dependencies health check failed');
    res.status(503).json({ status: 'error', error: 'Dependencies health check failed' });
  }
});

healthRouter.get('/health/sla', async (_req: Request, res: Response) => {
  try {
    const sla = await getSlaMetrics();
    res.json(sla);
  } catch (err) {
    log.error({ err }, 'SLA metrics check failed');
    res.status(500).json({ error: 'SLA metrics check failed' });
  }
});

export default healthRouter;
