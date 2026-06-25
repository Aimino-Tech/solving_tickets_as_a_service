import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/__tests__/**/*.{test,spec}.?(c|m)[jt]s?(x)", "eval/**/*.{test,spec}.?(c|m)[jt]s?(x)"],

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

    testTimeout: 30000,

    // Coverage configuration
    coverage: {
      thresholdAutoUpdate: false,
      provider: "v8",
      thresholds: {
        lines: 90,
        branches: 80,
        functions: 85,
        statements: 90,
      },
    },
  },
});
