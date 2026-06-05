import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Look for E2E test files in tests/e2e/
    dir: 'tests/e2e',

    // Node environment for backend testing
    environment: 'node',

    // Make describe/it/expect available without imports
    globals: true,

    // Longer timeout for E2E tests (30s by default)
    testTimeout: 30_000,
    hookTimeout: 60_000,

    // E2E tests are sequential (no parallel) to avoid port conflicts
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },

    // Global setup/teardown
    globalSetup: ['tests/e2e/harness/setup.ts'],
    globalTeardown: ['tests/e2e/harness/teardown.ts'],

    // Don't restore mocks between tests (E2E uses real instances)
    restoreMocks: false,

    // Retry flaky E2E tests once
    retry: 1,

    // Report slow tests
    slowTestThreshold: 10_000,

    // Exclude fixtures from test discovery
    exclude: ['**/node_modules/**', '**/fixtures/**'],
  },
});
