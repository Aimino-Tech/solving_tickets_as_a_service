import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Launch-readiness lives at the repo root under tests/ — the default
    // vitest.config.ts include only covers src/__tests__ + eval.
    include: ["tests/launch-readiness.test.ts"],

    // Node environment for backend checks
    environment: "node",

    // Make describe/it/expect available without imports
    globals: true,

    // `npm run build` inside the suite takes longer than the 5s default
    testTimeout: 180_000,
    hookTimeout: 180_000,

    // No coverage thresholds for the launch-readiness runner
    coverage: {
      provider: "v8",
      enabled: false,
    },
  },
});
