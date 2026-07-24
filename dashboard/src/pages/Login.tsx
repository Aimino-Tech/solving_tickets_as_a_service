import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useNavigate } from 'react-router-dom';

type AuthMode = 'login' | 'register';

export default function Login() {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
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
      setLoading(false);
    }
  }

  function switchMode() {
    setMode(mode === 'login' ? 'register' : 'login');
    setError(null);
  }

  return (
    <div className="flex min-h-screen">
      <div className="hidden flex-1 flex-col justify-between bg-gradient-to-br from-brand-600 to-brand-900 p-12 text-white lg:flex">
        <div>
          <div className="flex items-center gap-3">
            <span className="text-3xl">⚡</span>
            <span className="text-2xl font-bold">STAS</span>
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
        </div>

        <p className="text-sm text-brand-200">
          &copy; {new Date().getFullYear()} STAS. All rights reserved.
        </p>
      </div>

      <div className="flex flex-1 items-center justify-center bg-gray-50 p-8">
        <div className="w-full max-w-sm">
          <div className="mb-8 text-center lg:hidden">
            <div className="flex items-center justify-center gap-2">
              <span className="text-2xl">⚡</span>
              <span className="text-xl font-bold text-gray-900">STAS</span>
            </div>
            <p className="mt-1 text-sm text-gray-500">Solving Tickets As A Service</p>
          </div>

          <div className="card">
            <div className="flex border-b border-gray-200 mb-6">
              <button
                onClick={() => setMode('login')}
                className={`flex-1 pb-3 text-sm font-medium text-center border-b-2 transition-colors ${
                  mode === 'login'
                    ? 'border-brand-600 text-brand-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                Sign In
              </button>
              <button
                onClick={() => setMode('register')}
                className={`flex-1 pb-3 text-sm font-medium text-center border-b-2 transition-colors ${
                  mode === 'register'
                    ? 'border-brand-600 text-brand-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                Register
              </button>
            </div>

            <h2 className="text-xl font-semibold text-gray-900">
              {mode === 'login' ? 'Welcome back' : 'Create an account'}
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              {mode === 'login'
                ? 'Sign in with your email and password.'
                : 'Get started with STAS in minutes.'}
            </p>

            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              {mode === 'register' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700">Name</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Your name (optional)"
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

              {error && (
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="btn-primary w-full flex items-center justify-center gap-2 min-h-[44px]"
              >
                {loading ? (
                  <span className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                ) : mode === 'login' ? (
                  'Sign In'
                ) : (
                  'Create Account'
                )}
              </button>
            </form>

            <p className="mt-4 text-center text-xs text-gray-400">
              {mode === 'login' ? (
                <>
                  Don't have an account?{' '}
                  <button onClick={switchMode} className="text-brand-600 hover:text-brand-500 font-medium">
                    Register
                  </button>
                </>
              ) : (
                <>
                  Already have an account?{' '}
                  <button onClick={switchMode} className="text-brand-600 hover:text-brand-500 font-medium">
                    Sign in
                  </button>
                </>
              )}
            </p>
          </div>

          <p className="mt-4 text-center text-xs text-gray-400 lg:hidden">
            &copy; {new Date().getFullYear()} STAS. All rights reserved.
          </p>
        </div>
      </div>
    </div>
  );
}
