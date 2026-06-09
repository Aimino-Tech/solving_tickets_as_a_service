/**
 * Unit tests for src/credits/routes.ts — Credit system REST API routes.
 */
import { beforeAll, describe, expect, it, vi, beforeEach } from 'vitest';

beforeAll(() => {
  vi.stubEnv('GITHUB_APP_ID', 'test-app-123');
  vi.stubEnv('GITHUB_WEBHOOK_SECRET', 'test-webhook-secret-456');
  vi.stubEnv('GITHUB_APP_PRIVATE_KEY', 'test-private-key');
  vi.stubEnv('OPENCODE_API_KEY', 'test-opencode-api-key');
});

const mockGetBalance = vi.fn();
const mockGetTransactions = vi.fn();
const mockCredit = vi.fn();
const mockDeduct = vi.fn();
const mockCreateCheckoutSession = vi.fn();
const mockQuery = vi.fn();

vi.mock('../../db/repositories/CreditsRepository.js', () => ({
  creditsRepository: { getBalance: mockGetBalance, getTransactions: mockGetTransactions, credit: mockCredit, deduct: mockDeduct },
}));
vi.mock('../../stripe/checkout.js', () => ({ createCheckoutSession: mockCreateCheckoutSession }));
vi.mock('../../stripe/credit-packs.js', () => ({ CREDIT_PACKS: { pack1: { priceId: 'price_500', credits: 500, amountCents: 999 } } }));
vi.mock('../../utils/logger.js', () => ({ rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) } }));
vi.mock('../../db/connection.js', () => ({ queryWithRetry: mockQuery }));
vi.mock('express', () => ({ Router: vi.fn(() => ({ get: vi.fn(), post: vi.fn() })) }));

describe('credits/routes', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('exports creditRouter', async () => {
    const mod = await import('../../credits/routes.js');
    expect(mod.creditRouter).toBeDefined();
  });
});
