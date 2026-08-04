import { LogIn, Search } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminUsers, type AdminUserSummary } from '@/api/adminUsers';
import EmptyState from '@/components/EmptyState';
import ErrorState from '@/components/ErrorState';
import Pagination from '@/components/Pagination';
import { useAuth } from '@/context/AuthContext';
import { formatRelativeTime } from '@/utils/format';

export default function AdminUsers() {
  const { enterImpersonation, user: me } = useAuth();
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState('');
  const [qDraft, setQDraft] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await adminUsers.list({
        page,
        limit: 20,
        q: q || undefined,
        role: roleFilter || undefined,
      });
      setUsers(data.users);
      setTotalPages(data.totalPages);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }, [page, q, roleFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleRoleChange(user: AdminUserSummary, role: 'admin' | 'user') {
    if (user.role === role) return;
    setBusyId(`role-${user.id}`);
    setNotice(null);
    try {
      await adminUsers.setRole(user.id, role);
      setNotice(`${user.email} is now ${role}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to change role');
    } finally {
      setBusyId(null);
    }
  }

  async function handleLoginAs(user: AdminUserSummary) {
    if (me?.id === user.id) return;
    setBusyId(`login-${user.id}`);
    setError(null);
    try {
      const result = await adminUsers.impersonate(user.id);
      await enterImpersonation(result.token, result.refreshToken);
      // Full navigation so dashboard loads as that user.
      window.location.href = '/';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to login as user');
      setBusyId(null);
    }
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Users</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Login as any member to see their dashboard. Use <strong>Back to admin</strong> on the yellow bar to return.
        </p>
      </div>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <form
          className="flex flex-1 gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setQ(qDraft.trim());
          }}
        >
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              value={qDraft}
              onChange={(e) => setQDraft(e.target.value)}
              placeholder="Search email or name"
              className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm dark:border-gray-700 dark:bg-slate-800"
            />
          </div>
          <button type="submit" className="btn-secondary text-sm">
            Search
          </button>
        </form>
        <select
          value={roleFilter}
          onChange={(e) => {
            setPage(1);
            setRoleFilter(e.target.value);
          }}
          className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-slate-800"
        >
          <option value="">All roles</option>
          <option value="admin">Admin</option>
          <option value="user">User</option>
        </select>
      </div>

      {notice && (
        <p className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-900/20 dark:text-emerald-300">
          {notice}
        </p>
      )}

      {error && <ErrorState message={error} onRetry={() => void load()} />}

      {loading ? (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-400 dark:border-gray-800 dark:bg-slate-900">
          Loading users…
        </div>
      ) : !error && users.length === 0 ? (
        <EmptyState title="No users found" />
      ) : !error ? (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-slate-900">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase text-gray-500 dark:border-gray-800 dark:bg-slate-800/50 dark:text-gray-400">
              <tr>
                <th className="px-4 py-3 font-semibold">User</th>
                <th className="px-4 py-3 font-semibold">Plan</th>
                <th className="px-4 py-3 font-semibold">Role</th>
                <th className="px-4 py-3 font-semibold">Created</th>
                <th className="px-4 py-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isSelf = me?.id === u.id;
                const loggingIn = busyId === `login-${u.id}`;
                return (
                  <tr key={u.id} className="border-b border-gray-100 last:border-0 dark:border-gray-800">
                    <td className="px-4 py-3">
                      <Link
                        to={`/admin/users/${u.id}`}
                        className="font-medium text-gray-900 hover:text-brand-600 dark:text-gray-100 dark:hover:text-brand-400"
                      >
                        {u.email}
                      </Link>
                      {u.name ? <p className="text-xs text-gray-500">{u.name}</p> : null}
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{u.plan}</td>
                    <td className="px-4 py-3">
                      <select
                        value={u.role}
                        disabled={busyId === `role-${u.id}`}
                        onChange={(e) => void handleRoleChange(u, e.target.value as 'admin' | 'user')}
                        className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs dark:border-gray-700 dark:bg-slate-800"
                      >
                        <option value="user">user</option>
                        <option value="admin">admin</option>
                      </select>
                    </td>
                    <td className="px-4 py-3 text-gray-500">{formatRelativeTime(u.createdAt)}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        disabled={isSelf || !!busyId}
                        onClick={() => void handleLoginAs(u)}
                        className="inline-flex items-center gap-1 rounded-md bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <LogIn className="h-3.5 w-3.5" />
                        {loggingIn ? 'Logging in…' : isSelf ? 'You' : 'Login as'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      <Pagination className="mt-4" page={page} totalPages={totalPages} total={total} onPageChange={setPage} />
    </div>
  );
}
