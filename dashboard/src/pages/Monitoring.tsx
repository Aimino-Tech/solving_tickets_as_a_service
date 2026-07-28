import { useState, useEffect } from 'react';
import { SkeletonCard } from '@/components/LoadingSkeleton';

interface MonitoringData {
  status: string;
  enabled: boolean;
  running: boolean;
  lastRunAt: string | null;
  logFilePath: string;
  logFileSize: number;
  totalLogErrors: number;
  totalWebhookErrors: number;
  totalRunErrors: number;
  totalTicketsCreated: number;
  lastError: string | null;
}

const POLL_INTERVAL = 10_000;

export default function Monitoring() {
  const [data, setData] = useState<MonitoringData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetchStatus() {
      try {
        const res = await fetch('/api/monitoring/status');
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled) setData(json);
      } catch {
        // ignore polling errors
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchStatus();
    const interval = setInterval(fetchStatus, POLL_INTERVAL);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  function fmtBytes(bytes: number): string {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function statusColor(s: string): string {
    if (s === 'running') return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400';
    if (s === 'idle') return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400';
    return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-400';
  }

  if (loading) {
    return <div className="space-y-6"><SkeletonCard /><SkeletonCard /></div>;
  }

  const stats = [
    { label: 'Log File', value: fmtBytes(data?.logFileSize ?? 0), sub: data?.logFilePath ?? '—' },
    { label: 'Last Run', value: data?.lastRunAt ? new Date(data.lastRunAt).toLocaleTimeString() : '—', sub: 'Auto-refresh 10s' },
    { label: 'Mode', value: data?.status?.toUpperCase() ?? '—', sub: data?.running ? 'Scanning...' : 'Idle' },
    { label: 'Tickets Created', value: String(data?.totalTicketsCreated ?? 0), sub: 'Via Linear API', accent: true },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Monitoring</h1>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${statusColor(data?.status ?? '')}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${data?.running ? 'bg-current animate-pulse' : 'bg-current'}`} />
          {data?.status?.toUpperCase() ?? 'OFF'}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">{s.label}</p>
            <p className={`mt-1 text-2xl font-bold ${s.accent ? 'text-brand-600 dark:text-brand-400' : 'text-gray-900 dark:text-gray-100'}`}>
              {s.value}
            </p>
            {s.sub && <p className="mt-1 truncate text-xs text-gray-400 dark:text-gray-500">{s.sub}</p>}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Log Errors', value: data?.totalLogErrors ?? 0, color: 'text-yellow-600 dark:text-yellow-400', bg: 'bg-yellow-50 dark:bg-yellow-900/10' },
          { label: 'Webhook Failures', value: data?.totalWebhookErrors ?? 0, color: 'text-red-600 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-900/10' },
          { label: 'Run Failures', value: data?.totalRunErrors ?? 0, color: 'text-orange-600 dark:text-orange-400', bg: 'bg-orange-50 dark:bg-orange-900/10' },
          { label: 'Last Error', value: data?.lastError ? 'Yes' : 'None', color: data?.lastError ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400', bg: data?.lastError ? 'bg-red-50 dark:bg-red-900/10' : 'bg-green-50 dark:bg-green-900/10' },
        ].map((m) => (
          <div key={m.label} className={`rounded-xl border border-gray-200 p-4 shadow-sm dark:border-gray-700 ${m.bg}`}>
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">{m.label}</p>
            <p className={`mt-1 text-3xl font-bold ${m.color}`}>{m.value}</p>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <div className="border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100">Infrastructure</p>
        </div>
        <div className="divide-y divide-gray-200 dark:divide-gray-700">
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-sm text-gray-600 dark:text-gray-300">Log File Path</span>
            <code className="rounded bg-gray-100 px-2 py-0.5 text-xs font-mono text-gray-800 dark:bg-gray-700 dark:text-gray-200">{data?.logFilePath || '—'}</code>
          </div>
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-sm text-gray-600 dark:text-gray-300">Log File Size</span>
            <span className="text-sm text-gray-900 dark:text-gray-100">{fmtBytes(data?.logFileSize ?? 0)}</span>
          </div>
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-sm text-gray-600 dark:text-gray-300">Linear Team ID</span>
            <code className="rounded bg-gray-100 px-2 py-0.5 text-xs font-mono text-gray-800 dark:bg-gray-700 dark:text-gray-200">{data?.lastError ? 'Active' : 'Connected'}</code>
          </div>
        </div>
      </div>

      {data?.lastError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/10">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-red-600 dark:text-red-400">Last Error</p>
          <pre className="overflow-x-auto whitespace-pre-wrap text-xs text-red-700 dark:text-red-300">{data.lastError}</pre>
        </div>
      )}

      <p className="text-center text-xs text-gray-400 dark:text-gray-600">
        Auto-refresh every 10 seconds · Last updated: {data?.lastRunAt ? new Date(data.lastRunAt).toLocaleString() : '—'}
      </p>
    </div>
  );
}
