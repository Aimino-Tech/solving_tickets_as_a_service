import { useState, useEffect, useCallback, useRef } from 'react';
import { runs } from '@/api/client';
import type { Run } from '@/api/types';
import { Link } from 'react-router-dom';
import { formatDateTime, formatDurationSeconds } from '@/utils/format';
import { SkeletonCardGrid, SkeletonTable } from '@/components/LoadingSkeleton';

const POLL_INTERVAL_MS = 30_000;

type SystemStatus = 'operational' | 'degraded' | 'down';

interface MetricCard {
  label: string;
  value: string;
  icon: string;
  color: string;
  bg: string;
}

const METRICS: MetricCard[] = [
  { label: 'Queue Depth', value: '—', icon: 'M', color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-900/20' },
  { label: 'Active Fixes', value: '—', icon: 'A', color: 'text-green-600', bg: 'bg-green-50 dark:bg-green-900/20' },
  { label: 'Success Rate', value: '—', icon: 'C', color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-900/20' },
  { label: 'Avg Fix Time', value: '—', icon: 'T', color: 'text-purple-600', bg: 'bg-purple-50 dark:bg-purple-900/20' },
];

export default function LiveView() {
  const [recentRuns, setRecentRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [time, setTime] = useState(new Date());
  const abortRef = useRef<AbortController | null>(null);

  // AIM-3595: AbortController for polling to cancel stale requests
  const fetchRuns = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const data = await runs.list({ perPage: 10 }, { signal: controller.signal });
      if (!controller.signal.aborted) {
        // AIM-3585: Safe array fallback - handle malformed responses
        setRecentRuns(Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : []);
      }
    } catch { /* ignore */ }
    if (!controller.signal.aborted) {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRuns();
    const i = setInterval(fetchRuns, POLL_INTERVAL_MS);
    return () => {
      clearInterval(i);
      abortRef.current?.abort();
    };
  }, [fetchRuns]);
  useEffect(() => { const i = setInterval(() => setTime(new Date()), 1000); return () => clearInterval(i); }, []);

  // AIM-3612: Fix queue badge - only count queued, not running
  const queueDepth = recentRuns.filter(r => r.status === 'queued').length;
  const activeFixes = recentRuns.filter(r => r.status === 'running').length;

  // AIM-3606: Exclude in-progress from success rate
  const completedRuns = recentRuns.filter(r => r.status !== 'running' && r.status !== 'queued');
  const successCount = completedRuns.filter(r => r.status === 'success').length;
  const successRate = completedRuns.length > 0 ? Math.round((successCount / completedRuns.length) * 100) : 0;

  // AIM-3607: Exclude in-progress from avg fix time
  const avgDuration = completedRuns.length > 0
    ? completedRuns.reduce((s, r) => s + (r.durationSeconds ?? 0), 0) / completedRuns.length
    : 0;

  const metrics: MetricCard[] = METRICS.map(m => {
    if (m.label === 'Queue Depth') return { ...m, value: String(queueDepth) };
    if (m.label === 'Active Fixes') return { ...m, value: String(activeFixes) };
    if (m.label === 'Success Rate') return { ...m, value: `${successRate}%` };
    if (m.label === 'Avg Fix Time') return { ...m, value: avgDuration > 60 ? `${Math.round(avgDuration / 60)}m` : `${Math.round(avgDuration)}s` };
    return m;
  });

  if (loading) return <div className="p-6"><SkeletonCardGrid count={4} /><div className="mt-6"><SkeletonTable rows={5} columns={5} /></div></div>;

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Operator Command Center</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Live at {time.toLocaleTimeString()}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${queueDepth > 0 ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-gray-50 text-gray-500 dark:bg-gray-800 dark:text-gray-400'}`}>
            <span className={`h-2 w-2 rounded-full ${queueDepth > 0 ? 'bg-green-500' : 'bg-gray-300'}`} />
            {queueDepth > 0 ? `${queueDepth} in queue` : 'Idle'}
          </span>
        </div>
      </div>

      {/* Metric Cards */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {metrics.map((m, i) => (
          <div key={i} className={`rounded-xl border border-gray-200 p-4 dark:border-gray-700 dark:bg-gray-800 ${m.bg}`}>
            <div className="flex items-center gap-3">
              <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${m.bg}`}>
                <span className={`text-lg font-bold ${m.color}`}>{m.icon}</span>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{m.label}</p>
                <p className={`text-xl font-bold ${m.color}`}>{m.value}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Recent Runs */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700">
        <div className="border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Recent Activity</h2>
        </div>
        <div className="divide-y divide-gray-200 dark:divide-gray-700">
          {recentRuns.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-gray-500">No recent activity.</div>
          ) : recentRuns.slice(0, 10).map((run) => (
            <div key={run.id} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:flex-nowrap">
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                run.status === 'success' ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                run.status === 'failed' ? 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
                run.status === 'running' ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' :
                'bg-gray-50 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
              }`}>{run.status}</span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                {run.repoOwner}/{run.repoName}#{run.issueNumber}
              </span>
              {/* AIM-3613: Fix 0 duration falsy check - use != null instead of truthy check */}
              <span className="hidden text-xs text-gray-500 sm:inline dark:text-gray-400">{run.durationSeconds != null ? `${run.durationSeconds}s` : '—'}</span>
              <span className="hidden text-xs text-gray-500 sm:inline dark:text-gray-400">{run.createdAt ? formatDateTime(run.createdAt) : ''}</span>
              {run.id && <Link to={`/runs/${run.id}`} className="text-xs font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400">View</Link>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
