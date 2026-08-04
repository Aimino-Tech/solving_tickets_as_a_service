import { useState, useEffect, useCallback } from 'react';
import { runs } from '@/api/client';
import type { Run } from '@/api/types';
import { Link, useSearchParams } from 'react-router-dom';
import { formatCost, formatDurationShort } from '@/utils/format';
import { SkeletonTable, SkeletonCard } from '@/components/LoadingSkeleton';
import SlideOver from '@/components/SlideOver';
import RunDetailContent from '@/components/RunDetailContent';
import EmptyState from '@/components/EmptyState';
import ErrorState from '@/components/ErrorState';
import Pagination from '@/components/Pagination';
import StatusBadge from '@/components/StatusBadge';

const STATUS_FILTERS = ['all', 'running', 'success', 'failed', 'queued', 'cancelled'] as const;

export default function RunsHistory() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState<{ data: Run[]; total: number; page: number; totalPages: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedRun, setSelectedRun] = useState<Run | null>(null);

  const openSlideOver = useCallback((run: Run) => {
    setSelectedRun(run);
    window.location.hash = `detail-${run.id}`;
  }, []);

  const closeSlideOver = useCallback(() => {
    setSelectedRun(null);
    window.location.hash = '';
  }, []);

  const page = Number(searchParams.get('page')) || 1;
  const statusFilter = searchParams.get('status') || '';
  const repoFilter = searchParams.get('repo') || '';

  useEffect(() => {
    setLoading(true);
    setError(null);
    runs
      .list({ page, perPage: 20, status: statusFilter || undefined, repo: repoFilter || undefined })
      .then(setData)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [page, statusFilter, repoFilter]);

  function updateFilter(key: string, value: string) {
    const params = new URLSearchParams(searchParams);
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    if (key !== 'page') {
      params.delete('page');
    }
    setSearchParams(params);
  }

  function handlePageChange(newPage: number) {
    const params = new URLSearchParams(searchParams);
    params.set('page', String(newPage));
    setSearchParams(params);
  }

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-500 dark:text-gray-400">Status:</label>
          <select
            value={statusFilter || 'all'}
            onChange={(e) => updateFilter('status', e.target.value === 'all' ? '' : e.target.value)}
            className="input-field min-h-[44px] w-full sm:w-32"
          >
            {STATUS_FILTERS.map((s) => (
              <option key={s} value={s}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-500 dark:text-gray-400">Repo:</label>
          <input
            type="text"
            placeholder="owner/repo"
            value={repoFilter}
            onChange={(e) => updateFilter('repo', e.target.value)}
            className="input-field min-h-[44px] w-full sm:w-48"
          />
        </div>
        {(statusFilter || repoFilter) && (
          <button onClick={() => setSearchParams({})} className="min-h-[44px] min-w-[44px] text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
            Clear filters
          </button>
        )}
      </div>

      {/* Desktop Table */}
      <div className="hidden md:block overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead className="bg-gray-50 dark:bg-gray-700/50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">ID</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">Issue</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">Status</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">Duration</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">Cost</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">Date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {loading ? (
              <SkeletonTable rows={5} columns={6} />
            ) : error ? (
              <tr>
                <td colSpan={6} className="px-4">
                  <ErrorState message={error} />
                </td>
              </tr>
            ) : data?.data.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4">
                  <EmptyState title="No runs found." />
                </td>
              </tr>
            ) : (
              data?.data.map((run) => (
                <tr key={run.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors cursor-pointer" onClick={() => openSlideOver(run)}>
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs text-brand-600 dark:text-brand-400">
                      {String(run.id).slice(0, 8)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      {run.repoOwner}/{run.repoName}#{run.issueNumber}
                    </span>
                    <p className="truncate max-w-xs text-xs text-gray-500 dark:text-gray-400">{run.issueTitle}</p>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={run.status} />
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">
                    {formatDuration(run.durationSeconds)}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">
                    {formatCost(run.costCents)}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                    {new Date(run.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile Card List */}
      <div className="md:hidden space-y-3">
        {loading ? (
          [...Array(3)].map((_, i) => <SkeletonCard key={i} />)
        ) : error ? (
          <ErrorState message={error} />
        ) : data?.data.length === 0 ? (
          <EmptyState title="No runs found." />
        ) : (
          data?.data.map((run) => (
            <Link
              key={run.id}
              to={`/runs/${run.id}`}
              className="card block hover:border-brand-200 hover:shadow-md transition-all"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-brand-600">{String(run.id).slice(0, 8)}</span>
                  <StatusBadge status={run.status} />
                </div>
                <span className="text-xs text-gray-400 dark:text-gray-500">{formatDuration(run.durationSeconds)}</span>
              </div>
              <p className="mt-2 text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                {run.repoOwner}/{run.repoName}#{run.issueNumber}
              </p>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 truncate">{run.issueTitle}</p>
              <div className="mt-2 flex items-center justify-between text-xs text-gray-400 dark:text-gray-500">
                <span>{formatCost(run.costCents)}</span>
                <span>{new Date(run.createdAt).toLocaleDateString()}</span>
              </div>
            </Link>
          ))
        )}
      </div>

      {/* Pagination */}
      {data && (
        <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onPageChange={handlePageChange} />
      )}

      {/* Slide-over for run details */}
      <SlideOver
        isOpen={selectedRun !== null}
        onClose={closeSlideOver}
        title={selectedRun ? `Run ${String(selectedRun.id).slice(0, 8)}` : ''}
      >
        {selectedRun && <RunDetailContent run={selectedRun} />}
      </SlideOver>
    </div>
  );
}
