import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Integration tests live under tests/integration/ and run against the compose
    // stack. Vitest 4 resolves `include` relative to `dir`, so keep dir at the
    // project root and scope the glob to the integration suite.
    dir: ".",
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
