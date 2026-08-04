import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils';
import Incidents from '@/pages/Incidents';
import type { Incident, IncidentListResponse } from '@/api/types';

const mockList = vi.hoisted(() => vi.fn());
const mockCatalogList = vi.hoisted(() => vi.fn());
vi.mock('@/api/client', () => ({
  incidents: {
    list: mockList,
    get: vi.fn(),
    serviceCatalog: { list: mockCatalogList, create: vi.fn(), update: vi.fn(), remove: vi.fn() },
  },
}));

function makeIncident(id: string, overrides?: Partial<Incident>): Incident {
  return {
    fingerprint: id,
    service: 'payments-api',
    title: `Incident ${id}`,
    severity: 1,
    severityLabel: 'SEV1',
    labels: [],
    status: 'active',
    difficulty: 1,
    variant: 'low',
    repos: [],
    prs: [],
    firstSeenAt: '2026-08-01T10:00:00Z',
    dispatchedAt: '2026-08-01T10:05:00Z',
    ...overrides,
  };
}

function makeResponse(data: Incident[], overrides?: Record<string, unknown>): IncidentListResponse {
  return {
    data,
    total: data.length,
    page: 1,
    perPage: 20,
    totalPages: 1,
    stats: { active: data.filter((i) => i.status === 'active').length, resolved: 0, total: data.length, mttrSeconds: null, bySeverity: { SEV1: 0, SEV2: 0, SEV3: 0 } },
    source: 'opensymphony',
    ...overrides,
  };
}

describe('Incidents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockList.mockResolvedValue(makeResponse([]));
    mockCatalogList.mockResolvedValue({ data: [] });
  });

  it('renders the incidents table with data', async () => {
    mockList.mockResolvedValue(makeResponse([makeIncident('fp-1', { title: 'Checkout 500s' })]));

    renderWithProviders(<Incidents />, { initialEntries: ['/?tab=incidents'] });

    await waitFor(() => {
      expect(screen.getAllByText(/checkout 500s/i).length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText('SEV1').length).toBeGreaterThan(0);
    expect(screen.getAllByText('active').length).toBeGreaterThan(0);
    expect(screen.getByText('payments-api')).toBeInTheDocument();
  });

  it('shows empty state when no incidents', async () => {
    renderWithProviders(<Incidents />, { initialEntries: ['/?tab=incidents'] });

    await waitFor(() => {
      expect(screen.getAllByText(/no incidents found/i).length).toBeGreaterThan(0);
    });
  });

  it('shows error state', async () => {
    mockList.mockRejectedValue(new Error('Failed to load incidents'));

    renderWithProviders(<Incidents />, { initialEntries: ['/?tab=incidents'] });

    await waitFor(() => {
      expect(screen.getAllByText(/failed to load incidents/i).length).toBeGreaterThan(0);
    });
  });

  it('renders status and severity filter selectors', async () => {
    mockList.mockResolvedValue(makeResponse([makeIncident('fp-1')]));

    renderWithProviders(<Incidents />, { initialEntries: ['/?tab=incidents'] });

    await waitFor(() => {
      expect(screen.getAllByRole('combobox').length).toBeGreaterThanOrEqual(2);
    });
  });

  it('switches to service catalog tab', async () => {
    mockCatalogList.mockResolvedValue({
      data: [{ id: 1, name: 'payments-api', repos: ['owner/repo'], purpose: null, runbook: null, providers: [] }],
    });

    renderWithProviders(<Incidents />, { initialEntries: ['/?tab=catalog'] });

    await waitFor(() => {
      expect(screen.getByText('payments-api')).toBeInTheDocument();
    });
  });
});
