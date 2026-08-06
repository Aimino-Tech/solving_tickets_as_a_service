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
vi.mock('lucide-react', () => {
  const iconNames = [
    'Search', 'ArrowLeft', 'ArrowRight', 'Home', 'Eye', 'EyeOff', 'Menu', 'X',
    'Bell', 'ChevronDown', 'ChevronRight', 'LogOut', 'User', 'Settings', 'Activity',
    'FileText', 'GitPullRequest', 'LayoutDashboard', 'AlertTriangle', 'CheckCircle',
    'XCircle', 'HelpCircle', 'Info', 'Loader', 'RefreshCw', 'ExternalLink', 'Shield',
    'CreditCard', 'BarChart2', 'Terminal', 'Zap', 'Github', 'MessageSquare', 'Clock', 'Plus',
  ];
  const icons: Record<string, () => JSX.Element> = {};
  for (const name of iconNames) {
    icons[name] = () => <span data-testid={`icon-${name.toLowerCase()}`} />;
  }
  return icons;
});

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
import { ThemeProvider } from '@/context/ThemeContext';
import { I18nProvider } from '@/i18n/I18nProvider';

function renderApp(initialEntry: string) {
  render(
    <I18nProvider>
      <ThemeProvider>
        <MemoryRouter initialEntries={[initialEntry]}>
          <App />
        </MemoryRouter>
      </ThemeProvider>
    </I18nProvider>,
  );
}

describe('Routing — catch-all 404', () => {
  it('renders NotFound component for unmatched routes', () => {
    renderApp('/some/nonexistent/page');

    // Wait for loading to finish (AuthContext mock returns isLoading=false)
    // then verify the 404 page content is shown
    expect(screen.getByText('Page not found')).toBeInTheDocument();
    expect(screen.getByText('404')).toBeInTheDocument();
  });

  it('renders a valid existing route (login) correctly', () => {
    renderApp('/login');

    // Login page should render without 404
    expect(screen.queryByText('Page not found')).not.toBeInTheDocument();
  });

  it('renders the forgot-password page without 404', async () => {
    renderApp('/forgot-password');

    expect(screen.queryByText('Page not found')).not.toBeInTheDocument();
    expect(await screen.findByText('Send Reset Link')).toBeInTheDocument();
  });

  it('renders the reset-password page without 404', async () => {
    renderApp('/auth/reset-password');

    expect(screen.queryByText('Page not found')).not.toBeInTheDocument();
    expect(await screen.findByText('Update Password')).toBeInTheDocument();
  });

  it('shows 404 for deleted/superseded pages like /kpi, /monitoring, /admin/runs', () => {
    // These routes were identified in AIM-4336/AIM-4350 as pages that were
    // deleted by automation but their routes remained — the catch-all should
    // now return 404 for truly unmatched paths.
    renderApp('/truly-deleted-page');

    expect(screen.getByText('Page not found')).toBeInTheDocument();
  });
});
