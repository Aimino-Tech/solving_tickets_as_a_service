/**
 * Pipeline Status API --- endpoints for querying pipeline state.
 *
 * GET /api/pipeline/:issueId
 *   Returns the current status, stage, progress, and attempt count
 *   for the pipeline associated with the given issue ID.
 *
 * @module routes/pipeline
 */

import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
<<<<<<< HEAD
=======
import { queryWithRetry } from '../db/connection.js';
>>>>>>> origin/main
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'pipeline-api' });

// ---------------------------------------------------------------------------
// Rate Limiting
// ---------------------------------------------------------------------------

const pipelineLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
<<<<<<< HEAD
  message: {
    error: 'Too many pipeline status requests',
    retryAfter: 'see Retry-After header',
  },
=======
  message: { error: 'Too many pipeline status requests', retryAfter: 'see Retry-After header' },
>>>>>>> origin/main
});

// ---------------------------------------------------------------------------
// Redis helpers
// ---------------------------------------------------------------------------

/**
 * Read a value from Redis with a fallback.
 * Returns `undefined` when Redis is unavailable or the key does not exist.
 */
async function redisGet(key: string): Promise<string | undefined> {
  try {
    const { Redis } = await import('ioredis');
    const redis = new Redis(config.queue.redisUrl, {
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      lazyConnect: true,
    });
    await redis.connect();
    const val = await redis.get(key);
    await redis.quit().catch(() => {});
    return val ?? undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
<<<<<<< HEAD
// Types
=======
// Router
// ---------------------------------------------------------------------------

const router: Router = Router();
router.use(pipelineLimiter);

// ---------------------------------------------------------------------------
// GET /api/pipeline/:issueId --- pipeline status
>>>>>>> origin/main
// ---------------------------------------------------------------------------

interface PipelineState {
  status?: string;
  current_stage?: string;
  progress?: number;
  attempt?: number;
  pipeline_id?: string;
  pipeline_name?: string;
  created_at?: number;
  updated_at?: number;
  error?: string;
}

<<<<<<< HEAD
// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const router: Router = Router();
router.use(pipelineLimiter);

// ---------------------------------------------------------------------------
// GET /api/pipeline/:issueId --- pipeline status
// ---------------------------------------------------------------------------

=======
>>>>>>> origin/main
router.get('/pipeline/:issueId', async (req: Request, res: Response) => {
  try {
    const { issueId } = req.params;

    if (!issueId || typeof issueId !== 'string' || issueId.length > 200) {
      res.status(400).json({ error: 'Invalid issueId' });
      return;
    }

    // Look up pipeline_id via the issue -> pipeline_id mapping
    const pipelineIdKey = `pipeline:${issueId}:id`;
    const pipelineId = await redisGet(pipelineIdKey);

    if (!pipelineId) {
      res.json({
        status: 'not_found',
        current_stage: '',
        progress: 0.0,
        attempt: 0,
        issue_id: issueId,
      });
      return;
    }

    // Read pipeline state from Redis
    const stateKey = `pipeline:${pipelineId}:state`;
    const rawState = await redisGet(stateKey);

    if (!rawState) {
      res.json({
        status: 'unknown',
        current_stage: 'unknown',
        progress: 0.0,
        attempt: 0,
        pipeline_id: pipelineId,
        issue_id: issueId,
        note: 'Pipeline ID exists but state not readable',
      });
      return;
    }

    let state: PipelineState;
    try {
      state = JSON.parse(rawState) as PipelineState;
    } catch {
      res.status(500).json({
        error: 'Invalid pipeline state JSON',
        pipeline_id: pipelineId,
        issue_id: issueId,
      });
      return;
    }

    // Also query recent events from the events list
    const eventsKey = `pipeline:${pipelineId}:events`;
    let recentEvents: unknown[] = [];
    try {
      const { Redis } = await import('ioredis');
      const redis = new Redis(config.queue.redisUrl, {
        maxRetriesPerRequest: 1,
        connectTimeout: 2000,
        lazyConnect: true,
      });
      await redis.connect();
      const rawEvents = await redis.lrange(eventsKey, 0, 9);
      recentEvents = rawEvents
        .map((e: string) => {
          try {
            return JSON.parse(e) as unknown;
          } catch {
            return null;
          }
        })
        .filter(Boolean);
      await redis.quit().catch(() => {});
    } catch {
      // Events are optional
    }

    res.json({
      status: state.status ?? 'unknown',
      current_stage: state.current_stage ?? 'unknown',
      progress: state.progress ?? 0.0,
      attempt: state.attempt ?? 0,
      pipeline_id: pipelineId,
      pipeline_name: state.pipeline_name,
      issue_id: issueId,
      error: state.error,
      created_at: state.created_at,
      updated_at: state.updated_at,
      recent_events: recentEvents,
    });
  } catch (err) {
<<<<<<< HEAD
    log.error(
      { err: String(err), issueId: req.params.issueId },
      'Failed to get pipeline status',
    );
=======
    log.error({ err: String(err), issueId: req.params.issueId }, 'Failed to get pipeline status');
>>>>>>> origin/main
    res.status(500).json({ error: 'Failed to get pipeline status' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/pipeline --- list all known pipeline IDs (limited)
// ---------------------------------------------------------------------------

router.get('/pipeline', async (_req: Request, res: Response) => {
  try {
    const { Redis } = await import('ioredis');
    const redis = new Redis(config.queue.redisUrl, {
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      lazyConnect: true,
    });
    await redis.connect();

    // Scan for pipeline:*:id keys
    const stream = redis.scanStream({
      match: 'pipeline:*:id',
      count: 100,
    });

    const pipelineKeys: string[] = [];
    await new Promise<void>((resolve, reject) => {
      stream.on('data', (batchKeys: string[]) => {
        for (const key of batchKeys) {
          pipelineKeys.push(key);
        }
      });
      stream.on('end', resolve);
      stream.on('error', reject);
    });

    // Fetch pipeline IDs
    const pipelines: { issue_id: string; pipeline_id: string | null }[] = [];
    for (const key of pipelineKeys) {
      const issueId = key.replace(/^pipeline:/, '').replace(/:id$/, '');
      const pipelineId = await redis.get(key);
      pipelines.push({ issue_id: issueId, pipeline_id: pipelineId });
    }

    await redis.quit().catch(() => {});

    res.json({
      pipelines,
      total: pipelines.length,
    });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to list pipelines');
    res.status(500).json({ error: 'Failed to list pipelines' });
  }
});

export { router as pipelineRouter };
