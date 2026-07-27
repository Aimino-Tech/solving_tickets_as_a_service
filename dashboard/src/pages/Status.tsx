import { useState, useEffect } from 'react';
import { health, sla, type HealthResponse, type SLAMetrics } from '../api/client.js';

type ServiceStatus = 'operational' | 'degraded' | 'down';

function mapCheckToStatus(check: { status: string }): ServiceStatus {
  if (check.status === 'ok' || check.status === 'disabled') return 'operational';
  if (check.status === 'degraded') return 'degraded';
  return 'down';
}

function formatMs(ms: number | null | undefined): string {
  if (ms == null) return '-';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function formatPct(value: number | null | undefined): string {
  if (value == null) return '-';
  return `${value.toFixed(1)}%`;
}

export default function Status() {
  const [healthData, setHealthData] = useState<HealthResponse | null>(null);
  const [slaMetrics, setSlaMetrics] = useState<SLAMetrics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ctrl = new AbortController();

    async function fetchData() {
      try {
        const [h, s] = await Promise.all([
          health.getStatus(),
          sla.getMetrics(),
        ]);
        if (!ctrl.signal.aborted) {
          setHealthData(h);
          setSlaMetrics(s);
        }
      } catch {
        if (!ctrl.signal.aborted) {
          try {
            const resp = await fetch('/health', { signal: ctrl.signal });
            if (resp.ok) {
              const h = await resp.json() as HealthResponse;
              setHealthData(h);
            }
          } catch {}
        }
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }

    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => {
      ctrl.abort();
      clearInterval(interval);
    };
  }, []);

  const services = healthData?.checks
    ? Object.entries(healthData.checks).map(([name, check]) => ({
        name: name.charAt(0).toUpperCase() + name.slice(1),
        status: mapCheckToStatus(check),
        description: `${name === 'database' ? 'Postgres' : name === 'rabbitmq' ? 'Message queue' : name === 'opencode' ? 'AI fix engine' : name === 'sentry' ? 'Error tracking' : name}${check.latencyMs != null ? ` (${formatMs(check.latencyMs)})` : ''}`,
        latencyMs: check.latencyMs ?? null,
        error: check.error ?? null,
      }))
    : [];

  const operationalCount = services.filter((s: { status: ServiceStatus }) => s.status === 'operational').length;
  const degradedCount = services.filter((s: { status: ServiceStatus }) => s.status === 'degraded').length;
  const downCount = services.filter((s: { status: ServiceStatus }) => s.status === 'down').length;

  return (
    <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 lg:px-8">
      <div className="text-center">
        <h1 className="text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl">System Status</h1>
        <p className="mt-4 text-lg text-gray-600">Real-time status of STAS services.</p>
      </div>

      {loading ? (
        <div className="mt-8 text-center text-gray-500">Loading...</div>
      ) : (
        <>
          <div
            className="mt-8 rounded-2xl border p-8 text-center"
            style={{
              borderColor: downCount > 0 ? '#fecaca' : degradedCount > 0 ? '#fde68a' : '#bbf7d0',
              backgroundColor: downCount > 0 ? '#fef2f2' : degradedCount > 0 ? '#fffbeb' : '#f0fdf4',
            }}
          >
            <div className="text-5xl mb-4">
              {downCount > 0 ? '\u{1F534}' : degradedCount > 0 ? '\u{1F7E1}' : '\u{1F7E2}'}
            </div>
            <h2 className="text-2xl font-bold text-gray-900">
              {downCount > 0 ? 'Service Disruption' : degradedCount > 0 ? 'Degraded Performance' : 'All Systems Operational'}
            </h2>
            <p className="mt-2 text-sm text-gray-600">
              {operationalCount} operational, {degradedCount} degraded, {downCount} down
            </p>
            {healthData?.uptime != null && (
              <p className="mt-2 text-xs text-gray-400">
                Uptime: {Math.floor(healthData.uptime / 3600)}h {Math.floor((healthData.uptime % 3600) / 60)}m
              </p>
            )}
          </div>

          <div className="mt-8 space-y-3">
            {services.map((s: { name: string; status: ServiceStatus; description: string; latencyMs: number | null; error: string | null }) => (
              <div key={s.name} className="flex items-center justify-between rounded-lg border border-gray-200 p-4">
                <div className="flex items-center gap-4">
                  <span
                    className={
                      s.status === 'operational'
                        ? 'text-green-500'
                        : s.status === 'degraded'
                          ? 'text-yellow-500'
                          : 'text-red-500'
                    }
                  >
                    {s.status === 'operational' ? '\u25CF' : s.status === 'degraded' ? '\u25D0' : '\u25CB'}
                  </span>
                  <div>
                    <p className="text-sm font-medium text-gray-900">{s.name}</p>
                    <p className="text-xs text-gray-500">{s.description}</p>
                    {s.error && <p className="text-xs text-red-500">{s.error}</p>}
                  </div>
                </div>
                <span
                  className={`badge ${s.status === 'operational' ? 'badge-success' : s.status === 'degraded' ? 'badge-warning' : 'badge-error'}`}
                >
                  {s.status === 'operational' ? 'Operational' : s.status === 'degraded' ? 'Degraded' : 'Down'}
                </span>
              </div>
            ))}
          </div>

          {slaMetrics && (
            <div className="mt-12 rounded-xl border border-gray-200 p-6">
              <h3 className="text-base font-semibold text-gray-900">SLA Metrics</h3>
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="rounded-lg bg-gray-50 p-4 text-center">
                  <p className="text-2xl font-bold text-gray-900">
                    {slaMetrics.attainmentRate != null ? `${slaMetrics.attainmentRate.toFixed(1)}%` : 'N/A'}
                  </p>
                  <p className="mt-1 text-xs text-gray-500">SLA Attainment Rate</p>
                </div>
                <div className="rounded-lg bg-gray-50 p-4 text-center">
                  <p className="text-2xl font-bold text-gray-900">{slaMetrics.totalRecorded}</p>
                  <p className="mt-1 text-xs text-gray-500">Total Fixes Tracked</p>
                </div>
                <div className="rounded-lg bg-gray-50 p-4 text-center">
                  <p className="text-2xl font-bold text-red-600">{slaMetrics.breaches}</p>
                  <p className="mt-1 text-xs text-gray-500">SLA Breaches</p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="rounded-lg bg-gray-50 p-4 text-center">
                  <p className="text-lg font-semibold text-gray-900">{formatMs(slaMetrics.fixTimesMs.p50)}</p>
                  <p className="mt-1 text-xs text-gray-500">p50 Fix Time</p>
                </div>
                <div className="rounded-lg bg-gray-50 p-4 text-center">
                  <p className="text-lg font-semibold text-gray-900">{formatMs(slaMetrics.fixTimesMs.p95)}</p>
                  <p className="mt-1 text-xs text-gray-500">p95 Fix Time</p>
                </div>
                <div className="rounded-lg bg-gray-50 p-4 text-center">
                  <p className="text-lg font-semibold text-gray-900">{formatMs(slaMetrics.fixTimesMs.p99)}</p>
                  <p className="mt-1 text-xs text-gray-500">p99 Fix Time</p>
                </div>
              </div>
              {Object.keys(slaMetrics.byTier).length > 0 && (
                <div className="mt-6">
                  <h4 className="text-sm font-medium text-gray-700 mb-3">By Tier</h4>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-xs text-gray-600">
                      <thead>
                        <tr className="border-b border-gray-200">
                          <th className="px-3 py-2 text-left font-medium">Tier</th>
                          <th className="px-3 py-2 text-right font-medium">Count</th>
                          <th className="px-3 py-2 text-right font-medium">Attainment</th>
                          <th className="px-3 py-2 text-right font-medium">Breaches</th>
                          <th className="px-3 py-2 text-right font-medium">p50</th>
                          <th className="px-3 py-2 text-right font-medium">p95</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(slaMetrics.byTier).map(([tier, data]) => (
                          <tr key={tier} className="border-b border-gray-100">
                            <td className="px-3 py-2 text-left capitalize">{tier}</td>
                            <td className="px-3 py-2 text-right">{data.count}</td>
                            <td className="px-3 py-2 text-right">{formatPct(data.attainmentRate)}</td>
                            <td className="px-3 py-2 text-right">{data.breaches}</td>
                            <td className="px-3 py-2 text-right">{formatMs(data.p50)}</td>
                            <td className="px-3 py-2 text-right">{formatMs(data.p95)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="mt-12 rounded-xl border border-gray-200 p-6">
            <h3 className="text-base font-semibold text-gray-900">Status History</h3>
            <p className="mt-2 text-sm text-gray-600">
              For full incident history visit{' '}
              <a href="https://status.stas.aimino.ai" className="text-brand-600 underline" target="_blank" rel="noopener noreferrer">
                status.stas.aimino.ai
              </a>.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
