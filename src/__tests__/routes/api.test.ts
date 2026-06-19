/**
 * Unit tests for src/routes/api.ts — API routes.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('express', () => ({ Router: vi.fn(() => ({ use: vi.fn().mockReturnThis(), get: vi.fn().mockReturnThis(), post: vi.fn().mockReturnThis(), delete: vi.fn().mockReturnThis() })) }));
vi.mock('../../config.js', () => ({ config: { trackers: { defaultRepoOwner: 'test', defaultRepoName: 'repo' } } }));
vi.mock('../../utils/logger.js', () => ({ rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) } }));
vi.mock('../../security/authMiddleware.js', () => ({ requireAuth: vi.fn((req: any, res: any, next: any) => next()) }));

describe('routes/api', () => {
  it('exports apiRouter', async () => {
    const mod = await import('../../routes/api.js');
    expect(mod.apiRouter).toBeDefined();
  });
});
