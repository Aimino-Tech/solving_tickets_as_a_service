import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';

// Mock the AuthContext so ProtectedRoute doesn't redirect
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    isAuthenticated: true,
    isLoading: false,
    user: { username: 'testuser', id: '1' },
    login: vi.fn(),
    logout: vi.fn(),
  }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  Search: () => <span data-testid="icon-search">Search</span>,
  ArrowLeft: () => <span data-testid="icon-arrow-left">ArrowLeft</span>,
  Home: () => <span data-testid="icon-home">Home</span>,
}));

// Mock the API client
vi.mock('@/api/client', () => ({
  auth: {
    login: vi.fn(),
    register: vi.fn(),
    refresh: vi.fn(),
    me: vi.fn(),
    logout: vi.fn(),
    loginUrl: vi.fn(),
    forgotPassword: vi.fn(),
    resetPassword: vi.fn(),
  },
  setToken: vi.fn(),
  clearToken: vi.fn(),
  default: {},
}));

import App from '@/App';

describe('Routing — catch-all 404', () => {
  it('renders NotFound component for unmatched routes', () => {
    render(
      <MemoryRouter initialEntries={['/some/nonexistent/page']}>
        <App />
      </MemoryRouter>,
    );

    // Wait for loading to finish (AuthContext mock returns isLoading=false)
    // then verify the 404 page content is shown
    expect(screen.getByText('Page not found')).toBeInTheDocument();
    expect(screen.getByText('404')).toBeInTheDocument();
  });

  it('renders a valid existing route (login) correctly', () => {
    render(
      <MemoryRouter initialEntries={['/login']}>
        <App />
      </MemoryRouter>,
    );

    // Login page should render without 404
    expect(screen.queryByText('Page not found')).not.toBeInTheDocument();
  });

  it('renders the forgot-password page without 404', async () => {
    render(
      <MemoryRouter initialEntries={['/forgot-password']}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.queryByText('Page not found')).not.toBeInTheDocument();
    expect(await screen.findByText('Send Reset Link')).toBeInTheDocument();
  });

  it('renders the reset-password page without 404', async () => {
    render(
      <MemoryRouter initialEntries={['/auth/reset-password']}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.queryByText('Page not found')).not.toBeInTheDocument();
    expect(await screen.findByText('Update Password')).toBeInTheDocument();
  });

  it('shows 404 for deleted/superseded pages like /kpi, /monitoring, /admin/runs', () => {
    // These routes were identified in AIM-4336/AIM-4350 as pages that were
    // deleted by automation but their routes remained — the catch-all should
    // now return 404 for truly unmatched paths.
    render(
      <MemoryRouter initialEntries={['/truly-deleted-page']}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByText('Page not found')).toBeInTheDocument();
  });
});
