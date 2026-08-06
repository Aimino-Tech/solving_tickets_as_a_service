import {
  ArrowRight,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  GitBranch,
  RefreshCw,
  Zap,
} from 'lucide-react';
import { Fragment, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { BillingPlan } from '@/api/client';
import { billing, billing as billingApi, runs, stats } from '@/api/client';
import type { DashboardStats, Run } from '@/api/types';
import { SkeletonCardGrid } from '@/components/LoadingSkeleton';
import ProgressBar from '@/components/ProgressBar';
import RunFeedback from '@/components/RunFeedback';
import StatusBadge from '@/components/StatusBadge';
import { useAuth } from '@/context/AuthContext';
import { useI18n } from '@/i18n/I18nProvider';
import { syncRecommendations } from '@/services/notificationService';
import type { RepoHealth } from '@/utils/evaluation';
import { aggregateRepoHealth, buildRecommendations } from '@/utils/evaluation';
import { formatCost, formatDurationShort, formatRelativeTime } from '@/utils/format';

const POLL_INTERVAL_MS = 20_000;

const RECENT_RUNS_LIMIT = 10;

const PLAN_LIMIT_FALLBACK: Record<string, number> = {
  free: 10,
  solo: 100,
  team: 500,
  enterprise: -1,
  selfHosted: -1,
};

function resolveMonthlyLimit(planId: string, apiLimit?: number): number {
  if (typeof apiLimit === 'number') return apiLimit;
  return PLAN_LIMIT_FALLBACK[planId] ?? 10;
}

function fixesThisPeriod(dashboardStats: DashboardStats | null): number {
  if (!dashboardStats) return 0;
  if (typeof dashboardStats.fixesUsedThisMonth === 'number') return dashboardStats.fixesUsedThisMonth;
  const days = dashboardStats.runsByDay ?? [];
  if (days.length === 0) return dashboardStats.totalRuns ?? 0;
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  let sum = 0;
  let matched = false;
  for (const day of days) {
    const d = new Date(day.date);
    if (d.getFullYear() === y && d.getMonth() === m) {
      sum += day.count;
      matched = true;
    }
  }
  return matched ? sum : (dashboardStats.totalRuns ?? 0);
}

export default function DashboardHome() {
  const { t } = useI18n();
  const { user } = useAuth();
  const [plan, setPlan] = useState<BillingPlan | null>(null);
  const [recentRuns, setRecentRuns] = useState<Run[]>([]);
  const [dashboardStats, setDashboardStats] = useState<DashboardStats | null>(null);
  const [repoList, setRepoList] = useState<Array<{ id: string; owner: string; repo: string }>>([]);
  const [allRuns, setAllRuns] = useState<Run[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [portalError, setPortalError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedRepo, setExpandedRepo] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const userPlan = user?.plan || plan?.id || 'free';
  const planLabel = plan?.name || userPlan.charAt(0).toUpperCase() + userPlan.slice(1);
  const monthlyLimit = resolveMonthlyLimit(userPlan, plan?.monthlyFixLimit);
  const isUnlimited = monthlyLimit < 0 || monthlyLimit >= 999_999;
  const usedFixes = fixesThisPeriod(dashboardStats);
  const isFree = userPlan === 'free';
  const isSelfHosted = userPlan === 'selfHosted';

  async function handleOpenPortal() {
    setPortalError(null);
    try {
      const { url } = await billingApi.portal(window.location.href);
      window.location.href = url;
    } catch (err) {
      const message = err instanceof Error ? err.message : t('dashboard.portalFailed');
      if (message.toLowerCase().includes('billing record')) {
        setPortalError(t('dashboard.noSubscription'));
      } else {
        setPortalError(message);
      }
    }
  }

  async function handleCopyLabel() {
    try {
      await navigator.clipboard.writeText('syntaro:fix');
    } catch {
      // fallback: silently fail
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  useEffect(() => {
    const ac = new AbortController();
    Promise.all([
      billing.plan().catch(() => null),
      runs.list({ perPage: 100 }, { signal: ac.signal }).catch(() => ({
        data: [] as Run[],
        total: 0,
        page: 1,
        perPage: 100,
        totalPages: 0,
      })),
      stats.get().catch(() => null),
    ])
      .then(([planData, runsData, statsData]) => {
        setPlan(planData);
        setRecentRuns(runsData.data);
        setDashboardStats(statsData);
        setAllRuns(runsData.data);
      })
      .catch((err) => {
        if (err.name !== 'AbortError') setError(err.message);
      })
      .finally(() => setLoading(false));

    import('@/api/client')
      .then((mod) => mod.repos?.list?.({ signal: ac.signal }))
      .then((raw) => {
        if (Array.isArray(raw)) setRepoList(raw);
      })
      .catch(() => {});

    return () => ac.abort();
  }, []);

  useEffect(() => {
    intervalRef.current = setInterval(() => {
      const ac = new AbortController();
      abortRef.current?.abort();
      abortRef.current = ac;

      Promise.all([
        billing.plan().catch(() => null),
        runs.list({ perPage: 100 }, { signal: ac.signal }).catch(() => ({
          data: [] as Run[],
          total: 0,
          page: 1,
          perPage: 100,
          totalPages: 0,
        })),
        stats.get().catch(() => null),
      ])
        .then(([planData, runsData, statsData]) => {
          if (ac.signal.aborted) return;
          setPlan(planData);
          setRecentRuns(runsData.data);
          setDashboardStats(statsData);
          setAllRuns(runsData.data);
          setLastUpdated(new Date());
        })
        .catch(() => {});

      import('@/api/client')
        .then((mod) => mod.repos?.list?.({ signal: ac.signal }))
        .then((raw) => {
          if (!ac.signal.aborted && Array.isArray(raw)) setRepoList(raw);
        })
        .catch(() => {});
    }, POLL_INTERVAL_MS);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    const repoHealth = aggregateRepoHealth(allRuns);
    const totalBugs = repoHealth.reduce((s, r) => s + r.bugsDetected, 0);
    const hasData = allRuns.length > 0;
    const recommendations = buildRecommendations(dashboardStats, usedFixes, monthlyLimit, isUnlimited, totalBugs > 0);
    const filteredRecs = recommendations.filter((r) => {
      if ((r.id === 'pass-rate-critical' || r.id === 'pass-rate-warning') && !hasData) return false;
      return true;
    });
    syncRecommendations(
      filteredRecs.map((rec) => ({
        recId: rec.id,
        title: t(rec.titleKey),
        body: t(rec.descKey),
        type: rec.severity === 'critical' || rec.severity === 'warning' ? 'alert' : 'system',
        to: rec.to,
      })),
    );
  }, [dashboardStats, usedFixes, monthlyLimit, isUnlimited, allRuns, t]);

  async function handleRefresh() {
    setRefreshing(true);
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const [planData, runsData, statsData] = await Promise.all([
        billing.plan().catch(() => null),
        runs.list({ perPage: 100 }, { signal: ac.signal }).catch(() => ({
          data: [] as Run[],
          total: 0,
          page: 1,
          perPage: 100,
          totalPages: 0,
        })),
        stats.get().catch(() => null),
      ]);

      let repoData: Array<{ id: string; owner: string; repo: string }> = [];
      try {
        const mod = await import('@/api/client');
        const raw = await mod.repos?.list?.({ signal: ac.signal });
        repoData = Array.isArray(raw) ? raw : [];
      } catch {
        repoData = [];
      }

      if (!ac.signal.aborted) {
        setPlan(planData);
        setRecentRuns(runsData.data);
        setDashboardStats(statsData);
        setAllRuns(runsData.data);
        setRepoList(repoData);
        setLastUpdated(new Date());
      }
    } catch {
      // per-API .catch handles individual failures
    } finally {
      if (!ac.signal.aborted) setRefreshing(false);
    }
  }

  if (error) {
    return (
      <div className="card">
        <p className="text-red-600 dark:text-red-400">{t('dashboard.failedToLoad', { error })}</p>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{t('dashboard.unableToLoad')}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-12 rounded-lg bg-gray-200 dark:bg-gray-700 animate-pulse" />
        <SkeletonCardGrid count={4} />
      </div>
    );
  }

  const passRate =
    dashboardStats && typeof dashboardStats.passRate === 'number'
      ? `${Math.round(dashboardStats.passRate)}%`
      : '\u2014';
  const activeRepos = dashboardStats ? String(dashboardStats.activeRepos) : '\u2014';

  const repoHealth = aggregateRepoHealth(allRuns);
  const totalBugs = repoHealth.reduce((s, r) => s + r.bugsDetected, 0);
  const totalIssues = repoHealth.reduce((s, r) => s + r.issuesCreated, 0);
  const totalPending = repoHealth.reduce((s, r) => s + r.pending, 0);
  const totalDone = repoHealth.reduce((s, r) => s + r.done, 0);
  const hasData = allRuns.length > 0;
  const showNoRepos = repoList.length === 0 && allRuns.length === 0;

  return (
    <div className="space-y-6">
      {/* Header row: plan strip + refresh + updated indicator */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-2.5 dark:border-slate-800 dark:bg-slate-900">
        <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{planLabel}</span>
        <span className="text-xs text-gray-500 dark:text-gray-400">{t('dashboard.fixesThisPeriod')}</span>
        {!isUnlimited && (
          <>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {usedFixes}/{monthlyLimit}
            </span>
            <ProgressBar
              className="w-24"
              value={usedFixes}
              max={monthlyLimit}
              barClassName={
                usedFixes / monthlyLimit >= 0.8 ? 'bg-amber-500 dark:bg-amber-400' : 'bg-brand-600 dark:bg-brand-500'
              }
            />
          </>
        )}
        {isUnlimited && <span className="text-xs text-gray-500 dark:text-gray-400">{t('dashboard.unlimited')}</span>}
        {isFree && (
          <Link to="/billing" className="btn-secondary !px-3 !py-1.5 !text-xs ml-auto">
            {t('dashboard.manageBilling')}
          </Link>
        )}
        {!isFree && !isSelfHosted && (
          <div className="flex items-center gap-2 ml-auto">
            {plan?.hasBillingRecord ? (
              <button type="button" onClick={handleOpenPortal} className="btn-primary !px-3 !py-1.5 !text-xs">
                {t('dashboard.manageSubscription')}
              </button>
            ) : (
              <a href="https://syntaro.io/pricing" className="btn-primary !px-3 !py-1.5 !text-xs">
                {t('dashboard.subscribe')}
              </a>
            )}
            <Link to="/usage-limits" className="btn-secondary !px-3 !py-1.5 !text-xs">
              {t('dashboard.viewUsage')}
            </Link>
          </div>
        )}
        {portalError && <span className="text-xs text-red-600 dark:text-red-400">{portalError}</span>}
        <div className="flex items-center gap-2 ml-auto sm:ml-0">
          {lastUpdated && (
            <span className="text-xs text-gray-400 dark:text-gray-500">
              {t('dashboard.updatedAgo', { time: formatRelativeTime(lastUpdated) })}
            </span>
          )}
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className="inline-flex min-h-[44px] items-center justify-center rounded-md p-1.5 text-gray-400 transition-colors hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-50"
            aria-label={t('dashboard.refresh')}
          >
            <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Summary chips: repo health aggregates */}
      {hasData && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="badge-error">
            {t('dashboard.bugsDetected')}: {totalBugs}
          </span>
          <span className="badge-info">
            {t('dashboard.issuesCreated')}: {totalIssues}
          </span>
          <span className="badge-warning">
            {t('dashboard.pendingRuns')}: {totalPending}
          </span>
          <span className="badge-success">
            {t('dashboard.doneVerified')}: {totalDone}
          </span>
        </div>
      )}

      {/* Secondary chips: always visible */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="badge-neutral">
          <span>{t('dashboard.activeRepos')}</span>: <span>{activeRepos}</span>
        </span>
        <span className="badge-neutral">
          <span>{t('dashboard.passRate')}</span>: <span>{passRate}</span>
        </span>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {t('dashboard.totalRunsLabel')}: {dashboardStats ? String(dashboardStats.totalRuns) : '\u2014'}
        </p>
      </div>

      {/* Free user upgrade CTA */}
      {isFree && (
        <div className="card">
          <div className="flex items-start gap-3">
            <div className="inline-flex rounded-lg bg-brand-50 p-2 dark:bg-brand-900/50">
              <CheckCircle size={20} className="text-brand-600 dark:text-brand-400" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                {t('dashboard.upgradeToSolo')}
              </h3>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t('dashboard.upgradeSoloDesc')}</p>
              <div className="mt-3 flex flex-wrap gap-3">
                <a
                  href="https://syntaro.io/pricing"
                  className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
                >
                  {t('dashboard.viewPlans')}
                </a>
                <Link
                  to="/billing"
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800"
                >
                  {t('dashboard.manageBilling')}
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Repository health overview */}
      {repoHealth.length > 0 && (
        <div className="card">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">{t('dashboard.repoHealth')}</h3>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700">
                  <th className="pb-2 pr-4 text-left font-medium text-gray-500 dark:text-gray-400">
                    {t('dashboard.connectedRepos')}
                  </th>
                  <th className="pb-2 pr-4 text-right font-medium text-gray-500 dark:text-gray-400">
                    {t('dashboard.bugsDetected')}
                  </th>
                  <th className="pb-2 pr-4 text-right font-medium text-gray-500 dark:text-gray-400">
                    {t('dashboard.issuesCreated')}
                  </th>
                  <th className="pb-2 pr-4 text-right font-medium text-gray-500 dark:text-gray-400">
                    {t('dashboard.pendingRuns')}
                  </th>
                  <th className="pb-2 pr-4 text-right font-medium text-gray-500 dark:text-gray-400">
                    {t('dashboard.doneVerified')}
                  </th>
                  <th className="pb-2 pr-4 text-right font-medium text-gray-500 dark:text-gray-400">
                    {t('dashboard.passRate')}
                  </th>
                  <th className="pb-2 text-right font-medium text-gray-500 dark:text-gray-400">
                    {t('dashboard.lastRun')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {repoHealth.map((repo: RepoHealth) => {
                  const isExpanded = expandedRepo === repo.repo;
                  return (
                    <Fragment key={repo.repo}>
                      <tr
                        className="cursor-pointer transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/50"
                        onClick={() => setExpandedRepo(isExpanded ? null : repo.repo)}
                      >
                        <td className="py-2 pr-4">
                          <div className="flex items-center gap-1.5">
                            {repo.bugsDetected > 0 ? (
                              <ChevronDown size={14} className="shrink-0 text-gray-400 dark:text-gray-500" />
                            ) : (
                              <ChevronRight size={14} className="shrink-0 text-gray-400 dark:text-gray-500" />
                            )}
                            <Link
                              to={`/runs?repo=${repo.repo}`}
                              className="font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {repo.repo}
                            </Link>
                          </div>
                        </td>
                        <td className="py-2 pr-4 text-right tabular-nums">
                          {repo.bugsDetected > 0 ? (
                            <span className="text-red-600 dark:text-red-400">{repo.bugsDetected}</span>
                          ) : (
                            <span className="text-gray-400 dark:text-gray-500">0</span>
                          )}
                        </td>
                        <td className="py-2 pr-4 text-right tabular-nums text-gray-900 dark:text-gray-100">
                          {repo.issuesCreated}
                        </td>
                        <td className="py-2 pr-4 text-right tabular-nums">
                          {repo.pending > 0 ? (
                            <span className="text-amber-600 dark:text-amber-400">{repo.pending}</span>
                          ) : (
                            <span className="text-gray-400 dark:text-gray-500">0</span>
                          )}
                        </td>
                        <td className="py-2 pr-4 text-right tabular-nums text-green-600 dark:text-green-400">
                          {repo.done}
                        </td>
                        <td className="py-2 pr-4 text-right tabular-nums text-gray-900 dark:text-gray-100">
                          {repo.passRate}%
                        </td>
                        <td className="py-2 text-right text-xs text-gray-400 dark:text-gray-500">
                          {formatRelativeTime(repo.lastRunAt)}
                        </td>
                      </tr>
                      {isExpanded && repo.failedRuns.length > 0 && (
                        <tr>
                          <td colSpan={7} className="px-4 py-2 bg-gray-50 dark:bg-gray-800/30">
                            <div className="space-y-1.5">
                              {repo.failedRuns.map((fr) => (
                                <div key={fr.id} className="flex items-start gap-2 text-xs">
                                  <span className="font-mono text-red-600 dark:text-red-400 shrink-0">
                                    #{fr.issueNumber}
                                  </span>
                                  {fr.errorMessage && (
                                    <span className="font-mono text-red-500 dark:text-red-400 truncate max-w-xs">
                                      {fr.errorMessage}
                                    </span>
                                  )}
                                </div>
                              ))}
                              <Link
                                to={`/runs?repo=${repo.repo}&status=failed`}
                                className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
                              >
                                {t('dashboard.viewFailedRuns')} <ArrowRight size={12} />
                              </Link>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Link
            to="/repos"
            className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
          >
            {t('dashboard.manageRepos')} <ArrowRight size={14} />
          </Link>
        </div>
      )}

      {/* No repos + no runs: full zero state */}
      {showNoRepos && (
        <div className="card text-center py-8">
          <p className="text-sm text-gray-400 dark:text-gray-500">{t('dashboard.noReposConnected')}</p>
          <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">{t('dashboard.noReposConnectedDesc')}</p>
          <div className="mt-4 flex justify-center">
            <Link to="/repos" className="btn-primary !text-xs">
              {t('dashboard.connectRepo')}
            </Link>
          </div>
        </div>
      )}

      {/* Has repos but no runs: first-fix guide */}
      {repoList.length > 0 && allRuns.length === 0 && (
        <div className="card">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">{t('dashboard.getStartedTitle')}</h3>
          <ol className="mt-3 space-y-2 text-sm text-gray-600 dark:text-gray-400">
            <li className="flex items-start gap-2">
              <span className="font-bold text-brand-600 dark:text-brand-400">1.</span>
              <span>
                {t('dashboard.getStartedStep1')}{' '}
                <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-mono dark:bg-gray-800">
                  syntaro:fix
                </code>
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="font-bold text-brand-600 dark:text-brand-400">2.</span>
              <span>{t('dashboard.getStartedStep2')}</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="font-bold text-brand-600 dark:text-brand-400">3.</span>
              <span>{t('dashboard.getStartedStep3')}</span>
            </li>
          </ol>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleCopyLabel}
              className="btn-primary !text-xs inline-flex items-center gap-1.5"
            >
              {copied ? t('dashboard.copied') : t('dashboard.copyLabel')}
              {copied ? <CheckCircle size={14} /> : <Copy size={14} />}
            </button>
            <Link to="/repos" className="btn-secondary !text-xs">
              {t('dashboard.connectRepo')} <ArrowRight size={14} className="inline" />
            </Link>
          </div>
        </div>
      )}

      {/* Recent Fix Runs */}
      <div className="card">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">{t('dashboard.recentFixRuns')}</h3>
          <Link
            to="/runs"
            className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
          >
            {t('dashboard.viewAll')} <ArrowRight size={14} />
          </Link>
        </div>
        {recentRuns.length > 0 ? (
          <div className="mt-3 space-y-1.5">
            {recentRuns.slice(0, RECENT_RUNS_LIMIT).map((run) => (
              <Link
                key={run.id}
                to={`/runs/${run.id}`}
                className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-1.5 transition-colors hover:border-brand-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:border-brand-700 dark:hover:bg-gray-800"
              >
                <div className="min-w-0 flex-1">
                  <span className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                    {run.repoOwner}/{run.repoName}#{run.issueNumber}
                  </span>
                </div>
                <div className="ml-3 flex items-center gap-2 shrink-0">
                  <StatusBadge status={run.status} />
                  {run.durationSeconds != null && (
                    <span className="hidden text-xs text-gray-400 sm:inline-flex items-center">
                      <Clock size={12} className="mr-0.5" />
                      {formatDurationShort(run.durationSeconds)}
                    </span>
                  )}
                  {run.costCents != null && (
                    <span className="hidden text-xs text-gray-400 sm:inline">{formatCost(run.costCents)}</span>
                  )}
                  <RunFeedback runId={run.id} />
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-gray-400 dark:text-gray-500">
            {t('dashboard.noRuns', { label: 'syntaro:fix' })}
          </p>
        )}
      </div>

      {/* Shortcut cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Link
          to="/repos"
          className="card group transition-all hover:border-brand-200 hover:shadow-md dark:hover:border-brand-700"
        >
          <div className="flex items-center gap-2">
            <GitBranch size={18} className="text-brand-600 dark:text-brand-400" />
            <h3 className="text-base font-semibold text-gray-900 group-hover:text-brand-600 dark:text-gray-100 dark:group-hover:text-brand-400">
              {t('dashboard.connectedRepos')}
            </h3>
          </div>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t('dashboard.manageReposDesc')}</p>
          <span className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-brand-600 dark:text-brand-400">
            {t('dashboard.manageRepos')} <ArrowRight size={14} />
          </span>
        </Link>
        <Link
          to="/billing"
          className="card group transition-all hover:border-brand-200 hover:shadow-md dark:hover:border-brand-700"
        >
          <div className="flex items-center gap-2">
            <Zap size={18} className="text-brand-600 dark:text-brand-400" />
            <h3 className="text-base font-semibold text-gray-900 group-hover:text-brand-600 dark:text-gray-100 dark:group-hover:text-brand-400">
              {t('dashboard.planAndUsage')}
            </h3>
          </div>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t('dashboard.planAndUsageDesc')}</p>
          <span className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-brand-600 dark:text-brand-400">
            {t('dashboard.manageBilling')} <ArrowRight size={14} />
          </span>
        </Link>
      </div>
    </div>
  );
}
