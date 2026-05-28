/**
 * Environment configuration with validation.
 *
 * All env vars are read once at startup and exported as a typed config object.
 * Missing required values cause a friendly error message and process exit.
 */

import "dotenv/config";
import { rootLogger } from "./utils/logger.js";

function envInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === "") return fallback;
  const parsed = parseInt(raw, 10);
  if (isNaN(parsed)) {
    rootLogger.warn({ key, raw }, `Invalid integer for env var ${key}, using fallback ${fallback}`);
    return fallback;
  }
  return parsed;
}

function envStr(key: string, fallback?: string): string | undefined {
  const raw = process.env[key];
  if (raw === undefined || raw === "") return fallback;
  return raw;
}

function envRequired(key: string): string {
  const raw = process.env[key];
  if (!raw) {
    rootLogger.error(`Missing required env var: ${key}`);
    process.exit(1);
  }
  return raw;
}

export const config = {
  port: envInt("PORT", 3000),
  runMode: (process.env.RUN_MODE || "both") as "api" | "worker" | "both",
  logLevel: envStr("LOG_LEVEL", "info"),
  nodeEnv: envStr("NODE_ENV", "development"),

  github: {
    appId: envRequired("GITHUB_APP_ID"),
    privateKeyPath: envStr("GITHUB_APP_PRIVATE_KEY_PATH"),
    privateKeyEnv: envStr("GITHUB_APP_PRIVATE_KEY"),
    webhookSecret: envRequired("GITHUB_WEBHOOK_SECRET"),
    webhookPath: envStr("GITHUB_WEBHOOK_PATH", "/webhook"),
  },

  queue: {
    redisUrl: envStr("REDIS_URL", "redis://localhost:6379"),
    workerConcurrency: envInt("WORKER_CONCURRENCY", 2),
    dedupTtl: envInt("QUEUE_DEDUP_TTL_SECONDS", 120),
    keepCompleted: envInt("QUEUE_KEEP_COMPLETED", 200),
    keepFailed: envInt("QUEUE_KEEP_FAILED", 100),
  },

  opencode: {
    url: envStr("OPENCODE_URL", "http://localhost:4096"),
    model: envStr("OPENCODE_MODEL", "anthropic/claude-sonnet-4-20250514"),
  },

  openai: {
    apiKey: envStr("OPENAI_API_KEY"),
    cheapModel: envStr("OPENAI_CHEAP_MODEL", "gpt-4o-mini"),
  },

  e2b: {
    apiKey: envRequired("E2B_API_KEY"),
    templateId: envStr("E2B_TEMPLATE_ID", "stas-default"),
    sandboxTimeoutMs: envInt("E2B_SANDBOX_TIMEOUT_MS", 300_000),
  },

  stas: {
    label: envStr("STAS_LABEL", "stas:fix"),
    botName: envStr("BOT_NAME", "STAS"),
    devSkipWebhookVerify: process.env.DEV_SKIP_WEBHOOK_SIGNATURE_VERIFY === "true",
    maxAgentIterations: envInt("MAX_AGENT_ITERATIONS", 40),
    maxIssueComments: envInt("MAX_ISSUE_COMMENTS", 15),
  },
} as const;

export type Config = typeof config;
