import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, act } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils';

const {
  mockBillingPlan, mockBillingPortal, mockRunsList, mockStatsGet,
  mockAuditList, mockSettingsGet, mockSettingsUpdate, mockConfigApiGet,
  mockRequest, mockLitellmUsage, mockBillingInvoices,
  mockCreditsBalance, mockCreditsPacks, mockCreditsTransactions, mockCreditsUsage,
  mockBillingSettingsGet,
} = vi.hoisted(() => ({
  mockBillingPlan: vi.fn(),
  mockBillingPortal: vi.fn(),
  mockRunsList: vi.fn(),
  mockStatsGet: vi.fn(),
  mockAuditList: vi.fn(),
  mockSettingsGet: vi.fn(),
  mockSettingsUpdate: vi.fn(),
  mockConfigApiGet: vi.fn(),
  mockRequest: vi.fn(),
  mockLitellmUsage: vi.fn(),
  mockBillingInvoices: vi.fn(),
  mockCreditsBalance: vi.fn(),
  mockCreditsPacks: vi.fn(),
  mockCreditsTransactions: vi.fn(),
  mockCreditsUsage: vi.fn(),
  mockBillingSettingsGet: vi.fn(),
}));

vi.mock('@/api/client', () => ({
  billing: { plan: mockBillingPlan, portal: mockBillingPortal, invoices: mockBillingInvoices },
  runs: { list: mockRunsList },
  stats: { get: mockStatsGet },
  audit: { list: mockAuditList },
  settings: { get: mockSettingsGet, update: mockSettingsUpdate },
  configApi: { get: mockConfigApiGet, updateEnv: vi.fn() },
  request: mockRequest,
  litellm: { usage: mockLitellmUsage },
  credits: {
    balance: mockCreditsBalance,
    getPacks: mockCreditsPacks,
    transactions: mockCreditsTransactions,
    usage: mockCreditsUsage,
    redeemCoupon: vi.fn(),
    topUp: vi.fn(),
  },
  billingSettingsApi: { get: mockBillingSettingsGet, update: vi.fn() },
  tickets: { create: vi.fn().mockResolvedValue({ status: 'accepted' }), list: vi.fn().mockResolvedValue({ tickets: [] }) },
  github: {
    getStatus: vi.fn().mockResolvedValue({ connected: false }),
    getOAuthUrl: vi.fn().mockResolvedValue({ url: '' }),
    disconnect: vi.fn().mockResolvedValue({}),
  },
  bitbucket: {
    getStatus: vi.fn().mockResolvedValue({ connected: false }),
    getOAuthStatus: vi.fn().mockResolvedValue({ connected: false }),
    getOAuthUrl: vi.fn().mockResolvedValue({ url: '' }),
    connect: vi.fn().mockResolvedValue({}),
    disconnect: vi.fn().mockResolvedValue({}),
  },
  mcpKeysApi: {
    get: vi.fn().mockResolvedValue(null),
    list: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({}),
    rename: vi.fn().mockResolvedValue({}),
    revoke: vi.fn().mockResolvedValue({}),
  },
  privacy: {
    getDeletionStatus: vi.fn().mockResolvedValue({ status: 'none' }),
    requestDeletion: vi.fn(),
    cancelDeletion: vi.fn(),
    exportData: vi.fn(),
  },
}));

const mockFetchPreferences = vi.hoisted(() => vi.fn());
const mockSyncRecommendations = vi.hoisted(() => vi.fn());
vi.mock('@/services/notificationService', () => ({
  fetchPreferences: mockFetchPreferences,
  upsertPreference: vi.fn(),
  syncRecommendations: mockSyncRecommendations,
}));

const mockUseAuth = vi.hoisted(() => vi.fn());
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
  LineChart: ({ children }: any) => <div>{children}</div>,
  Line: () => null,
  BarChart: ({ children }: any) => <div>{children}</div>,
  Bar: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
}));

function setupDefaultAuth(overrides?: Record<string, unknown>) {
  mockUseAuth.mockReturnValue({
    user: { id: '1', email: 'test@test.com', name: 'Test User', plan: 'free', ...overrides },
    isAuthenticated: true,
    isLoading: false,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
  });
}

function setupEmptyMocks() {
  mockBillingPlan.mockResolvedValue({ id: 'free', name: 'Free', monthlyFixLimit: 10 });
  mockRunsList.mockResolvedValue({ data: [], total: 0, page: 1, perPage: 20, totalPages: 0 });
  mockStatsGet.mockResolvedValue({ totalRuns: 0, passRate: 0, avgDurationSeconds: 0, activeRepos: 0, runsByDay: [], costByDay: [], fixRateByWeek: [] });
  mockAuditList.mockResolvedValue({ data: [], total: 0, page: 1, perPage: 30, totalPages: 0 });
  mockSettingsGet.mockResolvedValue({ label: 'syntaro:fix', model: 'claude-sonnet-4-20250514', maxConcurrent: 3, sandboxPoolSize: 2, auditLogEnabled: true });
  mockConfigApiGet.mockResolvedValue({ env: {}, rateLimits: [], tokens: [], integrations: [], infrastructure: {}, symphonies: [], subscriptions: [], warnings: [] });
  mockLitellmUsage.mockResolvedValue({ totalSpend: 0, maxBudget: 0, spendPerModel: [], rpmLimit: null, tpmLimit: null });
  mockBillingInvoices.mockResolvedValue({ invoices: [] });
  mockCreditsBalance.mockResolvedValue(null);
  mockCreditsPacks.mockResolvedValue([]);
  mockCreditsTransactions.mockResolvedValue({ transactions: [], pagination: { limit: 20, offset: 0, total: 0 } });
  mockCreditsUsage.mockResolvedValue({ accountId: 0, period: 'monthly', usage: [] });
  mockBillingSettingsGet.mockResolvedValue({
    autoReloadEnabled: false,
    autoReloadThresholdCents: null,
    autoReloadTopupCents: null,
    monthlyLimitCents: null,
    monthSpendCents: 0,
  });
}

