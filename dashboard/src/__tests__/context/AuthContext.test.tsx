import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { auth, setToken, clearToken } from '@/api/client';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

// Mock the API client
vi.mock('@/api/client', () => ({
  auth: {
    loginUrl: vi.fn(() => '/api/auth/github'),
    me: vi.fn(),
    logout: vi.fn(),
  },
  setToken: vi.fn(),
  clearToken: vi.fn(),
}));

function TestConsumer() {
  const { user, isAuthenticated, isLoading, login, logout } = useAuth();
  return (
    <div>
      <div data-testid="loading">{String(isLoading)}</div>
      <div data-testid="authenticated">{String(isAuthenticated)}</div>
      <div data-testid="username">{user?.username ?? 'null'}</div>
      <button data-testid="login-btn" onClick={login}>
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
    localStorage.setItem('stas_token', 'existing-token');
    (auth.me as any).mockResolvedValue({
      user: { githubId: '123', username: 'testuser', avatarUrl: '' },
    });

    renderWithProvider(<TestConsumer />);
    expect(screen.getByTestId('loading')).toHaveTextContent('true');
  });

  it('loads user when a valid token exists', async () => {
    localStorage.setItem('stas_token', 'valid-token');
    (auth.me as any).mockResolvedValue({
      user: { githubId: '123', username: 'testuser', avatarUrl: 'https://example.com/avatar.png' },
    });

    renderWithProvider(<TestConsumer />);

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });
    expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
    expect(screen.getByTestId('username')).toHaveTextContent('testuser');
  });

  it('clears token and remains unauthenticated when /me fails', async () => {
    localStorage.setItem('stas_token', 'invalid-token');
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

  it('redirects to GitHub login when login() is called', async () => {
    renderWithProvider(<TestConsumer />);
    const user = userEvent.setup();

    await user.click(screen.getByTestId('login-btn'));

    expect(auth.loginUrl).toHaveBeenCalled();
  });

  it('calls logout and clears state when logout() is invoked', async () => {
    localStorage.setItem('stas_token', 'valid-token');
    (auth.me as any).mockResolvedValue({
      user: { githubId: '123', username: 'testuser', avatarUrl: '' },
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

    (auth.me as any).mockResolvedValue({
      user: { githubId: '456', username: 'urluser', avatarUrl: '' },
    });

    renderWithProvider(<TestConsumer />);

    await waitFor(() => {
      expect(setToken).toHaveBeenCalledWith('url-token-123');
    });

    await waitFor(() => {
      expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
      expect(screen.getByTestId('username')).toHaveTextContent('urluser');
    });
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
