import { vi } from 'vitest';

export const mockAuth = {
  register: vi.fn(),
  login: vi.fn(),
  me: vi.fn(),
  logout: vi.fn(),
  refresh: vi.fn(),
};

export const mockRuns = {
  list: vi.fn(),
  get: vi.fn(),
};

export const mockCredits = {
  balance: vi.fn(),
  transactions: vi.fn(),
  topUp: vi.fn(),
};

export const mockAccount = {
  get: vi.fn(),
  usage: vi.fn(),
  transactions: vi.fn(),
};

export const mockRepos = {
  list: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
};

export const mockStats = {
  get: vi.fn(),
};

export const mockBenchmarks = {
  get: vi.fn(),
  getPrices: vi.fn(),
};

export const mockKpi = {
  get: vi.fn(),
  exportUrl: vi.fn(() => '/api/kpi/export'),
};

export const mockPricing = {
  get: vi.fn(),
  calculate: vi.fn(),
  vs: vi.fn(),
};

export const mockSettings = {
  get: vi.fn(),
  update: vi.fn(),
};

export const mockAudit = {
  list: vi.fn(),
};

vi.mock('@/api/client', () => ({
  auth: mockAuth,
  runs: mockRuns,
  credits: mockCredits,
  account: mockAccount,
  repos: mockRepos,
  stats: mockStats,
  benchmarks: mockBenchmarks,
  kpi: mockKpi,
  pricing: mockPricing,
  settings: mockSettings,
  audit: mockAudit,
  setToken: vi.fn(),
  clearToken: vi.fn(),
}));
