import { beforeEach, vi } from 'vitest';

beforeEach(() => {
  vi.clearAllMocks();
});

process.env.TEST = 'true';
