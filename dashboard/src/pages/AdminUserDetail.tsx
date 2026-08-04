import { ArrowLeft, LogIn } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { adminUsers, type AdminUserDetail } from '@/api/adminUsers';
import ErrorState from '@/components/ErrorState';
import { useAuth } from '@/context/AuthContext';
import { formatRelativeTime } from '@/utils/format';

export default function AdminUserDetail() {
  const { id = '' } = useParams();
  const { enterImpersonation, user: me } = useAuth();
  const [user, setUser] = useState<AdminUserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      setUser(await adminUsers.get(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load user');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleEnterAccount() {
    if (!user) return;
    setBusy(true);
    setError(null);
    try {
      const result = await adminUsers.impersonate(user.id);
      await enterImpersonation(result.token, result.refreshToken);
      window.location.href = '/';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to login as user');
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div>
        <p className="text-sm text-gray-400">Loading user…</p>
      </div>
    );
  }

  if (error && !user) {
    return (
      <div>
        <ErrorState message={error} onRetry={() => void load()} />
      </div>
    );
  }

  if (!user) return null;

  const isSelf = me?.id === user.id;

  return (
    <div>
      <Link
        to="/admin/users"
        className="mb-4 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"
      >
        <ArrowLeft className="h-4 w-4" /> Back to users
      </Link>

      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{user.email}</h1>
          {user.name ? <p className="mt-1 text-sm text-gray-500">{user.name}</p> : null}
          <p className="mt-2 text-xs text-gray-400">ID: {user.id}</p>
        </div>
        <button
          type="button"
          disabled={busy || isSelf}
          onClick={() => void handleEnterAccount()}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <LogIn className="h-4 w-4" />
          {busy ? 'Logging in…' : isSelf ? 'Cannot login as yourself' : 'Login as this user'}
        </button>
      </div>

      {error && (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-900/20 dark:text-red-300">
          {error}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-slate-900">
          <p className="text-xs uppercase text-gray-400">Role</p>
          <p className="mt-1 text-lg font-semibold text-gray-900 dark:text-gray-100">{user.role}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-slate-900">
          <p className="text-xs uppercase text-gray-400">Plan</p>
          <p className="mt-1 text-lg font-semibold text-gray-900 dark:text-gray-100">{user.plan}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-slate-900">
          <p className="text-xs uppercase text-gray-400">Created</p>
          <p className="mt-1 text-lg font-semibold text-gray-900 dark:text-gray-100">
            {formatRelativeTime(user.createdAt)}
          </p>
        </div>
      </div>

      <div className="mt-6 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-slate-900">
        <h2 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">Linked accounts</h2>
        {user.accounts.length === 0 ? (
          <p className="text-sm text-gray-400">No linked accounts.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {user.accounts.map((a) => (
              <li key={a.id} className="flex justify-between gap-2 border-b border-gray-100 pb-2 last:border-0 dark:border-gray-800">
                <span className="text-gray-700 dark:text-gray-300">{a.email ?? a.name ?? a.id}</span>
                <span className="text-gray-400">{a.plan ?? '—'}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
