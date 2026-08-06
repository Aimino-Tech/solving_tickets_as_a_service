import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/__tests__/test-utils';
import RunsHistory from '@/pages/RunsHistory';
import type { Run } from '@/api/types';

const mockRunsList = vi.hoisted(() => vi.fn());
const mockBillingPlan = vi.hoisted(() => vi.fn());
const mockStatsGet = vi.hoisted(() => vi.fn());
const mockTicketsCreate = vi.hoisted(() => vi.fn());
const mockTicketsList = vi.hoisted(() => vi.fn());

vi.mock('@/api/client', () => ({
  runs: { list: mockRunsList },
  billing: { plan: mockBillingPlan },
  stats: { get: mockStatsGet },
  tickets: { create: mockTicketsCreate, list: mockTicketsList },
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { plan: 'free' } }),
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

function makeRunsResponse(data: Run[]) {
  return {
    data,
    total: data.length,
    page: 1,
    perPage: 100,
    totalPages: 1,
  };
}

describe('RunsHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunsList.mockResolvedValue(makeRunsResponse([]));
    mockBillingPlan.mockResolvedValue({ id: 'free', name: 'Free', monthlyFixLimit: 10 });
    mockTicketsList.mockResolvedValue({ tickets: [] });
    mockStatsGet.mockResolvedValue({
      totalRuns: 0,
      passRate: 0,
      avgDurationSeconds: 0,
      activeRepos: 0,
      runsByDay: [],
      costByDay: [],
      fixRateByWeek: [],
    });
    mockTicketsCreate.mockResolvedValue({ runId: 'ticket-1', status: 'accepted' });
  });

  it('renders the project overview (plan tier + kanban columns)', async () => {
    mockRunsList.mockResolvedValue(makeRunsResponse([makeRun('r1', { status: 'running' })]));

    renderWithProviders(<RunsHistory />);

    await waitFor(() => {
      expect(screen.getAllByText('Free').length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText('Pending').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Done / Verified').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Failed').length).toBeGreaterThan(0);
  });

  it('opens the detail aside when a kanban card is clicked', async () => {
    mockRunsList.mockResolvedValue(makeRunsResponse([makeRun('r1', { issueTitle: 'Fix login bug', costCents: 250 })]));

    renderWithProviders(<RunsHistory />);

    await waitFor(() => {
      expect(screen.getAllByText(/owner\/repo#1/).length).toBeGreaterThan(0);
    });
    await userEvent.click(screen.getAllByText(/owner\/repo#1/)[0]);

    expect(screen.getAllByText(/Was this fix helpful\?/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Fix login bug/).length).toBeGreaterThan(0);
  });

  it('opens the aside with a grouped list from a metric card, then run detail on click', async () => {
    mockRunsList.mockResolvedValue(
      makeRunsResponse([
        makeRun('r1', { issueNumber: 10, issueTitle: 'Fix login bug' }),
        makeRun('r2', { issueNumber: 11, issueTitle: 'Fix logout' }),
      ]),
    );
    mockStatsGet.mockResolvedValue({
      totalRuns: 2,
      passRate: 80,
      avgDurationSeconds: 120,
      activeRepos: 1,
      runsByDay: [],
      costByDay: [],
      fixRateByWeek: [],
    });

    renderWithProviders(<RunsHistory />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /issues created/i })).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole('button', { name: /issues created/i }));

    expect(screen.getByText(/distinct issues tracked/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Fix login bug/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Fix logout/).length).toBeGreaterThan(0);

    await userEvent.click(screen.getAllByText(/Fix login bug/)[0]);
    expect(screen.getAllByText(/Was this fix helpful\?/).length).toBeGreaterThan(0);
  });

  it('closes the detail aside on Escape', async () => {
    mockRunsList.mockResolvedValue(makeRunsResponse([makeRun('r1')]));

    renderWithProviders(<RunsHistory />);

    await waitFor(() => {
      expect(screen.getAllByText(/owner\/repo#1/).length).toBeGreaterThan(0);
    });
    await userEvent.click(screen.getAllByText(/owner\/repo#1/)[0]);
    expect(screen.getAllByText(/Was this fix helpful\?/).length).toBeGreaterThan(0);

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByText(/Was this fix helpful\?/)).not.toBeInTheDocument();
  });
});
