/**
 * Fix submission and polling routes for the RapidAPI.
 *
 * POST /api/fix       — Submit a new fix job
 * GET  /api/fix/:id   — Poll job status
 *
 * Jobs are stored in Redis with a TTL and enqueued for processing.
 */

import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { Redis } from 'ioredis';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import type { FixResponse, JobStatus, JobStatusResponse } from './types.js';

const log = rootLogger.child({ module: 'rapidapi-fix' });

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const fixRequestSchema = z.object({
  repoUrl: z
    .string()
    .min(1, 'repoUrl is required')
    .url('repoUrl must be a valid URL')
    .regex(
      /^https?:\/\/github\.com\/[\w.-]+\/[\w.-]+(?:\/.*)?$/,
      'repoUrl must be a valid GitHub repository URL',
    ),
  issueTitle: z
    .string()
    .min(1, 'issueTitle is required')
    .max(500, 'issueTitle must be at most 500 characters'),
  issueBody: z
    .string()
    .min(1, 'issueBody is required')
    .max(50_000, 'issueBody must be at most 50,000 characters'),
  language: z
    .string()
    .max(50, 'language must be at most 50 characters')
    .optional(),
});

// ---------------------------------------------------------------------------
// Redis client
// ---------------------------------------------------------------------------

let redis: Redis | null = null;

async function getRedis(): Promise<Redis> {
  if (!redis) {
    redis = new Redis(config.queue.redisUrl, {
      keyPrefix: 'rapidapi:jobs:',
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: true,
      retryStrategy: (times) => {
        if (times > 3) return null;
        return Math.min(times * 200, 2000);
      },
    });

    redis.on('error', (err) => {
      log.error({ err: String(err) }, 'Fix jobs Redis error');
    });

    await redis.connect();
  }
  return redis;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const JOB_TTL = 7 * 86_400; // 7 days

function redisKey(jobId: string): string {
  return `job:${jobId}`;
}

async function saveJob(
  client: Redis,
  jobId: string,
  data: JobStatusResponse,
): Promise<void> {
  await client.setex(redisKey(jobId), JOB_TTL, JSON.stringify(data));
}

async function getJob(
  client: Redis,
  jobId: string,
): Promise<JobStatusResponse | null> {
  const raw = await client.get(redisKey(jobId));
  if (!raw) return null;
  return JSON.parse(raw) as JobStatusResponse;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const router = Router();

/**
 * POST /api/fix
 *
 * Submit a new fix job. Validates the request body, generates a UUID jobId,
 * stores job metadata in Redis, enqueues a task, and returns immediately
 * with the jobId (<500ms latency target).
 */
router.post('/', async (req: Request, res: Response) => {
  const startTime = Date.now();

  // Validate request body
  const parseResult = fixRequestSchema.safeParse(req.body);
  if (!parseResult.success) {
    const errors = parseResult.error.issues.map(
      (issue) => `${issue.path.join('.')}: ${issue.message}`,
    );
    return res.status(400).json({ error: 'Validation failed', details: errors });
  }

  const { repoUrl, issueTitle, issueBody, language } = parseResult.data;

  try {
    const client = await getRedis();
    const jobId = randomUUID();
    const now = new Date().toISOString();

    // Build the initial job record
    const jobData: JobStatusResponse = {
      jobId,
      status: 'queued',
      createdAt: now,
      updatedAt: now,
    };

    await saveJob(client, jobId, jobData);

    // Enqueue the task for processing
    try {
      const { enqueueIssue } = await import('../queue/issueQueue.js');

      // Parse repo owner and name from the URL
      // URL format: https://github.com/owner/repo
      const urlParts = repoUrl.replace(/\/$/, '').split('/');
      const repoOwner = urlParts[urlParts.length - 2];
      const repoName = urlParts[urlParts.length - 1];

      await enqueueIssue(null as unknown as import('bullmq').Queue, {
        installationId: 0,
        repoOwner,
        repoName,
        repoPrivate: false,
        issueNumber: 0,
        issueTitle,
        issueBody,
        source: 'rapidapi',
        metadata: {
          rapidapiJobId: jobId,
          language: language ?? null,
          plan: req.plan ?? 'free',
        },
      });

      // Update job status to show it's been dispatched
      jobData.status = 'queued';
      jobData.updatedAt = new Date().toISOString();
      await saveJob(client, jobId, jobData);
    } catch (queueErr) {
      // Queue failure — still return the jobId so the user can poll
      log.error(
        { err: String(queueErr), jobId },
        'Failed to enqueue task',
      );
    }

    const response: FixResponse = {
      jobId,
      status: 'queued',
      pollUrl: `${req.protocol}://${req.get('host')}/api/fix/${jobId}`,
      createdAt: now,
    };

    const duration = Date.now() - startTime;
    log.info({ jobId, duration, plan: req.plan }, 'Fix job submitted');

    res.status(201).json(response);
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to submit fix job');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/fix/:jobId
 *
 * Poll the status of a fix job. Returns the current status, result URL,
 * eval score, and error message if applicable.
 */
router.get('/:jobId', async (req: Request, res: Response) => {
  const { jobId } = req.params;

  if (!jobId || typeof jobId !== 'string') {
    return res.status(400).json({ error: 'Invalid jobId' });
  }

  try {
    const client = await getRedis();
    const job = await getJob(client, jobId);

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    res.json(job);
  } catch (err) {
    log.error({ err: String(err), jobId }, 'Failed to get job status');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
