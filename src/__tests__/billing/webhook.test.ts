/**
 * Unit tests for src/billing/webhook.ts — Stripe subscription webhook handler.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockConstructEvent = vi.fn();
const mockRetrieveSubscription = vi.fn();

vi.mock('stripe', () => ({
  default: vi.fn(() => ({
    webhooks: { constructEvent: mockConstructEvent },
    subscriptions: { retrieve: mockRetrieveSubscription },
  })),
}));

vi.mock('../../config.js', () => ({
  config: { stripe: { secretKey: 'sk_test_mock', webhookSecret: 'whsec_mock', soloPriceId: 'price_solo_mock', teamPriceId: 'price_team_mock' } },
}));
vi.mock('../../utils/logger.js', () => ({
  rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
}));
vi.mock('../../db/connection.js', () => ({ queryWithRetry: vi.fn() }));

describe('billing/webhook', () => {
  let webhook: typeof import('../../billing/webhook.js');
  let mockQuery: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../../billing/webhook.js');
    mod.resetBillingWebhookClient();
    webhook = mod;
    mockQuery = (await import('../../db/connection.js')).queryWithRetry;
  });

  describe('createBillingWebhookHandler', () => {
    it('returns 500 when webhook secret missing', async () => {
      vi.resetModules();
      vi.mock('../../config.js', () => ({ config: { stripe: { secretKey: 'sk_test', webhookSecret: '' } } }));
      vi.mock('../../utils/logger.js', () => ({ rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) } }));
      const mod = await import('../../billing/webhook.js');
      mod.resetBillingWebhookClient();
      const handler = mod.createBillingWebhookHandler();
      const req = { rawBody: Buffer.from('test'), headers: { 'stripe-signature': 'sig' } } as any;
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
      await handler(req, res);
      expect(res.status).toHaveBeenCalledWith(500);
    });

    it('returns 400 when raw body missing', async () => {
      const handler = webhook.createBillingWebhookHandler();
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
      await handler({ headers: {} } as any, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 401 when stripe-signature missing', async () => {
      const handler = webhook.createBillingWebhookHandler();
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
      await handler({ rawBody: Buffer.from('test'), headers: {} } as any, res);
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('returns 401 on invalid signature', async () => {
      mockConstructEvent.mockImplementation(() => { throw new Error('Invalid signature'); });
      const handler = webhook.createBillingWebhookHandler();
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
      await handler({ rawBody: Buffer.from('test'), headers: { 'stripe-signature': 'bad' } } as any, res);
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('handles checkout.session.completed', async () => {
      mockConstructEvent.mockReturnValue({ type: 'checkout.session.completed', id: 'evt_mock', data: { object: { id: 'cs_mock', metadata: { accountId: '42', planId: 'solo' }, subscription: 'sub_mock', customer: 'cus_mock' } } });
      mockRetrieveSubscription.mockResolvedValue({ id: 'sub_mock', current_period_start: 1700000000, current_period_end: 1700086400, customer: 'cus_mock' });
      mockQuery.mockResolvedValue({ rows: [] });
      const handler = webhook.createBillingWebhookHandler();
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
      await handler({ rawBody: Buffer.from('test'), headers: { 'stripe-signature': 'valid' } } as any, res);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('handles invoice.paid', async () => {
      mockConstructEvent.mockReturnValue({ type: 'invoice.paid', id: 'evt_mock', data: { object: { id: 'in_mock', subscription: 'sub_mock', amount_paid: 4900 } } });
      mockRetrieveSubscription.mockResolvedValue({ id: 'sub_mock', current_period_start: 1700000000, current_period_end: 1700086400 });
      mockQuery.mockResolvedValue({ rows: [] });
      const handler = webhook.createBillingWebhookHandler();
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
      await handler({ rawBody: Buffer.from('test'), headers: { 'stripe-signature': 'valid' } } as any, res);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('handles customer.subscription.deleted', async () => {
      mockConstructEvent.mockReturnValue({ type: 'customer.subscription.deleted', id: 'evt_mock', data: { object: { id: 'sub_mock' } } });
      mockQuery.mockResolvedValue({ rows: [] });
      const handler = webhook.createBillingWebhookHandler();
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
      await handler({ rawBody: Buffer.from('test'), headers: { 'stripe-signature': 'valid' } } as any, res);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('acknowledges unknown events', async () => {
      mockConstructEvent.mockReturnValue({ type: 'charge.succeeded', id: 'evt_mock', data: { object: {} } });
      const handler = webhook.createBillingWebhookHandler();
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
      await handler({ rawBody: Buffer.from('test'), headers: { 'stripe-signature': 'valid' } } as any, res);
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });
});
