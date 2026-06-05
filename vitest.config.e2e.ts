import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // E2E test directory
    include: ['tests/e2e/**/*.test.ts'],

    // Node environment for backend testing
    environment: 'node',

    // Make describe/it/expect available without imports
    globals: true,

    // Don't restore mocks automatically (E2E tests manage their own state)
    restoreMocks: false,

    testTimeout: 60_000,
    hookTimeout: 60_000,

    // Run tests sequentially to avoid port conflicts
    sequence: {
      concurrent: false,
    },

    // Use forks pool (default in v4) - single fork for sequential
    pool: 'forks',

    // Set env vars BEFORE any modules are loaded
    env: {
      NODE_ENV: 'test',
      TEST: 'true',
      LOG_LEVEL: 'silent',
      RUN_MODE: 'both',
      GITHUB_APP_ID: '999999',
      GITHUB_WEBHOOK_SECRET: 'test-secret',
      GITHUB_APP_PRIVATE_KEY: 'test-private-key',
      DEV_SKIP_WEBHOOK_SIGNATURE_VERIFY: 'true',
      STAS_LABEL: 'stas:fix',
      REDIS_URL: 'redis://localhost:6379',
      ADMIN_API_KEY: 'test-admin-key',
      IP_ALLOWLIST_ENABLED: 'false',
      SLACK_WEBHOOK_URL: '',
      E2B_API_KEY: '',
      LINEAR_API_KEY: '',
      JIRA_URL: '',
      STRIPE_SECRET_KEY: '',
      OPENAI_API_KEY: 'sk-test-placeholder',
    },

    // Exclude unit tests from E2E run
    exclude: ['node_modules/**', 'src/__tests__/**'],

    // Coverage not needed for E2E
    coverage: {
      enabled: false,
    },
  },
});
