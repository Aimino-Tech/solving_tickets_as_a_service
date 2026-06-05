/**
 * Environment configuration with Zod validation.
 *
 * All env vars are read once at startup and exported as a typed config object.
 * Missing/invalid required values produce grouped error messages.
 */

import "dotenv/config";
import { z } from "zod";
import { rootLogger } from "./utils/logger.js";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const envSchema = z.object({
  // Server
  PORT: z.coerce.number().int().positive().max(65535).default(3000),
  RUN_MODE: z.enum(["api", "worker", "both"]).default("both"),

  // GitHub App
  GITHUB_APP_ID: z.string().min(1, "GITHUB_APP_ID is required"),
  GITHUB_APP_PRIVATE_KEY: z
    .string()
    .min(1, "GITHUB_APP_PRIVATE_KEY or GITHUB_APP_PRIVATE_KEY_PATH is required")
    .optional(),
  GITHUB_APP_PRIVATE_KEY_PATH: z.string().optional(),
  GITHUB_WEBHOOK_SECRET: z.string().min(1, "GITHUB_WEBHOOK_SECRET is required"),
  GITHUB_WEBHOOK_PATH: z.string().default("/webhook"),

  // Queue
  REDIS_URL: z.string().default("redis://localhost:6379"),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(2),
  QUEUE_DEDUP_TTL_SECONDS: z.coerce.number().int().positive().default(120),
  QUEUE_KEEP_COMPLETED: z.coerce.number().int().positive().default(200),
  QUEUE_KEEP_FAILED: z.coerce.number().int().positive().default(100),

  // OpenCode
  OPENCODE_URL: z.string().default("http://localhost:4096"),
  OPENCODE_MODEL: z.string().default("anthropic/claude-sonnet-4-20250514"),

  // OpenAI / triage
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_CHEAP_MODEL: z.string().default("gpt-4o-mini"),

  // Sandbox
  E2B_API_KEY: z.string().optional(),
  E2B_TEMPLATE_ID: z.string().default("stas-default"),
  E2B_SANDBOX_TIMEOUT_MS: z.coerce.number().int().positive().default(300_000),

  // STAS
  STAS_LABEL: z.string().default("stas:fix"),
  BOT_NAME: z.string().default("STAS"),
  DEV_SKIP_WEBHOOK_SIGNATURE_VERIFY: z.coerce.boolean().default(false),
  MAX_AGENT_ITERATIONS: z.coerce.number().int().positive().default(40),
  MAX_ISSUE_COMMENTS: z.coerce.number().int().positive().default(15),
  STAS_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  STAS_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),

  // Trackers — Linear
  LINEAR_API_KEY: z.string().optional(),
  LINEAR_WEBHOOK_SECRET: z.string().optional(),

  // Trackers — Jira
  JIRA_URL: z.string().optional(),
  JIRA_EMAIL: z.string().optional(),
  JIRA_API_TOKEN: z.string().optional(),
  JIRA_WEBHOOK_SECRET: z.string().optional(),
  JIRA_PROJECT_KEY: z.string().optional(),

  // Tracker-to-GitHub repo mapping (comma-separated: "linear=<owner/repo>,jira=<owner/repo>")
  TRACKER_DEFAULT_REPO_OWNER: z.string().optional(),
  TRACKER_DEFAULT_REPO_NAME: z.string().optional(),
  TRACKER_INSTALLATION_ID: z.coerce.number().int().positive().optional(),

  // Logging
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error", "fatal"]).default("info"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

type ParsedEnv = z.infer<typeof envSchema>;

// ---------------------------------------------------------------------------
// Build config tree
// ---------------------------------------------------------------------------

function buildConfig(env: ParsedEnv) {
  return {
    port: env.PORT,
    runMode: env.RUN_MODE,
    logLevel: env.LOG_LEVEL,
    nodeEnv: env.NODE_ENV,

    github: {
      appId: env.GITHUB_APP_ID,
      privateKeyPath: env.GITHUB_APP_PRIVATE_KEY_PATH,
      privateKeyEnv: env.GITHUB_APP_PRIVATE_KEY,
      webhookSecret: env.GITHUB_WEBHOOK_SECRET,
      webhookPath: env.GITHUB_WEBHOOK_PATH,
    },

    queue: {
      redisUrl: env.REDIS_URL,
      workerConcurrency: env.WORKER_CONCURRENCY,
      dedupTtl: env.QUEUE_DEDUP_TTL_SECONDS,
      keepCompleted: env.QUEUE_KEEP_COMPLETED,
      keepFailed: env.QUEUE_KEEP_FAILED,
    },

    opencode: {
      url: env.OPENCODE_URL,
      model: env.OPENCODE_MODEL,
    },

    openai: {
      apiKey: env.OPENAI_API_KEY,
      cheapModel: env.OPENAI_CHEAP_MODEL,
    },

    e2b: {
      apiKey: env.E2B_API_KEY,
      templateId: env.E2B_TEMPLATE_ID,
      sandboxTimeoutMs: env.E2B_SANDBOX_TIMEOUT_MS,
    },

    stas: {
      label: env.STAS_LABEL,
      botName: env.BOT_NAME,
      devSkipWebhookVerify: env.DEV_SKIP_WEBHOOK_SIGNATURE_VERIFY,
      maxAgentIterations: env.MAX_AGENT_ITERATIONS,
      maxIssueComments: env.MAX_ISSUE_COMMENTS,
      rateLimitWindowMs: env.STAS_RATE_LIMIT_WINDOW_MS,
      rateLimitMax: env.STAS_RATE_LIMIT_MAX,
    },

    trackers: {
      linear: env.LINEAR_API_KEY
        ? {
            apiKey: env.LINEAR_API_KEY,
            webhookSecret: env.LINEAR_WEBHOOK_SECRET,
          }
        : undefined,
      jira: env.JIRA_URL && env.JIRA_EMAIL && env.JIRA_API_TOKEN
        ? {
            url: env.JIRA_URL,
            email: env.JIRA_EMAIL,
            apiToken: env.JIRA_API_TOKEN,
            webhookSecret: env.JIRA_WEBHOOK_SECRET,
            projectKey: env.JIRA_PROJECT_KEY,
          }
        : undefined,
      defaultRepoOwner: env.TRACKER_DEFAULT_REPO_OWNER,
      defaultRepoName: env.TRACKER_DEFAULT_REPO_NAME,
      installationId: env.TRACKER_INSTALLATION_ID || 0,
    },
  } as const;
}

// ---------------------------------------------------------------------------
// Parse eagerly at module load
// ---------------------------------------------------------------------------

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const { fieldErrors, formErrors } = parsed.error.flatten();

  rootLogger.error("Invalid environment configuration:");

  if (formErrors.length > 0) {
    rootLogger.error({ errors: formErrors }, "Form-level errors");
  }

  for (const [key, msgs] of Object.entries(fieldErrors)) {
    if (msgs && msgs.length > 0) {
      for (const msg of msgs) {
        rootLogger.error({ key }, `${key}: ${msg}`);
      }
    }
  }

  process.exit(1);
}

export const config = buildConfig(parsed.data);

// ---------------------------------------------------------------------------
// Explicit re-parse helper (for tests / re-imports)
// ---------------------------------------------------------------------------

export function requireConfig(): typeof config {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const { fieldErrors } = result.error.flatten();
    const lines: string[] = ["Invalid environment configuration:"];
    for (const [key, msgs] of Object.entries(fieldErrors)) {
      if (msgs && msgs.length > 0) {
        lines.push(`  - ${key}: ${msgs.join("; ")}`);
      }
    }
    throw new Error(lines.join("\n"));
  }
  return buildConfig(result.data);
}

export type Config = typeof config;
