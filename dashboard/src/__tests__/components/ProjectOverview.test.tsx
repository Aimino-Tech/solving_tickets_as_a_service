import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/__tests__/test-utils';
import ProjectOverview from '@/components/ProjectOverview';
import type { DashboardStats, Run } from '@/api/types';
import type { BillingPlan } from '@/api/client';

const mockRunsList = vi.hoisted(() => vi.fn());
const mockBillingPlan = vi.hoisted(() => vi.fn());
const mockStatsGet = vi.hoisted(() => vi.fn());
const mockTicketsCreate = vi.hoisted(() => vi.fn());
const mockTicketsList = vi.hoisted(() => vi.fn());
const mockUseAuth = vi.hoisted(() => vi.fn());

vi.mock('@/api/client', () => ({
  runs: { list: mockRunsList },
  billing: { plan: mockBillingPlan },
  stats: { get: mockStatsGet },
  tickets: { create: mockTicketsCreate, list: mockTicketsList },
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

function makeRun(id: string, overrides?: Partial<Run>): Run {
  return {
    id,
    repoOwner: 'owner',
    repoName: 'repo',
    issueNumber: 1,
    issueTitle: `Issue ${id}`,
    status: 'success',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:05:00Z',
    ...overrides,
  };
}

function makeRunsResponse(data: Run[], overrides?: Record<string, unknown>) {
  return {
    data,
    total: data.length,
    page: 1,
    perPage: 100,
    totalPages: 1,
    ...overrides,
  };
}

function makeStats(overrides?: Partial<DashboardStats>): DashboardStats {
  return {
    totalRuns: 0,
    passRate: 0,
    avgDurationSeconds: 0,
    activeRepos: 1,
    runsByDay: [],
    costByDay: [],
    fixRateByWeek: [],
    ...overrides,
  };
}

function makePlan(overrides?: Partial<BillingPlan>): BillingPlan {
  return {
    id: 'free',
    name: 'Free',
    monthlyFixLimit: 10,
    ...overrides,
  };
}

function firstRepoRef() {
  return screen.getAllByText(/owner\/repo#1/)[0];
}

function warningToggle() {
  const buttons = screen.getAllByRole('button', { name: /owner\/repo#1/ });
  const toggle = buttons.find((b) => b.getAttribute('aria-expanded') !== null);
  if (!toggle) throw new Error('warning toggle not found');
  return toggle;
}

describe('ProjectOverview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({ user: { plan: 'free' } });
    mockBillingPlan.mockResolvedValue(makePlan());
    mockStatsGet.mockResolvedValue(makeStats({ totalRuns: 0 }));
    mockRunsList.mockResolvedValue(makeRunsResponse([]));
    mockTicketsCreate.mockResolvedValue({ runId: 'ticket-abc', status: 'accepted' });
    mockTicketsList.mockResolvedValue({ tickets: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders plan tier badge and usage progress', async () => {
    mockStatsGet.mockResolvedValue(makeStats({ totalRuns: 8, fixesUsedThisMonth: 8 }));
    mockRunsList.mockResolvedValue(makeRunsResponse(Array.from({ length: 8 }, (_, i) => makeRun(`r${i}`))));

    renderWithProviders(<ProjectOverview />);

    await waitFor(() => {
      expect(screen.getAllByText('Free').length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText('8/10').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/usage warning/i).length).toBeGreaterThan(0);
  });

  it('groups runs into kanban columns with counts', async () => {
    const runs = [
      makeRun('p1', { status: 'running' }),
      makeRun('p2', { status: 'queued' }),
      makeRun('d1', { status: 'success' }),
      makeRun('d2', { status: 'completed' }),
      makeRun('f1', { status: 'failed' }),
    ];
    mockRunsList.mockResolvedValue(makeRunsResponse(runs));
    mockStatsGet.mockResolvedValue(makeStats({ totalRuns: 5, passRate: 40 }));

    renderWithProviders(<ProjectOverview />);

    await waitFor(() => {
      expect(screen.getAllByText('Pending').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Done / Verified').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Failed').length).toBeGreaterThan(0);
    });
    expect(screen.getByText('Issue p1')).toBeInTheDocument();
    expect(screen.getByText('Issue d1')).toBeInTheDocument();
    expect(screen.getAllByText('Issue f1').length).toBeGreaterThan(0);
  });

  it('shows failed run details and a create-ticket button on warning click', async () => {
    const failed = makeRun('f1', { status: 'failed', errorMessage: 'Timeout waiting for tests' });
    mockRunsList.mockResolvedValue(makeRunsResponse([failed]));
    mockStatsGet.mockResolvedValue(makeStats({ totalRuns: 1, passRate: 0 }));

    renderWithProviders(<ProjectOverview />);

    await waitFor(() => {
      expect(screen.getAllByText(/owner\/repo#1/).length).toBeGreaterThan(0);
    });

    await userEvent.click(warningToggle());

    expect(screen.getByText(/Timeout waiting for tests/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create ticket/i })).toBeInTheDocument();
  });

  it('opens run detail when a kanban card is clicked', async () => {
    const onSelectRun = vi.fn();
    mockRunsList.mockResolvedValue(makeRunsResponse([makeRun('ok1', { status: 'success' }), makeRun('f1', { status: 'failed' })]));
    mockStatsGet.mockResolvedValue(makeStats({ totalRuns: 2, passRate: 50 }));

    renderWithProviders(<ProjectOverview onSelectRun={onSelectRun} />);

    await waitFor(() => {
      expect(screen.getAllByText(/owner\/repo#1/).length).toBeGreaterThan(0);
    });
    await userEvent.click(firstRepoRef());

    expect(onSelectRun).toHaveBeenCalledTimes(1);
    expect(onSelectRun).toHaveBeenCalledWith(expect.objectContaining({ id: 'ok1' }));
  });

  it('opens the detail aside with the grouped list when the metric card is clicked', async () => {
    const onBrowseRuns = vi.fn();
    const runs = [
      makeRun('r1', { issueNumber: 10, issueTitle: 'Fix login bug' }),
      makeRun('r2', { issueNumber: 10, issueTitle: 'Fix login bug' }),
      makeRun('r3', { issueNumber: 11, issueTitle: 'Fix logout' }),
      makeRun('r4', { issueNumber: 12, issueTitle: 'Fix timeout' }),
    ];
    mockRunsList.mockResolvedValue(makeRunsResponse(runs));
    mockStatsGet.mockResolvedValue(makeStats({ totalRuns: 4, passRate: 80 }));

    renderWithProviders(<ProjectOverview onBrowseRuns={onBrowseRuns} />);

    await waitFor(() => {
      expect(screen.getAllByText('3').length).toBeGreaterThan(0);
    });
    await userEvent.click(screen.getByRole('button', { name: /issues created/i }));

    expect(onBrowseRuns).toHaveBeenCalledTimes(1);
    const [browsedRuns, titleKey] = onBrowseRuns.mock.calls[0] as [Run[], string, string];
    expect(browsedRuns).toHaveLength(3);
    expect(browsedRuns.map((r) => r.id).sort()).toEqual(['r1', 'r3', 'r4']);
    expect(titleKey).toBe('dashboard.issuesCreated');
  });

  it('free tier: create ticket opens usage review modal and submits on confirm', async () => {
    const failed = makeRun('f1', { status: 'failed', issueTitle: 'Login bug' });
    mockRunsList.mockResolvedValue(makeRunsResponse([failed]));
    mockStatsGet.mockResolvedValue(makeStats({ totalRuns: 1, passRate: 0, fixesUsedThisMonth: 4 }));

    renderWithProviders(<ProjectOverview />);

    await waitFor(() => {
      expect(screen.getAllByText(/owner\/repo#1/).length).toBeGreaterThan(0);
    });
    await userEvent.click(warningToggle());
    await userEvent.click(screen.getByRole('button', { name: /create ticket/i }));

    expect(screen.getByText(/usage review/i)).toBeInTheDocument();
    expect(screen.getAllByText('4/10').length).toBeGreaterThan(0);

    await userEvent.click(screen.getByRole('button', { name: /confirm & create/i }));

    await waitFor(() => {
      expect(mockTicketsCreate).toHaveBeenCalledTimes(1);
    });
    expect(mockTicketsCreate.mock.calls[0][0]).toMatchObject({
      repoOwner: 'owner',
      repoName: 'repo',
      issueTitle: 'Fix: Login bug',
      source: 'dashboard-warning',
    });
    expect(screen.getByText(/ticket created successfully/i)).toBeInTheDocument();
  });

  it('free tier at exhausted usage: creation is still allowed (fix budget gates dispatch server-side)', async () => {
    const failed = makeRun('f1', { status: 'failed', issueTitle: 'Login bug' });
    mockRunsList.mockResolvedValue(makeRunsResponse([failed]));
    mockStatsGet.mockResolvedValue(makeStats({ totalRuns: 1, passRate: 0, fixesUsedThisMonth: 10 }));
    mockTicketsCreate.mockResolvedValue({ runId: 'ticket-abc', status: 'accepted' });

    renderWithProviders(<ProjectOverview />);

    await waitFor(() => {
      expect(screen.getAllByText(/owner\/repo#1/).length).toBeGreaterThan(0);
    });
    await userEvent.click(warningToggle());
    await userEvent.click(screen.getByRole('button', { name: /create ticket/i }));

    // Usage review is informational; creation is never blocked client-side.
    expect(screen.getByText(/usage review/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /confirm & create/i }));
    expect(mockTicketsCreate).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/ticket created successfully/i)).toBeInTheDocument();
  });

  it('team tier: shows auto-create note and no manual create button', async () => {
    mockUseAuth.mockReturnValue({ user: { plan: 'team' } });
    mockBillingPlan.mockResolvedValue(makePlan({ id: 'team', name: 'Team', monthlyFixLimit: 999_999 }));
    const failed = makeRun('f1', { status: 'failed', errorMessage: 'boom' });
    mockRunsList.mockResolvedValue(makeRunsResponse([failed]));
    mockStatsGet.mockResolvedValue(makeStats({ totalRuns: 1, passRate: 0 }));

    renderWithProviders(<ProjectOverview />);

    await waitFor(() => {
      expect(screen.getAllByText(/owner\/repo#1/).length).toBeGreaterThan(0);
    });
    await userEvent.click(warningToggle());

    expect(screen.getByText(/ticket auto-created/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /create ticket/i })).not.toBeInTheDocument();
  });

  it('team tier: auto-submits a ticket for newly detected failures on poll', async () => {
    vi.useFakeTimers();
    mockUseAuth.mockReturnValue({ user: { plan: 'team' } });
    mockBillingPlan.mockResolvedValue(makePlan({ id: 'team', name: 'Team', monthlyFixLimit: 999_999 }));
    mockStatsGet.mockResolvedValue(makeStats({ totalRuns: 2, passRate: 50 }));
    mockRunsList
      .mockResolvedValueOnce(makeRunsResponse([makeRun('ok1', { status: 'success' })]))
      .mockResolvedValueOnce(makeRunsResponse([makeRun('ok1', { status: 'success' }), makeRun('f1', { status: 'failed' })]));

    renderWithProviders(<ProjectOverview />);
    await act(async () => {});
    expect(mockRunsList).toHaveBeenCalledTimes(1);
    expect(mockTicketsCreate).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(20_000);
    await act(async () => {});

    expect(mockRunsList).toHaveBeenCalledTimes(2);
    expect(mockTicketsCreate).toHaveBeenCalledTimes(1);
    expect(mockTicketsCreate.mock.calls[0][0]).toMatchObject({
      repoOwner: 'owner',
      repoName: 'repo',
    });
  });
});
