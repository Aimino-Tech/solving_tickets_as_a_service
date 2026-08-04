import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils';
import IncidentDetail from '@/pages/IncidentDetail';
import type { Incident } from '@/api/types';

const mockGet = vi.hoisted(() => vi.fn());
vi.mock('@/api/client', () => ({
  incidents: { get: mockGet, list: vi.fn(), serviceCatalog: { list: vi.fn() } },
}));

function makeIncident(overrides?: Partial<Incident>): Incident {
  return {
    fingerprint: 'fp-1',
    service: 'payments-api',
    title: 'Checkout 500s',
    severity: 1,
    severityLabel: 'SEV1',
    labels: ['p1'],
    status: 'active',
    difficulty: 4,
    variant: 'max',
    repos: ['owner/repo'],
    prs: [{ repo: 'owner/repo', prUrl: 'https://github.com/owner/repo/pull/9' }],
    firstSeenAt: '2026-08-01T10:00:00Z',
    dispatchedAt: '2026-08-01T10:05:00Z',
    ...overrides,
  };
}

describe('IncidentDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders header, confidence gate and timeline', async () => {
    mockGet.mockResolvedValue({
      incident: makeIncident(),
      stats: { active: 2, resolved: 1, total: 3, mttrSeconds: null, bySeverity: { SEV1: 1, SEV2: 1, SEV3: 1 } },
    });

    renderWithProviders(<IncidentDetail />, { initialEntries: ['/incidents/fp-1'] });

    await waitFor(() => {
      expect(screen.getAllByText(/checkout 500s/i).length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText(/Tier 4/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/gate blocked/i)).toBeInTheDocument();
  });

  it('shows gate passed when difficulty is low', async () => {
    mockGet.mockResolvedValue({
      incident: makeIncident({ difficulty: 2, variant: 'medium', status: 'resolved' }),
      stats: { active: 0, resolved: 1, total: 1, mttrSeconds: 120, bySeverity: { SEV1: 1, SEV2: 0, SEV3: 0 } },
    });

    renderWithProviders(<IncidentDetail />, { initialEntries: ['/incidents/fp-1'] });

    await waitFor(() => {
      expect(screen.getAllByText(/gate passed/i).length).toBeGreaterThan(0);
    });
  });

  it('renders fix PRs with links', async () => {
    mockGet.mockResolvedValue({
      incident: makeIncident(),
      stats: { active: 1, resolved: 0, total: 1, mttrSeconds: null, bySeverity: { SEV1: 1, SEV2: 0, SEV3: 0 } },
    });

    renderWithProviders(<IncidentDetail />, { initialEntries: ['/incidents/fp-1'] });

    await waitFor(() => {
      expect(screen.getAllByText('owner/repo').length).toBeGreaterThan(0);
    });
    const link = screen.getByRole('link', { name: /view pr/i });
    expect(link).toHaveAttribute('href', 'https://github.com/owner/repo/pull/9');
  });

  it('shows error state', async () => {
    mockGet.mockRejectedValue(new Error('Failed to load incident'));

    renderWithProviders(<IncidentDetail />, { initialEntries: ['/incidents/fp-1'] });

    await waitFor(() => {
      expect(screen.getAllByText(/failed to load incident/i).length).toBeGreaterThan(0);
    });
  });
});
