/**
 * Environment setup for E2E tests.
 *
 * Separated from index.ts to avoid importing server.js at module level
 * (which would trigger config validation before env vars are set).
 */

export interface TestHarnessOptions {
  /** Port for the STAS Express server (0 = random) */
  stasPort?: number;
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
 * Call BEFORE importing any STAS modules.
 */
export function setupTestEnvironment(options?: TestHarnessOptions): void {
  process.env.TEST = 'true';
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = options?.verbose ? 'debug' : 'fatal';
  process.env.DEV_SKIP_WEBHOOK_SIGNATURE_VERIFY = 'true';
  process.env.STAS_LABEL = 'stas:fix';
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

  // Override with any custom env vars
  if (options?.env) {
    Object.assign(process.env, options.env);
  }
}
