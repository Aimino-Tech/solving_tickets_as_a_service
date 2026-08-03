// Sets environment variables before any E2E test file runs.
// This runs in the vitest worker process before each test file.
// Must be listed in vitest.e2e.config.ts setupFiles.

process.env.TEST = 'true';
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'fatal';
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
