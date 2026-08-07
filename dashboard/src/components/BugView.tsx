import { Bug, RefreshCw, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { runs } from '@/api/client';
import type { Run } from '@/api/types';
import EvaluationPanel from '@/components/EvaluationPanel';
import { SkeletonCard } from '@/components/LoadingSkeleton';
import { useI18n } from '@/i18n/I18nProvider';
import type { FeedbackDelta, ProjectEvaluation } from '@/utils/evaluation';
import { computeFeedbackLoop, deriveBugs, evaluateBugs } from '@/utils/evaluation';
import { formatRelativeTime } from '@/utils/format';

const SNAPSHOT_KEY = 'syntaro:bugs-eval-snapshot';

const EMPTY_RUNS_RESPONSE = { data: [] as Run[], total: 0, page: 1, perPage: 100, totalPages: 0 };

const STATUS_BADGE: Record<string, string> = {
  open: 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300',
  fixed: 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300',
  reopened: 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300',
};

export default function BugView() {
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const [allRuns, setAllRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [previousEval, setPreviousEval] = useState<ProjectEvaluation | null>(null);

  const qFilter = searchParams.get('q') ?? '';
  const repoFilter = searchParams.get('repo') ?? '';
  const statusFilter = searchParams.get('bugStatus') ?? '';

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
    let snapshot: ProjectEvaluation | null = null;
    try {
      const raw = localStorage.getItem(SNAPSHOT_KEY);
      if (raw) snapshot = JSON.parse(raw) as ProjectEvaluation;
    } catch {
      snapshot = null;
    }
    setPreviousEval(snapshot);
    void loadData(true);
  }, [loadData]);

  const bugs = useMemo(() => deriveBugs(allRuns), [allRuns]);
  const evaluation = useMemo(() => evaluateBugs(bugs), [bugs]);
  const feedback = useMemo<FeedbackDelta[]>(
    () => computeFeedbackLoop(previousEval, evaluation),
    [previousEval, evaluation],
  );

  useEffect(() => {
    if (loading || allRuns.length === 0) return;
    try {
      localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(evaluation));
    } catch {
      // best-effort snapshot — quota errors must not break the view
    }
  }, [evaluation, loading, allRuns.length]);

  const filteredBugs = useMemo(() => {
    const q = qFilter.trim().toLowerCase();
    return bugs.filter((b) => {
      if (repoFilter && b.repo !== repoFilter) return false;
      if (statusFilter && b.status !== statusFilter) return false;
      if (q) {
        const haystack = `${b.repo}#${b.issueNumber} ${b.issueTitle} ${b.errorMessage ?? ''}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [bugs, qFilter, repoFilter, statusFilter]);

  const openCount = bugs.filter((b) => b.status === 'open').length;
  const fixedCount = bugs.filter((b) => b.status === 'fixed').length;
  const criticalCount = bugs.filter((b) => b.severity === 'critical').length;

  const setParam = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(searchParams);
      if (value) next.set(key, value);
      else next.delete(key);
      setSearchParams(next);
    },
    [searchParams, setSearchParams],
  );

  if (loading) {
    return (
      <div className="space-y-6">
        <SkeletonCard />
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
              <Bug size={20} className="text-red-500" />
            </span>
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('dashboard.bugsDetected')}</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">{t('overview.bug.subtitle')}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs font-medium">
            <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-red-700 dark:bg-red-900/50 dark:text-red-300">
              {criticalCount} {t('overview.bug.summary.critical')}
            </span>
            <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300">
              {openCount} {t('overview.bug.summary.open')}
            </span>
            <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-green-700 dark:bg-green-900/50 dark:text-green-300">
              {fixedCount} {t('overview.bug.summary.fixed')}
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
          <select
            value={statusFilter}
            onChange={(e) => setParam('bugStatus', e.target.value)}
            aria-label={t('overview.bug.filter.status')}
            className="h-9 rounded-md border border-gray-200 bg-white px-2 text-sm text-gray-700 outline-none focus:border-brand-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
          >
            <option value="">{t('overview.bug.filter.all')}</option>
            <option value="open">{t('overview.bug.status.open')}</option>
            <option value="fixed">{t('overview.bug.status.fixed')}</option>
            <option value="reopened">{t('overview.bug.status.reopened')}</option>
          </select>
          {repoFilter && (
            <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300">
              {repoFilter}
            </span>
          )}
          {error && <span className="text-xs text-red-600 dark:text-red-400">{error}</span>}
        </div>
      </div>

      <EvaluationPanel evaluation={evaluation} feedback={feedback} hasFailed={bugs.length > 0} />

      <div className="card">
        <div className="flex items-center gap-2">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">{t('overview.bug.listTitle')}</h3>
          <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 dark:bg-brand-900/50 dark:text-brand-300">
            {filteredBugs.length}
          </span>
        </div>
        {filteredBugs.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed border-gray-200 px-3 py-6 text-center text-sm text-gray-400 dark:border-gray-700 dark:text-gray-500">
            {bugs.length === 0 ? t('overview.bug.empty') : t('overview.bug.noMatch')}
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500 dark:border-gray-700 dark:text-gray-400">
                  <th className="pb-2 pr-4 font-medium">{t('overview.bug.col.status')}</th>
                  <th className="pb-2 pr-4 font-medium">{t('overview.bug.col.bug')}</th>
                  <th className="hidden pb-2 pr-4 font-medium lg:table-cell">{t('overview.bug.col.error')}</th>
                  <th className="pb-2 pr-4 font-medium">{t('overview.bug.col.severity')}</th>
                  <th className="pb-2 pr-4 font-medium">{t('overview.bug.col.detected')}</th>
                  <th className="pb-2 pr-4 font-medium">{t('overview.bug.col.fixed')}</th>
                  <th className="pb-2 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {filteredBugs.map((bug) => (
                  <tr key={bug.id}>
                    <td className="py-2.5 pr-4">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_BADGE[bug.status]}`}
                      >
                        {t(`overview.bug.status.${bug.status}`)}
                      </span>
                    </td>
                    <td className="py-2.5 pr-4">
                      <span className="block truncate font-mono text-xs text-brand-600 dark:text-brand-400">
                        {bug.repo}#{bug.issueNumber}
                      </span>
                      <span className="block max-w-60 truncate text-gray-700 dark:text-gray-300">{bug.issueTitle}</span>
                    </td>
                    <td className="hidden max-w-72 py-2.5 pr-4 lg:table-cell">
                      <code className="block truncate font-mono text-xs text-gray-500 dark:text-gray-400">
                        {bug.errorMessage ?? '\u2014'}
                      </code>
                    </td>
                    <td className="py-2.5 pr-4">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          bug.severity === 'critical'
                            ? 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300'
                            : 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300'
                        }`}
                      >
                        {t(`overview.verdicts.${bug.severity}`)}
                      </span>
                    </td>
                    <td className="whitespace-nowrap py-2.5 pr-4 text-xs text-gray-500 dark:text-gray-400">
                      {formatRelativeTime(bug.createdAt)}
                    </td>
                    <td className="whitespace-nowrap py-2.5 pr-4 text-xs text-gray-500 dark:text-gray-400">
                      {bug.fixedAt ? formatRelativeTime(bug.fixedAt) : '\u2014'}
                    </td>
                    <td className="py-2.5 text-right">
                      <Link
                        to={`/runs/${bug.id}`}
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
