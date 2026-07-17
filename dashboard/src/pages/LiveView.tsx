import { useState, useEffect, useCallback } from 'react';
import { runs } from '@/api/client';
import type { Run } from '@/api/types';
import { Link } from 'react-router-dom';
import {
  Activity,
  CheckCircle,
  Clock,
  AlertTriangle,
  RefreshCw,
  Zap,
  TrendingUp,
  Timer,
} from 'lucide-react';
import { formatDateTime, formatDurationSeconds } from '@/utils/format';
import { SkeletonCardGrid, SkeletonTable } from '@/components/LoadingSkeleton';

const POLL_INTERVAL_MS = 30_000;

type SystemStatus = 'operational' | 'degraded' | 'down';

function getSystemStatus(runs: Run[]): SystemStatus {
  const recent = runs.slice(0, 20);
  if (recent.length === 0) return 'operational';
  const failedCount = recent.filter((r) => r.status === 'failed').length;
  if (failedCount / recent.length > 0.5) return 'down';
  if (failedCount / recent.length > 0.2) return 'degraded';
  return 'operational';
}

const statusColors: Record<SystemStatus, string> = {
  operational: 'bg-green-500',
  degraded: 'bg-amber-500',
  down: 'bg-red-500',
};

const statusLabels: Record<SystemStatus, string> = {
  operational: 'All Systems Operational',
  degraded: 'Degraded Performance',
  down: 'Major Outage',
};

const runStatusStyles: Record<Run['status'], { bg: string; text: string; dot: string }> = {
  queued: { bg: 'bg-gray-100 dark:bg-gray-700', text: 'text-gray-600 dark:text-gray-300', dot: 'bg-gray-400' },
  running: { bg: 'bg-blue-50 dark:bg-blue-900/40', text: 'text-blue-600 dark:text-blue-400', dot: 'bg-blue-500 animate-pulse' },
  success: { bg: 'bg-green-50 dark:bg-green-900/40', text: 'text-green-600 dark:text-green-400', dot: 'bg-green-500' },
  failed: { bg: 'bg-red-50 dark:bg-red-900/40', text: 'text-red-600 dark:text-red-400', dot: 'bg-red-500' },
  cancelled: { bg: 'bg-amber-50 dark:bg-amber-900/40', text: 'text-amber-600 dark:text-amber-400', dot: 'bg-amber-500' },
};

