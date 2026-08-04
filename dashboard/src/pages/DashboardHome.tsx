import { useState, useEffect } from 'react';
import type { Run, DashboardStats } from '@/api/types';
import { billing, runs, stats, type BillingPlan } from '@/api/client';
import { Link } from 'react-router-dom';
import { Activity, CheckCircle, Clock, Sparkles } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useI18n } from '@/i18n/I18nProvider';
import { SkeletonCardGrid } from '@/components/LoadingSkeleton';
import StatusBadge from '@/components/StatusBadge';
import { formatDurationShort } from '@/utils/format';

const PLAN_LABELS: Record<string, string> = {
  free: 'Free',
  solo: 'Solo',
  team: 'Team',
  enterprise: 'Enterprise',
  selfHosted: 'Self-Hosted',
};

const PLAN_LIMITS: Record<string, number> = {
  free: 10,
  solo: 500,
  team: -1, // unlimited
  enterprise: -1,
  selfHosted: -1,
};

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
  const planLabel = PLAN_LABELS[userPlan] || userPlan;
  const monthlyLimit = PLAN_LIMITS[userPlan] ?? 10;
  const isUnlimited = monthlyLimit === -1;

  async function handleOpenPortal() {
    setPortalError(null);
    try {
      const { url } = await billing.portal(window.location.href);
      window.location.href = url;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to open billing portal';
      if (message.toLowerCase().includes('billing record')) {
        setPortalError('No subscription found. Subscribe first.');
      } else {
        setPortalError(message);
      }
    }
  }

  useEffect(() => {
    const ac = new AbortController();
    Promise.all([
      billing.plan().catch(() => null),
      runs.list({ perPage: 5 }, { signal: ac.signal }).catch(() => ({ data: [] as import('@/api/types').Run[], total: 0, page: 1, perPage: 5, totalPages: 0 })),
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
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
          Unable to load dashboard data. Please try again later.
        </p>
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

  const cards = [
    {
      label: 'Current Plan',
      value: planLabel,
      sub: isUnlimited ? 'Unlimited fixes' : `${monthlyLimit} fixes/mo`,
      color: 'text-brand-600 dark:text-brand-400',
      bg: 'bg-brand-50 dark:bg-brand-900/50',
      Icon: Sparkles,
    },
    {
      label: 'Total Fix Runs',
      value: recentRuns.length > 0 ? String(recentRuns.length) : '0',
      color: 'text-green-600 dark:text-green-400',
      bg: 'bg-green-50 dark:bg-green-900/50',
      Icon: CheckCircle,
    },
    {
      label: 'Active Repos',
      value: dashboardStats ? String(dashboardStats.activeRepos) : '\u2014',
      color: 'text-amber-600 dark:text-amber-400',
      bg: 'bg-amber-50 dark:bg-amber-900/50',
      Icon: Activity,
    },
  ];

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => (
          <div key={card.label} className="card">
            <div className={`inline-flex rounded-lg ${card.bg} p-2`}>
              <card.Icon className={card.color} size={24} />
            </div>
            <p className="mt-3 text-sm font-medium text-gray-500 dark:text-gray-400">{card.label}</p>
            <p className={`mt-1 text-3xl font-bold ${card.color}`}>{card.value}</p>
            {card.sub && (
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{card.sub}</p>
            )}
          </div>
        ))}
      </div>

      {userPlan !== 'free' && userPlan !== 'selfHosted' && (
        <div className="card">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Plan Overview</h3>
          <div className="mt-4 grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">Plan</p>
              <p className="text-2xl font-bold text-brand-600 dark:text-brand-400">{planLabel}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">Monthly Fixes</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                {isUnlimited ? 'Unlimited' : monthlyLimit.toLocaleString()}
              </p>
            </div>
          </div>
          <div className="mt-4 flex gap-3">
            {plan?.hasBillingRecord ? (
              <button
                onClick={handleOpenPortal}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 transition-colors"
              >
                Manage Subscription
              </button>
            ) : (
              <a href="https://syntaro.io/pricing" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 transition-colors">
                Subscribe
              </a>
            )}
          </div>
          {portalError && (
            <p className="mt-2 text-sm text-red-600 dark:text-red-400">{portalError}</p>
          )}
        </div>
      )}

      {userPlan === 'free' && (
        <div className="card">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Upgrade to Solo</h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Get 500 fixes/mo, priority support, and more for just $49/mo.
          </p>
          <div className="mt-4 flex gap-3">
            <a href="https://syntaro.io/pricing" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 transition-colors">
              View Plans
            </a>
          </div>
        </div>
      )}

      <div className="card">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Recent Fix Runs</h3>
          <Link to="/runs" className="text-sm font-medium text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300">
            View All &rarr;
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
                      <Clock size={12} className="inline mr-1" />
                      {formatDurationShort(run.durationSeconds)}
                    </span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <p className="mt-4 text-sm text-gray-400 dark:text-gray-500">
            No fixes yet &mdash; label a GitHub issue with <code className="rounded bg-gray-100 px-1 py-0.5 text-xs dark:bg-gray-800">syntaro:fix</code> to get started.
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <Link to="/repos" className="card group hover:border-brand-200 dark:hover:border-brand-700 hover:shadow-md transition-all">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 group-hover:text-brand-600 dark:group-hover:text-brand-400">
            Connected Repos
          </h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Manage your GitHub repositories and webhook connections.
          </p>
          <span className="mt-3 inline-block text-sm font-medium text-brand-600 dark:text-brand-400">
            Manage Repos &rarr;
          </span>
        </Link>
        <Link to="/billing" className="card group hover:border-brand-200 dark:hover:border-brand-700 hover:shadow-md transition-all">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 group-hover:text-brand-600 dark:group-hover:text-brand-400">
            Subscription & Billing
          </h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Manage your subscription plan, credit balance, and usage.
          </p>
          <span className="mt-3 inline-block text-sm font-medium text-brand-600 dark:text-brand-400">
            Manage Billing &rarr;
          </span>
        </Link>
      </div>
    </div>
  );
}
