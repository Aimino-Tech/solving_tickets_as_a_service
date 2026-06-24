/**
 * Global test setup for STAS.
 *
 * - Sets TEST env var so config knows we're in test mode
 * - Sets required env vars to prevent config.ts from exiting
 * - Clears all mocks before each test (via beforeEach)
 *
 * NOTE: We use vi.stubEnv() so vitest properly tracks env overrides.
 * Direct process.env.X = Y can conflict with vi.stubEnv in tests.
 *
 * LOG_LEVEL is intentionally NOT set here — each test file can control
 * log output as needed via individual mocks.
 */

import { beforeEach, vi } from 'vitest';

beforeEach(() => {
  vi.clearAllMocks();
});

vi.stubEnv('TEST', 'true');
vi.stubEnv('GITHUB_APP_ID', 'test-app-id');
vi.stubEnv('GITHUB_WEBHOOK_SECRET', 'test-webhook-secret');
vi.stubEnv('GITHUB_APP_PRIVATE_KEY', 'test-private-key');
vi.stubEnv('NODE_ENV', 'test');
vi.stubEnv('OPENCODE_API_KEY', 'test-opencode-key');

vi.mock('tsarch', () => ({}));
vi.mock('better-sqlite3', () => {
  const mockDb = {
    exec: vi.fn(),
    prepare: vi.fn(() => ({
      run: vi.fn(),
      get: vi.fn(),
      all: vi.fn(),
      finalize: vi.fn(),
    })),
    close: vi.fn(),
  };
  return { default: vi.fn(() => mockDb) };
});
vi.mock('@opencode-ai/plugin', () => ({
  definePlugin: vi.fn(() => ({})),
  defineTool: vi.fn(() => ({})),
}));
