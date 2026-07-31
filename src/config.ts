import 'dotenv/config';
import { z } from 'zod';
import { rootLogger } from './utils/logger.js';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/**
 * Safe boolean coercion that properly handles string "false" and "0".
 * Zod's z.coerce.boolean() treats any non-empty string as true,
 * which breaks env vars like CI_MONITOR_ENABLED=false.
 */
const boolSchema = (defaultVal: boolean) =>
  z.preprocess((val) => {
    if (val === 'true' || val === '1') return true;
    if (val === 'false' || val === '0') return false;
    return val;
  }, z.boolean().default(defaultVal));
const envSchema = z.object({
  PORT: z.coerce.number().int().positive().max(65535).default(3000),
  RUN_MODE: z.enum(['api', 'worker', 'both']).default('both'),

  GITHUB_APP_ID: z.string().min(1, 'GITHUB_APP_ID is required'),
  GITHUB_APP_PRIVATE_KEY: z
    .string()
    .min(1, 'GITHUB_APP_PRIVATE_KEY or GITHUB_APP_PRIVATE_KEY_PATH is required')
    .optional(),
  GITHUB_APP_PRIVATE_KEY_PATH: z.string().optional(),
  GITHUB_TOKEN: z.string().optional(),
  GITHUB_OAUTH_CLIENT_ID: z.string().optional(),
  GITHUB_OAUTH_CLIENT_SECRET: z.string().optional(),
  DEV_GITHUB_TOKEN: z.string().optional(),
  GITHUB_WEBHOOK_SECRET: z.string().min(1, 'GITHUB_WEBHOOK_SECRET is required'),
  GITHUB_WEBHOOK_PATH: z.string().default('/webhook'),
  PR_QUALITY_GATE_ENABLED: boolSchema(true),
  PR_AUTO_REQUEST_REVIEW: boolSchema(true),
  PR_MERGE_QUEUE_ENABLED: boolSchema(false),
  PR_REVIEWERS_COUNT: z.coerce.number().int().min(0).max(10).default(2),

  REDIS_URL: z.string().default('redis://localhost:6379'),
  RABBITMQ_URL: z.string().default('amqp://guest:guest@localhost:5672/stas'),
  QUEUE_BACKEND: z.enum(['amqp']).default('amqp'),

  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(2),
  QUEUE_DEDUP_TTL_SECONDS: z.coerce.number().int().positive().default(120),
  QUEUE_MSG_TTL_MS: z.coerce.number().int().positive().default(30_000),
  QUEUE_KEEP_COMPLETED: z.coerce.number().int().positive().default(200),
  QUEUE_KEEP_FAILED: z.coerce.number().int().positive().default(100),
  QUEUE_MAX_RETRIES: z.coerce.number().int().positive().max(10).default(4),
  QUEUE_RETRY_DELAYS: z.string().default('30000,120000,300000,900000'),

  OPENCODE_URL: z.string().default('http://localhost:4096'),
  OPENCODE_MODEL: z.string().default('anthropic/claude-sonnet-4-20250514'),
  OPENAI_BASE_URL: z.string().default('http://litellm-proxy:4002/v1'),
  FALLBACK_MODELS: z.string().default('gpt-4o,claude-haiku'),

  FREE_TIER_MODEL: z.string().default('free-tier'),
  FREE_TIER_BASE_URL: z.string().default('http://localhost:4002'),
  PAID_TIER_MODEL: z.string().default('deepseek-v4-flash'),
  PAID_TIER_BASE_URL: z.string().default('http://localhost:4002'),

  FIX_TIMEOUT_MS: z.coerce.number().int().positive().default(600_000),
  PHASE_TIMEOUT_TRIAGE_MS: z.coerce.number().int().positive().default(30_000),
  PHASE_TIMEOUT_SANDBOX_MS: z.coerce.number().int().positive().default(600_000),
  PHASE_TIMEOUT_PRCREATION_MS: z.coerce.number().int().positive().default(30_000),

  OPENAI_API_KEY: z.string().optional(),
  OPENAI_CHEAP_MODEL: z.string().default('gpt-4o-mini'),

  E2B_API_KEY: z.string().optional(),
  E2B_TEMPLATE_ID: z.string().default('default'),
  E2B_SANDBOX_TIMEOUT_MS: z.coerce.number().int().positive().default(300_000),

  STAS_DEFAULT_TIER: z.enum(['free', 'pro', 'enterprise']).default('free'),
  STAS_MONTHLY_QUOTA_ENABLED: boolSchema(true),
  STAS_POWERED_BY_FOOTER: boolSchema(true),
  STAS_WORKER_CONCURRENCY: z.coerce.number().int().positive().default(4),
  STAS_MODE: z.enum(['oss', 'hosted']).default('oss'),
  STAS_AI_MODE: z.enum(['ai', 'static']).default('ai'),
  STAS_AI_DISABLED: boolSchema(false),
  STAS_LABEL: z.string().default('stas:fix'),
  BOT_NAME: z.string().default('STAS'),
  DEV_SKIP_WEBHOOK_SIGNATURE_VERIFY: boolSchema(false),
  MAX_AGENT_ITERATIONS: z.coerce.number().int().positive().default(40),
  MAX_ISSUE_COMMENTS: z.coerce.number().int().positive().default(15),
  // Rate limiting — calibrated for 500-user scale
  STAS_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  STAS_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(150),
  STAS_RATE_LIMIT_PER_REPO_MAX: z.coerce.number().int().positive().default(20),
  STAS_RATE_LIMIT_PER_IP_MAX: z.coerce.number().int().positive().default(60),
  STAS_RATE_LIMIT_PER_USER_MAX: z.coerce.number().int().positive().default(100),

  // Queue depth limits
  QUEUE_MAX_PENDING_PER_REPO: z.coerce.number().int().positive().default(10),
  QUEUE_DLQ_MAX_SIZE: z.coerce.number().int().positive().default(50),
  QUEUE_DLQ_NOTIFY_AT: z.coerce.number().int().positive().default(25),

  // PostgreSQL connection pool — tuned for 500-user load
  POSTGRES_POOL_MAX: z.coerce.number().int().positive().default(25),
  POSTGRES_POOL_MIN: z.coerce.number().int().positive().default(5),

  // Redis TTL — optimized for hot data at 500-user scale
  REDIS_TTL_DEFAULT: z.coerce.number().int().positive().default(300),
  REDIS_TTL_FREQUENT_ACCESS: z.coerce.number().int().positive().default(60),
  ADMIN_API_KEY: z.string().optional(),

  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET must be at least 32 characters')
    .default('change-me-to-a-random-secret-at-least-32-chars'),
  JWT_EXPIRES_IN: z.string().default('24h'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),

  AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  AUTH_LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(5),
  AUTH_REGISTER_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(3),
  AUTH_REFRESH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),

  // Proxy
  PROXY_MODEL_ROUTER_ENABLED: boolSchema(true),
  PROXY_GITHUB_ACTIONS_DISPATCH_ENABLED: boolSchema(false),
  PROXY_GITHUB_PAT: z.string().optional(),
  PROXY_HAS_PAT: boolSchema(false),
  PROXY_PAT: z.string().default(''),
  PROXY_DISPATCH_URL: z.string().default(''),
  PROXY_API_KEY: z.string().default(''),
  PROXY_ALLOWED_ORGS: z.string().default(''),

  WEBHOOK_RETRY_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(15000),
  WEBHOOK_RETRY_BATCH_SIZE: z.coerce.number().int().positive().default(10),

  GITLAB_URL: z.string().default('https://gitlab.com'),
  GITLAB_TOKEN: z.string().optional(),
  GITLAB_WEBHOOK_SECRET: z.string().optional(),

  BITBUCKET_USERNAME: z.string().optional(),
  BITBUCKET_APP_PASSWORD: z.string().optional(),
  BITBUCKET_WEBHOOK_SECRET: z.string().optional(),
  BITBUCKET_BASE_URL: z.string().default('https://api.bitbucket.org'),

  SLACK_WEBHOOK_URL: z.string().optional(),
  SLACK_CHANNEL: z.string().optional(),
  SLACK_BOT_TOKEN: z.string().optional(),
  SLACK_SIGNING_SECRET: z.string().optional(),
  SLACK_APP_TOKEN: z.string().optional(),
  SLACK_TICKET_ENABLED: boolSchema(false),
  SLACK_CHAT_ENABLED: boolSchema(false),
  SLACK_INTERACTIONS_PATH: z.string().default('/slack/events'),

  LINEAR_API_KEY: z.string().optional(),
  LINEAR_WEBHOOK_SECRET: z.string().optional(),

  JIRA_URL: z.string().optional(),
  JIRA_EMAIL: z.string().optional(),
  JIRA_API_TOKEN: z.string().optional(),
  JIRA_WEBHOOK_SECRET: z.string().optional(),
  JIRA_PROJECT_KEY: z.string().optional(),

  TRACKER_DEFAULT_REPO_OWNER: z.string().optional(),
  TRACKER_DEFAULT_REPO_NAME: z.string().optional(),
  TRACKER_INSTALLATION_ID: z.coerce.number().int().positive().optional(),

  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_100_CREDITS: z.string().default('price_100credits'),
  STRIPE_PRICE_500_CREDITS: z.string().default('price_500credits'),
  STRIPE_PRICE_2000_CREDITS: z.string().default('price_2000credits'),

  POSTHOG_API_KEY: z.string().optional(),
  POSTHOG_HOST: z.string().default('https://us.i.posthog.com'),

  DPA_VERSION: z.string().default('2026-06-01'),
  DPA_REQUIRE_ACCEPTANCE: z
    .preprocess((v) => {
      if (typeof v === 'string') return v === 'true' || v === '1';
      return v;
    }, z.boolean())
    .default(true),
  DATA_RETENTION_DAYS: z.coerce.number().int().positive().default(30),

  USAGE_CREDITS_FIX_RUN: z.coerce.number().int().positive().default(50),
  USAGE_CREDITS_TRIAGE: z.coerce.number().int().positive().default(10),
  USAGE_CREDITS_SANDBOX: z.coerce.number().int().positive().default(5),

  FEATURE_FLAGS_DEFAULT_TTL_SECONDS: z.coerce.number().int().positive().default(30),
  FEATURE_FLAGS_AUTO_DISABLE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.05),

  // Monitoring Loop (Phase 2)
  MONITORING_LOOP_ENABLED: boolSchema(false),
  MONITORING_LOOP_INTERVAL_MS: z.coerce.number().int().positive().default(10000),
  MONITORING_LOOP_TEAM_ID: z.string().default(''),
  MONITORING_LOOP_PROJECT_ID: z.string().optional(),
  MONITORING_LOOP_DEFAULT_ACCOUNT_ID: z.coerce.number().int().positive().optional(),

  // CI monitoring
  CI_MONITOR_ENABLED: boolSchema(false),
  CI_REPOS: z.string().default(''),
  CI_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(60000),
  CI_FAILURE_THRESHOLD: z.coerce.number().int().positive().default(3),

  // OpenCode Health
  OPENCODE_HEALTH_CIRCUIT_BREAKER_THRESHOLD: z.coerce.number().int().positive().default(3),
  OPENCODE_HEALTH_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(30000),
  OPENCODE_HEALTH_CACHE_TTL_MS: z.coerce.number().int().positive().default(30000),
  OPENCODE_HEALTH_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
  OPENCODE_HEALTH_STARTUP_TIMEOUT_MS: z.coerce.number().int().positive().default(120000),

  // RapidAPI
  RAPIDAPI_PROXY_SECRET: z.string().optional(),

  // Stripe pricing plans
  STRIPE_SOLO_PRICE_ID: z.string().default('price_solo'),
  STRIPE_TEAM_PRICE_ID: z.string().default('price_team'),

  // Security CSP
  CSP_REPORT_URI: z.string().optional(),

  // Docker
  DOCKER_IMAGE: z.string().default('node:20-slim'),
  DOCKER_CONTAINER_MEMORY: z.string().default('512m'),
  DOCKER_CONTAINER_CPU: z.coerce.number().min(0.1).default(0.5),
  DOCKER_NETWORK_RESTRICT: boolSchema(true),
  DOCKER_ALLOWED_HOSTS: z.string().default(''),
  DOCKER_SECCOMP_PROFILE: z.string().optional(),
  DOCKER_APPARMOR_PROFILE: z.string().optional(),
  DOCKER_GVISOR_ENABLED: boolSchema(false),

  // Database
  SUPABASE_URL: z.string().default(''),
  SUPABASE_ANON_KEY: z.string().default(''),
  SUPABASE_SERVICE_ROLE_KEY: z.string().default(''),
  SUPABASE_JWT_SECRET: z.string().default(''),

  DATABASE_URL: z.preprocess(
    (v) =>
      typeof v === 'string' && v.trim() !== ''
        ? v
        : process.env.SUPABASE_DATABASE_URL || 'postgres://localhost:5432/stas',
    z.string(),
  ),
  DATABASE_POOL_MIN: z.coerce.number().int().min(1).positive().default(2),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).positive().default(10),
  DATABASE_SSL: z
    .preprocess((v) => {
      if (typeof v === 'string') return v === 'true' || v === '1';
      return v;
    }, z.boolean())
    .default(false),
  DATABASE_ENABLE_AUDIT_PERSISTENCE: z
    .preprocess((v) => {
      if (typeof v === 'string') return v === 'true' || v === '1';
      return v;
    }, z.boolean())
    .default(false),

  STAS_RATE_LIMIT_DEFAULT_TIER: z.enum(['free', 'pro', 'enterprise']).default('free'),
  STAS_RATE_LIMIT_IP_MAX: z.coerce.number().int().positive().default(30),
  STAS_CONCURRENCY_OVERRIDES: z.string().default(''),

  // MCP Server Configuration
  MCP_API_KEY: z.string().optional(),
  MCP_AUTH_ENABLED: z
    .preprocess((v) => {
      if (typeof v === 'string') return v === 'true' || v === '1';
      return v;
    }, z.boolean())
    .default(true),
  STAS_MCP_SERVER_URL: z.string().default('http://localhost:4095'),
  STAS_MCP_PORT: z.coerce.number().int().positive().max(65535).default(4095),
  STAS_MCP_AUTO_START: boolSchema(true),
  STAS_MCP_SSL_ENABLED: boolSchema(false),
  STAS_MCP_SSL_KEY_PATH: z.string().optional(),
  STAS_MCP_SSL_CERT_PATH: z.string().optional(),

  // OpenSymphony adapter configuration
  OPENSYMPHONY_ENABLED: boolSchema(false),
  OPENSYMPHONY_PORT: z.coerce.number().int().positive().max(65535).default(4097),
  OPENSYMPHONY_HOST: z.string().default('127.0.0.1'),
  MCP_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  MCP_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),

  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_WEBHOOK_PATH: z.string().default('/webhook/telegram'),

  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_WEBHOOK_PATH: z.string().default('/webhook/whatsapp'),
  WHATSAPP_VERIFY_TOKEN: z.string().optional(),

  // Logging
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  STAS_LOG_FILE: z.string().optional(),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  ADMIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  CORS_ORIGIN: z.string().default('*'),
  REQUEST_BODY_LIMIT: z.string().default('1mb'),
  WEBHOOK_BODY_LIMIT: z.string().default('5mb'),

  // ── IP Allowlist ──
  IP_ALLOWLIST_ENABLED: boolSchema(false),
  IP_ALLOWLIST: z.string().default(''),

  // ── Sandbox Security ──
  SANDBOX_PRIVILEGED: boolSchema(false),
  SANDBOX_READONLY_ROOT: boolSchema(true),
  SANDBOX_MEMORY_LIMIT: z.string().default('512m'),
  SANDBOX_CPU_LIMIT: z.string().default('0.5'),
  SANDBOX_PIDS_LIMIT: z.coerce.number().int().positive().default(256),
  SANDBOX_DISK_LIMIT: z.string().default('2gb'),
  SANDBOX_NETWORK_ENABLED: boolSchema(false),

  SENTRY_DSN: z.string().optional(),
  SENTRY_ENVIRONMENT: z.string().default('development'),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),

  HEALTH_QUEUE_DEPTH_WARN_THRESHOLD: z.coerce.number().int().positive().default(50),
  HEALTH_QUEUE_DEPTH_CRIT_THRESHOLD: z.coerce.number().int().positive().default(200),
  HEALTH_QUEUE_DEPTH_ALERT_MINUTES: z.coerce.number().int().positive().default(5),
  DLQ_RETENTION_DAYS: z.coerce.number().int().positive().default(7),

  ALERT_SLACK_CHANNEL: z.string().default('#stas-alerts'),
  ALERT_WARN_QUEUE_DEPTH: z.coerce.number().int().positive().default(50),
  ALERT_CRIT_QUEUE_DEPTH: z.coerce.number().int().positive().default(200),
  ALERT_WARN_ERROR_RATE_PERCENT: z.coerce.number().min(0).max(100).default(10),
  ALERT_CRIT_ERROR_RATE_PERCENT: z.coerce.number().min(0).max(100).default(30),

  METERING_COST_TRIAGE: z.coerce.number().int().positive().default(1),
  METERING_COST_OPENCODE_PRIMARY: z.coerce.number().int().positive().default(10),
  METERING_COST_OPENCODE_FALLBACK: z.coerce.number().int().positive().default(5),
  METERING_COST_PR_CREATION: z.coerce.number().int().positive().default(2),
  METERING_COST_RETRY_PENALTY: z.coerce.number().int().positive().default(3),
  METERING_BASELINE_SANDBOX_MS: z.coerce.number().int().positive().default(300000),
  METERING_FREE_MONTHLY_CREDITS: z.coerce.number().int().default(100),
  METERING_SANDBOX_MULTIPLIER_MIN: z.coerce.number().min(0.1).max(1.0).default(0.5),
  METERING_SANDBOX_MULTIPLIER_MAX: z.coerce.number().min(1.0).max(5.0).default(2.0),

  // OSY Dispatch
  OSY_DISPATCH_URL: z.string().default(''),
  OSY_API_KEY: z.string().default(''),
  OSY_TENANT: z.string().default('default'),

  // LiteLLM
  LITELLM_API_KEY: z.string().default(''),
  LITELLM_BASE_URL: z.string().default('http://localhost:4000'),
  LITELLM_MODEL: z.string().default('gpt-4o'),

  // Onboarding
  ONBOARDING_ENABLED: boolSchema(false),
  ONBOARDING_N8N_WEBHOOK_URL: z.string().optional(),

  // Teams
  TEAMS_ENABLED: boolSchema(false),
  TEAMS_MAX_MEMBERS: z.coerce.number().int().positive().default(10),

  // OpenSymphony additions
  OPENSYMPHONY_CELERY_PIPELINE_URL: z.string().default(''),
  OPENSYMPHONY_CELERY_PIPELINE_API_KEY: z.string().default(''),
  OPENSYMPHONY_CELERY_PIPELINE_ENABLED: boolSchema(false),
  OPENSYMPHONY_DISPATCH_URL: z.string().default(''),
  OPENSYMPHONY_API_KEY: z.string().default(''),
  OPENSYMPHONY_TENANT: z.string().default('default'),

  // Loops
  LOOPS_API_KEY: z.string().optional(),

  // Alerting additions
  ALERT_N8N_WEBHOOK_URL: z.string().optional(),
});

