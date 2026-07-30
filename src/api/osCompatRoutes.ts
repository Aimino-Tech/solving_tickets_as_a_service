/**
 * OpenSymphony compatibility bridge.
 *
 * Implements the /api/tickets endpoints that SymphonyElixir.STAS.AppServer
 * expects, translating to STAS internal job storage.
 *
 *     POST /api/tickets  — Submit ticket (maps to internal fix job)
 *     GET  /api/tickets/:id  — Poll ticket status
 *
 * Auth: x-admin-key header matching ADMIN_API_KEY env.
 */

import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { Redis } from "ioredis";
import { z } from "zod";
import { config } from "../config.js";
import { rootLogger } from "../utils/logger.js";
import type { JobStatus, JobStatusResponse } from "./types.js";

const log = rootLogger.child({ module: "os-compat" });

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const ticketSubmitSchema = z.object({
  workspace: z.string().optional(),
  issue_id: z.string().optional(),
  identifier: z.string().optional(),
  title: z.string().min(1, "title is required").max(2000),
  description: z.string().max(100_000).optional().nullable(),
  labels: z.array(z.string()).optional(),
  priority: z.number().int().optional(),
  callback_url: z.string().url().optional().nullable(),
});

// ---------------------------------------------------------------------------
// Redis
// ---------------------------------------------------------------------------

let redis: Redis | null = null;

async function getRedis(): Promise<Redis> {
  if (!redis) {
    redis = new Redis(config.queue.redisUrl, {
      keyPrefix: "os:tickets:",
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: true,
      retryStrategy: (times) => {
        if (times > 3) return null;
        return Math.min(times * 200, 2000);
      },
    });
    redis.on("error", (err) => {
      log.error({ err: String(err) }, "OS compat Redis error");
    });
    await redis.connect();
  }
  return redis;
}

const JOB_TTL = 7 * 86_400; // 7 days

interface TicketRecord {
  ticketId: string;
  status: JobStatus;
  workspace?: string;
  issue_id?: string;
  identifier?: string;
  title: string;
  description?: string | null;
  labels?: string[];
  priority?: number;
  error?: string;
  result?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const router = Router();

/**
 * Admin key auth middleware.
 * Checks x-admin-key header against ADMIN_API_KEY env.
 */
router.use((req: Request, res: Response, next) => {
  const adminKey = req.headers["x-admin-key"] as string | undefined;
  const expected = process.env["ADMIN_API_KEY"];
  if (!expected) {
    log.warn("ADMIN_API_KEY not set — OS compat routes disabled");
    return res.status(503).json({ error: "OS compat not configured" });
  }
  if (!adminKey || adminKey !== expected) {
    return res.status(401).json({ error: "Invalid or missing admin key" });
  }
  next();
});

/**
 * POST /api/tickets
 *
 * Accepts a ticket payload from OpenSymphony:
 *   { workspace, issue_id, identifier, title, description, labels, priority, callback_url }
 *
 * Stores the job in Redis and enqueues via RabbitMQ.
 */
router.post("/tickets", async (req: Request, res: Response) => {
  const startTime = Date.now();

  const parseResult = ticketSubmitSchema.safeParse(req.body);
  if (!parseResult.success) {
    const errors = parseResult.error.issues.map(
      (issue) => `${issue.path.join(".")}: ${issue.message}`,
    );
    return res.status(400).json({ error: "Validation failed", details: errors });
  }

  const { workspace, issue_id, identifier, title, description, labels, priority } = parseResult.data;

  try {
    const client = await getRedis();
    const ticketId = randomUUID();
    const now = new Date().toISOString();

    const record: TicketRecord = {
      ticketId,
      status: "queued",
      workspace,
      issue_id,
      identifier,
      title,
      description,
      labels,
      priority,
      createdAt: now,
      updatedAt: now,
    };

    await client.setex(`ticket:${ticketId}`, JOB_TTL, JSON.stringify(record));

    // Enqueue via RabbitMQ for STAS processing
    try {
      const { QUEUES, publishMessage, connect: rmqConnect, isConnected } = await import("../queue/rabbitmq.js");
      const { config: stasConfig } = await import("../config.js");

      if (!isConnected()) {
        await rmqConnect();
      }

      const jobData = {
        installationId: 0,
        repoOwner: stasConfig.trackers.defaultRepoOwner || "aimino-tech",
        repoName: stasConfig.trackers.defaultRepoName || "sandbox",
        repoPrivate: false,
        issueNumber: 0,
        issueTitle: title,
        issueBody: description || "",
        source: "opensymphony",
        osTicketId: ticketId,
        osIdentifier: identifier || "unknown",
      };

      const messageId = `${jobData.installationId}:${jobData.repoOwner}/${jobData.repoName}#${jobData.issueNumber}-${Date.now()}`;
      await publishMessage(QUEUES.issuesFix.exchange, QUEUES.issuesFix.routingKey, {
        ...jobData,
        _meta: { messageId, enqueuedAt: new Date().toISOString() },
      });

      record.status = "queued";
      record.updatedAt = new Date().toISOString();
      await client.setex(`ticket:${ticketId}`, JOB_TTL, JSON.stringify(record));
    } catch (queueErr) {
      log.error({ err: String(queueErr), ticketId }, "Failed to enqueue OS ticket");
    }

    log.info({ ticketId, identifier, title, duration: Date.now() - startTime }, "OS ticket submitted");

    res.status(201).json({ id: ticketId });
  } catch (err) {
    log.error({ err: String(err) }, "Failed to submit OS ticket");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/tickets/:id
 *
 * Returns ticket status in OpenSymphony-expected format:
 *   { status: "queued"|"running"|"completed"|"failed", result?: {...}, error?: string }
 */
router.get("/tickets/:id", async (req: Request, res: Response) => {
  const { id } = req.params;

  if (!id || typeof id !== "string") {
    return res.status(400).json({ error: "Invalid ticket id" });
  }

  try {
    const client = await getRedis();
    const raw = await client.get(`ticket:${id}`);

    if (!raw) {
      return res.status(404).json({ error: "Ticket not found" });
    }

    const record = JSON.parse(raw) as TicketRecord;

    // Return in OpenSymphony-expected format
    const response: Record<string, unknown> = {
      id: record.ticketId,
      status: record.status,
      error: record.error,
      result: record.result,
      created_at: record.createdAt,
      updated_at: record.updatedAt,
      completed_at: record.completedAt,
    };

    res.json(response);
  } catch (err) {
    log.error({ err: String(err), ticketId: id }, "Failed to get ticket status");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
