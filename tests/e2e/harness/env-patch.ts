// Sets environment variables before any E2E test file runs.
// This runs in the vitest worker process before each test file.
// Must be listed in vitest.e2e.config.ts setupFiles.

process.env.TEST = 'true';
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'fatal';
process.env.DEV_SKIP_WEBHOOK_SIGNATURE_VERIFY = 'true';
process.env.STAS_LABEL = 'stas:fix';
process.env.GITHUB_APP_ID = '999999';
process.env.GITHUB_WEBHOOK_SECRET = 'test-secret';
process.env.GITHUB_APP_PRIVATE_KEY = 'mock-private-key';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.OPENCODE_URL = 'http://localhost:4096';
process.env.OPENAI_API_KEY = 'sk-test';
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
