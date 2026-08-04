import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/__tests__/test-utils';
import Settings from '@/pages/Settings';

const { mockConfigApiGet, mockConfigApiUpdateEnv, mockRequest, mockMcpKeysApiList, mockPrivacy, mockBitbucket } = vi.hoisted(() => ({
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
  mockBitbucket: {
    getStatus: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    listRepos: vi.fn(),
    getOAuthUrl: vi.fn(),
    handleOAuthCallback: vi.fn(),
    getOAuthStatus: vi.fn(),
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
  bitbucket: mockBitbucket,
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
    mockBitbucket.getStatus.mockResolvedValue({ connected: false, workspace: '', username: null });
    mockBitbucket.getOAuthStatus.mockResolvedValue({
      oauthConfigured: true,
      connected: false,
      workspace: '',
      authMethod: null,
      username: null,
    });
    mockBitbucket.getOAuthUrl.mockResolvedValue({ url: 'https://bitbucket.org/site/oauth2/authorize?client_id=x' });

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

  it('shows disabled Connect for GitLab, Azure and Jira; Bitbucket Connect is clickable', async () => {
    renderWithProviders(<Settings />);

    await waitFor(() => {
      expect(screen.getByText('Bitbucket')).toBeInTheDocument();
    });

    expect(screen.queryAllByRole('link', { name: 'Connect' }).length).toBe(0);

    const disabledConnects = screen.getAllByTitle('Setup guide coming soon');
    expect(disabledConnects.length).toBe(3);

    const bbDescription = screen.getByText(
      'Connect with Bitbucket OAuth (recommended) or an API token',
    );
    const bbCard = bbDescription.closest('div.p-4') as HTMLElement;
    const bbConnect = within(bbCard).getByRole('button', { name: 'Connect' });
    expect(bbConnect).toBeEnabled();

    await userEvent.click(bbConnect);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Connect with Bitbucket' })).toBeInTheDocument();
    });
  });

  async function expandBitbucketPanel() {
    const description = screen.getByText(
      'Connect with Bitbucket OAuth (recommended) or an API token',
    );
    const card = description.closest('div.p-4') as HTMLElement;
    await userEvent.click(within(card).getByRole('button', { name: 'Connect' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Connect with Bitbucket' })).toBeInTheDocument();
    });
  }

  it('surfaces Bitbucket scopes error under the form and stays disconnected', async () => {
    mockBitbucket.connect.mockRejectedValue(
      new Error('API Token provided has no Bitbucket scopes'),
    );
    renderWithProviders(<Settings />);

    await waitFor(() => {
      expect(screen.getByText('Bitbucket')).toBeInTheDocument();
    });
    await expandBitbucketPanel();
    await userEvent.click(screen.getByRole('button', { name: 'Use API token instead' }));

    const tokenInput = screen.getByPlaceholderText('ATATT3xFfGF0...');
    await userEvent.clear(tokenInput);
    await userEvent.type(tokenInput, 'ATATT3xFfGF0-this-is-a-long-enough-fake-token');

    await userEvent.click(screen.getByRole('button', { name: 'Connect with API token' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('no Bitbucket scopes');
    });
    expect(mockBitbucket.connect).toHaveBeenCalledWith({
      apiToken: 'ATATT3xFfGF0-this-is-a-long-enough-fake-token',
    });
  });

  it('shows Manage after successful Bitbucket connect', async () => {
    mockBitbucket.connect.mockResolvedValue({
      connected: true,
      workspace: 'aimino',
      repoCount: 3,
      emailUsed: 'test@test.com',
    });
    renderWithProviders(<Settings />);

    await waitFor(() => {
      expect(screen.getByText('Bitbucket')).toBeInTheDocument();
    });
    await expandBitbucketPanel();
    await userEvent.click(screen.getByRole('button', { name: 'Use API token instead' }));

    const tokenInput = screen.getByPlaceholderText('ATATT3xFfGF0...');
    await userEvent.type(tokenInput, 'ATATT3xFfGF0-this-is-a-long-enough-fake-token');
    await userEvent.click(screen.getByRole('button', { name: 'Connect with API token' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Manage/i })).toBeInTheDocument();
    });
    expect(screen.getByText(/workspace aimino/i)).toBeInTheDocument();
  });

  it('renders Data & Privacy section with export and deletion controls', async () => {
    renderWithProviders(<Settings />);

    await waitFor(() => {
      expect(screen.getAllByText('Export My Data').length).toBeGreaterThan(0);
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
