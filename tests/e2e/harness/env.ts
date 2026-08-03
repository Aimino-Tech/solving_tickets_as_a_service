/**
 * Environment setup for E2E tests.
 *
 * Separated from index.ts to avoid importing server.js at module level
 * (which would trigger config validation before env vars are set).
 */

export interface TestHarnessOptions {
  /** Port for the SYNTARO Express server (0 = random) */
  syntaroPort?: number;
  /** Port for the mock GitHub API server (0 = random) */
  githubApiPort?: number;
  /** Port for the mock OpenCode server (0 = random) */
  openCodePort?: number;
  /** Override environment variables */
  env?: Record<string, string>;
  /** Enable verbose logging during tests */
  verbose?: boolean;
}

/**
 * Set up environment variables for E2E testing.
 * Call BEFORE importing any SYNTARO modules.
 */
export function setupTestEnvironment(options?: TestHarnessOptions): void {
  process.env.TEST = 'true';
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = options?.verbose ? 'debug' : 'fatal';
  process.env.DEV_SKIP_WEBHOOK_SIGNATURE_VERIFY = 'true';
  process.env.SYNTARO_LABEL = 'syntaro:fix';
  process.env.GITHUB_APP_ID = '999999';
  process.env.GITHUB_WEBHOOK_SECRET = 'test-secret';
  process.env.GITHUB_APP_PRIVATE_KEY = 'mock-private-key';
  process.env.REDIS_URL = 'redis://localhost:6379';
  process.env.OPENCODE_URL = 'http://localhost:4096';
  process.env.OPENCODE_API_KEY = 'sk-test';
  process.env.SLACK_WEBHOOK_URL = '';
  process.env.E2B_API_KEY = '';
  process.env.LINEAR_API_KEY = '';
  process.env.JIRA_URL = '';
  process.env.STRIPE_SECRET_KEY = '';
  process.env.ADMIN_API_KEY = 'test-admin-key';
  process.env.IP_ALLOWLIST_ENABLED = 'false';
  process.env.TRACKER_DEFAULT_REPO_OWNER = 'owner';
  process.env.TRACKER_DEFAULT_REPO_NAME = 'test-repo';
  process.env.TRACKER_INSTALLATION_ID = '555';
  process.env.JWT_SECRET = 'test-jwt-secret-for-e2e-tests';
  process.env.SUPABASE_JWT_SECRET = 'test-supabase-jwt-secret';
  process.env.DPA_VERSION = '2026-06-01';
  process.env.DPA_REQUIRE_ACCEPTANCE = 'false';
  process.env.DATA_RETENTION_DAYS = '30';
  process.env.OPENSYMPHONY_ENABLED = 'false';
  process.env.RABBITMQ_URL = 'amqp://guest:guest@localhost:5672';
  process.env.DATABASE_URL = 'postgres://localhost:5432/syntaro_test';
  process.env.SYNTARO_MCP_AUTO_START = 'false';
  process.env.CI_MONITOR_ENABLED = 'false';
  process.env.SYNTARO_AI_DISABLED = 'true';

  // Override with any custom env vars
  if (options?.env) {
    Object.assign(process.env, options.env);
  }
}
