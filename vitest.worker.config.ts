import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Only run the worker-pipeline E2E test
    dir: 'tests/e2e',
    include: ['tests/e2e/worker-pipeline.test.ts'],

    // Node environment
    environment: 'node',

    // Make describe/it/expect available without imports
    globals: true,

    // Long timeout for worker pipeline (setup + execution can take several minutes)
    testTimeout: 300_000,
    hookTimeout: 300_000,

    // Sequential execution to avoid port conflicts
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },

    // Don't restore mocks between tests
    restoreMocks: false,

    // Retry flaky tests once
    retry: 1,

    // Report slow tests
    slowTestThreshold: 30_000,
  },
});
