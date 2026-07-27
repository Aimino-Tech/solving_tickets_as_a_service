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
    singleFork: true,

    // Global setup/teardown (runs in main process before workers)
    globalSetup: ['tests/e2e/harness/setup.ts'],
    globalTeardown: ['tests/e2e/harness/teardown.ts'],

    // Setup files run in worker before test files, in order:
    // 1. env-patch.ts — sets env vars so config validation passes
    // 2. mock-setup.ts — mocks modules with side effects (queue, db, etc.)
    setupFiles: [
      'tests/e2e/harness/env-patch.ts',
      'tests/e2e/harness/mock-setup.ts',
    ],

    // Don't restore mocks between tests (E2E uses real instances)
    restoreMocks: false,

    // Retry flaky E2E tests once
    retry: 1,

    // Report slow tests
    slowTestThreshold: 10_000,

    // Exclude fixtures from test discovery and worker-pipeline
    // (worker-pipeline has its own dedicated config and requires RabbitMQ)
    exclude: ['**/node_modules/**', '**/fixtures/**', '**/worker-pipeline.test.ts', '**/full-flow.test.ts'],
  },
});
