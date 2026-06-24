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

vi.mock('tsarch', () => {
  const chainable = {
    matchingPattern: () => chainable,
    shouldNot: () => chainable,
    dependOnFiles: () => chainable,
    check: async () => [],
    filesOfProject: () => chainable,
  };
  return { filesOfProject: () => chainable };
});

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
  function MockDatabase() { return mockDb; }
  return { default: MockDatabase };
});
