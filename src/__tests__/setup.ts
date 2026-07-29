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
