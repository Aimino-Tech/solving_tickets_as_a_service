import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from '@/__tests__/test-utils';
import IncidentDetail from '@/pages/IncidentDetail';
import type { IncidentDetail as IncidentDetailType } from '@/api/types';

const mockGet = vi.hoisted(() => vi.fn());
const mockTransition = vi.hoisted(() => vi.fn());

vi.mock('@/api/client', () => ({
  incidents: { get: mockGet, transition: mockTransition },
}));

function makeDetail(overrides?: Partial<IncidentDetailType>): IncidentDetailType {
  return {
    id: 7,
    title: 'Auth service outage',
    severity: 'SEV1',
    status: 'investigating',
    source: 'monitoring',
    confidence: 'medium',
    summary: 'Increased 5xx rate on auth endpoints.',
    alertId: 'alert-42',
    runId: 'run-99',
    autoFixed: false,
    policyDecision: null,
    resolvedAt: null,
    createdAt: '2026-08-01T10:00:00Z',
    updatedAt: '2026-08-01T10:30:00Z',
    timeline: [
      { id: 1, incidentId: 7, event: 'alert', detail: 'Alert received from monitoring', createdAt: '2026-08-01T10:00:00Z' },
      { id: 2, incidentId: 7, event: 'status:investigating', detail: 'Status transitioned from open to investigating', createdAt: '2026-08-01T10:05:00Z' },
    ],
    repos: [
      { id: 1, incidentId: 7, repoOwner: 'acme', repoName: 'auth-svc', status: 'fixing', prUrl: 'https://github.com/acme/auth-svc/pull/12', branchName: 'fix/auth-outage', runId: 'run-99', createdAt: '2026-08-01T10:10:00Z', updatedAt: '2026-08-01T10:10:00Z' },
    ],
    ...overrides,
  };
}

function renderDetail() {
  return renderWithProviders(
    <Routes>
      <Route path="/incidents/:id" element={<IncidentDetail />} />
    </Routes>,
    { initialEntries: ['/incidents/7'] },
  );
}

describe('IncidentDetail page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders incident header, timeline and linked repos', async () => {
    mockGet.mockResolvedValue({ data: makeDetail() });
    renderDetail();

    await waitFor(() => {
      expect(screen.getByText('Auth service outage')).toBeInTheDocument();
    });
    expect(screen.getByText('SEV1')).toBeInTheDocument();
    expect(screen.getAllByText('investigating').length).toBeGreaterThan(0);
    // Timeline events
    expect(screen.getAllByText(/Alert received from monitoring/i).length).toBeGreaterThan(0);
    // Linked repo + PR
    expect(screen.getByText('acme/auth-svc')).toBeInTheDocument();
    expect(screen.getByText('View PR')).toBeInTheDocument();
  });

  it('shows the policy decision confidence gate', async () => {
    mockGet.mockResolvedValue({ data: makeDetail() });
    renderDetail();

    await waitFor(() => {
      expect(screen.getByText(/Policy decision/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/confidence medium/i)).toBeInTheDocument();
  });

  it('transitions status when a step button is clicked', async () => {
    mockGet.mockResolvedValue({ data: makeDetail() });
    mockTransition.mockResolvedValue({ data: { id: 7, status: 'fixing' } });
    renderDetail();

    await waitFor(() => {
      expect(screen.getByText('Auth service outage')).toBeInTheDocument();
    });

    await userEvent.click(screen.getAllByText(/Mark fixing/i)[0]);

    await waitFor(() => {
      expect(mockTransition).toHaveBeenCalledWith('7', 'fixing');
    });
  });

  it('shows error state when load fails', async () => {
    mockGet.mockRejectedValue(new Error('Failed to load incident'));
    renderDetail();

    await waitFor(() => {
      expect(screen.getAllByText(/failed to load incident/i).length).toBeGreaterThan(0);
    });
  });
});
