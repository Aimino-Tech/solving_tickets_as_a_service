/**
 * Unit tests for src/routes/admin.ts — Admin API routes.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('express', () => ({ Router: vi.fn(() => ({ use: vi.fn().mockReturnThis(), get: vi.fn().mockReturnThis(), post: vi.fn().mockReturnThis() })) }));
vi.mock('../../audit/repository.js', () => ({ auditRepository: { query: vi.fn() } }));
vi.mock('../../audit/service.js', () => ({ logAdminAction: vi.fn() }));
vi.mock('../../db/repositories/index.js', () => ({ accountsRepository: { list: vi.fn(), findById: vi.fn(), update: vi.fn() }, creditsRepository: { getBalance: vi.fn(), credit: vi.fn(), deduct: vi.fn() } }));
vi.mock('../../security/adminAuth.js', () => ({ adminAuthMiddleware: vi.fn((req: any, res: any, next: any) => next()) }));
vi.mock('../../db/connection.js', () => ({ queryWithRetry: vi.fn() }));
vi.mock('../../config.js', () => ({ config: { queue: { redisUrl: 'redis://localhost:6379' } } }));
vi.mock('../../utils/logger.js', () => ({ rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) } }));

describe('routes/admin', () => {
  it('exports adminRouter', async () => {
    const mod = await import('../../routes/admin.js');
    expect(mod.adminRouter).toBeDefined();
  });
});
