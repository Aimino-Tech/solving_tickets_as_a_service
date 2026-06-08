/**
 * Unit tests for src/routes/adminWebhooks.ts — Admin webhook management routes.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('express', () => ({ Router: vi.fn(() => ({ use: vi.fn().mockReturnThis(), get: vi.fn().mockReturnThis(), post: vi.fn().mockReturnThis() })) }));
vi.mock('../../db/repositories/WebhookEventsRepository.js', () => ({ webhookEventsRepository: { list: vi.fn(), findById: vi.fn(), markForReplay: vi.fn(), listSources: vi.fn(), statusCounts: vi.fn(), replayRange: vi.fn() } }));
vi.mock('../../security/adminAuth.js', () => ({ adminAuthMiddleware: vi.fn((req: any, res: any, next: any) => next()) }));
vi.mock('../../utils/logger.js', () => ({ rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) } }));

describe('routes/adminWebhooks', () => {
  it('exports adminWebhooksRouter', async () => {
    const mod = await import('../../routes/adminWebhooks.js');
    expect(mod.adminWebhooksRouter).toBeDefined();
  });
});
