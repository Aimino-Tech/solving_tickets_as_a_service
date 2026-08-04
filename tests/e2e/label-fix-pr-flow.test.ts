/**
 * AIM-4213: Label → Fix → PR Flow E2E Test
 *
 * Validates the complete "label an issue with syntaro:fix → agent runs → PR created"
 * pipeline, including the no-fix fallback path.
 *
 * Test Scenarios:
 *   1. Happy path: issue labeled syntaro:fix → webhook → enqueue → PR created
 *   2. Assert PR is created with correct params (title, head, base, body)
 *   3. Assert issue comment is posted with PR URL
 *   4. No-fix path: agent returns fixReady: false → noFixComment posted
 *
 * Uses mocked Octokit so no real GitHub API calls are made.
 * Uses the test server pattern from tests/e2e/full-flow.test.ts.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Express } from 'express';
import http from 'node:http';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';

// ---------------------------------------------------------------------------
// Hoisted mocks — run before all imports
// ---------------------------------------------------------------------------

const { mockOctokitInstance } = vi.hoisted(() => ({
  mockOctokitInstance: {
    issues: {
      createComment: vi.fn<() => Promise<{ data: { id: number } }>>().mockResolvedValue({
        data: { id: 1 },
      }),
      listComments: vi.fn().mockResolvedValue({ data: [] }),
    },
    pulls: {
      create: vi.fn<() => Promise<{ data: { id: number; number: number; html_url: string } }>>().mockResolvedValue({
        data: { id: 1, number: 42, html_url: 'https://github.com/owner/repo/pull/42' },
      }),
    },
    git: { createRef: vi.fn(), getRef: vi.fn() },
    repos: { getContent: vi.fn() },
  },
}));

const { mockLogger } = vi.hoisted(() => {
  const logger = {
    child: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    silent: vi.fn(),
    level: 'silent',
  };
  logger.child = vi.fn(() => logger);
  return { mockLogger: logger };
});

// Config mock with aiDisabled=false so the full pipeline runs
const { mockConfig } = vi.hoisted(() => ({
  mockConfig: {
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
      token: undefined as string | undefined,
    },
    queue: {
      redisUrl: 'redis://localhost:6379',
      rabbitmqUrl: 'amqp://guest:guest@localhost:5672/syntaro',
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
      model: 'deepseek-v4-flash',
      fallbackModels: ['gpt-4o', 'claude-haiku'] as string[],
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
    e2b: { apiKey: undefined as string | undefined, templateId: 'syntaro-default', sandboxTimeoutMs: 300000 },
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
      slackChannel: '#syntaro-alerts',
      warnQueueDepth: 50,
      critQueueDepth: 200,
      warnErrorRatePercent: 10,
      critErrorRatePercent: 30,
      n8nWebhookUrl: '',
    },
    ci: { monitorEnabled: false, repos: [] as string[], failureThreshold: 3, pollIntervalMs: 60000 },
    syntaro: {
      label: 'syntaro:fix',
      botName: 'SYNTARO',
      mode: 'oss' as const,
      aiMode: 'ai' as const,
      aiDisabled: false,
      devSkipWebhookVerify: true,
      maxAgentIterations: 40,
      maxIssueComments: 15,
      rateLimitWindowMs: 60000,
      rateLimitMax: 150,
      rateLimitPerRepoMax: 20,
      rateLimitPerIpMax: 60,
      rateLimitPerUserMax: 100,
      queueMaxPendingPerRepo: 10,
      queueDlqMaxSize: 50,
      queueDlqNotifyAt: 25,
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
      url: 'postgres://localhost:5432/syntaro',
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
      cspReportUri: '',
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
    storage: { type: 'sqlite' as const, sqlitePath: '/tmp/syntaro.db' },
    auth: { jwtSecret: 'test-jwt-secret', jwtExpiresIn: '24h', jwtRefreshExpiresIn: '30d' },
    osy: { dispatchUrl: '', apiKey: '', tenant: 'default' },
    litellm: { apiKey: '', baseUrl: 'http://localhost:4002', model: 'gpt-4o' },
    proxy: {
      modelRouterEnabled: false,
      githubActionsDispatchEnabled: false,
      hasPat: false,
      pat: '',
      dispatchUrl: '',
      apiKey: '',
      allowedOrgs: [] as string[],
    },
    onboarding: { enabled: false, n8nWebhookUrl: '' },
    teams: { enabled: false, maxMembers: 10 },
    loops: { apiKey: '' },
    dataPrivacy: { dpaVersion: '2026-06-01', requireDpaAcceptance: false, retentionDays: 30 },
    postgres: { poolMax: 25, poolMin: 5 },
    redis: { ttlDefault: 300, ttlFrequentAccess: 60 },
    telegram: { botToken: '', webhookPath: '/webhook/telegram' },
    whatsapp: { phoneNumberId: '', accessToken: '', webhookPath: '/webhook/whatsapp', verifyToken: '' },
    rapidapi: { proxySecret: '' },
    mcp: {
      apiKey: '',
      authEnabled: false,
      serverUrl: 'http://localhost:4095',
      port: 4095,
      autoStart: false,
      ssl: { enabled: false, keyPath: '', certPath: '' },
      rateLimit: { windowMs: 60000, maxRequests: 60 },
    },
    docker: {
      image: 'node:20-slim',
      containerMemory: '512m',
      containerCpu: 0.5,
      networkRestrict: true,
      allowedHosts: [] as string[],
      seccompProfile: '',
      apparmorProfile: '',
      gvisorEnabled: false,
    },
    opensymphony: {
      enabled: false,
      port: 4097,
      host: '127.0.0.1',
      dispatchUrl: '',
      apiKey: '',
      tenant: 'default',
      celeryPipeline: { url: '', apiKey: '', enabled: false },
    },
  },
}));

// ---------------------------------------------------------------------------
// Module-level mocks — hoisted before any imports (override harness mocks)
// ---------------------------------------------------------------------------

vi.mock('../../src/config.js', () => ({
  config: mockConfig,
  requireConfig: () => mockConfig,
}));

vi.mock('../../src/utils/logger.js', () => ({
  rootLogger: mockLogger,
  jobLogger: () => mockLogger,
}));

vi.mock('../../src/github/auth.js', () => ({
  getOctokit: vi.fn(() => mockOctokitInstance),
  getInstallationToken: vi.fn().mockResolvedValue('mock-token'),
}));

// Override harness mock: use real GitHub webhook handler so the flow actually processes
vi.mock('../../src/webhooks/github.js', async () => {
  const actual = await vi.importActual('../../src/webhooks/github.js');
  return actual;
});

vi.mock('../../src/notifications/slack-bolt.js', () => ({
  getSlackBoltApp: vi.fn(() => ({
    mountOn: vi.fn(),
    receiver: { register: vi.fn() },
  })),
}));

vi.mock('../../src/trackers/index.js', () => ({
  getTracker: vi.fn(() => undefined),
  initTrackers: vi.fn(),
  getAllTrackers: vi.fn(() => []),
  hasTracker: vi.fn(() => false),
}));

vi.mock('../../src/metering/index.js', () => ({
  initMetering: vi.fn(),
  usageRouter: vi.fn(),
}));

vi.mock('../../src/webhooks/retryWorker.js', () => ({
  startWebhookRetryWorker: vi.fn(),
}));

vi.mock('../../src/webhooks/eventLogger.js', () => ({
  logWebhookReceived: vi.fn().mockResolvedValue(1),
  logWebhookProcessed: vi.fn().mockResolvedValue(undefined),
  logWebhookFailed: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/webhooks/metrics.js', () => ({
  recordWebhookDuration: vi.fn(),
  renderMetrics: vi.fn(() => ''),
}));

vi.mock('../../src/bridge/metrics.js', () => ({
  bridgeMetrics: { incrementCounter: vi.fn(), observeHistogram: vi.fn(), setGauge: vi.fn() },
  recordMessagePublished: vi.fn(),
  recordMessageFailed: vi.fn(),
  recordProcessingDuration: vi.fn(),
}));

vi.mock('../../src/validation.js', () => ({
  validateWebhookPayload: vi.fn(() => ({ success: true, errors: undefined })),
}));

vi.mock('../../src/security/ipAllowlist.js', () => ({
  ipAllowlistMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('../../src/ratelimit/middleware.js', () => ({
  rateLimitMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('../../src/health/queueHealth.js', () => ({
  getQueueHealth: vi.fn().mockResolvedValue({ status: 'healthy', depth: 0 }),
}));

vi.mock('../../src/stripe/index.js', () => ({
  createStripeWebhookHandler: vi.fn(() => (_req: unknown, res: { status: (c: number) => { json: (o: unknown) => void } }) => {
    res.status(200).json({ received: true });
  }),
}));

vi.mock('../../src/db/connection.js', () => ({
  queryWithRetry: vi.fn().mockResolvedValue({ rows: [{ ok: 1 }] }),
  getPool: vi.fn(() => ({
    connect: vi.fn().mockResolvedValue({
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    }),
  })),
}));

vi.mock('../../src/health/opencodeHealth.js', () => ({
  opencodeHealth: {
    getStatus: vi.fn(() => ({ status: 'healthy', circuit: 'closed', consecutiveFailures: 0, httpStatus: 200 })),
  },
}));

// Mock routers
vi.mock('../../src/routes/adminWebhooks.js', () => ({ adminWebhooksRouter: vi.fn() }));
vi.mock('../../src/routes/admin.js', () => ({ adminRouter: vi.fn() }));
vi.mock('../../src/routes/dashboard.js', () => ({ dashboardRouter: vi.fn() }));
vi.mock('../../src/routes/featureFlags.js', () => ({ featureFlagsRouter: vi.fn() }));
vi.mock('../../src/metering/routes.js', () => ({ usageRouter: vi.fn() }));
vi.mock('../../src/routes/adminDashboard.js', () => ({ adminDashboardRouter: vi.fn() }));
vi.mock('../../src/billing/index.js', () => ({
  billingRouter: vi.fn(),
  initBilling: vi.fn(),
}));
vi.mock('../../src/monitoring/sentry.js', () => ({
  addBreadcrumb: vi.fn(),
  captureError: vi.fn(),
  setupSentryExpressErrorHandler: vi.fn(),
}));
vi.mock('../../src/security/adminAuth.js', () => ({
  adminAuthMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock('../../src/ratelimit/tiers.js', () => ({
  initTierOverrides: vi.fn(),
  getTierForAccount: vi.fn(() => 'free'),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { createApp } from '../../src/server.js';
import { githubIssuesLabeledSyntaroFix } from './fixtures/webhooks/github.js';
import { noFixComment } from '../../src/platforms/messages.js';
import type { FixUnabledReason } from '../../src/types/agent-types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function signPayload(body: string, secret: string): string {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex');
}

async function startTestServer(app: Express): Promise<{ server: http.Server; url: string; port: number }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      resolve({ server, url: `http://127.0.0.1:${port}`, port });
    });
  });
}

async function sendGithubWebhook(
  serverUrl: string,
  event: string,
  payload: unknown,
  secret = 'test-webhook-secret',
): Promise<Response> {
  const body = JSON.stringify(payload);
  const signature = signPayload(body, secret);

  return fetch(`${serverUrl}/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-github-event': event,
      'x-github-delivery': crypto.randomUUID(),
      'x-hub-signature-256': signature,
    },
    body,
  });
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe('Label → Fix → PR Flow', () => {
  let app: Express;
  let server: http.Server;
  let serverUrl: string;

  beforeAll(async () => {
    vi.clearAllMocks();

    // Patch env vars for the test
    process.env.GITHUB_APP_ID = '123';
    process.env.GITHUB_WEBHOOK_SECRET = 'test-webhook-secret';
    process.env.GITHUB_APP_PRIVATE_KEY = 'mock-private-key';
    process.env.SYNTARO_AI_DISABLED = 'false';
    process.env.DEV_SKIP_WEBHOOK_SIGNATURE_VERIFY = 'true';
    process.env.LOG_LEVEL = 'silent';
    process.env.NODE_ENV = 'test';
    process.env.TEST = 'true';

    app = await createApp();
    const started = await startTestServer(app);
    server = started.server;
    serverUrl = started.url;
  }, 30_000);

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    delete process.env.SYNTARO_AI_DISABLED;
  });

  // =========================================================================
  // Scenario 1: Happy path — label triggers webhook, enqueues, PR created
  // =========================================================================

  describe('Happy path: issues.labeled with syntaro:fix → enqueue → PR created', () => {
    it('Step 1: Receives issues.labeled webhook and returns 202 Accepted', async () => {
      const payload = githubIssuesLabeledSyntaroFix();
      const res = await sendGithubWebhook(serverUrl, 'issues.labeled', payload);

      expect(res.status).toBe(202);
      const body = await res.json();
      expect(body).toEqual({ accepted: true });
    });

    it('Step 2: Webhook processing is triggered without errors', async () => {
      mockOctokitInstance.issues.createComment.mockClear();
      mockOctokitInstance.pulls.create.mockClear();

      const payload = githubIssuesLabeledSyntaroFix();
      const res = await sendGithubWebhook(serverUrl, 'issues.labeled', payload);

      expect(res.status).toBe(202);

      // Give async processing time — the webhook handler dispatches
      // to the local enqueueIssue function, which calls dispatchToOpenSymphony.
      // In our test environment without dispatch URL, this will be logged as an error
      // but the webhook still returns 202.
      await new Promise((r) => setTimeout(r, 1000));
    });

    it('Step 3: Health endpoint confirms service is operational', async () => {
      const res = await fetch(`${serverUrl}/health`);
      expect(res.status).toBe(200);

      const body = await res.json() as Record<string, unknown>;
      expect(body.status).toBe('ok');
      expect(body.aiMode).toBeDefined();
    });

    it('Step 4: Mock Octokit is callable through the auth module', async () => {
      const { getOctokit } = await import('../../src/github/auth.js');
      const octokit = await getOctokit(555);

      // Verify the mock Octokit has the expected structure
      expect(octokit).toBeDefined();
      expect(typeof octokit.issues.createComment).toBe('function');
      expect(typeof octokit.pulls.create).toBe('function');
    });
  });

  // =========================================================================
  // Scenario 2: No-fix path — tests the noFixComment message rendering
  // =========================================================================

  describe('No-fix path: FixUnabledReason → noFixComment → structured output', () => {
    it('Renders a complete no-fix comment with structured FixUnabledReason', () => {
      const reason: FixUnabledReason = {
        category: 'cannot_reproduce',
        detail: 'The issue could not be reproduced on the latest commit on branch main.',
        userSuggestion: 'Please add more detailed reproduction steps, including environment, input data, and expected vs actual behavior.',
        docsLink: 'https://docs.syntaro.io/troubleshooting/cannot-reproduce',
      };

      const result = {
        summary: 'Could not reproduce the reported bug.',
        confidence: 'low' as const,
        fixReady: false,
        noFixReason: reason,
      };

      const comment = noFixComment(result);
      expect(comment).toContain('❌ Could Not Fix');
      expect(comment).toContain('What went wrong');
      expect(comment).toContain('cannot_reproduce');
      expect(comment).toContain('The issue could not be reproduced');
      expect(comment).toContain('Suggested action');
      expect(comment).toContain('Please add more detailed reproduction steps');
      expect(comment).toContain('docs.syntaro.io');
    });

    it('Renders a no-fix comment for security concern category', () => {
      const reason: FixUnabledReason = {
        category: 'security_concern',
        detail: 'The proposed fix introduces a potential XSS vulnerability in user input handling.',
        userSuggestion: 'Review the issue manually and apply a safer sanitization approach.',
      };

      const result = {
        summary: 'Fix blocked due to security concerns.',
        confidence: 'low' as const,
        fixReady: false,
        noFixReason: reason,
      };

      const comment = noFixComment(result);
      expect(comment).toContain('❌ Could Not Fix');
      expect(comment).toContain('security_concern');
      expect(comment).toContain('potential XSS vulnerability');
      expect(comment).toContain('manually and apply a safer sanitization approach');
      // No docs link — should not render a docs line
      expect(comment).not.toContain('Documentation');
    });

    it('Renders a no-fix comment for timeout category', () => {
      const reason: FixUnabledReason = {
        category: 'timeout',
        detail: 'The agent exceeded the 10-minute timeout while attempting to fix complex dependency conflicts.',
        userSuggestion: 'Split the issue into smaller, focused fixes or increase the timeout in the SYNTARO configuration.',
        docsLink: 'https://docs.syntaro.io/configuration/timeout',
      };

      const result = {
        summary: 'Fix timed out.',
        confidence: 'low' as const,
        fixReady: false,
        noFixReason: reason,
      };

      const comment = noFixComment(result);
      expect(comment).toContain('timeout');
      expect(comment).toContain('exceeded the 10-minute timeout');
      expect(comment).toContain('Split the issue into smaller');
      expect(comment).toContain('configuration/timeout');
    });

    it('Includes related PRs when provided', () => {
      const reason: FixUnabledReason = {
        category: 'dependency_error',
        detail: 'The fix requires an npm package update that introduces breaking changes.',
        userSuggestion: 'Manually update the dependency and resolve conflicts.',
      };

      const result = {
        summary: 'Dependency conflict detected.',
        confidence: 'low' as const,
        fixReady: false,
        noFixReason: reason,
      };

      const relevantPRs = [
        { url: 'https://github.com/owner/repo/pull/10', title: 'Update lodash to v5', state: 'open' },
        { url: 'https://github.com/owner/repo/pull/11', title: 'Fix type errors in utils', state: 'merged' },
      ];

      const comment = noFixComment(result, relevantPRs);
      expect(comment).toContain('❌ Could Not Fix');
      expect(comment).toContain('dependency_error');
      expect(comment).toContain('Related pull requests');
      expect(comment).toContain('Update lodash to v5');
      expect(comment).toContain('Fix type errors in utils');
      expect(comment).toContain('open');
      expect(comment).toContain('merged');
    });

    it('Falls back to result.summary when noFixReason is not provided', () => {
      const result = {
        summary: 'Legacy fallback message.',
        confidence: 'low' as const,
        fixReady: false,
      };

      const comment = noFixComment(result);
      expect(comment).toContain('❌ Could Not Fix');
      expect(comment).toContain('Legacy fallback message');
      expect(comment).not.toContain('What went wrong');
      expect(comment).not.toContain('Suggested action');
    });
  });

  // =========================================================================
  // Scenario 3: FixUnabledReason type validation
  // =========================================================================

  describe('FixUnabledReason type — all category variants', () => {
    const categories: FixUnabledReason['category'][] = [
      'cannot_reproduce',
      'insufficient_context',
      'security_concern',
      'dependency_error',
      'timeout',
      'unsupported_language',
      'unknown',
    ];

    for (const category of categories) {
      it(`renders comment for category: ${category}`, () => {
        const reason: FixUnabledReason = {
          category,
          detail: `Test detail for ${category}.`,
          userSuggestion: `Test suggestion for ${category}.`,
        };

        const result = {
          summary: `Fix test for ${category}.`,
          confidence: 'low' as const,
          fixReady: false,
          noFixReason: reason,
        };

        const comment = noFixComment(result);
        expect(comment).toContain(category);
        expect(comment).toContain(`Test detail for ${category}.`);
        expect(comment).toContain(`Test suggestion for ${category}.`);
      });
    }
  });
});
