import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Look for test files in src/__tests__
    dir: "src/__tests__",

    // Node environment for backend testing
    environment: "node",

    // Make describe/it/expect available without imports
    globals: true,

    // Auto-restore mocks between tests
    restoreMocks: true,

    // Exclude node_modules, dist, and E2E tests from unit test runs
    exclude: ["**/node_modules/**", "**/dist/**", "**/tests/e2e/**"],

    // Setup file runs before each test file
    setupFiles: ["src/__tests__/setup.ts"],

    // Coverage configuration
    coverage: {
      thresholdAutoUpdate: false,
      provider: "v8",
      thresholds: {
        lines: 70,
        branches: 60,
        functions: 65,
        statements: 70,
      },
    },
  },
});
