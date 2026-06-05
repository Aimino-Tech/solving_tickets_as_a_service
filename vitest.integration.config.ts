import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Include the root-level tests/ directory for integration tests
    dir: "tests",
    include: ["tests/**/*.test.ts"],

    // Node environment for backend integration testing
    environment: "node",

    // Make describe/it/expect available without imports
    globals: true,

    // Longer timeout for integration tests (30s by default)
    testTimeout: 30_000,

    // No coverage thresholds for integration tests
    coverage: {
      provider: "v8",
      enabled: false,
    },
  },
});
