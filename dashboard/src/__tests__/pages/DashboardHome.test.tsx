import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders, deferredPromise } from '@/__tests__/test-utils';
import DashboardHome from '@/pages/DashboardHome';
import type { DashboardStats, Run } from '@/api/types';

const { mockBillingPlan, mockBillingPortal, mockRunsList, mockStatsGet } = vi.hoisted(() => ({
  mockBillingPlan: vi.fn(),
  mockBillingPortal: vi.fn(),
  mockRunsList: vi.fn(),
  mockStatsGet: vi.fn(),
}));

vi.mock('@/api/client', () => ({
  billing: { plan: mockBillingPlan, portal: mockBillingPortal },
  runs: { list: mockRunsList },
  stats: { get: mockStatsGet },
}));

const mockUseAuth = vi.hoisted(() => vi.fn());
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

function mockDefaultUser(overrides?: Record<string, unknown>) {
  mockUseAuth.mockReturnValue({
    user: { id: '1', email: 'test@test.com', name: 'Test User', plan: 'free', ...overrides },
    isAuthenticated: true,
    isLoading: false,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
  });
}

function makeStats(overrides?: Partial<DashboardStats>): DashboardStats {
  return {
    totalRuns: 10,
    passRate: 85,
    avgDurationSeconds: 120,
    activeRepos: 5,
    runsByDay: [],
    costByDay: [],
    fixRateByWeek: [],
    ...overrides,
  };
}

function makeRun(id: string, overrides?: Partial<Run>): Run {
  return {
    id,
    repoOwner: 'owner',
    repoName: 'repo',
    issueNumber: 1,
    issueTitle: 'Test issue',
    status: 'success',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:05:00Z',
    ...overrides,
  };
}

describe('DashboardHome', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDefaultUser();

    mockBillingPlan.mockResolvedValue({ id: 'free', name: 'Free', monthlyFixLimit: 10 });
    mockRunsList.mockResolvedValue({ data: [], total: 0, page: 1, perPage: 5, totalPages: 0 });
    mockStatsGet.mockResolvedValue(makeStats());
  });

  it('shows loading skeleton before data loads', async () => {
    const deferredPlan = deferredPromise<any>();
    const deferredRuns = deferredPromise<any>();
    const deferredStats = deferredPromise<any>();
    mockBillingPlan.mockReturnValue(deferredPlan.promise);
    mockRunsList.mockReturnValue(deferredRuns.promise);
    mockStatsGet.mockReturnValue(deferredStats.promise);

    renderWithProviders(<DashboardHome />);

    expect(screen.queryByText('Active Repos')).not.toBeInTheDocument();
    expect(screen.queryByText('Total Fix Runs')).not.toBeInTheDocument();

    deferredPlan.resolve({ id: 'free', name: 'Free', monthlyFixLimit: 10 });
    deferredRuns.resolve({ data: [], total: 0, page: 1, perPage: 5, totalPages: 0 });
    deferredStats.resolve(makeStats());
    await waitFor(() => {
      expect(screen.getByText('Active Repos')).toBeInTheDocument();
    });
  });

  it('shows Active Repos count from stats API', async () => {
    mockStatsGet.mockResolvedValue(makeStats({ activeRepos: 12 }));
    mockBillingPlan.mockResolvedValue({ id: 'solo', name: 'Solo', monthlyFixLimit: 500 });

    renderWithProviders(<DashboardHome />);

    await waitFor(() => {
      expect(screen.getByText('12')).toBeInTheDocument();
    });
  });

  it('shows em-dash for Active Repos when stats API returns no data', async () => {
    mockStatsGet.mockResolvedValue(null as unknown as DashboardStats);

    renderWithProviders(<DashboardHome />);

    await waitFor(() => {
      expect(screen.getByText('\u2014')).toBeInTheDocument();
    });
  });

  it('shows Total Fix Runs count from runs data', async () => {
    mockRunsList.mockResolvedValue({
      data: [makeRun('1'), makeRun('2'), makeRun('3')],
      total: 3, page: 1, perPage: 5, totalPages: 1,
    });

    renderWithProviders(<DashboardHome />);

    await waitFor(() => {
      expect(screen.getByText('3')).toBeInTheDocument();
    });
  });

  it('shows "0" for Total Fix Runs when no runs exist', async () => {
    mockRunsList.mockResolvedValue({ data: [], total: 0, page: 1, perPage: 5, totalPages: 0 });

    renderWithProviders(<DashboardHome />);

    await waitFor(() => {
      expect(screen.getByText('0')).toBeInTheDocument();
    });
  });

  it('shows "No fixes yet" empty state when no runs', async () => {
    mockRunsList.mockResolvedValue({ data: [], total: 0, page: 1, perPage: 5, totalPages: 0 });

    renderWithProviders(<DashboardHome />);

    await waitFor(() => {
      expect(screen.getByText(/no fixes yet/i)).toBeInTheDocument();
    });
  });

  it('shows Manage Subscription button for non-free user and calls portal API', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: '1', email: 'test@test.com', name: 'Test', plan: 'solo' },
      isAuthenticated: true,
      isLoading: false,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
    });
    mockBillingPortal.mockResolvedValue({ url: 'https://stripe.com/portal' });

    renderWithProviders(<DashboardHome />);

    await waitFor(() => {
      expect(screen.getByText('Manage Subscription')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText('Manage Subscription'));
    expect(mockBillingPortal).toHaveBeenCalled();
  });

  it('shows portal error when billing portal fails with billing record message', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: '1', email: 'test@test.com', name: 'Test', plan: 'solo' },
      isAuthenticated: true,
      isLoading: false,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
    });
    mockBillingPortal.mockRejectedValue(new Error('No billing record found'));

    renderWithProviders(<DashboardHome />);

    await waitFor(() => {
      expect(screen.getByText('Manage Subscription')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText('Manage Subscription'));

    await waitFor(() => {
      expect(screen.getByText(/no subscription found/i)).toBeInTheDocument();
    });
  });

  it('shows View Plans link for free users', async () => {
    mockDefaultUser({ plan: 'free' });

    renderWithProviders(<DashboardHome />);

    await waitFor(() => {
      expect(screen.getByText('View Plans')).toBeInTheDocument();
    });
  });

  it('gracefully handles individual API failures', async () => {
    // Each API call has its own .catch() handler, so individual failures
    // render the component with fallback default values
    mockRunsList.mockRejectedValue(new Error('Network error'));

    renderWithProviders(<DashboardHome />);

    await waitFor(() => {
      expect(screen.getByText('Current Plan')).toBeInTheDocument();
    });
    // Falls back to free plan, zero runs
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getByText(/no fixes yet/i)).toBeInTheDocument();
  });
});
