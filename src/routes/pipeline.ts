/**
 * Pipeline Status API endpoints.
 * GET /api/pipeline/:issueId - pipeline state
 * GET /api/pipeline - list all known pipelines
 */
import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'pipeline-api' });
const pipelineLimiter = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many pipeline status requests', retryAfter: 'see Retry-After header' } });

async function redisGet(key: string): Promise<string | undefined> {
  try {
    const { Redis } = await import('ioredis');
    const redis = new Redis(config.queue.redisUrl, { maxRetriesPerRequest: 1, connectTimeout: 2000, lazyConnect: true });
    await redis.connect();
    const val = await redis.get(key);
    await redis.quit().catch(() => {});
    return val ?? undefined;
  } catch { return undefined; }
}

const router: Router = Router();
router.use(pipelineLimiter);

router.get('/pipeline/:issueId', async (req: Request, res: Response) => {
  try {
    const { issueId } = req.params;
    if (!issueId || typeof issueId !== 'string' || issueId.length > 200) { res.status(400).json({ error: 'Invalid issueId' }); return; }
    const pipelineId = await redisGet(`pipeline:${issueId}:id`);
    if (!pipelineId) { res.json({ status: 'not_found', current_stage: '', progress: 0.0, attempt: 0, issue_id: issueId }); return; }
    const rawState = await redisGet(`pipeline:${pipelineId}:state`);
    if (!rawState) { res.json({ status: 'unknown', current_stage: 'unknown', progress: 0.0, attempt: 0, pipeline_id: pipelineId, issue_id: issueId, note: 'State not readable' }); return; }
    let state: Record<string, unknown>;
    try { state = JSON.parse(rawState); } catch { res.status(500).json({ error: 'Invalid pipeline state JSON', pipeline_id: pipelineId, issue_id: issueId }); return; }
    let recentEvents: unknown[] = [];
    try {
      const { Redis } = await import('ioredis');
      const redis = new Redis(config.queue.redisUrl, { maxRetriesPerRequest: 1, connectTimeout: 2000, lazyConnect: true });
      await redis.connect();
      recentEvents = (await redis.lrange(`pipeline:${pipelineId}:events`, 0, 9)).map((e: string) => { try { return JSON.parse(e); } catch { return null; } }).filter(Boolean);
      await redis.quit().catch(() => {});
    } catch { /* events optional */ }
    res.json({ status: state.status ?? 'unknown', current_stage: state.current_stage ?? 'unknown', progress: state.progress ?? 0.0, attempt: state.attempt ?? 0, pipeline_id: pipelineId, pipeline_name: state.pipeline_name, issue_id: issueId, error: state.error, created_at: state.created_at, updated_at: state.updated_at, recent_events: recentEvents });
  } catch (err) { log.error({ err: String(err), issueId: req.params.issueId }, 'Failed to get pipeline status'); res.status(500).json({ error: 'Failed to get pipeline status' }); }
});

router.get('/pipeline', async (_req: Request, res: Response) => {
  try {
    const { Redis } = await import('ioredis');
    const redis = new Redis(config.queue.redisUrl, { maxRetriesPerRequest: 1, connectTimeout: 2000, lazyConnect: true });
    await redis.connect();
    const stream = redis.scanStream({ match: 'pipeline:*:id', count: 100 });
    const pipelineKeys: string[] = [];
    await new Promise<void>((resolve, reject) => { stream.on('data', (bk: string[]) => pipelineKeys.push(...bk)); stream.on('end', resolve); stream.on('error', reject); });
    const pipelines: { issue_id: string; pipeline_id: string | null }[] = [];
    for (const key of pipelineKeys) { const iid = key.replace(/^pipeline:/, '').replace(/:id$/, ''); pipelines.push({ issue_id: iid, pipeline_id: await redis.get(key) }); }
    await redis.quit().catch(() => {});
    res.json({ pipelines, total: pipelines.length });
  } catch (err) { log.error({ err: String(err) }, 'Failed to list pipelines'); res.status(500).json({ error: 'Failed to list pipelines' }); }
});

export { router as pipelineRouter };
