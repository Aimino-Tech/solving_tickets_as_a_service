import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/__tests__/test-utils';
import type { Run } from '@/api/types';
import RunsHistory from '@/pages/RunsHistory';

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

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

  it('navigates to the issues tab when the issues metric card is clicked, then to run detail', async () => {
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

    renderWithProviders(
      <>
        <RunsHistory />
        <LocationProbe />
      </>,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /issues created/i })).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole('button', { name: /issues created/i }));

    await waitFor(() => {
      expect(screen.getByText(/distinct issues tracked/i)).toBeInTheDocument();
    });
    expect(screen.getAllByText(/Fix login bug/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Fix logout/).length).toBeGreaterThan(0);

    await userEvent.click(screen.getAllByText(/Fix login bug/)[0]);
    expect(screen.getByTestId('location')).toHaveTextContent('/runs/r1');
  });

  it('renders the issues, pending and done tabs from the tab bar', async () => {
    mockRunsList.mockResolvedValue(
      makeRunsResponse([
        makeRun('r1', { status: 'running' }),
        makeRun('r2', { status: 'success' }),
        makeRun('r3', { status: 'failed' }),
      ]),
    );

    renderWithProviders(<RunsHistory />, { initialEntries: ['/runs?tab=issues'] });

    await waitFor(() => {
      expect(screen.getByText(/distinct issues tracked/i)).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: 'Pending 1' }));
    await waitFor(() => {
      expect(screen.getByText(/fix runs waiting or in progress/i)).toBeInTheDocument();
    });
    expect(screen.getAllByText(/owner\/repo#1/).length).toBeGreaterThan(0);

    await userEvent.click(screen.getByRole('button', { name: 'Done 1' }));
    await waitFor(() => {
      expect(screen.getByText(/fix runs completed and verified/i)).toBeInTheDocument();
    });
    expect(screen.getAllByText(/owner\/repo#1/).length).toBeGreaterThan(0);
  });

  it('renders the evaluation tab with the project evaluation', async () => {
    mockRunsList.mockResolvedValue(makeRunsResponse([makeRun('r1', { status: 'failed' })]));
    mockStatsGet.mockResolvedValue({
      totalRuns: 1,
      passRate: 0,
      avgDurationSeconds: 300,
      activeRepos: 1,
      runsByDay: [],
      costByDay: [],
      fixRateByWeek: [],
    });

    renderWithProviders(<RunsHistory />, { initialEntries: ['/runs?tab=evaluation'] });

    await waitFor(() => {
      expect(screen.getByText(/project health breakdown/i)).toBeInTheDocument();
    });
    expect(screen.getAllByText('Pass rate').length).toBeGreaterThan(0);
    expect(screen.getByText('owner/repo')).toBeInTheDocument();
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

  it('renders the bug tab when ?tab=bug is present', async () => {
    mockRunsList.mockResolvedValue(
      makeRunsResponse([makeRun('f1', { status: 'failed', issueTitle: 'Fix login', errorMessage: 'TypeError: x' })]),
    );

    renderWithProviders(<RunsHistory />, { initialEntries: ['/runs?tab=bug'] });

    await waitFor(() => {
      expect(screen.getByText(/Bug fix rate/)).toBeInTheDocument();
    });
    expect(screen.getAllByText(/Bugs detected/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/owner\/repo#1/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Critical').length).toBeGreaterThan(0);
  });

  it('renders the bug tab when ?status=failed is present', async () => {
    mockRunsList.mockResolvedValue(makeRunsResponse([makeRun('f1', { status: 'failed' })]));

    renderWithProviders(<RunsHistory />, { initialEntries: ['/runs?status=failed'] });

    await waitFor(() => {
      expect(screen.getByText(/Bug fix rate/)).toBeInTheDocument();
    });
  });

  it('switches between overview and bug tab via the tab bar', async () => {
    mockRunsList.mockResolvedValue(makeRunsResponse([makeRun('f1', { status: 'failed' })]));

    renderWithProviders(<RunsHistory />);

    await waitFor(() => {
      expect(screen.getAllByText('Failed').length).toBeGreaterThan(0);
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Bugs 1' })).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole('button', { name: 'Bugs 1' }));
    await waitFor(() => {
      expect(screen.getByText(/Bug fix rate/)).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: 'Overview' }));
    await waitFor(() => {
      expect(screen.getAllByText('Failed').length).toBeGreaterThan(0);
    });
  });
});