type ParsedEnv = z.infer<typeof envSchema>;

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
    logFile: env.STAS_LOG_FILE ?? '',
    logLevel: env.LOG_LEVEL,
    nodeEnv: env.NODE_ENV,
    github: {
      appId: env.GITHUB_APP_ID,
      privateKeyPath: env.GITHUB_APP_PRIVATE_KEY_PATH,
      privateKeyEnv: env.GITHUB_APP_PRIVATE_KEY,
      token: env.GITHUB_TOKEN,
      webhookSecret: env.GITHUB_WEBHOOK_SECRET,
      webhookPath: env.GITHUB_WEBHOOK_PATH,
      oauthClientId: env.GITHUB_OAUTH_CLIENT_ID ?? '',
      oauthClientSecret: env.GITHUB_OAUTH_CLIENT_SECRET ?? '',
      devToken: env.DEV_GITHUB_TOKEN ?? '',
      prQualityGate: env.PR_QUALITY_GATE_ENABLED,
      autoRequestReview: env.PR_AUTO_REQUEST_REVIEW,
      mergeQueueEnabled: env.PR_MERGE_QUEUE_ENABLED,
      reviewersCount: env.PR_REVIEWERS_COUNT,
    },

    queue: {
      redisUrl: env.REDIS_URL,
      rabbitmqUrl: env.RABBITMQ_URL,
      backend: env.QUEUE_BACKEND,
      workerConcurrency: env.WORKER_CONCURRENCY,
      dedupTtl: env.QUEUE_DEDUP_TTL_SECONDS,
      msgTtlMs: env.QUEUE_MSG_TTL_MS,
      keepCompleted: env.QUEUE_KEEP_COMPLETED,
      keepFailed: env.QUEUE_KEEP_FAILED,
      maxRetries: env.QUEUE_MAX_RETRIES,
      retryDelays: env.QUEUE_RETRY_DELAYS.split(',')
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => !Number.isNaN(n)),
    },

    opencode: {
      url: env.OPENCODE_URL,
      model: env.OPENCODE_MODEL,
      fallbackModels: env.FALLBACK_MODELS.split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      modelTier: {
        freeModel: env.FREE_TIER_MODEL,
        freeBaseUrl: env.FREE_TIER_BASE_URL,
        paidModel: env.PAID_TIER_MODEL,
        paidBaseUrl: env.PAID_TIER_BASE_URL,
      },
      direct: {
        apiKey: env.OPENAI_API_KEY ?? '',
      },
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
      baseUrl: env.BITBUCKET_BASE_URL,
    },

    ci: {
      monitorEnabled: env.CI_MONITOR_ENABLED,
      repos: env.CI_REPOS.split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      pollIntervalMs: env.CI_POLL_INTERVAL_MS,
      failureThreshold: env.CI_FAILURE_THRESHOLD,
    },

    opencodeHealth: {
      circuitBreakerThreshold: env.OPENCODE_HEALTH_CIRCUIT_BREAKER_THRESHOLD,
      pollIntervalMs: env.OPENCODE_HEALTH_POLL_INTERVAL_MS,
      cacheTtlMs: env.OPENCODE_HEALTH_CACHE_TTL_MS,
      requestTimeoutMs: env.OPENCODE_HEALTH_REQUEST_TIMEOUT_MS,
      startupTimeoutMs: env.OPENCODE_HEALTH_STARTUP_TIMEOUT_MS,
    },

    rapidapi: {
      proxySecret: env.RAPIDAPI_PROXY_SECRET,
    },

    docker: {
      image: env.DOCKER_IMAGE,
      containerMemory: env.DOCKER_CONTAINER_MEMORY,
      containerCpu: env.DOCKER_CONTAINER_CPU,
      networkRestrict: env.DOCKER_NETWORK_RESTRICT,
      allowedHosts: env.DOCKER_ALLOWED_HOSTS.split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      seccompProfile: env.DOCKER_SECCOMP_PROFILE ?? '',
      apparmorProfile: env.DOCKER_APPARMOR_PROFILE ?? '',
      gvisorEnabled: env.DOCKER_GVISOR_ENABLED,
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
      appToken: env.SLACK_APP_TOKEN,
      ticketEnabled: env.SLACK_TICKET_ENABLED,
      chatEnabled: env.SLACK_CHAT_ENABLED,
      interactionsPath: env.SLACK_INTERACTIONS_PATH,
    },

    mcp: {
      apiKey: env.MCP_API_KEY ?? '',
      authEnabled: env.MCP_AUTH_ENABLED,
      serverUrl: env.STAS_MCP_SERVER_URL,
      port: env.STAS_MCP_PORT,
      autoStart: env.STAS_MCP_AUTO_START,
      ssl: {
        enabled: env.STAS_MCP_SSL_ENABLED,
        keyPath: env.STAS_MCP_SSL_KEY_PATH ?? '',
        certPath: env.STAS_MCP_SSL_CERT_PATH ?? '',
      },
      rateLimit: {
        windowMs: env.MCP_RATE_LIMIT_WINDOW_MS,
        maxRequests: env.MCP_RATE_LIMIT_MAX,
      },
    },

    telegram: {
      botToken: env.TELEGRAM_BOT_TOKEN ?? '',
      webhookPath: env.TELEGRAM_WEBHOOK_PATH,
    },

    whatsapp: {
      phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID ?? '',
      accessToken: env.WHATSAPP_ACCESS_TOKEN ?? '',
      webhookPath: env.WHATSAPP_WEBHOOK_PATH,
      verifyToken: env.WHATSAPP_VERIFY_TOKEN ?? '',
    },

    admin: {
      apiKey: env.ADMIN_API_KEY ?? '',
      rateLimitMax: env.ADMIN_RATE_LIMIT_MAX,
    },

    sentry: {
      dsn: env.SENTRY_DSN,
      environment: env.SENTRY_ENVIRONMENT,
      tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
    },

    monitoring: {
      queueDepthWarnThreshold: env.HEALTH_QUEUE_DEPTH_WARN_THRESHOLD,
      queueDepthCritThreshold: env.HEALTH_QUEUE_DEPTH_CRIT_THRESHOLD,
      queueDepthAlertMinutes: env.HEALTH_QUEUE_DEPTH_ALERT_MINUTES,
      dlqRetentionDays: env.DLQ_RETENTION_DAYS,
    },

    monitoringLoop: {
      enabled: env.MONITORING_LOOP_ENABLED,
      intervalMs: env.MONITORING_LOOP_INTERVAL_MS,
      teamId: env.MONITORING_LOOP_TEAM_ID,
      projectId: env.MONITORING_LOOP_PROJECT_ID,
      defaultAccountId: env.MONITORING_LOOP_DEFAULT_ACCOUNT_ID,
    },

    alerting: {
      slackChannel: env.ALERT_SLACK_CHANNEL,
      warnQueueDepth: env.ALERT_WARN_QUEUE_DEPTH,
      critQueueDepth: env.ALERT_CRIT_QUEUE_DEPTH,
      warnErrorRatePercent: env.ALERT_WARN_ERROR_RATE_PERCENT,
      critErrorRatePercent: env.ALERT_CRIT_ERROR_RATE_PERCENT,
      n8nWebhookUrl: env.ALERT_N8N_WEBHOOK_URL ?? '',
    },

    stas: {
      mode: env.STAS_MODE,
      aiMode: env.STAS_AI_MODE,
      aiDisabled: env.STAS_AI_DISABLED,
      label: env.STAS_LABEL,
      botName: env.BOT_NAME,
      devSkipWebhookVerify: env.DEV_SKIP_WEBHOOK_SIGNATURE_VERIFY,
      maxAgentIterations: env.MAX_AGENT_ITERATIONS,
      maxIssueComments: env.MAX_ISSUE_COMMENTS,
      rateLimitWindowMs: env.STAS_RATE_LIMIT_WINDOW_MS,
      rateLimitMax: env.STAS_RATE_LIMIT_MAX,
      rateLimitPerRepoMax: env.STAS_RATE_LIMIT_PER_REPO_MAX,
      rateLimitPerIpMax: env.STAS_RATE_LIMIT_PER_IP_MAX,
      rateLimitPerUserMax: env.STAS_RATE_LIMIT_PER_USER_MAX,
      queueMaxPendingPerRepo: env.QUEUE_MAX_PENDING_PER_REPO,
      queueDlqMaxSize: env.QUEUE_DLQ_MAX_SIZE,
      queueDlqNotifyAt: env.QUEUE_DLQ_NOTIFY_AT,
      defaultTier: env.STAS_DEFAULT_TIER,
      monthlyQuotaEnabled: env.STAS_MONTHLY_QUOTA_ENABLED,
      poweredByFooterEnabled: env.STAS_POWERED_BY_FOOTER,
    },

    postgres: {
      poolMax: env.POSTGRES_POOL_MAX,
      poolMin: env.POSTGRES_POOL_MIN,
    },

    redis: {
      ttlDefault: env.REDIS_TTL_DEFAULT,
      ttlFrequentAccess: env.REDIS_TTL_FREQUENT_ACCESS,
    },

    webhookRetry: {
      pollIntervalMs: env.WEBHOOK_RETRY_POLL_INTERVAL_MS,
      batchSize: env.WEBHOOK_RETRY_BATCH_SIZE,
    },

    usage: {
      creditsFixRun: env.USAGE_CREDITS_FIX_RUN,
      creditsTriage: env.USAGE_CREDITS_TRIAGE,
      creditsSandbox: env.USAGE_CREDITS_SANDBOX,
    },

    rateLimit: {
      defaultTier: env.STAS_RATE_LIMIT_DEFAULT_TIER,
      ipMaxPerMinute: env.STAS_RATE_LIMIT_IP_MAX,
      adminOverrides: parseConcurrencyOverrides(env.STAS_CONCURRENCY_OVERRIDES),
    },

    stripe: {
      secretKey: env.STRIPE_SECRET_KEY,
      webhookSecret: env.STRIPE_WEBHOOK_SECRET,
      price100Credits: env.STRIPE_PRICE_100_CREDITS,
      price500Credits: env.STRIPE_PRICE_500_CREDITS,
      price2000Credits: env.STRIPE_PRICE_2000_CREDITS,
      soloPriceId: env.STRIPE_SOLO_PRICE_ID,
      teamPriceId: env.STRIPE_TEAM_PRICE_ID,
    },

    posthog: {
      apiKey: env.POSTHOG_API_KEY,
      host: env.POSTHOG_HOST,
    },

    dataPrivacy: {
      dpaVersion: env.DPA_VERSION,
      requireDpaAcceptance: env.DPA_REQUIRE_ACCEPTANCE,
      retentionDays: env.DATA_RETENTION_DAYS,
    },

    database: {
      url: env.DATABASE_URL,
      poolMin: env.DATABASE_POOL_MIN,
      poolMax: env.DATABASE_POOL_MAX,
      ssl: env.DATABASE_SSL,
      enableAuditPersistence: env.DATABASE_ENABLE_AUDIT_PERSISTENCE,
    },

    fixTimeoutMs: env.FIX_TIMEOUT_MS,

    phaseTimeouts: {
      triage: env.PHASE_TIMEOUT_TRIAGE_MS,
      sandboxBoot: env.PHASE_TIMEOUT_SANDBOX_MS,
      openCodeAgent: env.FIX_TIMEOUT_MS,
      prCreation: env.PHASE_TIMEOUT_PRCREATION_MS,
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

    // ── Supabase ───────────────────────────────────────────────────────────
    supabase: {
      url: env.SUPABASE_URL,
      anonKey: env.SUPABASE_ANON_KEY,
      serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
      jwtSecret: env.SUPABASE_JWT_SECRET,
    },

    // ── Auth (JWT) ──────────────────────────────────────────────────────────
    auth: {
      jwtSecret: env.JWT_SECRET,
      jwtExpiresIn: env.JWT_EXPIRES_IN,
      jwtRefreshExpiresIn: env.JWT_REFRESH_EXPIRES_IN,
      rateLimitWindowMs: env.AUTH_RATE_LIMIT_WINDOW_MS,
      loginRateLimitMax: env.AUTH_LOGIN_RATE_LIMIT_MAX,
      registerRateLimitMax: env.AUTH_REGISTER_RATE_LIMIT_MAX,
      refreshRateLimitMax: env.AUTH_REFRESH_RATE_LIMIT_MAX,
    },

    // ── Security ────────────────────────────────────────────────────────────
    security: {
      adminApiKey: env.ADMIN_API_KEY,
      corsOrigin: env.CORS_ORIGIN,
      requestBodyLimit: env.REQUEST_BODY_LIMIT,
      webhookBodyLimit: env.WEBHOOK_BODY_LIMIT,
      cspReportUri: env.CSP_REPORT_URI,

      ipAllowlist: {
        enabled: env.IP_ALLOWLIST_ENABLED,
        ips: env.IP_ALLOWLIST.split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      },
      sandbox: {
        privileged: env.SANDBOX_PRIVILEGED,
        readOnlyRoot: env.SANDBOX_READONLY_ROOT,
        memoryLimit: env.SANDBOX_MEMORY_LIMIT,
        cpuLimit: env.SANDBOX_CPU_LIMIT,
        pidsLimit: env.SANDBOX_PIDS_LIMIT,
        diskLimit: env.SANDBOX_DISK_LIMIT,
        networkEnabled: env.SANDBOX_NETWORK_ENABLED,
      },
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

    opensymphony: {
      enabled: env.OPENSYMPHONY_ENABLED,
      port: env.OPENSYMPHONY_PORT,
      host: env.OPENSYMPHONY_HOST,
      dispatchUrl: env.OPENSYMPHONY_DISPATCH_URL,
      apiKey: env.OPENSYMPHONY_API_KEY,
      tenant: env.OPENSYMPHONY_TENANT,
      celeryPipeline: {
        url: env.OPENSYMPHONY_CELERY_PIPELINE_URL,
        apiKey: env.OPENSYMPHONY_CELERY_PIPELINE_API_KEY,
        enabled: env.OPENSYMPHONY_CELERY_PIPELINE_ENABLED,
      },
    },

    osy: {
      dispatchUrl: env.OSY_DISPATCH_URL,
      apiKey: env.OSY_API_KEY,
      tenant: env.OSY_TENANT,
    },

    litellm: {
      apiKey: env.LITELLM_API_KEY,
      baseUrl: env.LITELLM_BASE_URL,
      model: env.LITELLM_MODEL,
    },

    proxy: {
      modelRouterEnabled: env.PROXY_MODEL_ROUTER_ENABLED,
      githubActionsDispatchEnabled: env.PROXY_GITHUB_ACTIONS_DISPATCH_ENABLED,
      hasPat: env.PROXY_HAS_PAT,
      pat: env.PROXY_PAT,
      dispatchUrl: env.PROXY_DISPATCH_URL,
      apiKey: env.PROXY_API_KEY,
      allowedOrgs: env.PROXY_ALLOWED_ORGS.split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    },

    onboarding: {
      enabled: env.ONBOARDING_ENABLED,
      n8nWebhookUrl: env.ONBOARDING_N8N_WEBHOOK_URL ?? '',
    },

    teams: {
      enabled: env.TEAMS_ENABLED,
      maxMembers: env.TEAMS_MAX_MEMBERS,
    },

    loops: {
      apiKey: env.LOOPS_API_KEY ?? '',
    },

    usageCredits: {
      fixRun: env.USAGE_CREDITS_FIX_RUN,
      triage: env.USAGE_CREDITS_TRIAGE,
      sandbox: env.USAGE_CREDITS_SANDBOX,
    },
  } as const;
}

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  const { fieldErrors, formErrors } = parsed.error.flatten();
  rootLogger.error('Invalid environment configuration:');
  if (formErrors.length > 0) rootLogger.error({ errors: formErrors }, 'Form-level errors');
  for (const [key, msgs] of Object.entries(fieldErrors)) {
    if (msgs && msgs.length > 0) {
      for (const msg of msgs) rootLogger.error({ key }, `${key}: ${msg}`);
    }
  }
  process.exit(1);
}

export const config = buildConfig(parsed.data);

export function requireConfig(): typeof config {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const { fieldErrors } = result.error.flatten();
    throw new Error(
      `Invalid environment configuration: ${Object.entries(fieldErrors)
        .map(([k, v]) => `${k}: ${v?.join('; ')}`)
        .join(', ')}`,
    );
  }
  return buildConfig(result.data);
}

export type Config = typeof config;
