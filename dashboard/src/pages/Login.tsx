import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useNavigate, Link } from 'react-router-dom';

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
          <h1 className="text-4xl font-bold leading-tight">
            Solving Tickets As A Service
          </h1>
          <p className="mt-4 text-lg text-brand-100">
            Label a GitHub issue. Get a pull request. Powered by OpenCode + frontier models.
          </p>

          <div className="mt-6 rounded-lg border border-brand-400/30 bg-brand-500/20 p-4">
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-green-400 text-sm font-bold text-white">✓</span>
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
                <svg className="h-5 w-5 flex-shrink-0 text-brand-300" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
                {feature}
              </li>
            ))}
          </ul>
        </div>

        <p className="text-sm text-brand-200">
          &copy; {new Date().getFullYear()} SYNTARO. All rights reserved.
        </p>
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
                onClick={() => { setMode('login'); setError(null); }}
                className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  mode === 'login' ? 'bg-brand-600 text-white' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => { setMode('register'); setError(null); }}
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
                  <label className="block text-sm font-medium text-gray-700">
                    Name
                  </label>
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
                <label className="block text-sm font-medium text-gray-700">
                  Email
                </label>
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
                <label className="block text-sm font-medium text-gray-700">
                  Password
                </label>
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

              {error && (
                <p className="text-sm text-red-500">{error}</p>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="btn-primary w-full min-h-[44px]"
              >
                {submitting ? 'Please wait...' : mode === 'login' ? 'Sign In' : 'Create Account'}
              </button>
            </form>

            <p className="mt-4 text-center text-xs text-gray-400">
              By signing in, you agree to our Terms of Service.
            </p>
          </div>

          <p className="mt-4 text-center text-sm text-gray-500">
            <Link to="/onboarding" className="font-medium text-brand-600 hover:text-brand-500">
              New to SYNTARO? Learn more
            </Link>
          </p>

          <p className="mt-4 text-center text-xs text-gray-400 lg:hidden">
            &copy; {new Date().getFullYear()} SYNTARO. All rights reserved.
          </p>
        </div>
      </div>
    </div>
  );
}
