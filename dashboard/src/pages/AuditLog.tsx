import { useState, useEffect, useRef } from 'react';
import { audit } from '@/api/client';
import type { AuditEntry, PaginatedResponse } from '@/api/types';
import { formatRelativeTime } from '@/utils/format';

const ACTION_ICONS: Record<string, string> = {
  run_started: '▶',
  run_completed: '✓',
  run_failed: '✗',
  repo_connected: '⊞',
  repo_disconnected: '⊟',
  settings_updated: '⚙',
  user_login: '→',
  user_logout: '←',
};

const ACTION_COLORS: Record<string, string> = {
  run_started: 'border-l-blue-500',
  run_completed: 'border-l-green-500',
  run_failed: 'border-l-red-500',
  repo_connected: 'border-l-amber-500',
  repo_disconnected: 'border-l-rose-500',
  settings_updated: 'border-l-gray-500',
  user_login: 'border-l-brand-500',
  user_logout: 'border-l-gray-400',
};

export default function AuditLog() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  const requestIdRef = useRef(0);

  function loadPage(p: number, signal?: AbortSignal) {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    audit
      .list({ page: p, perPage: 30 }, { signal })
      .then((res: PaginatedResponse<AuditEntry>) => {
        if (requestId !== requestIdRef.current) return;
        setEntries(res.data);
        setTotal(res.total);
        setTotalPages(res.totalPages);
        setPage(res.page);
      })
      .catch((err: Error) => {
        if (err.name !== 'AbortError') setError(err.message);
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setLoading(false);
      });
  }

  useEffect(() => {
    const ac = new AbortController();
    loadPage(page, ac.signal);
    return () => ac.abort();
  }, [page]);

  function formatAction(action: string): string {
    return action
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500 dark:text-gray-400">{total} total entries</p>
      </div>

      {/* Timeline */}
      {loading ? (
        <div className="space-y-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="card animate-pulse flex gap-4">
              <div className="h-10 w-1 rounded bg-gray-200 dark:bg-gray-700" />
              <div className="flex-1">
                <div className="h-4 w-32 rounded bg-gray-200 dark:bg-gray-700" />
                <div className="mt-2 h-3 w-48 rounded bg-gray-200 dark:bg-gray-700" />
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="card">
          <p className="text-red-600 dark:text-red-400">{error}</p>
          <button onClick={() => loadPage(page)} className="mt-2 text-sm font-medium text-brand-600 min-h-[44px] min-w-[44px]">
            Retry
          </button>
        </div>
      ) : entries.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-gray-500 dark:text-gray-400">No audit entries yet.</p>
          <p className="mt-1 text-sm text-gray-400 dark:text-gray-500">
            Actions will appear here as the bot processes fixes.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {entries.map((entry) => (
            <div
              key={entry.id}
              className={`card border-l-4 ${ACTION_COLORS[entry.action] || 'border-l-gray-300'}`}
            >
              <div className="flex items-start gap-3">
                <span className="mt-0.5 text-lg">
                  {ACTION_ICONS[entry.action] || '•'}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      {formatAction(entry.action)}
                    </span>
                    <span className="text-xs text-gray-400 dark:text-gray-500">
                      by {entry.actor}
                    </span>
                  </div>
                  {entry.target && (
                    <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{entry.target}</p>
                  )}
                  {entry.details && Object.keys(entry.details).length > 0 && (
                    <pre className="mt-1 text-xs text-gray-400 font-mono overflow-x-auto">
                      {JSON.stringify(entry.details, null, 2)}
                    </pre>
                  )}
                </div>
                <time className="text-xs text-gray-400 whitespace-nowrap">
                  {formatTimeAgo(entry.createdAt)}
                </time>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Page {page} of {totalPages}
          </p>
          <div className="flex gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
              className="btn-secondary text-xs"
            >
              Previous
            </button>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage(page + 1)}
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

function formatTimeAgo(isoDate: string): string {
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(isoDate).toLocaleDateString();
}
