/**
 * Global test setup for STAS.
 *
 * - Sets TEST env var so config knows we're in test mode
 * - Sets required env vars to prevent config.ts from exiting
 * - Clears all mocks before each test (via beforeEach)
 *
 * NOTE: We use vi.stubEnv() so vitest properly tracks env overrides.
 * Direct process.env.X = Y can conflict with vi.stubEnv in tests.
 *
 * LOG_LEVEL is intentionally NOT set here — each test file can control
 * log output as needed via individual mocks.
 */

import { beforeEach, vi } from 'vitest';

beforeEach(() => {
  vi.clearAllMocks();
});

vi.stubEnv('TEST', 'true');
vi.stubEnv('GITHUB_APP_ID', 'test-app-id');
vi.stubEnv('GITHUB_WEBHOOK_SECRET', 'test-webhook-secret');
vi.stubEnv('GITHUB_APP_PRIVATE_KEY', 'test-private-key');
vi.stubEnv('NODE_ENV', 'test');
vi.stubEnv('OPENCODE_API_KEY', 'test-opencode-key');
vi.stubEnv('LINEAR_API_KEY', 'test-linear-key');
vi.stubEnv('JIRA_URL', 'https://test-jira.example.com');
vi.stubEnv('JIRA_EMAIL', 'test@test.com');
vi.stubEnv('JIRA_API_TOKEN', 'test-jira-token');
vi.stubEnv('LINEAR_WEBHOOK_SECRET', 'test-linear-webhook');
vi.stubEnv('JIRA_WEBHOOK_SECRET', 'test-jira-webhook');
vi.stubEnv('TRACKER_DEFAULT_REPO_OWNER', 'test-owner');
vi.stubEnv('TRACKER_DEFAULT_REPO_NAME', 'test-repo');
vi.stubEnv('TRACKER_INSTALLATION_ID', '123');
vi.stubEnv('STAS_LABEL', 'stas:fix');
vi.stubEnv('GITHUB_APP_ID', 'test-app-id');
vi.stubEnv('GITHUB_WEBHOOK_SECRET', 'test-webhook-secret');
vi.stubEnv('GITHUB_APP_PRIVATE_KEY', 'test-private-key');
vi.stubEnv('OPENCODE_API_KEY', 'test-opencode-key');
vi.stubEnv('RAPIDAPI_PROXY_SECRET', 'test-rapidapi-secret');
vi.stubEnv('SESSION_SECRET', 'test-session-secret');
vi.stubEnv('DATABASE_URL', 'postgresql://test:test@localhost:5432/test');
vi.stubEnv('STAS_JWT_SECRET', 'test-jwt-secret');
vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_mock');
vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_mock');
vi.stubEnv('JIRA_EMAIL', 'test@example.com');
vi.stubEnv('JIRA_API_TOKEN', 'test-jira-token');
vi.stubEnv('LINEAR_API_KEY', 'test-linear-key');
vi.stubEnv('SLACK_BOT_TOKEN', 'xoxb-test-token');
vi.stubEnv('SLACK_SIGNING_SECRET', 'test-signing-secret');
vi.stubEnv('RABBITMQ_URL', 'amqp://localhost');
vi.stubEnv('RABBITMQ_ISSUE_QUEUE', 'test-queue');
vi.stubEnv('DATABASE_URL', 'postgres://localhost:5432/test');
vi.stubEnv('STAS_MONTHLY_QUOTA', '1000');
vi.stubEnv('STAS_RATE_LIMIT_MAX', '100');
vi.stubEnv('JIRA_URL', 'https://test-jira.example.com');

const mockFilesOfProject = vi.hoisted(() => {
  const chain = {
    matchingPattern: vi.fn().mockReturnThis(),
    shouldNot: vi.fn().mockReturnThis(),
    dependOnFiles: vi.fn().mockReturnThis(),
    check: vi.fn().mockResolvedValue([]),
  };
  return vi.fn(() => chain);
});

vi.mock('tsarch', () => ({
  filesOfProject: mockFilesOfProject,
}));

const mockBetterSqlite3Db = vi.hoisted(() => ({
  exec: vi.fn(),
  pragma: vi.fn(),
  prepare: vi.fn(() => ({
    run: vi.fn(),
    get: vi.fn(),
    all: vi.fn(),
    finalize: vi.fn(),
  })),
  close: vi.fn(),
}));

vi.mock('better-sqlite3', () => ({
  default: vi.fn(function () { return mockBetterSqlite3Db; }),
}));



vi.mock('bullmq', () => ({
  Queue: vi.fn(() => ({
    add: vi.fn(),
    getJob: vi.fn(),
    getJobs: vi.fn(),
    obliterate: vi.fn(),
    close: vi.fn(),
  })),
  Worker: vi.fn(() => ({
    on: vi.fn(),
    close: vi.fn(),
  })),
  QueueEvents: vi.fn(() => ({
    on: vi.fn(),
    close: vi.fn(),
  })),
}));

vi.mock('amqplib', () => ({
  connect: vi.fn(() => ({
    createChannel: vi.fn(() => ({
      assertQueue: vi.fn(),
      sendToQueue: vi.fn(),
      consume: vi.fn(),
      ack: vi.fn(),
      nack: vi.fn(),
      close: vi.fn(),
    })),
    close: vi.fn(),
  })),
}));

const schemaChainable = () => ({
  default: vi.fn(() => schemaChainable()),
  optional: vi.fn(() => schemaChainable()),
  describe: vi.fn(() => schemaChainable()),
});

const mockToolSchema = {
  string: vi.fn(() => schemaChainable()),
  number: vi.fn(() => schemaChainable()),
  optional: vi.fn(() => schemaChainable()),
};

const mockTool = Object.assign(
  vi.fn(() => ({
    execute: vi.fn().mockResolvedValue({ output: 'mock output', metadata: { tool: 'mock' } }),
    schema: mockToolSchema,
  })),
  {
    schema: mockToolSchema,
    create: vi.fn(() => ({
      execute: vi.fn().mockResolvedValue({ output: 'mock output', metadata: { tool: 'mock' } }),
      schema: mockToolSchema,
    })),
  },
);

vi.mock('@opencode-ai/plugin', () => ({
  tool: mockTool as any,
  definePlugin: vi.fn(() => ({})),
  defineTool: vi.fn(() => ({})),
}));
