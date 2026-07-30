import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/__tests__/test-utils';
import RunsHistory from '@/pages/RunsHistory';
import type { Run } from '@/api/types';

const mockRunsList = vi.hoisted(() => vi.fn());
vi.mock('@/api/client', () => ({
  runs: { list: mockRunsList },
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
    perPage: 20,
    totalPages: 1,
    ...overrides,
  };
}

describe('RunsHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunsList.mockResolvedValue(makeRunsResponse([]));
  });

  it('renders runs table with data', async () => {
    const runs = [makeRun('run-1', { issueTitle: 'Fix login bug' })];
    mockRunsList.mockResolvedValue(makeRunsResponse(runs));

    renderWithProviders(<RunsHistory />);

    await waitFor(() => {
      expect(screen.getAllByText(/owner\/repo#1/i).length).toBeGreaterThan(0);
    });

    // Issue title appears in both desktop table and mobile card view
    expect(screen.getAllByText(/Fix login bug/i).length).toBeGreaterThan(0);
  });

  it('displays correct status badge for each status', async () => {
    const runs: Run[] = [
      makeRun('r1', { status: 'success' }),
      makeRun('r2', { status: 'failed' }),
      makeRun('r3', { status: 'running' }),
      makeRun('r4', { status: 'queued' }),
      makeRun('r5', { status: 'cancelled' }),
    ];
    mockRunsList.mockResolvedValue(makeRunsResponse(runs, { total: 5 }));

    renderWithProviders(<RunsHistory />);

    await waitFor(() => {
      expect(screen.getAllByText('success').length).toBeGreaterThan(0);
      expect(screen.getAllByText('failed').length).toBeGreaterThan(0);
      expect(screen.getAllByText('running').length).toBeGreaterThan(0);
      expect(screen.getAllByText('queued').length).toBeGreaterThan(0);
      expect(screen.getAllByText('cancelled').length).toBeGreaterThan(0);
    });
  });

  it('shows pagination controls when multiple pages exist', async () => {
    const runs = Array.from({ length: 20 }, (_, i) => makeRun(`r${i}`));
    mockRunsList.mockResolvedValue(makeRunsResponse(runs, { page: 1, totalPages: 3, total: 45 }));

    renderWithProviders(<RunsHistory />);

    await waitFor(() => {
      expect(screen.getByText(/page 1 of 3/i)).toBeInTheDocument();
    });

    expect(screen.getByText('Previous')).toBeDisabled();
    expect(screen.getByText('Next')).not.toBeDisabled();
  });

  it('disables Previous button on page 1', async () => {
    const runs = Array.from({ length: 20 }, (_, i) => makeRun(`r${i}`));
    mockRunsList.mockResolvedValue(makeRunsResponse(runs, { page: 1, totalPages: 2, total: 25 }));

    renderWithProviders(<RunsHistory />);

    await waitFor(() => {
      expect(screen.getByText('Previous')).toBeDisabled();
    });
  });

  it('shows empty state when no runs', async () => {
    mockRunsList.mockResolvedValue(makeRunsResponse([]));

    renderWithProviders(<RunsHistory />);

    await waitFor(() => {
      expect(screen.getAllByText(/no runs found/i).length).toBeGreaterThan(0);
    });
  });

  it('shows error state with error message', async () => {
    mockRunsList.mockRejectedValue(new Error('Failed to fetch runs'));

    renderWithProviders(<RunsHistory />);

    await waitFor(() => {
      expect(screen.getAllByText(/failed to fetch runs/i).length).toBeGreaterThan(0);
    });
  });

  it('shows status filter dropdown with all options', async () => {
    const runs = [makeRun('r1')];
    mockRunsList.mockResolvedValue(makeRunsResponse(runs));

    renderWithProviders(<RunsHistory />);

    await waitFor(() => {
      expect(screen.getAllByText('owner/repo#1').length).toBeGreaterThan(0);
    });

    expect(screen.getByRole('combobox')).toBeInTheDocument();
    const options = screen.getAllByRole('option');
    const optionTexts = options.map((o) => o.textContent);
    expect(optionTexts).toEqual(['All', 'Running', 'Success', 'Failed', 'Queued', 'Cancelled']);
  });

  it('shows repo filter input', async () => {
    const runs = [makeRun('r1')];
    mockRunsList.mockResolvedValue(makeRunsResponse(runs));

    renderWithProviders(<RunsHistory />);

    await waitFor(() => {
      expect(screen.getAllByText('owner/repo#1').length).toBeGreaterThan(0);
    });

    expect(screen.getByPlaceholderText('owner/repo')).toBeInTheDocument();
  });

  it('shows Clear filters button when filters are active', async () => {
    const runs = [makeRun('r1')];
    mockRunsList.mockResolvedValue(makeRunsResponse(runs));

    renderWithProviders(<RunsHistory />, { initialEntries: ['/?status=running'] });

    await waitFor(() => {
      expect(screen.getByText(/clear filters/i)).toBeInTheDocument();
    });
  });

  it('calls runs.list with repo param when repo filter changes', async () => {
    mockRunsList.mockResolvedValue(makeRunsResponse([]));

    renderWithProviders(<RunsHistory />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('owner/repo')).toBeInTheDocument();
    });

    mockRunsList.mockClear();

    const repoInput = screen.getByPlaceholderText('owner/repo');
    await userEvent.type(repoInput, 'test');

    await waitFor(() => {
      // After typing, at least one call should have the repo param
      const calls = mockRunsList.mock.calls.filter(
        ([params]: [any]) => params?.repo === 'test',
      );
      expect(calls.length).toBeGreaterThan(0);
    });
  });

  it('renders mobile card view with run data', async () => {
    const runs = [makeRun('mobile-1', { durationSeconds: 90, costCents: 250 })];
    mockRunsList.mockResolvedValue(makeRunsResponse(runs));

    renderWithProviders(<RunsHistory />);

    await waitFor(() => {
      expect(screen.getAllByText(/owner\/repo#1/i).length).toBeGreaterThan(0);
    });

    // Cost $2.50 from costCents=250 should be visible
    expect(screen.getAllByText(/\$2\.50/).length).toBeGreaterThan(0);
  });
});
