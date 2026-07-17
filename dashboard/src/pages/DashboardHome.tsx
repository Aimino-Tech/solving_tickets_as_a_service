import { useState, useEffect } from 'react';
import { stats } from '@/api/client';
import type { DashboardStats } from '@/api/types';
import { Link } from 'react-router-dom';
import { Activity, CheckCircle, Clock, FolderGit } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';

export default function DashboardHome() {
  const { t } = useI18n();
  const [data, setData] = useState<DashboardStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    stats
      .get()
      .then(setData)
      .catch((err) => setError(err.message));
  }, []);

  if (error) {
    return (
      <div className="card">
        <p className="text-red-600">{t('dashboard.failedToLoad', { error })}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="card animate-pulse">
            <div className="h-4 w-24 rounded bg-gray-200" />
            <div className="mt-3 h-8 w-16 rounded bg-gray-200" />
          </div>
        ))}
      </div>
    );
  }

  const cards = [
    {
      label: 'Total Runs',
      value: formatNumber(data.totalRuns),
      color: 'text-brand-600',
      bg: 'bg-brand-50',
      Icon: Activity,
    },
    {
      label: 'Pass Rate',
      value: formatPercentage(data.passRate),
      color: 'text-green-600',
      bg: 'bg-green-50',
      Icon: CheckCircle,
    },
    {
      label: 'Avg Duration',
      value: formatDurationSeconds(data.avgDurationSeconds),
      color: 'text-blue-600',
      bg: 'bg-blue-50',
      Icon: Clock,
    },
    {
      label: 'Active Repos',
      value: formatNumber(data.activeRepos),
      color: 'text-amber-600',
      bg: 'bg-amber-50',
      Icon: FolderGit,
    },
  ];

  return (
    <div className="space-y-8">
      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <div key={card.label} className="card">
            <div className={`inline-flex rounded-lg ${card.bg} p-2`}>
              <card.Icon className={card.color} size={24} />
            </div>
            <p className="mt-3 text-sm font-medium text-gray-500">{card.label}</p>
            <p className={`mt-1 text-3xl font-bold ${card.color}`}>{card.value}</p>
          </div>
        ))}
      </div>

      {/* Recent runs chart */}
      <div className="card">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900">{t('dashboard.recentRuns')}</h3>
          <Link to="/runs" className="text-sm font-medium text-brand-600 hover:text-brand-700">
            {t('dashboard.viewAll')} &rarr;
          </Link>
        </div>
        {data.runsByDay.length > 0 ? (
          <div className="mt-4">
            <div className="flex items-end gap-1" style={{ height: 160 }}>
              {data.runsByDay.map((day) => {
                const maxCount = Math.max(...data.runsByDay.map((d) => d.count), 1);
                const height = (day.count / maxCount) * 100;
                const passHeight = day.passed > 0 ? (day.passed / day.count) * height : 0;
                return (
                  <div
                    key={day.date}
                    className="flex flex-1 flex-col items-center justify-end gap-0.5"
                    title={`${day.date}: ${day.passed}/${day.count} passed`}
                  >
                    <div
                      className="w-full max-w-[32px] rounded-t bg-green-400 transition-all"
                      style={{ height: `${Math.max(passHeight, 0)}%` }}
                    />
                    <div
                      className="w-full max-w-[32px] rounded-t bg-brand-300 transition-all"
                      style={{ height: `${Math.max(height - passHeight, 0)}%` }}
                    />
                    <span className="mt-1 text-[10px] text-gray-400">
                      {new Date(day.date).getDate()}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="mt-2 flex items-center gap-4 text-xs text-gray-500">
              <span className="flex items-center gap-1">
                <span className="inline-block h-2.5 w-2.5 rounded bg-brand-300" /> {t('dashboard.total')}
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-2.5 w-2.5 rounded bg-green-400" /> {t('dashboard.passed')}
              </span>
            </div>
          </div>
        ) : (
          <p className="mt-4 text-sm text-gray-400">{t('dashboard.noRuns', { label: 'stas:fix' })}</p>
        )}
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <Link to="/repos" className="card group hover:border-brand-200 hover:shadow-md transition-all">
          <h3 className="text-base font-semibold text-gray-900 group-hover:text-brand-600">
            {t('dashboard.connectedRepos')}
          </h3>
          <p className="mt-1 text-sm text-gray-500">
            {t('dashboard.manageReposDesc')}
          </p>
          <span className="mt-3 inline-block text-sm font-medium text-brand-600">
            {t('dashboard.manageRepos')} &rarr;
          </span>
        </Link>
        <Link to="/analytics" className="card group hover:border-brand-200 hover:shadow-md transition-all">
          <h3 className="text-base font-semibold text-gray-900 group-hover:text-brand-600">
            {t('dashboard.analyticsTitle')}
          </h3>
          <p className="mt-1 text-sm text-gray-500">
            {t('dashboard.analyticsDesc')}
          </p>
          <span className="mt-3 inline-block text-sm font-medium text-brand-600">
            {t('dashboard.viewAnalytics')} &rarr;
          </span>
        </Link>
      </div>
    </div>
  );
}
