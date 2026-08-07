import { CheckCircle2, Clock, RefreshCw, Search, Ticket } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { runs } from '@/api/client';
import type { Run } from '@/api/types';
import { SkeletonCard } from '@/components/LoadingSkeleton';
import StatusBadge from '@/components/StatusBadge';
import { useI18n } from '@/i18n/I18nProvider';
import { formatRelativeTime } from '@/utils/format';

export type RunListKind = 'issues' | 'pending' | 'done';

const EMPTY_RUNS_RESPONSE = { data: [] as Run[], total: 0, page: 1, perPage: 100, totalPages: 0 };

const KIND_META: Record<
  RunListKind,
  { icon: typeof Ticket; iconClass: string; titleKey: string; subtitleKey: string; emptyKey: string }
> = {
  issues: {
    icon: Ticket,
    iconClass: 'text-brand-600 dark:text-brand-400',
    titleKey: 'dashboard.issuesCreated',
    subtitleKey: 'overview.issue.subtitle',
    emptyKey: 'overview.issue.empty',
  },
  pending: {
    icon: Clock,
    iconClass: 'text-amber-500',
    titleKey: 'dashboard.pendingRuns',
    subtitleKey: 'overview.pending.subtitle',
    emptyKey: 'overview.pending.empty',
  },
  done: {
    icon: CheckCircle2,
    iconClass: 'text-green-500',
    titleKey: 'dashboard.doneVerified',
    subtitleKey: 'overview.done.subtitle',
    emptyKey: 'overview.done.empty',
  },
};

function isPending(status: Run['status']): boolean {
  return status === 'queued' || status === 'pending' || status === 'running';
}

function isDone(status: Run['status']): boolean {
  return status === 'success' || status === 'completed';
}

