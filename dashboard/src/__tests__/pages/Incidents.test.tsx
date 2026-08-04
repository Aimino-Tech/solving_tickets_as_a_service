import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/__tests__/test-utils';
import Incidents from '@/pages/Incidents';
import type { Incident, IncidentStats } from '@/api/types';

const mockList = vi.hoisted(() => vi.fn());
const mockGetStats = vi.hoisted(() => vi.fn());
const mockNotify = vi.hoisted(() => vi.fn());

vi.mock('@/api/client', () => ({
  incidents: { list: mockList, getStats: mockGetStats },
}));

vi.mock('@/hooks/usePushNotifications', () => ({
  usePushNotifications: () => ({ notify: mockNotify }),
}));

function makeIncident(id: number, overrides?: Partial<Incident>): Incident {
  return {
    id,
    title: `Incident ${id}`,
    severity: 'SEV2',
    status: 'open',
    source: 'monitoring',
    confidence: 'high',
    summary: null,
    alertId: null,
    runId: null,
    autoFixed: false,
    policyDecision: null,
    resolvedAt: null,
    createdAt: '2026-08-01T10:00:00Z',
    updatedAt: '2026-08-01T10:00:00Z',
    ...overrides,
  };
}

function makeStats(overrides?: Partial<IncidentStats>): IncidentStats {
  return {
    total: 3,
    open: 1,
    investigating: 1,
    fixing: 0,
    resolved: 1,
    mttrMs: 3600000,
    bySeverity: [
      { severity: 'SEV1', count: 1 },
      { severity: 'SEV2', count: 2 },
    ],
    ...overrides,
  };
}

describe('Incidents page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetStats.mockResolvedValue(makeStats());
  });

  it('renders stats cards and incident rows', async () => {
    mockList.mockResolvedValue({ data: [makeIncident(1, { title: 'Checkout latency spike' })], total: 1, offset: 0 });
    renderWithProviders(<Incidents />);

    await waitFor(() => {
      expect(screen.getAllByText(/Checkout latency spike/i).length).toBeGreaterThan(0);
    });
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getAllByText('monitoring').length).toBeGreaterThan(0);
  });

  it('shows empty state when no incidents', async () => {
    mockList.mockResolvedValue({ data: [], total: 0, offset: 0 });
    renderWithProviders(<Incidents />);
    await waitFor(() => {
      expect(screen.getAllByText(/no incidents found/i).length).toBeGreaterThan(0);
    });
  });

  it('shows error state with message', async () => {
    mockList.mockRejectedValue(new Error('Failed to fetch incidents'));
    renderWithProviders(<Incidents />);
    await waitFor(() => {
      expect(screen.getAllByText(/failed to fetch incidents/i).length).toBeGreaterThan(0);
    });
  });

  it('shows severity/status/source filters and time range inputs', async () => {
    mockList.mockResolvedValue({ data: [makeIncident(1)], total: 1, offset: 0 });
    renderWithProviders(<Incidents />);
    await waitFor(() => {
      expect(screen.getAllByText(/Incident 1/i).length).toBeGreaterThan(0);
    });

    const combos = screen.getAllByRole('combobox');
    expect(combos.length).toBeGreaterThanOrEqual(3);
    const dateInputs = screen.getAllByDisplayValue('').filter(
      (el) => (el as HTMLInputElement).type === 'date',
    );
    expect(dateInputs.length).toBeGreaterThanOrEqual(2);
  });

  it('calls list with time range filters when date inputs change', async () => {
    mockList.mockResolvedValue({ data: [], total: 0, offset: 0 });
    renderWithProviders(<Incidents />);
    await waitFor(() => {
      expect(mockList).toHaveBeenCalled();
    });

    mockList.mockClear();
    const dateInputs = screen.getAllByDisplayValue('').filter(
      (el) => (el as HTMLInputElement).type === 'date',
    );
    await userEvent.type(dateInputs[0], '2026-08-01');

    await waitFor(() => {
      const calls = mockList.mock.calls.filter(([filters]: [any]) => filters?.from === '2026-08-01');
      expect(calls.length).toBeGreaterThan(0);
    });
  });

  it('shows Clear filters when a filter is active', async () => {
    mockList.mockResolvedValue({ data: [makeIncident(1)], total: 1, offset: 0 });
    renderWithProviders(<Incidents />, { initialEntries: ['/?severity=SEV1'] });
    await waitFor(() => {
      expect(screen.getByText(/clear filters/i)).toBeInTheDocument();
    });
  });

  it('fires a resolution notification when an open incident becomes resolved on poll', async () => {
    mockList
      .mockResolvedValueOnce({ data: [makeIncident(1, { status: 'open' })], total: 1, offset: 0 })
      .mockResolvedValueOnce({ data: [makeIncident(1, { status: 'resolved' })], total: 1, offset: 0 });
    mockGetStats
      .mockResolvedValueOnce(makeStats())
      .mockResolvedValueOnce(makeStats({ open: 0, resolved: 2 }));

    vi.useFakeTimers();
    try {
      renderWithProviders(<Incidents />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(mockList).toHaveBeenCalledTimes(1);
      expect(mockNotify).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      expect(mockList).toHaveBeenCalledTimes(2);
      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'alert',
          data: expect.objectContaining({ incidentId: 1 }),
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
