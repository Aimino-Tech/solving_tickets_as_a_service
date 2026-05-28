/**
 * STAS — Solving Tickets As A Service
 *
 * Entry point — starts the API server, the worker, or both based on RUN_MODE.
 *
 * Usage:
 *   RUN_MODE=api    npm run dev    # API server only
 *   RUN_MODE=worker npm run dev    # Worker only
 *   RUN_MODE=both   npm run dev    # Both (default)
 *
 * ── Error Handling Audit ────────────────────────────────────────────
 * ✅ main() catch block logs error and exits with code 1
 * ✅ Graceful shutdown on SIGTERM/SIGINT (closes server, worker, Redis)
 * ✅ Server failure in 'both' mode logs and allows worker to continue
 * ✅ Worker failure in 'both' mode logs and allows server to continue
 * ────────────────────────────────────────────────────────────────────
 */

import "dotenv/config";
import type { Server } from "node:http";
import { config } from "./config.js";
import { rootLogger } from "./utils/logger.js";

const log = rootLogger.child({ module: "entry" });

let server: Server | undefined;
let shutdownInProgress = false;

async function main(): Promise<void> {
  log.info(
    { runMode: config.runMode, nodeEnv: config.nodeEnv },
    "Starting STAS",
  );

  const mode = config.runMode;

  // Graceful shutdown — closes server, worker, and exits
  const shutdown = async (signal: string) => {
    if (shutdownInProgress) return;
    shutdownInProgress = true;

    log.info({ signal }, "Shutting down gracefully");

    // Close server if running
    if (server) {
      await new Promise<void>((resolve) => {
        server!.close(() => {
          log.info("Server closed");
          resolve();
        });
      });
    }

    // Close worker if running
    if (worker) {
      try {
        await worker.close();
        log.info("Worker closed");
      } catch (err) {
        log.warn({ err: String(err) }, "Error closing worker");
      }
    }

    process.exit(0);
  };

  // Start API server
  if (mode === "api" || mode === "both") {
    log.info("Starting API server...");
    try {
      const { startServer } = await import("./server.js");
      server = startServer() as Server;
      log.info("API server started");
    } catch (err) {
      log.error({ err: String(err) }, "Failed to start API server");
      if (mode === "api") {
        process.exit(1);
      }
    }
  }

  // Start worker
  let worker: { close: () => Promise<void> } | undefined;
  if (mode === "worker" || mode === "both") {
    log.info("Starting worker...");
    try {
      const { createIssueWorker } = await import("./queue/issueQueue.js");
      worker = createIssueWorker();
      log.info("Worker started");
    } catch (err) {
      log.error({ err: String(err) }, "Failed to start worker");
      if (mode === "worker") {
        process.exit(1);
      }
    }
  }

  // Register signal handlers for graceful shutdown
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  log.error({ err: String(err) }, "Fatal error during startup");
  process.exit(1);
});
