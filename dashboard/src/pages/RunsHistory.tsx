import { useState, useEffect } from 'react';
import { runs } from '@/api/client';
import type { Run } from '@/api/types';
import { Link, useSearchParams } from 'react-router-dom';

const STATUS_FILTERS = ['all', 'running', 'success', 'failed', 'queued', 'cancelled'] as const;

export default function RunsHistory() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState<{ data: Run[]; total: number; page: number; totalPages: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const page = Number(searchParams.get('page')) || 1;
  const statusFilter = searchParams.get('status') || '';
  const repoFilter = searchParams.get('repo') || '';

  useEffect(() => {
    setLoading(true);
    setError(null);
    runs
      .list({ page, perPage: 20, status: statusFilter || undefined, repo: repoFilter || undefined })
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [page, statusFilter, repoFilter]);

  function updateFilter(key: string, value: string) {
    const params = new URLSearchParams(searchParams);
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    params.delete('page');
    setSearchParams(params);
  }

  function formatDuration(seconds?: number): string {
    if (!seconds) return '—';
    if (seconds < 60) return `${seconds}s`;
    return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  }

  function formatCost(cents?: number): string {
    if (!cents) return '—';
    return `$${(cents / 100).toFixed(2)}`;
  }

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-500">Status:</label>
          <select
            value={statusFilter || 'all'}
            onChange={(e) => updateFilter('status', e.target.value === 'all' ? '' : e.target.value)}
            className="input-field w-32"
          >
            {STATUS_FILTERS.map((s) => (
              <option key={s} value={s}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-500">Repo:</label>
          <input
            type="text"
            placeholder="owner/repo"
            value={repoFilter}
            onChange={(e) => updateFilter('repo', e.target.value)}
            className="input-field w-48"
          />
        </div>
        {(statusFilter || repoFilter) && (
          <button onClick={() => setSearchParams({})} className="text-sm text-gray-500 hover:text-gray-700">
            Clear filters
          </button>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">ID</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">Issue</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">Status</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">Duration</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">Cost</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">Date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-sm text-gray-400">
                  Loading...
                </td>
              </tr>
            ) : error ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-sm text-red-500">
                  {error}
                </td>
              </tr>
            ) : data?.data.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-sm text-gray-400">
                  No runs found.
                </td>
              </tr>
            ) : (
              data?.data.map((run) => (
                <tr key={run.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <Link
                      to={`/runs/${run.id}`}
                      className="font-mono text-xs text-brand-600 hover:text-brand-700"
                    >
                      {run.id.slice(0, 8)}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <Link to={`/runs/${run.id}`} className="text-sm font-medium text-gray-900 hover:text-brand-600">
                      {run.repoOwner}/{run.repoName}#{run.issueNumber}
                    </Link>
                    <p className="truncate max-w-xs text-xs text-gray-500">{run.issueTitle}</p>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={run.status} />
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {formatDuration(run.durationSeconds)}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {formatCost(run.costCents)}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {new Date(run.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-500">
            Page {data.page} of {data.totalPages} ({data.total} total)
          </p>
          <div className="flex gap-2">
            <button
              disabled={page <= 1}
              onClick={() => updateFilter('page', String(page - 1))}
              className="btn-secondary text-xs"
            >
              Previous
            </button>
            <button
              disabled={page >= data.totalPages}
              onClick={() => updateFilter('page', String(page + 1))}
              className="btn-secondary text-xs"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: Run['status'] }) {
  const styles: Record<string, string> = {
    success: 'badge-success',
    running: 'badge-info',
    queued: 'badge-neutral',
    failed: 'badge-error',
    cancelled: 'badge-warning',
  };
  return <span className={styles[status] || 'badge-neutral'}>{status}</span>;
}
