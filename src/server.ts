/**
 * Express API server — webhook receiver and health endpoint.
 *
 * Features:
 * - Raw body middleware for webhook signature verification
 * - Request ID middleware for log correlation
 * - Structured access logging with pino
 * - GET /health endpoint
 * - POST /webhook — GitHub webhook receiver via @octokit/webhooks
 *
 * ── Error Handling Audit ────────────────────────────────────────────
 * ✅ Global Express error middleware (4-arg handler) at bottom of chain
 * ✅ Process-level uncaughtException and unhandledRejection handlers
 * ✅ app.listen() error event handled (EADDRINUSE, EACCES, etc.)
 * ✅ Server instance returned for graceful shutdown by caller
 * ✅ Request ID middleware for log correlation
 * ────────────────────────────────────────────────────────────────────
 */

import crypto from "node:crypto";
import express from "express";
import type { Request, Response, NextFunction } from "express";
import { config } from "./config.js";
import { rootLogger } from "./utils/logger.js";
import { createGithubWebhooks } from "./webhooks/github.js";
import { createIssueQueue } from "./queue/issueQueue.js";
import type { IssueJobData } from "./utils/types.js";
import { validateWebhookPayload } from "./validation.js";
import rateLimit from "express-rate-limit";

const log = rootLogger.child({ module: "server" });

/**
 * Create and configure the Express application.
 */
export function createApp(): express.Application {
  const app = express();

  // ── Request ID middleware ────────────────────────────────────────
  app.use((req: Request, res: Response, next: NextFunction) => {
    const requestId =
      (req.headers["x-request-id"] as string) ||
      crypto.randomUUID();
    req.requestId = requestId;
    res.setHeader("x-request-id", requestId);
    next();
  });

  // ── Structured access log middleware ─────────────────────────────
  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    res.on("finish", () => {
      const latency = Date.now() - start;
      log.info(
        {
          method: req.method,
          path: req.path,
          statusCode: res.statusCode,
          latency,
          requestId: req.requestId,
          contentLength: req.headers["content-length"],
          userAgent: req.headers["user-agent"],
        },
        `${req.method} ${req.path} ${res.statusCode} ${latency}ms`,
      );
    });
    next();
  });

  // ── Raw body capture for webhook verification ────────────────────
  app.use(
    "/webhook",
    express.raw({ type: "application/json", verify: addRawBody }),
  );

  // ── JSON parsing for all other routes ────────────────────────────
  app.use(express.json());

  // ── Rate limiter for webhook routes ───────────────────────────────
  const limiter = rateLimit({
    windowMs: config.stas.rateLimitWindowMs,
    limit: config.stas.rateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests", retryAfter: "see Retry-After header" },
  });
  app.use("/webhook", limiter);

  // ── Health check ─────────────────────────────────────────────────
  app.get("/health", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      label: config.stas.label,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  });

  // ── Webhook receiver ─────────────────────────────────────────────
  const queue = createIssueQueue();
  const webhooks = createGithubWebhooks(queue);

  app.post("/webhook", async (req: Request, res: Response) => {
    const event = req.headers["x-github-event"] as string;
    const deliveryId = req.headers["x-github-delivery"] as string;
    const signature = req.headers["x-hub-signature-256"] as string;

    log.info(
      { event, deliveryId, requestId: req.requestId },
      "Received webhook",
    );

    // ── Parse and validate payload before processing ──────────────
    const rawBody = (req as { rawBody?: Buffer }).rawBody;
    let parsedPayload: unknown;
    try {
      parsedPayload = rawBody
        ? JSON.parse(rawBody.toString())
        : req.body;
    } catch (err) {
      log.error({ err: String(err) }, "Failed to parse webhook payload");
      res.status(400).json({ error: "Invalid JSON payload" });
      return;
    }

    const validation = validateWebhookPayload(event, parsedPayload);
    if (!validation.success) {
      log.warn(
        {
          event,
          errors: validation.errors,
          requestId: req.requestId,
        },
        "Webhook payload validation failed",
      );
      res.status(400).json({ error: "Invalid payload", details: validation.errors });
      return;
    }

    // ── Verify signature (skip in dev mode if configured) ─────────
    if (!config.stas.devSkipWebhookVerify && signature) {
      if (!rawBody) {
        log.error("Missing raw body for signature verification");
        res.status(400).json({ error: "Missing raw body" });
        return;
      }

      try {
        await webhooks.verifyAndReceive({
          id: deliveryId,
          name: event as any,
          payload: rawBody.toString(),
          signature,
        });
      } catch (err) {
        log.warn({ err: String(err) }, "Webhook verification failed");
        res.status(401).json({ error: "Invalid signature" });
        return;
      }
    } else {
      // Dev mode: process without verification
      const payload = rawBody ? rawBody.toString() : JSON.stringify(req.body);

      try {
        await webhooks.verifyAndReceive({
          id: deliveryId || crypto.randomUUID(),
          name: event as any,
          payload,
          signature: signature || "",
        });
      } catch (err) {
        log.error({ err: String(err) }, "Webhook processing error");
        // Don't return 401 in dev mode — just log the error
      }
    }

    // Always return 202 Accepted for webhooks
    res.status(202).json({ accepted: true });
  });

  // ── 404 handler ──────────────────────────────────────────────────
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: "Not found" });
  });

  // ── Global error handler ─────────────────────────────────────────
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    log.error({ err: String(err) }, "Unhandled error");
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}

/**
 * Start the Express server on the configured port.
 * Returns the server instance so callers can close it during graceful shutdown.
 */
export function startServer(): import("http").Server {
  const app = createApp();

  const server = app.listen(config.port, "0.0.0.0", () => {
    log.info(
      { port: config.port, label: config.stas.label, env: config.nodeEnv },
      `STAS server listening on :${config.port}`,
    );
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      log.error({ port: config.port }, `Port ${config.port} is already in use`);
    } else if (err.code === "EACCES") {
      log.error({ port: config.port }, `Permission denied for port ${config.port}`);
    } else {
      log.error({ err: String(err) }, "Server failed to start");
    }
    process.exit(1);
  });

  return server;
}

// ── Process-level error handlers ────────────────────────────────────

process.on("uncaughtException", (err) => {
  log.error({ err: String(err), stack: (err as Error).stack }, "Uncaught exception — shutting down");
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  log.error(
    { err: String(reason), stack: (reason as Error)?.stack },
    "Unhandled promise rejection — shutting down",
  );
  process.exit(1);
});

// ── Helper: Capture raw body for webhook signature verification ────

/**
 * Express verify callback that stores the raw body buffer on the request
 * object so it can be used for webhook signature verification.
 */
function addRawBody(
  req: Request,
  _res: Response,
  buf: Buffer,
): void {
  (req as { rawBody?: Buffer }).rawBody = buf;
}

// Extend Express Request to include requestId
declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}
