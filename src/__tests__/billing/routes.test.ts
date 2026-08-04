/**
 * Unit tests for src/billing/routes.ts — Billing API routes.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

// Hoisted so the vi.mock factories can reference them (vitest hoists factories).
const { mockRouter, mockListInvoices, mockQueryWithRetry } = vi.hoisted(() => ({
  mockRouter: {
    use: vi.fn().mockReturnThis(),
    get: vi.fn().mockReturnThis(),
    post: vi.fn().mockReturnThis(),
  },
  mockListInvoices: vi.fn(),
  mockQueryWithRetry: vi.fn(),
}));

vi.mock('express', () => ({ Router: vi.fn(() => mockRouter) }));
vi.mock('../../config.js', () => ({
  config: {
    stripe: { soloPriceId: 'price_solo', teamPriceId: 'price_team' },
    dataPrivacy: { dpaVersion: '1', requireDpaAcceptance: false },
  },
}));
vi.mock('../../utils/logger.js', () => ({
  rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })), info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../db/connection.js', () => ({ queryWithRetry: mockQueryWithRetry }));
vi.mock('../../billing/stripe.js', () => ({
  createSubscriptionCheckoutSession: vi.fn(),
  createBillingPortalSession: vi.fn(),
  cancelSubscriptionAtPeriodEnd: vi.fn(),
  reactivateSubscription: vi.fn(),
  listInvoices: mockListInvoices,
}));

type InvoicesHandler = (req: Request, res: Response) => Promise<void>;

let invoicesHandler: InvoicesHandler;

beforeEach(async () => {
  vi.resetModules();
  mockRouter.get.mockClear();
  mockQueryWithRetry.mockReset();
  mockListInvoices.mockReset();

  await import('../../billing/routes.js');

  const registration = mockRouter.get.mock.calls.find((call) => call[0] === '/invoices');
  if (registration) {
    invoicesHandler = registration[registration.length - 1] as InvoicesHandler;
  }
});

function createMockReq(overrides: Record<string, unknown> = {}): Request {
  return { headers: {}, query: {}, body: {}, ...overrides } as unknown as Request;
}

function createMockRes() {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  return res;
}

describe('billing/routes — GET /api/v1/billing/invoices', () => {
  it('returns normalized invoices when a billing record with a Stripe customer exists', async () => {
    mockQueryWithRetry.mockResolvedValue({ rows: [{ stripe_customer_id: 'cus_123' }] });
    mockListInvoices.mockResolvedValue([
      {
        id: 'in_1',
        number: 'INV-001',
        status: 'paid',
        created: 1700000000,
        period_start: 1699990000,
        period_end: 1702582000,
        amount_due: 4900,
        amount_paid: 4900,
        currency: 'usd',
        invoice_pdf: 'https://pay.stripe.com/invoice/in_1/pdf',
        hosted_invoice_url: 'https://pay.stripe.com/invoice/in_1',
      },
      { id: 'in_2' },
    ]);

    const req = createMockReq({ headers: { 'x-account-id': '42' } });
    const res = createMockRes();

    await invoicesHandler(req, res as unknown as Response);

    expect(mockQueryWithRetry).toHaveBeenCalledWith(
      'SELECT stripe_customer_id FROM billing WHERE account_id = $1',
      [42],
    );
    expect(mockListInvoices).toHaveBeenCalledWith('cus_123', 20);
    expect(res.json).toHaveBeenCalledWith({
      invoices: [
        {
          id: 'in_1',
          number: 'INV-001',
          status: 'paid',
          created: new Date(1700000000 * 1000).toISOString(),
          periodStart: new Date(1699990000 * 1000).toISOString(),
          periodEnd: new Date(1702582000 * 1000).toISOString(),
          amountDueCents: 4900,
          amountPaidCents: 4900,
          currency: 'usd',
          invoicePdf: 'https://pay.stripe.com/invoice/in_1/pdf',
          hostedInvoiceUrl: 'https://pay.stripe.com/invoice/in_1',
        },
        {
          id: 'in_2',
          number: null,
          status: 'unknown',
          created: new Date(0).toISOString(),
          periodStart: null,
          periodEnd: null,
          amountDueCents: 0,
          amountPaidCents: 0,
          currency: 'usd',
          invoicePdf: null,
          hostedInvoiceUrl: null,
        },
      ],
    });
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns an empty invoices array when there is no billing record or no Stripe customer', async () => {
    const req = createMockReq({ headers: { 'x-account-id': '42' } });

    // No billing row at all
    mockQueryWithRetry.mockResolvedValue({ rows: [] });
    let res = createMockRes();
    await invoicesHandler(req, res as unknown as Response);
    expect(res.json).toHaveBeenCalledWith({ invoices: [] });
    expect(mockListInvoices).not.toHaveBeenCalled();

    // Billing row exists but stripe_customer_id is null
    mockQueryWithRetry.mockResolvedValue({ rows: [{ stripe_customer_id: null }] });
    res = createMockRes();
    await invoicesHandler(req, res as unknown as Response);
    expect(res.json).toHaveBeenCalledWith({ invoices: [] });
    expect(mockListInvoices).not.toHaveBeenCalled();
  });

  it('returns 500 with an error message when the Stripe call throws', async () => {
    mockQueryWithRetry.mockResolvedValue({ rows: [{ stripe_customer_id: 'cus_123' }] });
    mockListInvoices.mockRejectedValue(new Error('stripe is down'));

    const req = createMockReq({ headers: { 'x-account-id': '42' } });
    const res = createMockRes();

    await invoicesHandler(req, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Failed to load invoices' });
  });

  it('returns 400 when the account id cannot be determined', async () => {
    const req = createMockReq();
    const res = createMockRes();

    await invoicesHandler(req, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Account identification required. Provide x-account-id header or accountId query param.',
    });
    expect(mockQueryWithRetry).not.toHaveBeenCalled();
  });
});
