import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    // Look for test files in tests/e2e/
    dir: "tests/e2e",

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

    // Setup file — absolute path
    setupFiles: [path.resolve(__dirname, "../../src/__tests__/setup.ts")],

    // Print test names as they run
    reporters: ["default"],
  },
});
