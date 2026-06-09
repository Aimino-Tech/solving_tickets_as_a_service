import { describe, expect, it, vi } from 'vitest';

vi.mock('express', () => ({
  Router: vi.fn(() => ({
    use: vi.fn().mockReturnThis(),
    get: vi.fn().mockReturnThis(),
    put: vi.fn().mockReturnThis(),
    post: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
  })),
}));

vi.mock('../../services/featureFlags.js', () => ({
  isFeatureEnabled: vi.fn(),
  enabledFor: vi.fn(),
  setFeatureFlag: vi.fn(),
  deleteFeatureFlag: vi.fn(),
  listFeatureFlags: vi.fn(),
  setAccountOverride: vi.fn(),
  removeAccountOverride: vi.fn(),
  recordFlagError: vi.fn(),
  getErrorRate: vi.fn(),
  invalidateCache: vi.fn(),
}));

vi.mock('../../featureFlags/metrics.js', () => ({
  renderFeatureFlagMetrics: vi.fn(() => ''),
}));

vi.mock('../../utils/logger.js', () => ({
  rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
}));

describe('routes/featureFlags', () => {
  it('exports featureFlagsRouter', async () => {
    const mod = await import('../../routes/featureFlags.js');
    expect(mod.featureFlagsRouter).toBeDefined();
  });
});
