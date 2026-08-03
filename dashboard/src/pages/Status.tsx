import { useState, useEffect } from 'react';
import { health, sla, type HealthResponse, type SLAMetrics } from '../api/client';

function formatMs(ms: number | null | undefined): string {
  if (ms == null) return '-';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}

export default function Status() {
  const [healthData, setHealthData] = useState<HealthResponse | null>(null);
  const [slaData, setSlaData] = useState<SLAMetrics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      health.getVerbose().catch(() => null),
      sla.getMetrics().catch(() => null),
    ]).then(([h, s]) => {
      if (!cancelled) {
        setHealthData(h);
        setSlaData(s);
      }
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const checks = healthData?.checks ?? {};
  const allOk = healthData?.status === 'ok';
  const hasWarnings = Object.values(checks).some((c) => c.status === 'degraded');

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-16">
        <div className="animate-pulse space-y-8">
          <div className="h-8 w-48 rounded bg-gray-200 dark:bg-gray-700 mx-auto" />
          <div className="h-32 rounded-2xl bg-gray-100 dark:bg-gray-800" />
          {[...Array(5)].map((_, i) => <div key={i} className="h-16 rounded-lg bg-gray-100 dark:bg-gray-800" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 lg:px-8">
      <div className="text-center">
        <h1 className="text-4xl font-bold tracking-tight text-gray-900 dark:text-gray-100 sm:text-5xl">System Status</h1>
        <p className="mt-4 text-lg text-gray-600 dark:text-gray-400">Real-time status of SYNTARO services.</p>
      </div>

      <div className={`mt-8 rounded-2xl border p-8 text-center ${
        !allOk ? 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20' :
        hasWarnings ? 'border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-900/20' :
        'border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/20'
      }`}>
        <div className="text-5xl mb-4">{!allOk ? '🔴' : hasWarnings ? '🟡' : '🟢'}</div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {!allOk ? 'Service Disruption' : hasWarnings ? 'Degraded Performance' : 'All Systems Operational'}
        </h2>
        {healthData && (
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            AI Mode: {healthData.aiMode ?? 'enabled'}
          </p>
        )}
      </div>

      {/* Component Health */}
      {Object.keys(checks).length > 0 && (
        <div className="mt-8">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-3">Core Dependencies</h3>
          <div className="space-y-2">
            {Object.entries(checks).map(([name, check]) => (
              <div key={name} className="flex items-center justify-between rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                <div className="flex items-center gap-4">
                  <span className={`inline-block h-2.5 w-2.5 rounded-full ${
                    check.status === 'ok' ? 'bg-green-500' :
                    check.status === 'disabled' ? 'bg-gray-300' :
                    check.status === 'degraded' ? 'bg-yellow-500' : 'bg-red-500'
                  }`} />
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100 capitalize">{name}</p>
                    {check.latencyMs !== undefined && (
                      <p className="text-xs text-gray-500">{check.latencyMs}ms response</p>
                    )}
                    {check.error && <p className="text-xs text-red-500">{check.error}</p>}
                  </div>
                </div>
                <span className={`badge ${
                  check.status === 'ok' ? 'badge-success' :
                  check.status === 'disabled' ? 'badge' :
                  check.status === 'degraded' ? 'badge-warning' : 'badge-error'
                }`}>
                  {check.status === 'ok' ? 'Operational' :
                   check.status === 'disabled' ? 'Disabled' :
                   check.status === 'degraded' ? 'Degraded' : 'Down'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SLA Metrics */}
      {slaData && (
        <div className="mt-8">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-3">SLA Performance</h3>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 text-center">
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{formatMs(slaData.fixTimesMs?.p50)}</p>
              <p className="text-xs text-gray-500">p50 Fix Time</p>
            </div>
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 text-center">
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{formatMs(slaData.fixTimesMs?.p95)}</p>
              <p className="text-xs text-gray-500">p95 Fix Time</p>
            </div>
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 text-center">
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{formatMs(slaData.fixTimesMs?.p99)}</p>
              <p className="text-xs text-gray-500">p99 Fix Time</p>
            </div>
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 text-center">
              <p className={`text-2xl font-bold ${(slaData.attainmentRate ?? 100) < 95 ? 'text-red-600' : (slaData.attainmentRate ?? 100) < 99 ? 'text-yellow-600' : 'text-green-600'}`}>
                {slaData.attainmentRate ?? 100}%
              </p>
              <p className="text-xs text-gray-500">SLA Attainment</p>
            </div>
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 text-center">
              <p className={`text-2xl font-bold ${(slaData.breaches ?? 0) > 0 ? 'text-red-600' : 'text-gray-900 dark:text-gray-100'}`}>
                {slaData.breaches ?? 0}
              </p>
              <p className="text-xs text-gray-500">Breached ({slaData.totalRecorded ?? 0} total)</p>
            </div>
          </div>
        </div>
      )}

      <div className="mt-12 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Status History</h3>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          For full incident history visit{' '}
          <a href="https://status.syntaro.io" className="text-brand-600 underline" target="_blank" rel="noopener noreferrer">status.syntaro.io</a>.
        </p>
      </div>
    </div>
  );
}
