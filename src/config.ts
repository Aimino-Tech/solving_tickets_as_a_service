/**
 * Environment configuration with Zod validation.
 *
 * All env vars are read once at startup and exported as a typed config object.
 * Missing/invalid required values produce grouped error messages.
 */

import 'dotenv/config';
import { z } from 'zod';
import { rootLogger } from './utils/logger.js';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const envSchema = z.object({
  // Server
  PORT: z.coerce.number().int().positive().max(65535).default(3000),
  RUN_MODE: z.enum(['api', 'worker', 'both']).default('both'),

  // GitHub App
  GITHUB_APP_ID: z.string().min(1, 'GITHUB_APP_ID is required'),
  GITHUB_APP_PRIVATE_KEY: z
    .string()
    .min(1, 'GITHUB_APP_PRIVATE_KEY or GITHUB_APP_PRIVATE_KEY_PATH is required')
    .optional(),
  GITHUB_APP_PRIVATE_KEY_PATH: z.string().optional(),
  GITHUB_WEBHOOK_SECRET: z.string().min(1, 'GITHUB_WEBHOOK_SECRET is required'),
  GITHUB_WEBHOOK_PATH: z.string().default('/webhook'),

  // Queue
  REDIS_URL: z.string().default('redis://localhost:6379'),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(2),
  QUEUE_DEDUP_TTL_SECONDS: z.coerce.number().int().positive().default(120),
  QUEUE_KEEP_COMPLETED: z.coerce.number().int().positive().default(200),
  QUEUE_KEEP_FAILED: z.coerce.number().int().positive().default(100),
  QUEUE_MAX_RETRIES: z.coerce.number().int().positive().max(10).default(4),
  QUEUE_RETRY_DELAYS: z.string().default("30000,120000,300000,900000"),
  QUEUE_BACKEND: z.enum(['bullmq', 'rabbitmq', 'both']).default('both'),

  // RabbitMQ
  RABBITMQ_URL: z.string().default('amqp://localhost:5672/stas'),
  RABBITMQ_PREFETCH_COUNT: z.coerce.number().int().positive().default(10),
  RABBITMQ_RECONNECT_DELAY_MS: z.coerce.number().int().positive().default(5000),
  RABBITMQ_MAX_RECONNECT_ATTEMPTS: z.coerce.number().int().positive().default(10),

  // Bridge
  BRIDGE_RPC_TIMEOUT: z.coerce.number().int().positive().default(30000),
  BRIDGE_MAX_RETRIES: z.coerce.number().int().positive().max(10).default(3),
  BRIDGE_CIRCUIT_BREAKER_THRESHOLD: z.coerce.number().int().positive().default(5),
  QUEUE_FALLBACK_BACKEND: z.enum(['redis', 'local', 'none']).default('redis'),

  // OpenCode
  OPENCODE_URL: z.string().default("http://localhost:4096"),
  OPENCODE_MODEL: z.string().default("anthropic/claude-sonnet-4-20250514"),
  FALLBACK_MODELS: z.string().default("gpt-4o,claude-haiku"),

  // Timeouts
  FIX_TIMEOUT_MS: z.coerce.number().int().positive().default(600_000),
  PHASE_TIMEOUT_TRIAGE_MS: z.coerce.number().int().positive().default(30_000),
  PHASE_TIMEOUT_SANDBOX_MS: z.coerce.number().int().positive().default(300_000),
  PHASE_TIMEOUT_PRCREATION_MS: z.coerce.number().int().positive().default(30_000),

  // OpenAI / triage
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_CHEAP_MODEL: z.string().default('gpt-4o-mini'),

  // Sandbox
  E2B_API_KEY: z.string().optional(),
  E2B_TEMPLATE_ID: z.string().default('stas-default'),
  E2B_SANDBOX_TIMEOUT_MS: z.coerce.number().int().positive().default(300_000),

  // STAS
 
  // Pricing
  STAS_DEFAULT_TIER: z.enum(["free", "pro", "enterprise"]).default("free"),
  STAS_MONTHLY_QUOTA_ENABLED: z.coerce.boolean().default(true),
  STAS_LABEL: z.string().default('stas:fix'),
  BOT_NAME: z.string().default('STAS'),
  DEV_SKIP_WEBHOOK_SIGNATURE_VERIFY: z.coerce.boolean().default(false),
  MAX_AGENT_ITERATIONS: z.coerce.number().int().positive().default(40),
  MAX_ISSUE_COMMENTS: z.coerce.number().int().positive().default(15),
  STAS_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  STAS_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),

  // GitLab
  GITLAB_URL: z.string().default('https://gitlab.com'),
  GITLAB_TOKEN: z.string().optional(),
  GITLAB_WEBHOOK_SECRET: z.string().optional(),

  // Bitbucket
  BITBUCKET_USERNAME: z.string().optional(),
  BITBUCKET_APP_PASSWORD: z.string().optional(),
  BITBUCKET_WEBHOOK_SECRET: z.string().optional(),

  // Slack notifications
  SLACK_WEBHOOK_URL: z.string().optional(),
  SLACK_CHANNEL: z.string().optional(),
  SLACK_BOT_TOKEN: z.string().optional(),
  SLACK_SIGNING_SECRET: z.string().optional(),
  SLACK_INTERACTIONS_PATH: z.string().default('/slack/events'),

  // Trackers -- Linear
  LINEAR_API_KEY: z.string().optional(),
  LINEAR_WEBHOOK_SECRET: z.string().optional(),

  // Trackers -- Jira
  JIRA_URL: z.string().optional(),
  JIRA_EMAIL: z.string().optional(),
  JIRA_API_TOKEN: z.string().optional(),
  JIRA_WEBHOOK_SECRET: z.string().optional(),
  JIRA_PROJECT_KEY: z.string().optional(),

  // Tracker-to-GitHub repo mapping (comma-separated: "linear=<owner/repo>,jira=<owner/repo>")
  TRACKER_DEFAULT_REPO_OWNER: z.string().optional(),
  TRACKER_DEFAULT_REPO_NAME: z.string().optional(),
  TRACKER_INSTALLATION_ID: z.coerce.number().int().positive().optional(),

  // Stripe
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_100_CREDITS: z.string().default('price_100credits'),
  STRIPE_PRICE_500_CREDITS: z.string().default('price_500credits'),
  STRIPE_PRICE_2000_CREDITS: z.string().default('price_2000credits'),

  // Usage metering
  USAGE_CREDITS_FIX_RUN: z.coerce.number().int().positive().default(50),
  USAGE_CREDITS_TRIAGE: z.coerce.number().int().positive().default(10),
  USAGE_CREDITS_SANDBOX: z.coerce.number().int().positive().default(5),

  // Feature flags

  // Database
  DATABASE_URL: z.string().default('postgres://localhost:5432/stas'),
  DATABASE_POOL_MIN: z.coerce.number().int().min(1).positive().default(2),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).positive().default(10),
  DATABASE_SSL: z.coerce.boolean().default(false),

  // Rate limiting (credit-based)
  STAS_RATE_LIMIT_DEFAULT_TIER: z.enum(['free', 'pro', 'enterprise']).default('free'),
  STAS_RATE_LIMIT_IP_MAX: z.coerce.number().int().positive().default(30),
  STAS_CONCURRENCY_OVERRIDES: z.string().default(''),

  // Logging
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Sentry
  SENTRY_DSN: z.string().optional(),
  SENTRY_ENVIRONMENT: z.string().optional(),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),

  // Feature Flags
  FEATURE_FLAGS_DEFAULT_TTL_SECONDS: z.coerce.number().int().positive().default(30),
  FEATURE_FLAGS_AUTO_DISABLE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.05),

  // Metering / Usage Tracking
  METERING_COST_TRIAGE: z.coerce.number().int().positive().default(1),
  METERING_COST_OPENCODE_PRIMARY: z.coerce.number().int().positive().default(10),
  METERING_COST_OPENCODE_FALLBACK: z.coerce.number().int().positive().default(5),
  METERING_COST_PR_CREATION: z.coerce.number().int().positive().default(2),
  METERING_COST_RETRY_PENALTY: z.coerce.number().int().positive().default(3),
  METERING_BASELINE_SANDBOX_MS: z.coerce.number().int().positive().default(300000),
  METERING_FREE_MONTHLY_CREDITS: z.coerce.number().int().default(100),
  METERING_SANDBOX_MULTIPLIER_MIN: z.coerce.number().min(0.1).max(1.0).default(0.5),
  METERING_SANDBOX_MULTIPLIER_MAX: z.coerce.number().min(1.0).max(5.0).default(2.0),
});

