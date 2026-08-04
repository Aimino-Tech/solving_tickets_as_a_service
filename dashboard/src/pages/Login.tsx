import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';

const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  invalid_oauth_callback: 'Sign-in failed. Please try again.',
  oauth_state_mismatch: 'Sign-in session expired. Please try again.',
  oauth_exchange_failed: 'Could not complete sign-in. Please try again.',
  oauth_not_configured: 'Social sign-in is not configured yet.',
  oauth_failed: 'Sign-in failed. Please try again.',
};

function startOAuth(provider: 'google' | 'azure' | 'github') {
  window.location.href = `/api/v1/auth/oauth/${provider}/start`;
}

function GoogleIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" role="img" aria-label="Google">
      <title>Google</title>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

function MicrosoftIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 23 23" role="img" aria-label="Microsoft">
      <title>Microsoft</title>
      <rect x="1" y="1" width="10" height="10" fill="#F25022" />
      <rect x="12" y="1" width="10" height="10" fill="#7FBA00" />
      <rect x="1" y="12" width="10" height="10" fill="#00A4EF" />
      <rect x="12" y="12" width="10" height="10" fill="#FFB900" />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" role="img" aria-label="GitHub" fill="currentColor">
      <title>GitHub</title>
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

const FEATURES = [
  'Real-time fix run monitoring',
  'Connected repository management',
  'Analytics & cost tracking',
  'Full audit log',
  'Team collaboration (coming soon)',
];

export default function Login() {
  const { login, register } = useAuth();
  const navigate = useNavigate();

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const oauthError = new URLSearchParams(window.location.search).get('error');
    if (oauthError) {
      setError(OAUTH_ERROR_MESSAGES[oauthError] ?? 'Sign-in failed. Please try again.');
    }
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      if (mode === 'login') {
        await login(email, password);
      } else {
        await register(email, password, name || undefined);
      }
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen">
      <div className="hidden flex-1 flex-col justify-between bg-gradient-to-br from-brand-600 to-brand-900 p-12 text-white lg:flex">
        <div>
          <div className="flex items-center gap-3">
            <span className="text-3xl font-bold">SYNTARO</span>
          </div>
        </div>

        <div className="max-w-md">
          <h1 className="text-4xl font-bold leading-tight">Solving Tickets As A Service</h1>
          <p className="mt-4 text-lg text-brand-100">
            Label a GitHub issue. Get a pull request. Powered by OpenCode + frontier models.
          </p>

          <div className="mt-6 rounded-lg border border-brand-400/30 bg-brand-500/20 p-4">
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-green-400 text-sm font-bold text-white">
                ✓
              </span>
              <p className="text-sm font-medium text-white">
                We Never Train on Your Code.{' '}
                <a href="/security" className="underline text-brand-200 hover:text-white transition-colors">
                  Read our security policy →
                </a>
              </p>
            </div>
          </div>

          <ul className="mt-8 space-y-3">
            {FEATURES.map((feature) => (
              <li key={feature} className="flex items-center gap-3 text-brand-100">
                <svg
                  className="h-5 w-5 flex-shrink-0 text-brand-300"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
                {feature}
              </li>
            ))}
          </ul>
        </div>

        <p className="text-sm text-brand-200">&copy; {new Date().getFullYear()} SYNTARO. All rights reserved.</p>
      </div>

      <div className="flex flex-1 items-center justify-center bg-gray-50 p-8">
        <div className="w-full max-w-sm">
          <div className="mb-8 text-center lg:hidden">
            <div className="flex items-center justify-center gap-2">
              <span className="text-2xl font-bold text-gray-900">SYNTARO</span>
            </div>
            <p className="mt-1 text-sm text-gray-500">Solving Tickets As A Service</p>
          </div>

          <div className="card">
            <div className="flex mb-4 rounded-lg border border-gray-200 p-0.5">
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setError(null);
                }}
                className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  mode === 'login' ? 'bg-brand-600 text-white' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('register');
                  setError(null);
                }}
                className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  mode === 'register' ? 'bg-brand-600 text-white' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                Register
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {mode === 'register' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700">Name</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Your name"
                    className="input-field mt-1 w-full min-h-[44px]"
                  />
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  className="input-field mt-1 w-full min-h-[44px]"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === 'register' ? 'At least 8 characters' : 'Your password'}
                  required
                  minLength={8}
                  className="input-field mt-1 w-full min-h-[44px]"
                />
              </div>

              {error && <p className="text-sm text-red-500">{error}</p>}

              <button type="submit" disabled={submitting} className="btn-primary w-full min-h-[44px]">
                {submitting ? 'Please wait...' : mode === 'login' ? 'Sign In' : 'Create Account'}
              </button>

              {mode === 'login' && (
                <div className="text-center">
                  <Link to="/forgot-password" className="text-sm font-medium text-brand-600 hover:text-brand-500">
                    Forgot password?
                  </Link>
                </div>
              )}
            </form>

            <div className="mt-5 space-y-3">
              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-gray-200 dark:bg-gray-600" />
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400">or</span>
                <div className="h-px flex-1 bg-gray-200 dark:bg-gray-600" />
              </div>
              <button type="button" onClick={() => startOAuth('google')} className="btn-oauth">
                <GoogleIcon />
                Continue with Google
              </button>
              <button type="button" onClick={() => startOAuth('azure')} className="btn-oauth">
                <MicrosoftIcon />
                Continue with Microsoft
              </button>
              <button type="button" onClick={() => startOAuth('github')} className="btn-oauth">
                <GitHubIcon />
                Continue with GitHub
              </button>
            </div>

            <p className="mt-4 text-center text-xs text-gray-500 dark:text-gray-400">By signing in, you agree to our Terms of Service.</p>
          </div>

          <p className="mt-4 text-center text-sm text-gray-500">
            <Link to="/onboarding" className="font-medium text-brand-600 hover:text-brand-500">
              New to SYNTARO? Learn more
            </Link>
          </p>

          <p className="mt-4 text-center text-xs text-gray-500 dark:text-gray-400 lg:hidden">
            &copy; {new Date().getFullYear()} SYNTARO. All rights reserved.
          </p>
        </div>
      </div>
    </div>
  );
}
