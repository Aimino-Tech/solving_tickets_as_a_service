/**
 * Scaling Management API Routes
 *
 * Provides endpoints for monitoring and managing STAS scaling:
 *   - GET  /api/scaling/status          — Current scaling status & metrics
 *   - POST /api/scaling/scale           — Trigger scale up/down
 *   - GET  /api/scaling/recommendations — AI-driven scaling recommendations
 *
 * All routes require admin authentication (matching admin.ts pattern).
 *
 * @module routes/scaling
 */

import { Router, type Request, type Response } from 'express';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import { adminAuthMiddleware } from '../security/adminAuth.js';
import { getQueueHealth, getDLQSummary } from '../health/index.js';

const log = rootLogger.child({ module: 'scaling-api' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ScalingStatus {
  status: 'ok' | 'degraded' | 'critical';
  timestamp: string;
  scaling: {
    maxWorkers: number;
    currentWorkers: number;
    recommendedWorkers: number;
    poolMax: number;
    poolUtilizationPercent: number;
  };
  rateLimits: {
    windowMs: number;
    maxPerRepo: number;
    maxPerIp: number;
    maxPerUser: number;
  };
  queue: {
    depth: number;
    dlqCount: number;
    status: string;
  };
  dlq: {
    maxSize: number;
    notifyAt: number;
    currentCount: number;
  };
  metrics: {
    activeWorkers: number;
    workerUtilization: number;
    p95LatencyMs: number;
    errorRatePercent: number;
    fixRatePercent: number;
    costPerFix: number;
  };
}

interface ScaleAction {
  action: 'scale_up' | 'scale_down' | 'scale_to';
  count?: number;
  reason?: string;
}

interface ScalingRecommendation {
  timestamp: string;
  recommendations: Array<{
    type: 'scale_up' | 'scale_down' | 'adjust_config' | 'investigate';
    priority: 'critical' | 'high' | 'medium' | 'low';
    metric: string;
    currentValue: number;
    threshold: number;
    message: string;
    action: string;
  }>;
  summary: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
}

// ---------------------------------------------------------------------------
// In-memory scaling state
// ---------------------------------------------------------------------------

// Track current/recommended worker count (in production, this would be backed
// by Redis or the orchestrator API — Docker/K8s)
let currentWorkerCount = 1;
let recommendedWorkerCount = 1;

// Track scale events for audit
const scaleEventLog: Array<{
  timestamp: string;
  action: string;
  from: number;
  to: number;
  reason: string;
}> = [];

// Cost tracking (simple in-memory — extend with real metering data)
interface CostMetrics {
  totalCostCents: number;
  totalFixes: number;
  windowStart: string;
}

const costMetrics: CostMetrics = {
  totalCostCents: 0,
  totalFixes: 0,
  windowStart: new Date().toISOString(),
};

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const router: Router = Router();

// Apply admin auth to all scaling routes
router.use(adminAuthMiddleware);

// ---------------------------------------------------------------------------
// GET /api/scaling/status
// ---------------------------------------------------------------------------

router.get('/status', async (_req: Request, res: Response) => {
  try {
    // Gather queue health data
    let queueDepth = 0;
    let dlqCount = 0;
    let queueStatus = 'unknown';

    try {
      const queueHealth = await getQueueHealth();
      queueDepth = queueHealth.summary.totalMessages;
      dlqCount = queueHealth.summary.dlqMessages;
      queueStatus = queueHealth.status;
    } catch (err) {
      log.warn({ err: String(err) }, 'Failed to get queue health for scaling status');
    }

    const poolMax = config.scaling.pgPoolMax;
    const poolUtilizationPercent = Math.min(
      100,
      Math.round((queueDepth / Math.max(1, poolMax * 10)) * 100),
    );

    const status: ScalingStatus = {
      status: queueStatus === 'critical' ? 'critical' : queueStatus === 'degraded' ? 'degraded' : 'ok',
      timestamp: new Date().toISOString(),
      scaling: {
        maxWorkers: config.scaling.maxWorkers,
        currentWorkers: currentWorkerCount,
        recommendedWorkers: recommendedWorkerCount,
        poolMax,
        poolUtilizationPercent,
      },
      rateLimits: {
        windowMs: config.scaling.rateLimitWindowMs,
        maxPerRepo: config.scaling.rateLimitMaxPerRepo,
        maxPerIp: config.scaling.rateLimitMaxPerIp,
        maxPerUser: config.scaling.rateLimitMaxPerUser,
      },
      queue: {
        depth: queueDepth,
        dlqCount,
        status: queueStatus,
      },
      dlq: {
        maxSize: config.scaling.dlqMaxSize,
        notifyAt: config.scaling.dlqNotifyAt,
        currentCount: dlqCount,
      },
      metrics: {
        activeWorkers: currentWorkerCount,
        workerUtilization: currentWorkerCount > 0
          ? Math.min(100, Math.round((queueDepth / Math.max(1, currentWorkerCount * 10)) * 100))
          : 0,
        p95LatencyMs: 0, // Would come from Prometheus in production
        errorRatePercent: 0,
        fixRatePercent: costMetrics.totalFixes > 0
          ? Math.round((costMetrics.totalFixes / Math.max(1, costMetrics.totalFixes)) * 100)
          : 100,
        costPerFix: costMetrics.totalFixes > 0
          ? costMetrics.totalCostCents / costMetrics.totalFixes
          : 0,
      },
    };

    log.info({ scalingStatus: status }, 'Scaling status requested');
    res.json(status);
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to get scaling status');
    res.status(500).json({ error: 'Failed to get scaling status' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/scaling/scale
// ---------------------------------------------------------------------------

router.post('/scale', async (req: Request, res: Response) => {
  try {
    const body = req.body as ScaleAction;

    if (!body.action || !['scale_up', 'scale_down', 'scale_to'].includes(body.action)) {
      res.status(400).json({
        error: 'Invalid action. Must be: scale_up, scale_down, or scale_to',
      });
      return;
    }

    const previousCount = currentWorkerCount;
    let newCount = currentWorkerCount;

    switch (body.action) {
      case 'scale_up':
        newCount = Math.min(config.scaling.maxWorkers, currentWorkerCount + 1);
        break;
      case 'scale_down':
        newCount = Math.max(1, currentWorkerCount - 1);
        break;
      case 'scale_to':
        if (typeof body.count !== 'number' || body.count < 1 || body.count > config.scaling.maxWorkers) {
          res.status(400).json({
            error: `count must be between 1 and ${config.scaling.maxWorkers}`,
          });
          return;
        }
        newCount = body.count;
        break;
    }

    currentWorkerCount = newCount;
    recommendedWorkerCount = newCount;

    // Log the scale event
    const scaleEvent = {
      timestamp: new Date().toISOString(),
      action: body.action,
      from: previousCount,
      to: newCount,
      reason: body.reason ?? `Manual scale ${body.action}`,
    };
    scaleEventLog.push(scaleEvent);

    // Keep only last 100 events
    if (scaleEventLog.length > 100) {
      scaleEventLog.shift();
    }

    log.info(
      { action: body.action, from: previousCount, to: newCount, reason: body.reason },
      'Scale action executed',
    );

    res.json({
      success: true,
      action: body.action,
      previousWorkers: previousCount,
      currentWorkers: newCount,
      maxWorkers: config.scaling.maxWorkers,
      timestamp: scaleEvent.timestamp,
      message: `Scaled from ${previousCount} to ${newCount} worker(s)`,
    });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to execute scale action');
    res.status(500).json({ error: 'Failed to execute scale action' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/scaling/recommendations
// ---------------------------------------------------------------------------

router.get('/recommendations', async (_req: Request, res: Response) => {
  try {
    // Gather metrics for recommendations
    let queueDepth = 0;
    let dlqCount = 0;

    try {
      const queueHealth = await getQueueHealth();
      queueDepth = queueHealth.summary.totalMessages;
      dlqCount = queueHealth.summary.dlqMessages;
    } catch {
      // Use defaults if queue health unavailable
    }

    const recommendations: ScalingRecommendation['recommendations'] = [];

    // Rule 1: Queue depth > 200 → critical scale_up
    if (queueDepth > 200) {
      recommendations.push({
        type: 'scale_up',
        priority: 'critical',
        metric: 'queue_depth',
        currentValue: queueDepth,
        threshold: 200,
        message: `Queue depth ${queueDepth} exceeds critical threshold of 200`,
        action: `Scale up to at least ${Math.min(config.scaling.maxWorkers, Math.ceil(queueDepth / 50))} workers immediately`,
      });
    }

    // Rule 2: Queue depth > 50 for sustained load → high scale_up
    if (queueDepth > 50 && queueDepth <= 200) {
      recommendations.push({
        type: 'scale_up',
        priority: 'high',
        metric: 'queue_depth',
        currentValue: queueDepth,
        threshold: 50,
        message: `Queue depth ${queueDepth} exceeds warning threshold of 50`,
        action: `Consider scaling up to ${Math.min(config.scaling.maxWorkers, Math.max(currentWorkerCount + 1, Math.ceil(queueDepth / 50)))} workers`,
      });
    }

    // Rule 3: DLQ has messages → investigate
    if (dlqCount > 0) {
      const priority = dlqCount > config.scaling.dlqNotifyAt ? 'critical' : 'high';
      recommendations.push({
        type: 'investigate',
        priority,
        metric: 'dlq_count',
        currentValue: dlqCount,
        threshold: config.scaling.dlqNotifyAt,
        message: `Dead-letter queue has ${dlqCount} message(s)`,
        action: dlqCount > config.scaling.dlqNotifyAt
          ? 'Investigate DLQ messages immediately — threshold exceeded'
          : 'Review DLQ messages and replay if appropriate',
      });
    }

    // Rule 4: Queue depth very low with many workers → scale_down
    if (queueDepth < 10 && currentWorkerCount > 2) {
      recommendations.push({
        type: 'scale_down',
        priority: 'medium',
        metric: 'queue_depth',
        currentValue: queueDepth,
        threshold: 10,
        message: `Queue depth ${queueDepth} is very low with ${currentWorkerCount} workers`,
        action: `Consider scaling down to ${Math.max(1, currentWorkerCount - 1)} worker(s) to reduce resource usage`,
      });
    }

    // Rule 5: Worker pool utilization check
    const utilizationPercent = currentWorkerCount > 0
      ? Math.round((queueDepth / Math.max(1, currentWorkerCount * 10)) * 100)
      : 0;
    if (utilizationPercent > 80) {
      recommendations.push({
        type: 'scale_up',
        priority: 'high',
        metric: 'worker_utilization',
        currentValue: utilizationPercent,
        threshold: 80,
        message: `Worker utilization at ${utilizationPercent}%`,
        action: `Scale up to reduce utilization below 80%`,
      });
    }

    // Rule 6: Rate limit headroom check
    recommendations.push({
      type: 'adjust_config',
      priority: 'low',
      metric: 'rate_limit_max_per_user',
      currentValue: config.scaling.rateLimitMaxPerUser,
      threshold: 1000,
      message: `Current rate limit per user: ${config.scaling.rateLimitMaxPerUser} req/min`,
      action: queueDepth > 100
        ? 'Consider increasing SCALING_RATE_LIMIT_MAX_PER_USER for enterprise users'
        : 'Rate limit configuration is adequate',
    });

    // Sort by priority
    const priorityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    recommendations.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

    const summary = {
      critical: recommendations.filter((r) => r.priority === 'critical').length,
      high: recommendations.filter((r) => r.priority === 'high').length,
      medium: recommendations.filter((r) => r.priority === 'medium').length,
      low: recommendations.filter((r) => r.priority === 'low').length,
    };

    const result: ScalingRecommendation = {
      timestamp: new Date().toISOString(),
      recommendations,
      summary,
    };

    log.info({ recommendationSummary: summary }, 'Scaling recommendations generated');
    res.json(result);
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to generate scaling recommendations');
    res.status(500).json({ error: 'Failed to generate scaling recommendations' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/scaling/events — recent scale events (audit log)
// ---------------------------------------------------------------------------

router.get('/events', async (_req: Request, res: Response) => {
  try {
    const limit = Math.min(Math.abs(Number(_req.query.limit) || 50), 100);
    res.json({
      events: scaleEventLog.slice(-limit).reverse(),
      total: scaleEventLog.length,
    });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to get scale events');
    res.status(500).json({ error: 'Failed to get scale events' });
  }
});

export { router as scalingRouter };