function fmtSeconds(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '\u2014';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

export default function RunListTab({ kind }: { kind: RunListKind }) {
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const [allRuns, setAllRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const qFilter = searchParams.get('q') ?? '';
  const repoFilter = searchParams.get('repo') ?? '';

  const loadData = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const runsData = await runs.list({ perPage: 100 }).catch(() => EMPTY_RUNS_RESPONSE);
      setAllRuns(runsData.data);
      setLastUpdated(new Date());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadData(true);
  }, [loadData]);

  const rows = useMemo(() => {
    let list: Run[];
    if (kind === 'pending') {
      list = allRuns.filter((r) => isPending(r.status));
    } else if (kind === 'done') {
      list = allRuns.filter((r) => isDone(r.status));
    } else {
      const seen = new Map<string, Run>();
      for (const run of allRuns) {
        const key = `${run.repoOwner}/${run.repoName}#${run.issueNumber}`;
        const prev = seen.get(key);
        if (!prev || run.createdAt > prev.createdAt) seen.set(key, run);
      }
      list = Array.from(seen.values());
    }
    const q = qFilter.trim().toLowerCase();
    return list.filter((r) => {
      if (repoFilter && `${r.repoOwner}/${r.repoName}` !== repoFilter) return false;
      if (q) {
        const haystack = `${r.repoOwner}/${r.repoName}#${r.issueNumber} ${r.issueTitle}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [allRuns, kind, qFilter, repoFilter]);

  const setParam = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(searchParams);
      if (value) next.set(key, value);
      else next.delete(key);
      setSearchParams(next);
    },
    [searchParams, setSearchParams],
  );

  const meta = KIND_META[kind];
  const Icon = meta.icon;

  if (loading) {
    return (
      <div className="space-y-6">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center justify-center rounded-md bg-brand-50 p-2 dark:bg-brand-900/50">
              <Icon size={20} className={meta.iconClass} />
            </span>
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t(meta.titleKey)}</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">{t(meta.subtitleKey)}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs font-medium">
            <span className="rounded-full bg-brand-50 px-2.5 py-0.5 text-brand-700 dark:bg-brand-900/50 dark:text-brand-300">
              {rows.length}
            </span>
            {lastUpdated && (
              <span className="hidden text-xs text-gray-400 dark:text-gray-500 sm:inline">
                {t('dashboard.updatedAgo', { time: formatRelativeTime(lastUpdated) })}
              </span>
            )}
            <button
              type="button"
              onClick={() => loadData(false)}
              disabled={refreshing}
              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md p-1.5 text-gray-400 transition-colors hover:text-gray-600 disabled:opacity-50 dark:hover:text-gray-300"
              aria-label={t('dashboard.refresh')}
            >
              <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search
              size={14}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400"
            />
            <input
              value={qFilter}
              onChange={(e) => setParam('q', e.target.value)}
              placeholder={t('overview.bug.filter.search')}
              aria-label={t('overview.bug.filter.search')}
              className="h-9 w-64 rounded-md border border-gray-200 bg-white pl-8 pr-2 text-sm text-gray-900 outline-none transition-colors placeholder:text-gray-400 focus:border-brand-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
            />
          </div>
          {repoFilter && (
            <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300">
              {repoFilter}
            </span>
          )}
          {error && <span className="text-xs text-red-600 dark:text-red-400">{error}</span>}
        </div>
      </div>

      <div className="card">
        <div className="flex items-center gap-2">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">{t(meta.titleKey)}</h3>
          <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 dark:bg-brand-900/50 dark:text-brand-300">
            {rows.length}
          </span>
        </div>
        {rows.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed border-gray-200 px-3 py-6 text-center text-sm text-gray-400 dark:border-gray-700 dark:text-gray-500">
            {t(meta.emptyKey)}
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500 dark:border-gray-700 dark:text-gray-400">
                  <th className="pb-2 pr-4 font-medium">{t('overview.bug.col.status')}</th>
                  <th className="pb-2 pr-4 font-medium">{t('overview.bug.col.bug')}</th>
                  <th className="hidden pb-2 pr-4 font-medium lg:table-cell">{t('overview.list.col.pr')}</th>
                  <th className="pb-2 pr-4 font-medium">{t('overview.list.col.started')}</th>
                  <th className="hidden pb-2 pr-4 font-medium md:table-cell">{t('overview.list.col.duration')}</th>
                  <th className="pb-2 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {rows.map((run) => (
                  <tr key={run.id}>
                    <td className="py-2.5 pr-4">
                      <StatusBadge status={run.status} />
                    </td>
                    <td className="py-2.5 pr-4">
                      <Link
                        to={`/runs/${run.id}`}
                        className="block max-w-60 transition-colors hover:text-brand-600 dark:hover:text-brand-300"
                      >
                        <span className="block truncate font-mono text-xs text-brand-600 dark:text-brand-400">
                          {run.repoOwner}/{run.repoName}#{run.issueNumber}
                        </span>
                        <span className="block truncate text-gray-700 dark:text-gray-300">{run.issueTitle}</span>
                      </Link>
                    </td>
                    <td className="hidden max-w-56 py-2.5 pr-4 lg:table-cell">
                      {run.prUrl ? (
                        <a
                          href={run.prUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="block truncate text-xs text-brand-600 hover:text-brand-700 dark:text-brand-400"
                        >
                          {run.prUrl.replace(/^https?:\/\//, '')}
                        </a>
                      ) : (
                        <span className="text-xs text-gray-400 dark:text-gray-500">{'\u2014'}</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap py-2.5 pr-4 text-xs text-gray-500 dark:text-gray-400">
                      {formatRelativeTime(run.createdAt)}
                    </td>
                    <td className="hidden whitespace-nowrap py-2.5 pr-4 text-xs text-gray-500 dark:text-gray-400 md:table-cell">
                      {fmtSeconds(run.durationSeconds)}
                    </td>
                    <td className="py-2.5 text-right">
                      <Link
                        to={`/runs/${run.id}`}
                        className="text-xs font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
                      >
                        {t('overview.bug.viewRun')}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
