import { vi } from 'vitest';

export const mockAuth = {
  loginUrl: vi.fn(() => '/api/auth/github'),
  me: vi.fn(),
  logout: vi.fn(),
};

export const mockRuns = {
  list: vi.fn(),
  get: vi.fn(),
};

export const mockRepos = {
  list: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
};

export const mockStats = {
  get: vi.fn(),
};

export const mockAudit = {
  list: vi.fn(),
};

export const mockSettings = {
  get: vi.fn(),
  update: vi.fn(),
};

vi.mock('@/api/client', () => ({
  auth: mockAuth,
  runs: mockRuns,
  repos: mockRepos,
  stats: mockStats,
  audit: mockAudit,
  settings: mockSettings,
  setToken: vi.fn(),
  clearToken: vi.fn(),
}));