type ParsedEnv = z.infer<typeof envSchema>;

// ---------------------------------------------------------------------------
// Build config tree
// ---------------------------------------------------------------------------


function parseConcurrencyOverrides(raw: string): Record<string, number> {
  if (!raw) return {};
  const result: Record<string, number> = {};
  for (const part of raw.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = Number(trimmed.slice(eqIdx + 1).trim());
    if (!Number.isNaN(val) && Number.isInteger(val) && val > 0) {
      result[key] = val;
    }
  }
  return result;
}

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
      maxRetries: env.QUEUE_MAX_RETRIES,
      retryDelays: env.QUEUE_RETRY_DELAYS.split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => !Number.isNaN(n)),
      backend: env.QUEUE_BACKEND,
    },

    rabbitmq: {
      url: env.RABBITMQ_URL,
      prefetchCount: env.RABBITMQ_PREFETCH_COUNT,
      reconnectDelayMs: env.RABBITMQ_RECONNECT_DELAY_MS,
      maxReconnectAttempts: env.RABBITMQ_MAX_RECONNECT_ATTEMPTS,
    },

    bridge: {
      rpcTimeoutMs: env.BRIDGE_RPC_TIMEOUT,
      maxRetries: env.BRIDGE_MAX_RETRIES,
      circuitBreakerThreshold: env.BRIDGE_CIRCUIT_BREAKER_THRESHOLD,
      fallbackBackend: env.QUEUE_FALLBACK_BACKEND,
    },

    opencode: {
      url: env.OPENCODE_URL,
      model: env.OPENCODE_MODEL,
      fallbackModels: env.FALLBACK_MODELS.split(",").map((s) => s.trim()).filter(Boolean),
    },

    gitlab: {
      url: env.GITLAB_URL,
      token: env.GITLAB_TOKEN ?? '',
      webhookSecret: env.GITLAB_WEBHOOK_SECRET ?? '',
    },

    bitbucket: {
      username: env.BITBUCKET_USERNAME ?? '',
      appPassword: env.BITBUCKET_APP_PASSWORD ?? '',
      webhookSecret: env.BITBUCKET_WEBHOOK_SECRET ?? '',
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

    slack: {
      webhookUrl: env.SLACK_WEBHOOK_URL,
      channel: env.SLACK_CHANNEL,
      botToken: env.SLACK_BOT_TOKEN,
      signingSecret: env.SLACK_SIGNING_SECRET,
      interactionsPath: env.SLACK_INTERACTIONS_PATH,
    },

    stas: {
      label: env.STAS_LABEL,
      botName: env.BOT_NAME,
      devSkipWebhookVerify: env.DEV_SKIP_WEBHOOK_SIGNATURE_VERIFY,
      maxAgentIterations: env.MAX_AGENT_ITERATIONS,
      maxIssueComments: env.MAX_ISSUE_COMMENTS,
      rateLimitWindowMs: env.STAS_RATE_LIMIT_WINDOW_MS,
      rateLimitMax: env.STAS_RATE_LIMIT_MAX,
      defaultTier: env.STAS_DEFAULT_TIER,
      monthlyQuotaEnabled: env.STAS_MONTHLY_QUOTA_ENABLED,
    },

    rateLimit: {
      defaultTier: env.STAS_RATE_LIMIT_DEFAULT_TIER,
      ipMaxPerMinute: env.STAS_RATE_LIMIT_IP_MAX,
      adminOverrides: parseConcurrencyOverrides(env.STAS_CONCURRENCY_OVERRIDES),
    },

    usage: {
      creditsFixRun: env.USAGE_CREDITS_FIX_RUN,
      creditsTriage: env.USAGE_CREDITS_TRIAGE,
      creditsSandbox: env.USAGE_CREDITS_SANDBOX,
    },

    stripe: {
      secretKey: env.STRIPE_SECRET_KEY,
      webhookSecret: env.STRIPE_WEBHOOK_SECRET,
      price100Credits: env.STRIPE_PRICE_100_CREDITS,
      price500Credits: env.STRIPE_PRICE_500_CREDITS,
      price2000Credits: env.STRIPE_PRICE_2000_CREDITS,
    },

    database: {
      url: env.DATABASE_URL,
      poolMin: env.DATABASE_POOL_MIN,
      poolMax: env.DATABASE_POOL_MAX,
      ssl: env.DATABASE_SSL,
    },

    fixTimeoutMs: env.FIX_TIMEOUT_MS,

    phaseTimeouts: {
      triage: env.PHASE_TIMEOUT_TRIAGE_MS,
      sandboxBoot: env.PHASE_TIMEOUT_SANDBOX_MS,
      openCodeAgent: env.FIX_TIMEOUT_MS,
      prCreation: env.PHASE_TIMEOUT_PRCREATION_MS,
    },

    sentry: {
      dsn: env.SENTRY_DSN,
      environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
      tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
    },

    featureFlags: {
      defaultTtlSeconds: env.FEATURE_FLAGS_DEFAULT_TTL_SECONDS,
      autoDisableThreshold: env.FEATURE_FLAGS_AUTO_DISABLE_THRESHOLD,
    },

    trackers: {
      linear: env.LINEAR_API_KEY
        ? {
            apiKey: env.LINEAR_API_KEY,
            webhookSecret: env.LINEAR_WEBHOOK_SECRET,
          }
        : undefined,
      jira:
        env.JIRA_URL && env.JIRA_EMAIL && env.JIRA_API_TOKEN
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

    metering: {
      costTriage: env.METERING_COST_TRIAGE,
      costOpencodePrimary: env.METERING_COST_OPENCODE_PRIMARY,
      costOpencodeFallback: env.METERING_COST_OPENCODE_FALLBACK,
      costPrCreation: env.METERING_COST_PR_CREATION,
      costRetryPenalty: env.METERING_COST_RETRY_PENALTY,
      baselineSandboxMs: env.METERING_BASELINE_SANDBOX_MS,
      freeMonthlyCredits: env.METERING_FREE_MONTHLY_CREDITS,
      sandboxMultiplierMin: env.METERING_SANDBOX_MULTIPLIER_MIN,
      sandboxMultiplierMax: env.METERING_SANDBOX_MULTIPLIER_MAX,
    },

    usageCredits: {
      fixRun: env.USAGE_CREDITS_FIX_RUN,
      triage: env.USAGE_CREDITS_TRIAGE,
      sandbox: env.USAGE_CREDITS_SANDBOX,
    },
  } as const;
}

// ---------------------------------------------------------------------------
// Parse eagerly at module load
// ---------------------------------------------------------------------------

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const { fieldErrors, formErrors } = parsed.error.flatten();

  rootLogger.error('Invalid environment configuration:');

  if (formErrors.length > 0) {
    rootLogger.error({ errors: formErrors }, 'Form-level errors');
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
    const lines: string[] = ['Invalid environment configuration:'];
    for (const [key, msgs] of Object.entries(fieldErrors)) {
      if (msgs && msgs.length > 0) {
        lines.push(`  - ${key}: ${msgs.join('; ')}`);
      }
    }
    throw new Error(lines.join('\n'));
  }
  return buildConfig(result.data);
}

export type Config = typeof config;
