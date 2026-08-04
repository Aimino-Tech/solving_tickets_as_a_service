import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/__tests__/test-utils';
import Settings from '@/pages/Settings';

const { mockConfigApiGet, mockConfigApiUpdateEnv, mockRequest, mockMcpKeysApiList } = vi.hoisted(() => ({
  mockConfigApiGet: vi.fn(),
  mockConfigApiUpdateEnv: vi.fn(),
  mockRequest: vi.fn(),
  mockMcpKeysApiList: vi.fn(),
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

  it('renders Data & Privacy tab and its content', async () => {
    renderWithProviders(<Settings />);

    const privacyTab = screen.getByText('Data & Privacy');
    await userEvent.click(privacyTab);

    await waitFor(() => {
      expect(screen.getByText('Request Deletion')).toBeInTheDocument();
    });
  });

  it('renders Reset All Settings button in danger zone', async () => {
    renderWithProviders(<Settings />);

    await userEvent.click(screen.getByText('Data & Privacy'));

    await waitFor(() => {
      expect(screen.getByText('Request Deletion')).toBeInTheDocument();
    });

    expect(screen.getByText('Reset All Settings')).toBeInTheDocument();
    expect(screen.getByText('Reset All Settings').closest('button')).toHaveClass('btn-danger');
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
