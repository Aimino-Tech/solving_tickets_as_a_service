import { ActivityIcon, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { BillingPlan } from '@/api/client';
import { billing, runs, stats } from '@/api/client';
import type { DashboardStats, Run } from '@/api/types';
import EvaluationPanel from '@/components/EvaluationPanel';
import { SkeletonCard } from '@/components/LoadingSkeleton';
import { resolveTier } from '@/components/ProjectOverview';
import { useAuth } from '@/context/AuthContext';
import { useI18n } from '@/i18n/I18nProvider';
import type { FeedbackDelta, ProjectEvaluation } from '@/utils/evaluation';
import { aggregateRepoHealth, computeFeedbackLoop, evaluateProject } from '@/utils/evaluation';
import { formatRelativeTime } from '@/utils/format';

const SNAPSHOT_KEY = 'syntaro:project-eval-snapshot';

const EMPTY_RUNS_RESPONSE = { data: [] as Run[], total: 0, page: 1, perPage: 100, totalPages: 0 };

export default function EvaluationView() {
  const { t } = useI18n();
  const { user } = useAuth();
  const [plan, setPlan] = useState<BillingPlan | null>(null);
  const [allRuns, setAllRuns] = useState<Run[]>([]);
  const [statsData, setStatsData] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [previousEval, setPreviousEval] = useState<ProjectEvaluation | null>(null);

  const loadData = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const [planData, runsData, statsDataRes] = await Promise.all([
        billing.plan().catch(() => null),
        runs.list({ perPage: 100 }).catch(() => EMPTY_RUNS_RESPONSE),
        stats.get().catch(() => null),
      ]);
      setPlan(planData);
      setAllRuns(runsData.data);
      setStatsData(statsDataRes);
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

  const tier = useMemo(() => resolveTier(user?.plan || plan?.id), [user?.plan, plan?.id]);
  const isUnlimited = useMemo(() => {
    const limit = plan?.monthlyFixLimit;
    return typeof limit === 'number' ? limit < 0 || limit >= 999_999 : tier !== 'free' && tier !== 'solo';
  }, [plan?.monthlyFixLimit, tier]);
  const monthlyLimit = useMemo(() => {
    const apiLimit = plan?.monthlyFixLimit;
    if (typeof apiLimit === 'number') return apiLimit;
    const fallback: Record<string, number> = {
      free: 10,
      solo: 500,
      team: 999_999,
      enterprise: 999_999,
      selfHosted: 999_999,
    };
    return fallback[tier] ?? 10;
  }, [plan?.monthlyFixLimit, tier]);
  const usedFixes = useMemo(() => {
    if (statsData && typeof statsData.fixesUsedThisMonth === 'number') return statsData.fixesUsedThisMonth;
    return statsData?.totalRuns ?? allRuns.length;
  }, [statsData, allRuns]);

  const evaluation = useMemo<ProjectEvaluation>(
    () => evaluateProject({ runs: allRuns, stats: statsData, usedFixes, monthlyLimit, isUnlimited }),
    [allRuns, statsData, usedFixes, monthlyLimit, isUnlimited],
  );
  const feedback = useMemo<FeedbackDelta[]>(
    () => computeFeedbackLoop(previousEval, evaluation),
    [previousEval, evaluation],
  );
  const repoHealth = useMemo(() => aggregateRepoHealth(allRuns), [allRuns]);

  useEffect(() => {
    if (loading || allRuns.length === 0) return;
    try {
      localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(evaluation));
    } catch {
      // best-effort snapshot — quota errors must not break the view
    }
  }, [evaluation, loading, allRuns.length]);

  if (loading) {
    return (
      <div className="space-y-6">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  const totalRuns = statsData?.totalRuns ?? allRuns.length;
  const passRate = statsData && typeof statsData.passRate === 'number' ? statsData.passRate : null;

  return (
    <div className="space-y-6">
      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center justify-center rounded-md bg-brand-50 p-2 dark:bg-brand-900/50">
              <ActivityIcon size={20} className="text-brand-600 dark:text-brand-400" />
            </span>
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('overview.healthScore')}</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">{t('overview.evaluation.subtitle')}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs font-medium">
            <span className="rounded-full bg-brand-50 px-2.5 py-0.5 text-brand-700 dark:bg-brand-900/50 dark:text-brand-300">
              {evaluation.score === null ? '\u2014' : `${evaluation.score}/100`}
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

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label={t('overview.evaluation.stats.totalRuns')} value={String(totalRuns)} />
          <Stat
            label={t('overview.evaluation.stats.passRate')}
            value={passRate === null ? '\u2014' : `${Math.round(passRate)}%`}
          />
          <Stat
            label={t('overview.evaluation.stats.avgDuration')}
            value={
              statsData && typeof statsData.avgDurationSeconds === 'number'
                ? `${Math.round(statsData.avgDurationSeconds)}s`
                : '\u2014'
            }
          />
          <Stat
            label={t('overview.evaluation.stats.activeRepos')}
            value={String(statsData?.activeRepos ?? repoHealth.length)}
          />
        </div>
        {error && <p className="mt-3 text-xs text-red-600 dark:text-red-400">{error}</p>}
      </div>

      <EvaluationPanel
        evaluation={evaluation}
        feedback={feedback}
        hasFailed={allRuns.some((r) => r.status === 'failed')}
      />

      <div className="card">
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">{t('overview.evaluation.repos')}</h3>
        {repoHealth.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed border-gray-200 px-3 py-6 text-center text-sm text-gray-400 dark:border-gray-700 dark:text-gray-500">
            {t('overview.evaluation.noRepos')}
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500 dark:border-gray-700 dark:text-gray-400">
                  <th className="pb-2 pr-4 font-medium">{t('overview.evaluation.col.repo')}</th>
                  <th className="pb-2 pr-4 font-medium">{t('overview.evaluation.col.passRate')}</th>
                  <th className="pb-2 pr-4 font-medium">{t('overview.evaluation.col.bugs')}</th>
                  <th className="pb-2 pr-4 font-medium">{t('overview.evaluation.col.issues')}</th>
                  <th className="hidden pb-2 pr-4 font-medium md:table-cell">{t('overview.evaluation.col.pending')}</th>
                  <th className="hidden pb-2 pr-4 font-medium md:table-cell">{t('overview.evaluation.col.done')}</th>
                  <th className="pb-2 font-medium">{t('overview.evaluation.col.lastRun')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {repoHealth.map((repo) => (
                  <tr key={repo.repo}>
                    <td className="py-2.5 pr-4 font-mono text-xs text-brand-600 dark:text-brand-400">{repo.repo}</td>
                    <td className="py-2.5 pr-4 tabular-nums text-gray-700 dark:text-gray-300">{repo.passRate}%</td>
                    <td className="py-2.5 pr-4 tabular-nums text-gray-700 dark:text-gray-300">{repo.bugsDetected}</td>
                    <td className="py-2.5 pr-4 tabular-nums text-gray-700 dark:text-gray-300">{repo.issuesCreated}</td>
                    <td className="hidden py-2.5 pr-4 tabular-nums text-gray-700 dark:text-gray-300 md:table-cell">
                      {repo.pending}
                    </td>
                    <td className="hidden py-2.5 pr-4 tabular-nums text-gray-700 dark:text-gray-300 md:table-cell">
                      {repo.done}
                    </td>
                    <td className="whitespace-nowrap py-2.5 text-xs text-gray-500 dark:text-gray-400">
                      {formatRelativeTime(repo.lastRunAt)}
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 px-3 py-2 dark:border-gray-700">
      <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
      <p className="mt-0.5 text-lg font-bold tabular-nums text-gray-900 dark:text-gray-100">{value}</p>
    </div>
  );
}
