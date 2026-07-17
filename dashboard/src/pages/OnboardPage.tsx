import { useAuth } from '@/context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { auth } from '@/api/client';

const STEPS = [
  {
    number: 1,
    title: 'Connect with GitHub',
    description: 'Authorize STAS to access your repositories.',
    action: 'Connect',
  },
  {
    number: 2,
    title: 'Install the GitHub App',
    description: 'Install STAS on the repositories you want automated fixes for.',
    action: 'Install',
  },
  {
    number: 3,
    title: 'Label an issue',
    description: 'Add the label <code>stas:fix</code> to any issue. STAS will investigate, fix, and open a PR.',
    action: 'Label',
  },
];

export default function OnboardPage() {
  const { user, isAuthenticated, isLoading, login } = useAuth();
  const navigate = useNavigate();
  const [connecting, setConnecting] = useState(false);

  // If already authenticated, redirect to dashboard
  useEffect(() => {
    if (!isLoading && isAuthenticated && user) {
      navigate('/', { replace: true });
    }
  }, [isLoading, isAuthenticated, user, navigate]);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" />
      </div>
    );
  }

  async function handleConnect() {
    setConnecting(true);
    try {
      // Direct to GitHub OAuth
      window.location.href = auth.loginUrl();
    } catch {
      setConnecting(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      {/* Header */}
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <span className="text-2xl">⚡</span>
            <span className="text-xl font-bold text-gray-900">STAS</span>
            <span className="rounded-full bg-brand-100 px-2.5 py-0.5 text-xs font-medium text-brand-700">
              Solving Tickets As A Service
            </span>
          </div>
          <button
            onClick={handleConnect}
            disabled={connecting}
            className="btn-primary flex items-center gap-2"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
            </svg>
            {connecting ? 'Connecting...' : 'Connect with GitHub'}
          </button>
        </div>
      </header>

      {/* Hero */}
      <main className="flex-1">
        <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
          <div className="text-center">
            <h1 className="text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl">
              Automated fixes for your GitHub issues
            </h1>
            <p className="mt-4 text-lg text-gray-500">
              Label an issue with <code className="rounded bg-gray-100 px-2 py-0.5 text-sm font-semibold text-brand-600">stas:fix</code>. STAS investigates your codebase, writes a fix, runs your tests, and opens a PR.
            </p>
          </div>

          {/* Steps */}
          <div className="mt-16">
            <div className="space-y-8">
              {STEPS.map((step) => (
                <div key={step.number} className="relative flex gap-6">
                  {/* Number circle */}
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border-2 border-brand-200 bg-white">
                    <span className="text-sm font-bold text-brand-600">{step.number}</span>
                  </div>

                  {/* Connector line */}
                  {step.number < STEPS.length && (
                    <div className="absolute left-5 top-10 h-full w-0.5 -translate-x-1/2 bg-gray-200" />
                  )}

                  {/* Content */}
                  <div className="flex-1 pb-8">
                    <h3 className="text-lg font-semibold text-gray-900">{step.title}</h3>
                    <p
                      className="mt-1 text-sm text-gray-500"
                      dangerouslySetInnerHTML={{ __html: step.description }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Call to action */}
          <div className="mt-12 text-center">
            <button
              onClick={handleConnect}
              disabled={connecting}
              className="btn-primary inline-flex items-center gap-2 px-8 py-3 text-base"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
              </svg>
              {connecting ? 'Connecting...' : 'Get started — Connect with GitHub'}
            </button>
            <p className="mt-3 text-xs text-gray-400">
              No credit card required. Open source. Free tier available.
            </p>
          </div>

          {/* Already have an account */}
          <div className="mt-8 text-center">
            <p className="text-sm text-gray-500">
              Already have an account?{' '}
              <button onClick={login} className="font-medium text-brand-600 hover:text-brand-500">
                Sign in
              </button>
            </p>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-400">
              &copy; {new Date().getFullYear()} STAS. Open source.
            </p>
            <div className="flex gap-6">
              <a href="/security" className="text-sm text-gray-400 hover:text-gray-600">
                Security
              </a>
              <a href="/privacy" className="text-sm text-gray-400 hover:text-gray-600">
                Privacy
              </a>
              <a href="/pricing" className="text-sm text-gray-400 hover:text-gray-600">
                Pricing
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
