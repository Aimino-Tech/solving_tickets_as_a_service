/**
 * Unit tests for src/routes/auth.ts — Authentication routes.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('express', () => ({ Router: vi.fn(() => ({ get: vi.fn().mockReturnThis() })) }));
vi.mock('../../config.js', () => ({ config: { nodeEnv: 'test', dashboard: { baseUrl: 'http://localhost:3000', githubClientId: 'client_id', githubClientSecret: 'client_secret' } } }));
vi.mock('../../utils/logger.js', () => ({ rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) } }));

describe('routes/auth', () => {
  it('exports authRouter', async () => {
    const mod = await import('../../routes/auth.js');
    expect(mod.authRouter).toBeDefined();
  });
});
