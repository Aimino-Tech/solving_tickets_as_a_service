/**
 * STAS Bridge Router — REST bridge between the Symphony orchestrator
 * and the STAS MCP pipeline.
 *
 * Exposes two endpoints:
 *
 *   POST /api/tickets   — Accept orchestrator ticket format, map to MCP
 *                         pipeline, and return a run ID.
 *   GET  /api/tickets/:id — Poll run status, mapped to orchestrator format.
 *
 * This file follows the same Redis/RabbitMQ patterns as `mcp.ts` but
 * implements the protocol the Elixir orchestrator's AppServer expects.
 *
 * ── Orchestrator Protocol ─────────────────────────────────────────────────
 *
 * POST /api/tickets payload:
 *   { workspace, issue_id, identifier, title, description, labels, priority, callback_url }
 * Response (201): { "id": "runId-uuid" }
 *
 * GET /api/tickets/:id responses:
 *   200 { status: "completed", result: { ticket_id } }
 *   200 { status: "failed", error: "reason" }
 *   200 { status: "in_progress" }
 *   404 { error: "Ticket not found" }
 */

import { randomUUID } from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { Redis } from 'ioredis';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import type { McpJobStatus } from '../opencode-contract.js';

const log = rootLogger.child({ module: 'stas-bridge' });

// ---------------------------------------------------------------------------
// Redis connection (follows mcp.ts pattern — same key prefix for shared store)
// ---------------------------------------------------------------------------

let redis: Redis | null = null;

async function getRedis(): Promise<Redis> {
  if (!redis) {
    redis = new Redis(config.queue.redisUrl, {
      keyPrefix: 'mcp:',
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: true,
      retryStrategy: (times) => {
        if (times > 3) return null;
        return Math.min(times * 200, 2000);
      },
    });
    redis.on('error', (err) => {
      log.error({ err: String(err) }, 'STAS bridge Redis error');
    });
    await redis.connect();
  }
  return redis;
}

const JOB_TTL = 7 * 86_400; // 7 days — same as mcp.ts

function redisKey(...parts: string[]): string {
  return parts.join(':');
}

async function saveJob(client: Redis, runId: string, data: McpJobStatus): Promise<void> {
  await client.setex(redisKey('job', runId), JOB_TTL, JSON.stringify(data));
}

async function getJob(client: Redis, runId: string): Promise<McpJobStatus | null> {
  const raw = await client.get(redisKey('job', runId));
  if (!raw) return null;
  return JSON.parse(raw) as McpJobStatus;
}

// ---------------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------------

function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const apiKey = process.env.STAS_API_KEY || config.mcp.apiKey;
  if (!apiKey) {
    res.status(500).json({ error: 'STAS API key not configured' });
    return;
  }
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ') || authHeader.slice(7) !== apiKey) {
    res.status(401).json({ error: 'Unauthorized: invalid or missing API key' });
    return;
  }
  next();
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const router = Router();

// Apply auth to all STAS Bridge routes
router.use(authMiddleware);

// ---------------------------------------------------------------------------
// POST /api/tickets — Submit a ticket from the orchestrator
// ---------------------------------------------------------------------------

router.post('/api/tickets', async (req: Request, res: Response) => {
  const { workspace, issue_id, identifier, title, description, labels, priority, callback_url } = req.body ?? {};

  // Validate required fields
  if (!title || typeof title !== 'string') {
    return res.status(400).json({ error: 'title is required and must be a string' });
  }

  try {
    const client = await getRedis();
    const runId = randomUUID();
    const now = new Date().toISOString();

    // Save initial job status (shared Redis namespace with MCP)
    const jobData: McpJobStatus = {
      runId,
      status: 'queued',
      message: 'Issue queued for STAS processing via bridge',
      createdAt: now,
      updatedAt: now,
    };
    await saveJob(client, runId, jobData);

    // Publish to RabbitMQ for the MCP issue consumer
    try {
      const { QUEUES, publishMessage, connect: rmqConnect, isConnected } = await import('../queue/rabbitmq.js');
      if (!isConnected()) await rmqConnect();

      const messageId = `stas-bridge:${runId}-${Date.now()}`;

      // Validate required config values
      const installationId = config.trackers?.installationId;
      const repoOwner = config.trackers?.defaultRepoOwner;
      const repoName = config.trackers?.defaultRepoName;

      if (!installationId || !repoOwner || !repoName) {
        return res.status(500).json({
          error: 'Server configuration incomplete',
          missing: {
            ...(!installationId && { installationId: 'config.trackers.installationId is required' }),
            ...(!repoOwner && { defaultRepoOwner: 'config.trackers.defaultRepoOwner is required' }),
            ...(!repoName && { defaultRepoName: 'config.trackers.defaultRepoName is required' }),
          },
        });
      }

      await publishMessage(QUEUES.issuesFix.exchange, QUEUES.issuesFix.routingKey, {
        installationId,
        repoOwner,
        repoName,
        repoPrivate: false,
        issueNumber: 0,
        issueTitle: title,
        issueBody: description || '',
        source: 'stas-bridge',
        labels: Array.isArray(labels) ? labels : [],
        _meta: {
          messageId,
          enqueuedAt: now,
          // Preserve orchestrator fields for downstream use
          orchestrator: {
            workspace,
            issue_id,
            identifier,
            priority,
            callback_url,
          },
        },
      });

      log.info({ runId, title, identifier }, 'STAS bridge: issue submitted to pipeline');
    } catch (queueErr) {
      // Non-fatal — job is saved in Redis; the consumer can still pick it up
      // if RabbitMQ recovers.  Log and proceed.
      log.error({ err: String(queueErr), runId }, 'STAS bridge: failed to enqueue issue');
    }

    // Return orchestrator-compatible response
    res.status(201).json({ id: runId });
  } catch (err) {
    log.error({ err: String(err) }, 'STAS bridge: failed to submit ticket');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/tickets/:id — Poll ticket status
// ---------------------------------------------------------------------------

router.get('/api/tickets/:id', async (req: Request, res: Response) => {
  const { id } = req.params;

  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Invalid ticket id' });
  }

  try {
    const client = await getRedis();
    const job = await getJob(client, id);

    if (!job) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    // Map MCP statuses to orchestrator format
    switch (job.status) {
      case 'completed':
        return res.json({
          status: 'completed',
          result: {
            ticket_id: id,
            pr_url: job.prUrl,
            message: job.message,
          },
        });

      case 'failed':
      case 'error':
        return res.json({
          status: 'failed',
          error: job.errorMessage || job.message || 'Unknown error',
        });

      default:
        // queued, investigating, fixing, testing, verifying, committing → in_progress
        return res.json({
          status: 'in_progress',
          runId: job.runId,
          message: job.message,
          progress: job.progress,
          createdAt: job.createdAt,
          updatedAt: job.updatedAt,
        });
    }
  } catch (err) {
    log.error({ err: String(err), ticketId: id }, 'STAS bridge: failed to get ticket status');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
