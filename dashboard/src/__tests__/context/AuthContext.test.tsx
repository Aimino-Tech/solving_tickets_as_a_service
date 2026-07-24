import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { auth, setToken, clearToken } from '@/api/client';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

vi.mock('@/api/client', () => ({
  auth: {
    register: vi.fn(),
    login: vi.fn(),
    me: vi.fn(),
    logout: vi.fn(),
    refresh: vi.fn(),
  },
  setToken: vi.fn(),
  clearToken: vi.fn(),
}));

function TestConsumer() {
  const { user, isAuthenticated, isLoading, login, register, logout } = useAuth();
  return (
    <div>
      <div data-testid="loading">{String(isLoading)}</div>
      <div data-testid="authenticated">{String(isAuthenticated)}</div>
      <div data-testid="email">{user?.email ?? 'null'}</div>
      <button data-testid="login-btn" onClick={() => login('test@test.com', 'password')}>
        Login
      </button>
      <button data-testid="register-btn" onClick={() => register('test@test.com', 'password', 'Test')}>
        Register
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
      id: 1, email: 'test@test.com', name: 'Test User', plan: 'free', createdAt: '2024-01-01',
    });

    renderWithProvider(<TestConsumer />);
    expect(screen.getByTestId('loading')).toHaveTextContent('true');
  });

  it('loads user when a valid token exists', async () => {
    localStorage.setItem('stas_token', 'valid-token');
    (auth.me as any).mockResolvedValue({
      id: 1, email: 'test@test.com', name: 'Test User', plan: 'free', createdAt: '2024-01-01',
    });

    renderWithProvider(<TestConsumer />);

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });
    expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
    expect(screen.getByTestId('email')).toHaveTextContent('test@test.com');
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
    expect(screen.getByTestId('email')).toHaveTextContent('null');
    expect(auth.me).not.toHaveBeenCalled();
  });

  it('calls login and sets user on success', async () => {
    (auth.login as any).mockResolvedValue({
      token: 'new-token',
      refreshToken: 'refresh',
      user: { id: 1, email: 'test@test.com', name: 'Test User', plan: 'free' },
    });

    renderWithProvider(<TestConsumer />);

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });

    const user = userEvent.setup();
    await user.click(screen.getByTestId('login-btn'));

    await waitFor(() => {
      expect(auth.login).toHaveBeenCalledWith('test@test.com', 'password');
      expect(setToken).toHaveBeenCalledWith('new-token');
      expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
    });
  });

  it('calls logout and clears state when logout() is invoked', async () => {
    localStorage.setItem('stas_token', 'valid-token');
    (auth.me as any).mockResolvedValue({
      id: 1, email: 'test@test.com', name: 'Test User', plan: 'free', createdAt: '2024-01-01',
    });
    (auth.logout as any).mockResolvedValue({ message: 'Logged out' });

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

  it('throws error when useAuth is used outside provider', () => {
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