function RunRow({ run }: { run: Run }) {
  const style = runStatusStyles[run.status];
  return (
    <tr className="border-b border-gray-100 dark:border-gray-700 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${style.dot}`} />
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${style.bg} ${style.text}`}>
            {run.status}
          </span>
        </div>
      </td>
      <td className="px-4 py-3">
        <Link
          to={`/runs/${run.id}`}
          className="text-sm font-medium text-brand-600 dark:text-brand-400 hover:underline"
        >
          #{run.issueNumber}
        </Link>
      </td>
      <td className="px-4 py-3">
        <p className="text-sm text-gray-900 dark:text-gray-100 truncate max-w-[240px]">{run.issueTitle}</p>
      </td>
      <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
        {run.repoOwner}/{run.repoName}
      </td>
      <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
        {run.durationSeconds != null ? formatDurationSeconds(run.durationSeconds) : '—'}
      </td>
      <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
        {formatDateTime(run.updatedAt)}
      </td>
    </tr>
  );
}

export default function LiveView() {
  const [allRuns, setAllRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchData = useCallback(async (silent = false) => {
    try {
      if (silent) setIsRefreshing(true);
      const response = await runs.list({ perPage: 50 });
      setAllRuns(response.data);
      setLastRefresh(new Date());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load pipeline data');
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(() => fetchData(true), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchData]);

  const queuedRuns = allRuns.filter((r) => r.status === 'queued');
  const activeRuns = allRuns.filter((r) => r.status === 'running');
  const recentCompleted = allRuns
    .filter((r) => r.status === 'success' || r.status === 'failed')
    .slice(0, 10);

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayRuns = allRuns.filter((r) => new Date(r.createdAt) >= todayStart);
  const todaySuccesses = todayRuns.filter((r) => r.status === 'success').length;
  const successRateToday = todayRuns.length > 0 ? todaySuccesses / todayRuns.length : 0;

  const completedRuns = allRuns.filter((r) => r.durationSeconds != null);
  const avgFixTime = completedRuns.length > 0
    ? completedRuns.reduce((sum, r) => sum + (r.durationSeconds ?? 0), 0) / completedRuns.length
    : 0;

  const systemStatus = getSystemStatus(allRuns);

  if (loading) {
    return (
      <div className="space-y-8">
        <div className="space-y-2">
          <div className="h-8 w-72 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
          <div className="h-5 w-48 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
        </div>
        <SkeletonCardGrid count={4} />
        <div className="card">
          <SkeletonTable rows={5} columns={6} />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card">
        <p className="text-red-600 dark:text-red-400">Failed to load pipeline data: {error}</p>
        <button
          onClick={() => fetchData()}
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 transition-colors"
        >
          <RefreshCw size={14} />
          Retry
        </button>
      </div>
    );
  }

  const statCards = [
    {
      label: 'Queue Depth',
      value: String(queuedRuns.length),
      icon: Clock,
      color: 'text-blue-600 dark:text-blue-400',
      bg: 'bg-blue-50 dark:bg-blue-900/50',
    },
    {
      label: 'Active Fixes',
      value: String(activeRuns.length),
      icon: Zap,
      color: 'text-amber-600 dark:text-amber-400',
      bg: 'bg-amber-50 dark:bg-amber-900/50',
    },
    {
      label: 'Success Rate Today',
      value: `${(successRateToday * 100).toFixed(1)}%`,
      icon: TrendingUp,
      color: successRateToday >= 0.7 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400',
      bg: successRateToday >= 0.7 ? 'bg-green-50 dark:bg-green-900/50' : 'bg-red-50 dark:bg-red-900/50',
    },
    {
      label: 'Avg Fix Time',
      value: formatDurationSeconds(avgFixTime),
      icon: Timer,
      color: 'text-purple-600 dark:text-purple-400',
      bg: 'bg-purple-50 dark:bg-purple-900/50',
    },
  ];

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Operator Command Center
          </h1>
          <div className="mt-1 flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${statusColors[systemStatus]}`} />
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {statusLabels[systemStatus]}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400 dark:text-gray-500">
            Last refresh: {lastRefresh.toLocaleTimeString()}
          </span>
          <button
            onClick={() => fetchData(true)}
            disabled={isRefreshing}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
            Refresh
          </button>
          <span className="text-xs text-gray-400 dark:text-gray-500">
            Auto-refresh: 30s
          </span>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {statCards.map((card) => (
          <div key={card.label} className="card">
            <div className={`inline-flex rounded-lg ${card.bg} p-2`}>
              <card.Icon className={card.color} size={24} />
            </div>
            <p className="mt-3 text-sm font-medium text-gray-500 dark:text-gray-400">{card.label}</p>
            <p className={`mt-1 text-3xl font-bold ${card.color}`}>{card.value}</p>
          </div>
        ))}
      </div>

      {/* Active Runs Queue */}
      {activeRuns.length > 0 && (
        <div className="card">
          <div className="flex items-center gap-2">
            <Activity className="text-blue-500" size={20} />
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              Active Runs ({activeRuns.length})
            </h3>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-700/50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Issue</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Title</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Repo</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Duration</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {activeRuns.map((run) => (
                  <RunRow key={run.id} run={run} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Queued Runs */}
      {queuedRuns.length > 0 && (
        <div className="card">
          <div className="flex items-center gap-2">
            <Clock className="text-gray-400" size={20} />
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              Queued ({queuedRuns.length})
            </h3>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-700/50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Issue</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Title</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Repo</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Duration</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {queuedRuns.map((run) => (
                  <RunRow key={run.id} run={run} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Last 10 Completed Runs */}
      <div className="card">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle className="text-green-500" size={20} />
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              Recent Completed Runs
            </h3>
          </div>
          <Link
            to="/runs"
            className="text-sm font-medium text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300"
          >
            View all &rarr;
          </Link>
        </div>
        {recentCompleted.length > 0 ? (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-700/50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Issue</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Title</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Repo</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Duration</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Completed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {recentCompleted.map((run) => (
                  <RunRow key={run.id} run={run} />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="mt-4 flex items-center gap-2 text-sm text-gray-400 dark:text-gray-500">
            <AlertTriangle size={16} />
            No completed runs yet today
          </div>
        )}
      </div>
    </div>
  );
}
