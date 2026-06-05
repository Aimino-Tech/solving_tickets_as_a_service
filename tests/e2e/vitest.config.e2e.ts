import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Look for test files in the same directory as this config
    dir: ".",

    // Node environment for backend testing
    environment: "node",

    // Make describe/it/expect available without imports
    globals: true,

    // Auto-restore mocks between tests
    restoreMocks: true,

    // Longer timeout for integration tests (30s per test)
    testTimeout: 30_000,

    // Hook timeout
    hookTimeout: 30_000,

    // Pool: forks for isolation
    pool: "forks",

    // Retry flaky tests once
    retry: 1,

    // Setup file (relative to this config, resolves to src/__tests__/setup.ts)
    setupFiles: ["../../src/__tests__/setup.ts"],

    // Print test names as they run
    reporters: ["default"],
  },
});
