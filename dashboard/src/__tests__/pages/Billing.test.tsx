import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/__tests__/test-utils';
import Billing from '@/pages/Billing';

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: any) => <div data-testid="responsive-container">{children}</div>,
  LineChart: ({ children }: any) => <div data-testid="line-chart">{children}</div>,
  Line: () => null,
  BarChart: ({ children }: any) => <div data-testid="bar-chart">{children}</div>,
  Bar: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
}));

const { mockStatsGet, mockBillingPlan, mockBillingPortal, mockLitellmUsage, mockBillingInvoices } = vi.hoisted(() => ({
  mockStatsGet: vi.fn(),
  mockBillingPlan: vi.fn(),
  mockBillingPortal: vi.fn(),
  mockLitellmUsage: vi.fn(),
  mockBillingInvoices: vi.fn(),
}));

vi.mock('@/api/client', () => ({
  stats: { get: mockStatsGet },
  billing: { plan: mockBillingPlan, portal: mockBillingPortal, invoices: mockBillingInvoices },
  litellm: { usage: mockLitellmUsage },
}));

describe('Billing', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockStatsGet.mockResolvedValue({
      totalRuns: 100,
      passRate: 88,
      avgDurationSeconds: 95,
      activeRepos: 7,
      runsByDay: [{ date: '2024-01-01', count: 5, passed: 4 }],
      costByDay: [{ date: '2024-01-01', costCents: 250 }],
      fixRateByWeek: [{ week: '2024-W01', rate: 80 }],
    });

    mockBillingPlan.mockResolvedValue({
      id: 'solo',
      name: 'Solo',
      amountCents: 4900,
      monthlyFixLimit: 500,
      description: 'For individual developers',
      hasBillingRecord: true,
    });

    mockLitellmUsage.mockResolvedValue({
      totalSpend: 12.5,
      maxBudget: 100,
      spendPerModel: [{ model: 'claude-sonnet-4', spend: 8 }],
      rpmLimit: 100,
      tpmLimit: 100000,
    });

    mockBillingInvoices.mockResolvedValue({
      invoices: [
        {
          id: 'inv_1',
          number: 'INV-001',
          status: 'paid',
          created: '2024-01-15T00:00:00Z',
          periodStart: '2024-01-01',
          periodEnd: '2024-01-31',
          amountDueCents: 4900,
          amountPaidCents: 4900,
          currency: 'usd',
          invoicePdf: 'https://invoice.stripe.com/pdf/inv_1',
          hostedInvoiceUrl: 'https://invoice.stripe.com/inv_1',
        },
      ],
    });
  });

  it('shows Current Plan section with plan name', async () => {
    renderWithProviders(<Billing />);

    await waitFor(() => {
      expect(screen.getByText('Solo')).toBeInTheDocument();
    });

    expect(screen.getByText(/500 fixes\/mo/i)).toBeInTheDocument();
  });

  it('shows "No active plan found" when billing API fails', async () => {
    mockBillingPlan.mockRejectedValue(new Error('No plan'));

    renderWithProviders(<Billing />);

    await waitFor(() => {
      expect(screen.getByText(/no active plan found/i)).toBeInTheDocument();
    });
  });

  it('shows Manage Subscription button in plan card', async () => {
    renderWithProviders(<Billing />);

    await waitFor(() => {
      expect(screen.getAllByText('Manage Subscription').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('calls billing.portal on Manage Subscription click', async () => {
    mockBillingPortal.mockResolvedValue({ url: 'https://stripe.com/portal' });

    renderWithProviders(<Billing />);

    await waitFor(() => {
      expect(screen.getAllByText('Manage Subscription').length).toBeGreaterThanOrEqual(1);
    });

    const buttons = screen.getAllByText('Manage Subscription');
    const cardButton = buttons.find((b) => b.classList.contains('w-full'));
    await userEvent.click(cardButton!);
    expect(mockBillingPortal).toHaveBeenCalled();
  });

  it('shows View in Stripe Portal button in payment history section', async () => {
    renderWithProviders(<Billing />);

    await waitFor(() => {
      expect(screen.getByText('Payment History')).toBeInTheDocument();
    });

    expect(screen.getByText(/view in stripe portal/i)).toBeInTheDocument();
  });

  it('shows LiteLLM budget section with spend data', async () => {
    renderWithProviders(<Billing />);

    await waitFor(() => {
      expect(screen.getByText('LiteLLM Budget')).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByText('Total Spend')).toBeInTheDocument();
    });
  });

  it('shows budget bar when maxBudget > 0', async () => {
    renderWithProviders(<Billing />);

    await waitFor(() => {
      expect(screen.getByText('Budget')).toBeInTheDocument();
    });
  });

  it('hides budget bar when maxBudget is 0', async () => {
    mockLitellmUsage.mockResolvedValue({
      totalSpend: 0,
      maxBudget: 0,
      spendPerModel: [],
    });

    renderWithProviders(<Billing />);

    await waitFor(() => {
      expect(screen.getByText('LiteLLM Budget')).toBeInTheDocument();
    });

    expect(screen.queryByText('Budget')).not.toBeInTheDocument();
  });

  it('shows spend per model section when data exists', async () => {
    renderWithProviders(<Billing />);

    await waitFor(() => {
      expect(screen.getByText('Spend per Model')).toBeInTheDocument();
    });

    expect(screen.getByText('claude-sonnet-4')).toBeInTheDocument();
  });

  it('shows RPM and TPM limits when present', async () => {
    renderWithProviders(<Billing />);

    await waitFor(() => {
      expect(screen.getByText('RPM Limit')).toBeInTheDocument();
      expect(screen.getByText('TPM Limit')).toBeInTheDocument();
    });
  });

  it('shows Contact Support link pointing to mailto', async () => {
    renderWithProviders(<Billing />);

    await waitFor(() => {
      expect(screen.getByText(/need help with billing/i)).toBeInTheDocument();
    });

    const supportLink = screen.getByText('Contact Support');
    expect(supportLink.closest('a')).toHaveAttribute('href', 'mailto:support@aimino.io');
  });

  it('shows View Plans link in empty plan state', async () => {
    mockBillingPlan.mockRejectedValue(new Error('No plan'));

    renderWithProviders(<Billing />);

    await waitFor(() => {
      expect(screen.getAllByText('View Plans').length).toBeGreaterThanOrEqual(1);
    });

      const viewPlanLinks = screen.getAllByText('View Plans');
    const pricingLink = viewPlanLinks.find(
      (el) => el.closest('a')?.getAttribute('href') === 'https://syntaro.io/pricing',
    );
    expect(pricingLink).toBeDefined();
  });

  it('shows portal error message when portal call fails', async () => {
    mockBillingPortal.mockRejectedValue(new Error('Failed to open portal'));

    renderWithProviders(<Billing />);

    await waitFor(() => {
      expect(screen.getAllByText('Manage Subscription').length).toBeGreaterThanOrEqual(1);
    });

    const buttons = screen.getAllByText('Manage Subscription');
    const cardButton = buttons.find((b) => b.classList.contains('w-full'));
    await userEvent.click(cardButton!);

    await waitFor(() => {
      expect(screen.getByText(/failed to open portal/i)).toBeInTheDocument();
    });
  });

  it('shows usage stats cards with correct values', async () => {
    renderWithProviders(<Billing />);

    await waitFor(() => {
      expect(screen.getByText('Total Runs')).toBeInTheDocument();
    });

    // "100" also appears as RPM limit, so check it appears at least twice
    expect(screen.getAllByText('100').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('88%')).toBeInTheDocument();
    expect(screen.getByText('95s')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
  });

  it('shows LiteLLM error state', async () => {
    mockLitellmUsage.mockRejectedValue(new Error('LiteLLM API error'));

    renderWithProviders(<Billing />);

    await waitFor(() => {
      expect(screen.getByText(/liteLLM API error/i)).toBeInTheDocument();
    });
  });

  it('shows invoice table with data when invoices resolve', async () => {
    renderWithProviders(<Billing />);

    await waitFor(() => {
      expect(screen.getByText('Payment History')).toBeInTheDocument();
    });

    expect(screen.getByText('INV-001')).toBeInTheDocument();
    expect(screen.getByText('paid')).toBeInTheDocument();
    expect(screen.getByText('$49.00')).toBeInTheDocument();
  });

  it('shows "No payments yet" when invoices is empty', async () => {
    mockBillingInvoices.mockResolvedValue({ invoices: [] });

    renderWithProviders(<Billing />);

    await waitFor(() => {
      expect(screen.getByText('No payments yet')).toBeInTheDocument();
    });
  });

  it('shows invoice error state when invoices reject', async () => {
    mockBillingInvoices.mockRejectedValue(new Error('Invoice fetch failed'));

    renderWithProviders(<Billing />);

    await waitFor(() => {
      expect(screen.getByText('Invoice fetch failed')).toBeInTheDocument();
    });
  });
});
