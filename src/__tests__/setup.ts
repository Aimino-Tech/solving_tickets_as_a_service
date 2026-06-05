/**
 * Global test setup for STAS.
 *
 * - Sets TEST env var so config knows we're in test mode
 * - Sets required env vars to prevent config.ts from exiting
 * - Clears all mocks before each test (via beforeEach)
 */

import { beforeEach, vi } from 'vitest';

beforeEach(() => {
  vi.clearAllMocks();
});

// Ensure we're in test mode
process.env.TEST = 'true';

// Set required env vars to prevent config.ts from calling process.exit(1)
process.env.GITHUB_APP_ID = 'test-app-id';
process.env.GITHUB_WEBHOOK_SECRET = 'test-webhook-secret';
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
