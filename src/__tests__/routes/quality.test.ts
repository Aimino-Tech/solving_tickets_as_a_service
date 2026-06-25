import { describe, expect, it, vi } from 'vitest';

vi.mock('express-rate-limit', () => ({
  default: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
}));

vi.mock('../../utils/logger.js', () => ({
  rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
}));

describe('routes/quality', () => {
  it('exports qualityRouter', async () => {
    const mod = await import('../../routes/quality.js');
    expect(mod.qualityRouter).toBeDefined();
    expect(typeof mod.qualityRouter.get).toBe('function');
    expect(typeof mod.qualityRouter.post).toBe('function');
  });
});
