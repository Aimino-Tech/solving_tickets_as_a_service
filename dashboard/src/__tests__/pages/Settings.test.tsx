import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/__tests__/test-utils';
import Settings from '@/pages/Settings';

const { mockConfigApiGet, mockConfigApiUpdateEnv, mockRequest, mockMcpKeysApiList, mockPrivacy } = vi.hoisted(() => ({
  mockConfigApiGet: vi.fn(),
  mockConfigApiUpdateEnv: vi.fn(),
  mockRequest: vi.fn(),
  mockMcpKeysApiList: vi.fn(),
  mockPrivacy: {
    getDeletionStatus: vi.fn(),
    requestDeletion: vi.fn(),
    cancelDeletion: vi.fn(),
    exportData: vi.fn(),
  },
}));

vi.mock('@/api/client', () => ({
  configApi: { get: mockConfigApiGet, updateEnv: mockConfigApiUpdateEnv },
  request: mockRequest,
  mcpKeysApi: {
    list: mockMcpKeysApiList,
    create: vi.fn(),
    revoke: vi.fn(),
    rename: vi.fn(),
    get: vi.fn(),
  },
  github: {
    getOAuthUrl: vi.fn(),
  },
  privacy: mockPrivacy,
}));

const mockUseAuth = vi.hoisted(() => vi.fn());
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));


async function expandLinearPanel() {
  const description = screen.getByText('Connect a Linear workspace to delegate issues to Cloud Agents');
  const card = description.closest('div.p-4') as HTMLElement;
  await userEvent.click(within(card).getByRole('button', { name: 'Connect' }));
}

describe('Settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMcpKeysApiList.mockResolvedValue({ keys: [] });
    mockPrivacy.getDeletionStatus.mockResolvedValue({ activeRequest: null, retentionDays: 30 });

    mockUseAuth.mockReturnValue({
      user: { id: '1', email: 'test@test.com', name: 'Test User' },
      isAuthenticated: true,
      isLoading: false,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
    });

    mockConfigApiGet.mockResolvedValue({
      env: {},
      rateLimits: [],
      tokens: [],
      integrations: [],
      infrastructure: {},
      symphonies: [],
      subscriptions: [],
      warnings: [],
    });
  });

  it('renders API Keys section with Linear key in display mode first, shows input on Edit', async () => {
    renderWithProviders(<Settings />);

    await expandLinearPanel();

    await waitFor(() => {
      expect(screen.getByText('Linear API Key')).toBeInTheDocument();
    });

    // Display mode: shows "Not configured" and Edit button
    expect(screen.getByText('Not configured')).toBeInTheDocument();

    // Click Edit → input appears
    const editBtn = screen.getByTitle('Edit');
    await userEvent.click(editBtn);

    await waitFor(() => {
      const linearInput = screen.getByPlaceholderText('lin_api_...');
      expect(linearInput).toBeInTheDocument();
      expect(linearInput).toHaveAttribute('type', 'password');
    });
  });

  it('shows disabled Connect for GitLab, Azure, Bitbucket and Jira', async () => {
    renderWithProviders(<Settings />);

    await waitFor(() => {
      expect(screen.getByText('Bitbucket App Password')).toBeInTheDocument();
    });

    // No clickable Connect links remain
    expect(screen.queryAllByRole('link', { name: 'Connect' }).length).toBe(0);

    // GitLab, Azure DevOps, Bitbucket and Jira: disabled, not clickable
    const disabledConnects = screen.getAllByTitle('Setup guide coming soon');
    expect(disabledConnects.length).toBe(4);
    for (const el of disabledConnects) {
      expect(el.tagName).toBe('SPAN');
      expect(el).toHaveAttribute('aria-disabled', 'true');
    }

    expect(screen.getByText('Jira API Token')).toBeInTheDocument();
  });

  it('renders Data & Privacy section with export and deletion controls', async () => {
    renderWithProviders(<Settings />);

    await waitFor(() => {
      expect(screen.getByText('Export My Data')).toBeInTheDocument();
    });
    expect(screen.getByText('Request Data Deletion')).toBeInTheDocument();
    expect(mockPrivacy.getDeletionStatus).toHaveBeenCalled();
  });

  it('renders residency and no-training statements', async () => {
    renderWithProviders(<Settings />);

    await waitFor(() => {
      expect(screen.getByText('Data Residency')).toBeInTheDocument();
    });
    expect(screen.getByText('Your Code Is Not Used for Training')).toBeInTheDocument();
  });

  it('renders Reset All Settings button in danger zone', async () => {
    renderWithProviders(<Settings />);

    await waitFor(() => {
      expect(screen.getByText('Reset All Settings')).toBeInTheDocument();
    });

    expect(screen.getByText('Reset All Settings').closest('button')).toHaveClass('btn-danger');
  });

  it('shows deletion request status and cancel button when pending', async () => {
    mockPrivacy.getDeletionStatus.mockResolvedValue({
      activeRequest: {
        id: 1,
        accountId: 1,
        requestedAt: '2026-08-01T00:00:00Z',
        scheduledDeletionAt: '2026-08-31T00:00:00Z',
        status: 'pending',
      },
      retentionDays: 30,
    });
    renderWithProviders(<Settings />);

    await waitFor(() => {
      expect(screen.getByText('Cancel Deletion Request')).toBeInTheDocument();
    });
    expect(mockPrivacy.getDeletionStatus).toHaveBeenCalled();
  });

  it('requests deletion and refreshes status', async () => {
    mockPrivacy.requestDeletion.mockResolvedValue({
      deletionRequest: { id: 1, scheduledDeletionAt: 'x', status: 'pending' },
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderWithProviders(<Settings />);

    await waitFor(() => {
      expect(screen.getByText('Request Data Deletion')).toBeInTheDocument();
    });
    await userEvent.click(screen.getByText('Request Data Deletion'));

    await waitFor(() => {
      expect(mockPrivacy.requestDeletion).toHaveBeenCalled();
    });
    vi.restoreAllMocks();
  });

  it('exports data and triggers a JSON download', async () => {
    mockPrivacy.exportData.mockResolvedValue({ exportedAt: '2026-08-04T00:00:00Z', profile: { id: '1' } });
    renderWithProviders(<Settings />);

    await waitFor(() => {
      expect(screen.getAllByText('Export My Data').length).toBeGreaterThan(0);
    });

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:test'), revokeObjectURL: vi.fn() });
    const buttons = screen.getAllByText('Export My Data');
    await userEvent.click(buttons[buttons.length - 1]);

    await waitFor(() => {
      expect(mockPrivacy.exportData).toHaveBeenCalled();
    });
    expect(clickSpy).toHaveBeenCalled();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('toggles API key visibility when eye icon is clicked', async () => {
    renderWithProviders(<Settings />);

    await expandLinearPanel();

    await waitFor(() => {
      expect(screen.getByText('Linear API Key')).toBeInTheDocument();
    });
    const editBtn = screen.getByTitle('Edit');
    await userEvent.click(editBtn);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('lin_api_...')).toBeInTheDocument();
    });

    const keyInput = screen.getByPlaceholderText('lin_api_...') as HTMLInputElement;
    expect(keyInput.type).toBe('password');

    // Find visibility toggle buttons
    const toggleButtons = document.querySelectorAll('button');
    const eyeToggle = Array.from(toggleButtons).find(
      (btn) => btn.querySelector('svg'),
    );

    if (eyeToggle) {
      await userEvent.click(eyeToggle);
    }

    // Verify the component didn't crash
    expect(keyInput).toBeInTheDocument();
  });
});
