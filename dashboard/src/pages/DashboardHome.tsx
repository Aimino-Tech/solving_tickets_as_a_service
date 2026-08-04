import { useState, useEffect } from 'react';
import type { Run, DashboardStats } from '@/api/types';
import { billing, runs, stats, type BillingPlan } from '@/api/client';
import { Link } from 'react-router-dom';
import { Activity, CheckCircle, Clock, GitBranch, Percent, Sparkles } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useI18n } from '@/i18n/I18nProvider';
import { SkeletonCardGrid } from '@/components/LoadingSkeleton';
import StatusBadge from '@/components/StatusBadge';
import ProgressBar from '@/components/ProgressBar';
import { formatDurationShort } from '@/utils/format';

/** Fallback limits aligned with AGENTS.md / product pricing (API wins when present). */
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

/** Sum runs in the current calendar month from stats.runsByDay; fall back to totalRuns. */
function fixesThisPeriod(dashboardStats: DashboardStats | null): number {
  if (!dashboardStats) return 0;
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
  return matched ? sum : dashboardStats.totalRuns ?? 0;
}

export default function DashboardHome() {
  const { t } = useI18n();
  const { user } = useAuth();
  const [plan, setPlan] = useState<BillingPlan | null>(null);
  const [recentRuns, setRecentRuns] = useState<Run[]>([]);
  const [dashboardStats, setDashboardStats] = useState<DashboardStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [portalError, setPortalError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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
      const { url } = await billing.portal(window.location.href);
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

  useEffect(() => {
    const ac = new AbortController();
    Promise.all([
      billing.plan().catch(() => null),
      runs.list({ perPage: 5 }, { signal: ac.signal }).catch(() => ({
        data: [] as Run[],
        total: 0,
        page: 1,
        perPage: 5,
        totalPages: 0,
      })),
      stats.get().catch(() => null),
    ])
      .then(([planData, runsData, statsData]) => {
        setPlan(planData);
        setRecentRuns(runsData.data);
        setDashboardStats(statsData);
      })
      .catch((err) => {
        if (err.name !== 'AbortError') setError(err.message);
      })
      .finally(() => setLoading(false));
    return () => ac.abort();
  }, []);

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
      <div className="space-y-8">
        <SkeletonCardGrid count={3} />
      </div>
    );
  }

  const passRate =
    dashboardStats && typeof dashboardStats.passRate === 'number'
      ? `${Math.round(dashboardStats.passRate)}%`
      : '\u2014';
  const avgDuration =
    dashboardStats && typeof dashboardStats.avgDurationSeconds === 'number'
      ? formatDurationShort(dashboardStats.avgDurationSeconds)
      : '\u2014';
  const activeRepos = dashboardStats ? String(dashboardStats.activeRepos) : '\u2014';

  const usageSub = isUnlimited
    ? t('dashboard.unlimited')
    : t('dashboard.fixesOfLimit', { used: usedFixes, limit: monthlyLimit });

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <div className="card">
          <div className="inline-flex rounded-lg bg-brand-50 p-2 dark:bg-brand-900/50">
            <Sparkles className="text-brand-600 dark:text-brand-400" size={24} />
          </div>
          <p className="mt-3 text-sm font-medium text-gray-500 dark:text-gray-400">
            {t('dashboard.fixesThisPeriod')}
          </p>
          <p className="mt-1 text-3xl font-bold text-brand-600 dark:text-brand-400">
            {isUnlimited ? usedFixes : `${usedFixes}/${monthlyLimit}`}
          </p>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {planLabel} · {usageSub}
          </p>
          {!isUnlimited && (
            <ProgressBar
              className="mt-3"
              value={usedFixes}
              max={monthlyLimit}
              barClassName={
                usedFixes / monthlyLimit >= 0.9
                  ? 'bg-amber-500 dark:bg-amber-400'
                  : 'bg-brand-600 dark:bg-brand-500'
              }
            />
          )}
        </div>

        <div className="card">
          <div className="inline-flex rounded-lg bg-green-50 p-2 dark:bg-green-900/50">
            <Percent className="text-green-600 dark:text-green-400" size={24} />
          </div>
          <p className="mt-3 text-sm font-medium text-gray-500 dark:text-gray-400">
            {t('dashboard.passRate')}
          </p>
          <p className="mt-1 text-3xl font-bold text-green-600 dark:text-green-400">{passRate}</p>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {t('dashboard.avgDuration')}: {avgDuration}
          </p>
        </div>

        <div className="card">
          <div className="inline-flex rounded-lg bg-amber-50 p-2 dark:bg-amber-900/50">
            <Activity className="text-amber-600 dark:text-amber-400" size={24} />
          </div>
          <p className="mt-3 text-sm font-medium text-gray-500 dark:text-gray-400">
            {t('dashboard.activeRepos')}
          </p>
          <p className="mt-1 text-3xl font-bold text-amber-600 dark:text-amber-400">{activeRepos}</p>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {t('dashboard.totalRuns')}:{' '}
            {dashboardStats ? String(dashboardStats.totalRuns) : '\u2014'}
          </p>
        </div>
      </div>

      {!isFree && !isSelfHosted && (
        <div className="card">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            {t('dashboard.planOverview')}
          </h3>
          <div className="mt-4 grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">{t('dashboard.currentPlan')}</p>
              <p className="text-2xl font-bold text-brand-600 dark:text-brand-400">{planLabel}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">{t('dashboard.monthlyFixes')}</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                {isUnlimited ? t('dashboard.unlimited') : monthlyLimit.toLocaleString()}
              </p>
            </div>
          </div>
          <div className="mt-4 flex gap-3">
            {plan?.hasBillingRecord ? (
              <button
                onClick={handleOpenPortal}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
              >
                {t('dashboard.manageSubscription')}
              </button>
            ) : (
              <a
                href="https://syntaro.io/pricing"
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
              >
                {t('dashboard.subscribe')}
              </a>
            )}
            <Link
              to="/usage-limits"
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              {t('dashboard.viewUsage')}
            </Link>
          </div>
          {portalError && (
            <p className="mt-2 text-sm text-red-600 dark:text-red-400">{portalError}</p>
          )}
        </div>
      )}

      {isFree && (
        <div className="card">
          <div className="flex items-start gap-3">
            <div className="inline-flex rounded-lg bg-brand-50 p-2 dark:bg-brand-900/50">
              <CheckCircle className="text-brand-600 dark:text-brand-400" size={20} />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                {t('dashboard.upgradeToSolo')}
              </h3>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {t('dashboard.upgradeSoloDesc')}
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
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

      <div className="card">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            {t('dashboard.recentFixRuns')}
          </h3>
          <Link
            to="/runs"
            className="text-sm font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
          >
            {t('dashboard.viewAll')} →
          </Link>
        </div>
        {recentRuns.length > 0 ? (
          <div className="mt-4 space-y-3">
            {recentRuns.map((run) => (
              <Link
                key={run.id}
                to={`/runs/${run.id}`}
                className="flex items-center justify-between rounded-lg border border-gray-200 p-3 transition-colors hover:border-brand-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:border-brand-700 dark:hover:bg-gray-800"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                    {run.repoOwner}/{run.repoName}#{run.issueNumber}
                  </p>
                  <p className="truncate text-xs text-gray-500 dark:text-gray-400">{run.issueTitle}</p>
                </div>
                <div className="ml-4 flex items-center gap-3">
                  <StatusBadge status={run.status} />
                  {run.durationSeconds != null && (
                    <span className="hidden text-xs text-gray-400 sm:block">
                      <Clock size={12} className="mr-1 inline" />
                      {formatDurationShort(run.durationSeconds)}
                    </span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <p className="mt-4 text-sm text-gray-400 dark:text-gray-500">
            {t('dashboard.noRuns', { label: 'syntaro:fix' })}
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
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
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {t('dashboard.manageReposDesc')}
          </p>
          <span className="mt-3 inline-block text-sm font-medium text-brand-600 dark:text-brand-400">
            {t('dashboard.manageRepos')} →
          </span>
        </Link>
        <Link
          to="/billing"
          className="card group transition-all hover:border-brand-200 hover:shadow-md dark:hover:border-brand-700"
        >
          <div className="flex items-center gap-2">
            <Sparkles size={18} className="text-brand-600 dark:text-brand-400" />
            <h3 className="text-base font-semibold text-gray-900 group-hover:text-brand-600 dark:text-gray-100 dark:group-hover:text-brand-400">
              {t('dashboard.planAndUsage')}
            </h3>
          </div>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {t('dashboard.planAndUsageDesc')}
          </p>
          <span className="mt-3 inline-block text-sm font-medium text-brand-600 dark:text-brand-400">
            {t('dashboard.manageBilling')} →
          </span>
        </Link>
      </div>
    </div>
  );
}
