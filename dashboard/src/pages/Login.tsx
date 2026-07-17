import { useAuth } from '@/context/AuthContext';

const FEATURES = [
  'Real-time fix run monitoring',
  'Connected repository management',
  'Analytics & cost tracking',
  'Full audit log',
  'Team collaboration (coming soon)',
];

export default function Login() {
  const { login } = useAuth();

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
            <h2 className="text-xl font-semibold text-gray-900">Welcome back</h2>
            <p className="mt-1 text-sm text-gray-500">
              Sign in with your GitHub account to continue.
            </p>

            <button
              onClick={login}
              className="mt-6 flex w-full items-center justify-center gap-3 rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm font-semibold text-gray-700 shadow-sm transition-all hover:bg-gray-50 hover:shadow-md"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
              </svg>
              Sign in with GitHub
            </button>

            <p className="mt-4 text-center text-xs text-gray-400">
              By signing in, you agree to our Terms of Service.
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
