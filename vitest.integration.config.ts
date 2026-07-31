import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Only the 3-repo integration suite lives under tests/integration/.
    // The default vitest.config.ts include covers src/__tests__ + eval and
    // excludes this directory, so it needs its own config.
    include: ["tests/integration/**/*.test.ts"],

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
