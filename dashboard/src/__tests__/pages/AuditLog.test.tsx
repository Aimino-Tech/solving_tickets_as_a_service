import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/__tests__/test-utils';
import AuditLog from '@/pages/AuditLog';

const mockAuditList = vi.hoisted(() => vi.fn());
vi.mock('@/api/client', () => ({
  audit: { list: mockAuditList },
}));

function makeEntry(id: string, overrides?: Record<string, unknown>) {
  return {
    id,
    action: 'run_completed',
    actor: 'bot',
    target: 'owner/repo',
    details: { fixId: id },
    createdAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeAuditResponse(entries: unknown[], overrides?: Record<string, unknown>) {
  return {
    data: entries,
    total: entries.length,
    page: 1,
    perPage: 30,
    totalPages: 1,
    ...overrides,
  };
}

describe('AuditLog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuditList.mockResolvedValue(makeAuditResponse([]));
  });

  it('shows empty state when no entries', async () => {
    mockAuditList.mockResolvedValue(makeAuditResponse([]));

    renderWithProviders(<AuditLog />);

    await waitFor(() => {
      expect(screen.getByText(/no audit entries yet/i)).toBeInTheDocument();
    });
  });

  it('shows total entries count text', async () => {
    const entries = [makeEntry('1'), makeEntry('2'), makeEntry('3')];
    mockAuditList.mockResolvedValue(makeAuditResponse(entries, { total: 3 }));

    renderWithProviders(<AuditLog />);

    await waitFor(() => {
      expect(screen.getByText(/3 total entries/i)).toBeInTheDocument();
    });
  });

  it('renders entries with action, actor, and timestamp', async () => {
    const entries = [
      makeEntry('1', { action: 'run_started', actor: 'test-user' }),
      makeEntry('2', { action: 'run_failed', actor: 'system' }),
    ];
    mockAuditList.mockResolvedValue(makeAuditResponse(entries, { total: 2 }));

    renderWithProviders(<AuditLog />);

    await waitFor(() => {
      expect(screen.getByText('Run Started')).toBeInTheDocument();
    });

    expect(screen.getByText('Run Failed')).toBeInTheDocument();
    expect(screen.getByText(/by test-user/i)).toBeInTheDocument();
    expect(screen.getByText(/by system/i)).toBeInTheDocument();
  });

  it('shows pagination when multiple pages exist', async () => {
    const entries = Array.from({ length: 30 }, (_, i) => makeEntry(`e${i}`));
    mockAuditList.mockResolvedValue(makeAuditResponse(entries, { page: 1, totalPages: 2, total: 45 }));

    renderWithProviders(<AuditLog />);

    await waitFor(() => {
      expect(screen.getByText(/page 1 of 2/i)).toBeInTheDocument();
    });

    expect(screen.getByText('Previous')).toBeDisabled();
    expect(screen.getByText('Next')).not.toBeDisabled();
  });

  it('hides pagination when only one page', async () => {
    const entries = [makeEntry('1')];
    mockAuditList.mockResolvedValue(makeAuditResponse(entries, { total: 1, totalPages: 1 }));

    renderWithProviders(<AuditLog />);

    await waitFor(() => {
      expect(screen.getByText(/1 total entries/i)).toBeInTheDocument();
    });

    expect(screen.queryByText(/page 1 of 1/i)).not.toBeInTheDocument();
  });

  it('shows error state with retry button', async () => {
    mockAuditList.mockRejectedValue(new Error('Failed to load audit log'));

    renderWithProviders(<AuditLog />);

    await waitFor(() => {
      expect(screen.getByText(/failed to load audit log/i)).toBeInTheDocument();
    });

    const retryButton = screen.getByText('Retry');
    expect(retryButton).toBeInTheDocument();
  });

  it('retry button re-calls audit.list', async () => {
    mockAuditList.mockRejectedValueOnce(new Error('First attempt failed'));
    mockAuditList.mockResolvedValueOnce(makeAuditResponse([makeEntry('1')], { total: 1 }));

    renderWithProviders(<AuditLog />);

    await waitFor(() => {
      expect(screen.getByText(/first attempt failed/i)).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText('Retry'));

    await waitFor(() => {
      expect(screen.getByText(/1 total entries/i)).toBeInTheDocument();
    });

    expect(mockAuditList).toHaveBeenCalledTimes(2);
  });

  it('renders entry target when present', async () => {
    const entries = [makeEntry('1', { target: 'Aimino-Tech/solving_tickets_as_a_service' })];
    mockAuditList.mockResolvedValue(makeAuditResponse(entries, { total: 1 }));

    renderWithProviders(<AuditLog />);

    await waitFor(() => {
      expect(screen.getByText('Aimino-Tech/solving_tickets_as_a_service')).toBeInTheDocument();
    });
  });

  it('renders all known action types with correct formatting', async () => {
    const actions = [
      'run_started', 'run_completed', 'run_failed',
      'repo_connected', 'repo_disconnected', 'settings_updated',
      'user_login', 'user_logout',
    ];
    const entries = actions.map((action, i) => makeEntry(`e${i}`, { action }));
    mockAuditList.mockResolvedValue(makeAuditResponse(entries, { total: actions.length }));

    renderWithProviders(<AuditLog />);

    for (const action of actions) {
      const formatted = action.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      await waitFor(() => {
        expect(screen.getByText(formatted)).toBeInTheDocument();
      });
    }
  });
});
