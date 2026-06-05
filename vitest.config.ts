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

    // Setup file runs before each test file
    setupFiles: ["src/__tests__/setup.ts"],

    // Exclude E2E tests from normal runs
    exclude: ["**/node_modules/**", "**/dist/**", "**/tests/e2e/**"],

    // Coverage configuration
    coverage: {
      provider: "v8",
      thresholds: {
        lines: 80,
        branches: 70,
        functions: 75,
        statements: 80,
      },
    },
  },
});