function setupRateLimitMocks() {
  const rateLimitError = new Error('Too Many Requests');
  mockBillingPlan.mockRejectedValue(rateLimitError);
  mockRunsList.mockRejectedValue(rateLimitError);
  mockStatsGet.mockRejectedValue(rateLimitError);
  mockAuditList.mockRejectedValue(rateLimitError);
  mockSettingsGet.mockRejectedValue(rateLimitError);
  mockLitellmUsage.mockRejectedValue(rateLimitError);
  mockBillingInvoices.mockRejectedValue(rateLimitError);
  mockCreditsBalance.mockRejectedValue(rateLimitError);
  mockCreditsPacks.mockRejectedValue(rateLimitError);
  mockCreditsTransactions.mockRejectedValue(rateLimitError);
  mockCreditsUsage.mockRejectedValue(rateLimitError);
  mockBillingSettingsGet.mockRejectedValue(rateLimitError);
}

describe('Rate limiting (429 error handling)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultAuth();
    setupRateLimitMocks();
  });

  it('DashboardHome does not crash on 429', async () => {
    const DashboardHome = (await import('@/pages/DashboardHome')).default;
    renderWithProviders(<DashboardHome />);

    // Individual API rejections are caught by .catch() handlers,
    // so the component renders with default/fallback values instead of an error state
    await waitFor(() => {
      expect(screen.getByText('Fixes this period')).toBeInTheDocument();
    });
  });

  it('RunsHistory does not crash on 429', async () => {
    const RunsHistory = (await import('@/pages/RunsHistory')).default;
    renderWithProviders(<RunsHistory />);

    await waitFor(() => {
      expect(screen.getAllByText('Free').length).toBeGreaterThan(0);
    });
  });

  it('Billing does not crash on 429', async () => {
    const Billing = (await import('@/pages/Billing')).default;
    renderWithProviders(<Billing />);

    await waitFor(() => {
      expect(screen.getByText('Billing')).toBeInTheDocument();
    });
  });

  it('AuditLog does not crash on 429', async () => {
    const AuditLog = (await import('@/pages/AuditLog')).default;
    renderWithProviders(<AuditLog />);

    await waitFor(() => {
      expect(screen.getByText(/too many requests/i)).toBeInTheDocument();
    });
  });
});

describe('Empty state handling across all pages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultAuth();
    setupEmptyMocks();
  });

  it('DashboardHome renders without data', async () => {
    const DashboardHome = (await import('@/pages/DashboardHome')).default;
    renderWithProviders(<DashboardHome />);

    await waitFor(() => {
      expect(screen.getByText('Fixes this period')).toBeInTheDocument();
    });
    expect(screen.getByText(/Free/)).toBeInTheDocument();
    expect(screen.getByText(/no runs yet/i)).toBeInTheDocument();
  });

  it('RunsHistory renders without data', async () => {
    const RunsHistory = (await import('@/pages/RunsHistory')).default;
    renderWithProviders(<RunsHistory />);

    await waitFor(() => {
      expect(screen.getAllByText('Free').length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText('Pending').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Done / Verified').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Failed').length).toBeGreaterThan(0);
  });

  it('Billing renders without data (all APIs empty)', async () => {
    const Billing = (await import('@/pages/Billing')).default;
    renderWithProviders(<Billing />);

    await waitFor(() => {
      expect(screen.getByText('Billing')).toBeInTheDocument();
    });
  });

  it('AuditLog renders without entries', async () => {
    const AuditLog = (await import('@/pages/AuditLog')).default;
    renderWithProviders(<AuditLog />);

    await waitFor(() => {
      expect(screen.getByText(/no audit entries yet/i)).toBeInTheDocument();
    });
  });

  it('Settings renders without crashing', async () => {
    setupEmptyMocks();
    const Settings = (await import('@/pages/Settings')).default;
    const { unmount } = renderWithProviders(<Settings />);

    await waitFor(() => {
      expect(screen.getByText('Settings')).toBeInTheDocument();
    });
    await act(async () => {
      unmount();
    });
  });
});

describe('Auth context - unauthenticated user', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupEmptyMocks();
    mockUseAuth.mockReturnValue({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
    });
  });

  it('DashboardHome renders with unauthenticated user', async () => {
    const DashboardHome = (await import('@/pages/DashboardHome')).default;
    renderWithProviders(<DashboardHome />);

    await waitFor(() => {
      expect(screen.getByText('Fixes this period')).toBeInTheDocument();
    });

    expect(screen.getByText(/Free/)).toBeInTheDocument();
  });

  it('Settings renders with unauthenticated user', async () => {
    setupEmptyMocks();
    const Settings = (await import('@/pages/Settings')).default;
    const { unmount } = renderWithProviders(<Settings />);

    await waitFor(() => {
      expect(screen.getByText('Settings')).toBeInTheDocument();
    });
    await act(async () => {
      unmount();
    });
  });

  it('RunsHistory renders with unauthenticated user', async () => {
    const RunsHistory = (await import('@/pages/RunsHistory')).default;
    renderWithProviders(<RunsHistory />);

    await waitFor(() => {
      expect(screen.getAllByText('Free').length).toBeGreaterThan(0);
    });
  });

  it('AuditLog renders with unauthenticated user', async () => {
    const AuditLog = (await import('@/pages/AuditLog')).default;
    renderWithProviders(<AuditLog />);

    await waitFor(() => {
      expect(screen.getByText(/no audit entries yet/i)).toBeInTheDocument();
    });
  });
});
