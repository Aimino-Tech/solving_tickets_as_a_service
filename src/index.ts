/**
 * STAS — Solving Tickets As A Service
 *
 * Entry point — starts the API server, the worker, or both based on RUN_MODE.
 *
 * Usage:
 *   RUN_MODE=api    npm run dev    # API server only
 *   RUN_MODE=worker npm run dev    # Worker only
 *   RUN_MODE=both   npm run dev    # Both (default)
 */

import "dotenv/config";
import { config } from "./config.js";
import { rootLogger } from "./utils/logger.js";

const log = rootLogger.child({ module: "entry" });

async function main(): Promise<void> {
  log.info(
    { runMode: config.runMode, nodeEnv: config.nodeEnv },
    "Starting STAS",
  );

  const mode = config.runMode;

  // Start API server
  if (mode === "api" || mode === "both") {
    log.info("Starting API server...");
    try {
      const { startServer } = await import("./server.js");
      startServer();
      log.info("API server started");
    } catch (err) {
      log.error({ err: String(err) }, "Failed to start API server");
      if (mode === "api") {
        process.exit(1);
      }
    }
  }

  // Start worker
  if (mode === "worker" || mode === "both") {
    log.info("Starting worker...");
    try {
      const { createIssueWorker } = await import("./queue/issueQueue.js");
      const worker = createIssueWorker();
      log.info("Worker started");

      // Graceful shutdown
      const shutdown = async () => {
        log.info("Shutting down worker...");
        await worker.close();
        log.info("Worker shut down");
        process.exit(0);
      };

      process.on("SIGTERM", shutdown);
      process.on("SIGINT", shutdown);
    } catch (err) {
      log.error({ err: String(err) }, "Failed to start worker");
      if (mode === "worker") {
        process.exit(1);
      }
    }
  }

  // If only API mode, set up graceful shutdown for the server
  if (mode === "api") {
    process.on("SIGTERM", () => {
      log.info("Received SIGTERM, shutting down");
      process.exit(0);
    });
    process.on("SIGINT", () => {
      log.info("Received SIGINT, shutting down");
      process.exit(0);
    });
  }
}

main().catch((err) => {
  log.error({ err: String(err) }, "Fatal error during startup");
  process.exit(1);
});
