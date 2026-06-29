/**
 * Unit tests for src/routes/dashboard.ts — Dashboard API routes.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('express', () => ({ Router: vi.fn(() => ({ use: vi.fn().mockReturnThis(), get: vi.fn().mockReturnThis(), post: vi.fn().mockReturnThis() })) }));
vi.mock('../../db/connection.js', () => ({ queryWithRetry: vi.fn() }));
vi.mock('../../utils/logger.js', () => ({ rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) } }));

describe('routes/dashboard', () => {
  it('exports dashboardRouter', async () => {
    const mod = await import('../../routes/dashboard.js');
    expect(mod.dashboardRouter).toBeDefined();
  });
});
