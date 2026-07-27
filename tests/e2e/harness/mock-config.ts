/**
 * Shared mock config factory for E2E tests.
 *
 * Matches the shape of the real config from src/config.ts.
 * Used by test files that need to mock the config module
 * (because the real config module can't be loaded in tests
 * without all required env vars being set correctly).
 *
 * Usage:
 * ```ts
 * vi.mock('../../src/config.js', () => ({
 *   config: createMockConfig(),
 *   requireConfig: () => createMockConfig(),
 * }));
 * ```
 */

export function createMockConfig() {
  return {
    port: 0,
    runMode: 'api' as const,
    logLevel: 'silent',
    nodeEnv: 'test',
    github: {
      appId: '123',
      privateKeyPath: undefined as string | undefined,
      privateKeyEnv: 'mock-private-key',
      webhookSecret: 'test-webhook-secret',
      webhookPath: '/webhook',
    },
    queue: {
      redisUrl: 'redis://localhost:6379',
      rabbitmqUrl: 'amqp://guest:guest@localhost:5672/stas',
      workerConcurrency: 2,
      dedupTtl: 120,
      keepCompleted: 200,
      keepFailed: 100,
      maxRetries: 4,
      retryDelays: [30000, 120000, 300000, 900000] as number[],
      backend: 'rabbitmq' as const,
    },
    bridge: {
      rpcTimeoutMs: 30000,
      maxRetries: 3,
      circuitBreakerThreshold: 5,
      fallbackBackend: 'redis' as const,
    },
    opencode: {
      url: 'http://localhost:4096',
      model: 'anthropic/claude-sonnet-4-20250514',
      fallbackModels: ['gpt-4o', 'claude-haiku'],
    },
    opencodeHealth: {
      pollIntervalMs: 15000,
      cacheTtlMs: 30000,
      circuitBreakerThreshold: 3,
      requestTimeoutMs: 5000,
      startupTimeoutMs: 30000,
    },
    gitlab: {
      url: 'https://gitlab.com',
      token: 'mock-gitlab-token',
      webhookSecret: 'mock-gitlab-secret',
    },
    bitbucket: {
      username: 'mock-bitbucket-user',
      appPassword: 'mock-bitbucket-password',
      webhookSecret: 'mock-bitbucket-secret',
    },
    openai: { apiKey: 'mock-openai-key', cheapModel: 'gpt-4o-mini' },
    e2b: { apiKey: undefined as string | undefined, templateId: 'stas-default', sandboxTimeoutMs: 300000 },
    slack: {
      webhookUrl: undefined as string | undefined,
      channel: undefined as string | undefined,
      botToken: undefined as string | undefined,
      signingSecret: undefined as string | undefined,
      interactionsPath: '/slack/events',
    },
    admin: { apiKey: 'mock-admin-key', rateLimitMax: 10 },
    sentry: { dsn: undefined as string | undefined, environment: 'test', tracesSampleRate: 0 },
    monitoring: {
      queueDepthWarnThreshold: 50,
      queueDepthCritThreshold: 200,
      queueDepthAlertMinutes: 5,
      dlqRetentionDays: 7,
    },
    alerting: {
      slackChannel: '#stas-alerts',
      warnQueueDepth: 50,
      critQueueDepth: 200,
      warnErrorRatePercent: 10,
      critErrorRatePercent: 30,
    },
    ci: {
      monitorEnabled: false,
      repos: [] as string[],
      failureThreshold: 3,
      pollIntervalMs: 60000,
    },
    stas: {
      label: 'stas:fix',
      botName: 'STAS',
      devSkipWebhookVerify: true,
      maxAgentIterations: 40,
      maxIssueComments: 15,
      rateLimit: {
        windowMs: 60000,
        max: 30,
      },
      defaultTier: 'free' as const,
      monthlyQuotaEnabled: true,
    },
    webhookRetry: { pollIntervalMs: 15000, batchSize: 10 },
    usage: { creditsFixRun: 50, creditsTriage: 10, creditsSandbox: 5 },
    rateLimit: {
      defaultTier: 'free' as const,
      ipMaxPerMinute: 30,
      adminOverrides: {} as Record<string, number>,
    },
    stripe: {
      secretKey: undefined as string | undefined,
      webhookSecret: undefined as string | undefined,
      price100Credits: 'price_100credits',
      price500Credits: 'price_500credits',
      price2000Credits: 'price_2000credits',
      soloPriceId: undefined as string | undefined,
      teamPriceId: undefined as string | undefined,
    },
    database: {
      url: 'postgres://localhost:5432/stas',
      poolMin: 2,
      poolMax: 10,
      ssl: false,
      enableAuditPersistence: false,
    },
    fixTimeoutMs: 600000,
    phaseTimeouts: {
      triage: 30000,
      sandboxBoot: 300000,
      openCodeAgent: 600000,
      prCreation: 30000,
    },
    featureFlags: { defaultTtlSeconds: 30, autoDisableThreshold: 0.05 },
    trackers: {
      linear: undefined as { apiKey: string; webhookSecret: string } | undefined,
      jira: undefined as { url: string; email: string; apiToken: string; webhookSecret: string } | undefined,
      defaultRepoOwner: 'owner',
      defaultRepoName: 'test-repo',
      installationId: 555,
    },
    security: {
      adminApiKey: 'mock-admin-key',
      corsOrigin: '*',
      requestBodyLimit: '1mb',
      webhookBodyLimit: '5mb',
      ipAllowlist: { enabled: false, ips: [] as string[] },
      sandbox: {
        privileged: false,
        readOnlyRoot: true,
        memoryLimit: '512m',
        cpuLimit: '0.5',
        pidsLimit: 256,
        diskLimit: '2gb',
        networkEnabled: false,
      },
    },
    metering: {
      costTriage: 1,
      costOpencodePrimary: 10,
      costOpencodeFallback: 5,
      costPrCreation: 2,
      costRetryPenalty: 3,
      baselineSandboxMs: 300000,
      freeMonthlyCredits: 100,
      sandboxMultiplierMin: 0.5,
      sandboxMultiplierMax: 2.0,
    },
    usageCredits: { fixRun: 50, triage: 10, sandbox: 5 },
  };
}
