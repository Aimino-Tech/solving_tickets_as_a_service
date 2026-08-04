import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { auth, clearToken, setRefreshToken, setToken } from '@/api/client';
import { AuthProvider, useAuth } from '@/context/AuthContext';

// Mock the API client
vi.mock('@/api/client', () => ({
  auth: {
    login: vi.fn(),
    register: vi.fn(),
    refresh: vi.fn(),
    me: vi.fn(),
    logout: vi.fn(),
    loginUrl: vi.fn(() => '/api/auth/github'),
  },
  setToken: vi.fn(),
  setRefreshToken: vi.fn(),
  clearToken: vi.fn(),
  default: {},
}));

function TestConsumer() {
  const { user, isAuthenticated, isLoading, login, logout } = useAuth();
  return (
    <div>
      <div data-testid="loading">{String(isLoading)}</div>
      <div data-testid="authenticated">{String(isAuthenticated)}</div>
      <div data-testid="username">{user?.username ?? 'null'}</div>
      <button data-testid="login-btn" onClick={() => login('test@test.com', 'password')}>
        Login
      </button>
      <button data-testid="logout-btn" onClick={logout}>
        Logout
      </button>
    </div>
  );
}

function renderWithProvider(ui: ReactNode) {
  return render(
    <MemoryRouter>
      <AuthProvider>{ui}</AuthProvider>
    </MemoryRouter>,
  );
}

describe('AuthContext', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('starts in loading state when token exists in localStorage', () => {
    localStorage.setItem('syntaro_token', 'existing-token');
    (auth.me as any).mockResolvedValue({
      id: '1',
      email: 'test@test.com',
      name: 'testuser',
      username: 'testuser',
      avatarUrl: '',
      createdAt: '2024-01-01',
    });

    renderWithProvider(<TestConsumer />);
    expect(screen.getByTestId('loading')).toHaveTextContent('true');
  });

  it('loads user when a valid token exists', async () => {
    localStorage.setItem('syntaro_token', 'valid-token');
    (auth.me as any).mockResolvedValue({
      id: '1',
      email: 'test@test.com',
      name: 'testuser',
      username: 'testuser',
      avatarUrl: 'https://example.com/avatar.png',
      createdAt: '2024-01-01',
    });

    renderWithProvider(<TestConsumer />);

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });
    expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
    expect(screen.getByTestId('username')).toHaveTextContent('testuser');
  });

  it('clears token and remains unauthenticated when /me fails', async () => {
    localStorage.setItem('syntaro_token', 'invalid-token');
    (auth.me as any).mockRejectedValue(new Error('Unauthorized'));

    renderWithProvider(<TestConsumer />);

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });
    expect(screen.getByTestId('authenticated')).toHaveTextContent('false');
    expect(clearToken).toHaveBeenCalled();
  });

  it('remains unauthenticated when no token exists', async () => {
    renderWithProvider(<TestConsumer />);

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });
    expect(screen.getByTestId('authenticated')).toHaveTextContent('false');
    expect(screen.getByTestId('username')).toHaveTextContent('null');
    expect(auth.me).not.toHaveBeenCalled();
  });

  it('logs in with email and password', async () => {
    (auth.login as any).mockResolvedValue({
      token: 'new-token',
      refreshToken: 'new-refresh',
      user: { id: '3', email: 'test@test.com', name: 'TestUser', createdAt: '2024-01-01' },
    });

    renderWithProvider(<TestConsumer />);
    const user = userEvent.setup();

    await user.click(screen.getByTestId('login-btn'));

    await waitFor(() => {
      expect(auth.login).toHaveBeenCalledWith('test@test.com', 'password');
    });
    expect(setToken).toHaveBeenCalledWith('new-token');
    await waitFor(() => {
      expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
    });
    expect(screen.getByTestId('username')).toHaveTextContent('TestUser');
  });

  it('calls logout and clears state when logout() is invoked', async () => {
    localStorage.setItem('syntaro_token', 'valid-token');
    (auth.me as any).mockResolvedValue({
      id: '1',
      email: 'test@test.com',
      name: 'testuser',
      username: 'testuser',
      avatarUrl: '',
      createdAt: '2024-01-01',
    });
    (auth.logout as any).mockResolvedValue({ success: true });

    renderWithProvider(<TestConsumer />);

    await waitFor(() => {
      expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
    });

    const user = userEvent.setup();
    await user.click(screen.getByTestId('logout-btn'));

    await waitFor(() => {
      expect(auth.logout).toHaveBeenCalled();
      expect(clearToken).toHaveBeenCalled();
      expect(screen.getByTestId('authenticated')).toHaveTextContent('false');
    });
  });

  it('handles token from URL search params', async () => {
    // Mock URL with token
    const originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      value: { ...originalLocation, search: '?token=url-token-123' },
      writable: true,
    });

    // Make setToken actually store the token so localStorage flow works
    (setToken as any).mockImplementation((token: string) => {
      localStorage.setItem('syntaro_token', token);
    });

    (auth.me as any).mockResolvedValue({
      id: '2',
      email: 'url@test.com',
      name: 'urluser',
      username: 'urluser',
      avatarUrl: '',
      createdAt: '2024-01-01',
    });

    renderWithProvider(<TestConsumer />);

    await waitFor(() => {
      expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
    });
    expect(screen.getByTestId('username')).toHaveTextContent('urluser');
  });

  it('stores refreshToken from URL search params (OAuth callback)', async () => {
    const originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      value: { ...originalLocation, search: '?token=url-token-123&refreshToken=url-refresh-456' },
      writable: true,
    });

    (setToken as any).mockImplementation((token: string) => {
      localStorage.setItem('syntaro_token', token);
    });
    (setRefreshToken as any).mockImplementation((token: string) => {
      localStorage.setItem('syntaro_refresh_token', token);
    });
    (auth.me as any).mockResolvedValue({
      id: '2',
      email: 'url@test.com',
      name: 'urluser',
      username: 'urluser',
      avatarUrl: '',
      createdAt: '2024-01-01',
    });

    renderWithProvider(<TestConsumer />);

    await waitFor(() => {
      expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
    });
    expect(localStorage.getItem('syntaro_token')).toBe('url-token-123');
    expect(localStorage.getItem('syntaro_refresh_token')).toBe('url-refresh-456');
  });

  it('throws error when useAuth is used outside provider', () => {
    // Suppress console.error for expected error
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() =>
      render(
        <MemoryRouter>
          <TestConsumer />
        </MemoryRouter>,
      ),
    ).toThrow('useAuth must be used within an AuthProvider');

    spy.mockRestore();
  });
});
