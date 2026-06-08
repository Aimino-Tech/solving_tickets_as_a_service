/**
 * Shared module mocks for E2E tests using the test harness.
 *
 * Many STAS source modules do side effects at module load time
 * (connecting to Redis, validating env vars, etc.) that can't
 * run in a test environment without real services.
 *
 * This file provides consistent mocks so the harness can create
 * the Express app without hitting real dependencies.
 *
 * NOTE: `vi.mock` calls in setupFiles ARE hoisted and applied
 * before test file imports are resolved.
 *
 * IMPORTANT: All mock paths are relative to THIS file's location
 * (tests/e2e/harness/). Source files require ../../../src/ prefix.
 */

import { vi } from 'vitest';
import { createMockConfig } from './mock-config.js';

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------
const mockLogger = {
  child: vi.fn(() => mockLogger),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
  silent: vi.fn(),
  level: 'silent',
};

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const mockConfig = createMockConfig();

// ---------------------------------------------------------------------------
// Apply mocks — paths relative to THIS file (tests/e2e/harness/)
// ---------------------------------------------------------------------------

vi.mock('../../../src/config.js', () => ({
  config: mockConfig,
  requireConfig: () => mockConfig,
}));

vi.mock('../../../src/utils/logger.js', () => ({
  rootLogger: mockLogger,
  jobLogger: () => mockLogger,
}));

vi.mock('../../../src/notifications/slack-bolt.js', () => ({
  getSlackBoltApp: vi.fn(() => ({
    mountOn: vi.fn(),
    receiver: { register: vi.fn() },
    app: null,
    sendInteractiveMessage: vi.fn().mockResolvedValue(undefined),
  })),
  resetSlackBoltApp: vi.fn(),
}));

vi.mock('../../../src/trackers/index.js', () => ({
  getTracker: vi.fn(() => undefined),
  initTrackers: vi.fn(),
  getAllTrackers: vi.fn(() => []),
  hasTracker: vi.fn(() => false),
}));

vi.mock('../../../src/queue/issueQueue.js', () => ({
  enqueueIssue: vi.fn().mockResolvedValue('job-mock-id'),
  createIssueQueue: vi.fn(() => ({
    add: vi.fn().mockResolvedValue({ id: 'mock-job-id' }),
    close: vi.fn().mockResolvedValue(undefined),
    on: vi.fn().mockReturnThis(),
    getJob: vi.fn().mockResolvedValue(null),
    getJobs: vi.fn().mockResolvedValue([]),
    obliterate: vi.fn().mockResolvedValue(undefined),
    name: 'stas-issues',
  })),
  createIssueWorker: vi.fn(),
  createDeadLetterQueue: vi.fn(),
  createQueueEvents: vi.fn(() => ({ on: vi.fn(), close: vi.fn() })),
}));

vi.mock('../../../src/github/auth.js', () => ({
  getOctokit: vi.fn(() => ({
    issues: {
      createComment: vi.fn().mockResolvedValue({ data: { id: 1 } }),
      listComments: vi.fn().mockResolvedValue({ data: [] }),
    },
    pulls: {
      create: vi.fn().mockResolvedValue({ data: { id: 1, number: 42, html_url: 'https://github.com/owner/repo/pull/42' } }),
    },
    git: { createRef: vi.fn(), getRef: vi.fn() },
    repos: { getContent: vi.fn() },
  })),
  getInstallationToken: vi.fn().mockResolvedValue('mock-token'),
}));

vi.mock('../../../src/metering/index.js', () => ({
  initMetering: vi.fn(),
  usageRouter: vi.fn(),
}));

vi.mock('../../../src/webhooks/retryWorker.js', () => ({
  startWebhookRetryWorker: vi.fn(),
}));

vi.mock('../../../src/webhooks/eventLogger.js', () => ({
  logWebhookReceived: vi.fn().mockResolvedValue(1),
  logWebhookProcessed: vi.fn().mockResolvedValue(undefined),
  logWebhookFailed: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/webhooks/metrics.js', () => ({
  recordWebhookDuration: vi.fn(),
  renderMetrics: vi.fn(() => ''),
}));

vi.mock('../../../src/bridge/metrics.js', () => ({
  bridgeMetrics: { incrementCounter: vi.fn(), observeHistogram: vi.fn(), setGauge: vi.fn() },
  recordMessagePublished: vi.fn(),
  recordMessageFailed: vi.fn(),
  recordProcessingDuration: vi.fn(),
}));

vi.mock('../../../src/validation.js', () => ({
  validateWebhookPayload: vi.fn(() => ({ success: true, errors: undefined })),
}));

vi.mock('../../../src/security/ipAllowlist.js', () => ({
  ipAllowlistMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('../../../src/ratelimit/middleware.js', () => ({
  rateLimitMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('../../../src/health/queueHealth.js', () => ({
  getQueueHealth: vi.fn().mockResolvedValue({ status: 'healthy', depth: 0 }),
}));

vi.mock('../../../src/stripe/index.js', () => ({
  createStripeWebhookHandler: vi.fn(() => (_req: unknown, res: { status: (c: number) => { json: (o: unknown) => void } }) => {
    res.status(200).json({ received: true });
  }),
}));

vi.mock('../../../src/db/connection.js', () => ({
  queryWithRetry: vi.fn().mockResolvedValue({ rows: [{ ok: 1 }] }),
  getPool: vi.fn(() => ({
    connect: vi.fn().mockResolvedValue({
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    }),
  })),
}));

vi.mock('../../../src/health/opencodeHealth.js', () => ({
  opencodeHealth: {
    getStatus: vi.fn(() => ({ status: 'healthy', circuit: 'closed', consecutiveFailures: 0, httpStatus: 200 })),
  },
}));

// Mock all routers
vi.mock('../../../src/routes/adminWebhooks.js', () => ({ adminWebhooksRouter: vi.fn() }));
vi.mock('../../../src/routes/admin.js', () => ({ adminRouter: vi.fn() }));
vi.mock('../../../src/routes/dashboard.js', () => ({ dashboardRouter: vi.fn() }));
vi.mock('../../../src/routes/featureFlags.js', () => ({ featureFlagsRouter: vi.fn() }));
vi.mock('../../../src/metering/routes.js', () => ({ usageRouter: vi.fn() }));
vi.mock('../../../src/routes/adminDashboard.js', () => ({ adminDashboardRouter: vi.fn() }));
vi.mock('../../../src/billing/index.js', () => ({
  billingRouter: vi.fn(),
  initBilling: vi.fn(),
}));
vi.mock('../../../src/monitoring/sentry.js', () => ({
  addBreadcrumb: vi.fn(),
  setupSentryExpressErrorHandler: vi.fn(),
}));

// Mock webhook handlers
vi.mock('../../../src/webhooks/bitbucket.js', () => ({
  createBitbucketWebhooks: vi.fn(() => ({})),
}));
vi.mock('../../../src/webhooks/github.js', () => ({
  createGithubWebhooks: vi.fn(() => ({})),
}));
vi.mock('../../../src/webhooks/gitlab.js', () => ({
  createGitlabWebhooks: vi.fn(() => ({})),
}));

vi.mock('../../../src/security/adminAuth.js', () => ({
  adminAuthMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('../../../src/ratelimit/tiers.js', () => ({
  initTierOverrides: vi.fn(),
}));
