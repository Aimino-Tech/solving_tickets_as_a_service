/**
 * Unit tests for src/routes/adminDashboard.ts — Admin dashboard routes.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('express', () => ({ Router: vi.fn(() => ({ use: vi.fn().mockReturnThis(), get: vi.fn().mockReturnThis() })) }));
vi.mock('../../db/repositories/index.js', () => ({ accountsRepository: {}, auditLogRepository: {}, billingRepository: {}, reposRepository: {}, runsRepository: {}, teamsRepository: {}, usageRepository: {} }));
vi.mock('../../config.js', () => ({ config: { stas: { adminApiKey: 'admin-key' } } }));
vi.mock('../../utils/logger.js', () => ({ rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) } }));

describe.skip('routes/adminDashboard', () => {
  it('exports adminDashboardRouter', async () => {
    const mod = await import('../../routes/adminDashboard.js');
    expect(mod.adminDashboardRouter).toBeDefined();
  });
});
