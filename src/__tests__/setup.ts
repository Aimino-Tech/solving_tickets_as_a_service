/**
 * Global test setup for STAS.
 *
 * - Sets TEST env var so config knows we're in test mode
 * - Clears all mocks before each test (via beforeEach)
 */

import { beforeEach, vi } from "vitest";

beforeEach(() => {
  vi.clearAllMocks();
});

// Ensure we're in test mode
process.env.TEST = "true";
