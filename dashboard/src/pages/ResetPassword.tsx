import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { auth } from '@/api/client';

export default function ResetPassword() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const accessToken = useMemo(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    return hash.get('access_token');
  }, []);

  useEffect(() => {
    window.history.replaceState({}, '', window.location.pathname);
    if (!accessToken) {
      setError('Invalid or missing reset token. Use the link from the email.');
    }
  }, [accessToken]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    if (!accessToken) {
      setError('Invalid or missing reset token. Use the link from the email.');
      return;
    }
    setSubmitting(true);
    try {
      await auth.resetPassword(accessToken, password);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset password');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-8">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="flex items-center justify-center gap-2">
            <span className="text-2xl font-bold text-gray-900">SYNTARO</span>
          </div>
          <p className="mt-1 text-sm text-gray-500">Set a new password</p>
        </div>

        <div className="card">
          {done ? (
            <div className="space-y-4 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
                <svg className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              </div>
              <h2 className="text-lg font-semibold text-gray-900">Password updated</h2>
              <p className="text-sm text-gray-600">You can now sign in with your new password.</p>
              <Link to="/login" className="btn-primary mt-2 inline-flex w-full min-h-[44px] items-center justify-center">
                Sign In
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">New Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  required
                  minLength={8}
                  autoFocus
                  className="input-field mt-1 w-full min-h-[44px]"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Confirm Password</label>
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Repeat new password"
                  required
                  minLength={8}
                  className="input-field mt-1 w-full min-h-[44px]"
                />
              </div>

              {error && <p className="text-sm text-red-500">{error}</p>}

              <button type="submit" disabled={submitting} className="btn-primary w-full min-h-[44px]">
                {submitting ? 'Updating...' : 'Update Password'}
              </button>
            </form>
          )}
        </div>

        <p className="mt-4 text-center text-sm text-gray-500">
          <Link to="/login" className="font-medium text-brand-600 hover:text-brand-500">
            Back to Sign In
          </Link>
        </p>
      </div>
    </div>
  );
}
