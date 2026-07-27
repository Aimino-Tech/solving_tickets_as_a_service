import { useState, useEffect } from 'react';
import type { Run } from '@/api/types';
import { credits, runs, type CreditBalance } from '@/api/client';
import { Link } from 'react-router-dom';
import { Activity, Wallet, CheckCircle, Clock } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { SkeletonCardGrid } from '@/components/LoadingSkeleton';

export default function DashboardHome() {
  const { t } = useI18n();
  const [balance, setBalance] = useState<CreditBalance | null>(null);
  const [recentRuns, setRecentRuns] = useState<Run[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      credits.balance().catch(() => null),
      runs.list({ perPage: 5 }).catch(() => ({ data: [] as import('@/api/types').Run[], total: 0, page: 1, perPage: 5, totalPages: 0 })),
    ])
      .then(([bal, runsData]) => {
        setBalance(bal);
        setRecentRuns(runsData.data);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (error) {
    return (
      <div className="card">
        <p className="text-red-600 dark:text-red-400">{t('dashboard.failedToLoad', { error })}</p>
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
      label: 'Credit Balance',
      value: balance ? `${balance.balance.toLocaleString()} credits` : '—',
      color: 'text-brand-600 dark:text-brand-400',
      bg: 'bg-brand-50 dark:bg-brand-900/50',
      Icon: Wallet,
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
      value: '—',
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
          </div>
        ))}
      </div>

      {balance && (
        <div className="card">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Credit Overview</h3>
          <div className="mt-4 grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">Available Balance</p>
              <p className="text-2xl font-bold text-brand-600 dark:text-brand-400">{balance.balance.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">Lifetime Credits</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{balance.lifetimeCredits.toLocaleString()}</p>
            </div>
          </div>
          <div className="mt-4 flex gap-3">
            <Link to="/credits" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 transition-colors">
              Buy Credits
            </Link>
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
                  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    run.status === 'success'
                      ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                      : run.status === 'failed'
                      ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                      : run.status === 'running'
                      ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                      : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                  }`}>
                    {run.status}
                  </span>
                  {run.durationMs && (
                    <span className="hidden text-xs text-gray-400 sm:block">
                      <Clock size={12} className="inline mr-1" />
                      {run.durationMs >= 60_000
                        ? `${(run.durationMs / 60_000).toFixed(1)}m`
                        : `${Math.round(run.durationMs / 1000)}s`}
                    </span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <p className="mt-4 text-sm text-gray-400 dark:text-gray-500">
            No fixes yet — label a GitHub issue with <code className="rounded bg-gray-100 px-1 py-0.5 text-xs dark:bg-gray-800">stas:fix</code> to get started.
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
        <Link to="/credits" className="card group hover:border-brand-200 dark:hover:border-brand-700 hover:shadow-md transition-all">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 group-hover:text-brand-600 dark:group-hover:text-brand-400">
            Credits & Billing
          </h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            View your credit balance, transaction history, and purchase more credits.
          </p>
          <span className="mt-3 inline-block text-sm font-medium text-brand-600 dark:text-brand-400">
            View Credits &rarr;
          </span>
        </Link>
      </div>
    </div>
  );
}
