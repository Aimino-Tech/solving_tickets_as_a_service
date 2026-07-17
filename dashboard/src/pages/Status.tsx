import { useState, useEffect } from 'react';

const SERVICES = [
  { name: 'Webhook Receiver', status: 'operational' as const, description: 'Accepts incoming GitHub issue labels' },
  { name: 'Fix Runner', status: 'operational' as const, description: 'Executes AI-powered fix investigations' },
  { name: 'Sandbox Environment', status: 'operational' as const, description: 'Isolated code execution environment' },
  { name: 'PR Creator', status: 'operational' as const, description: 'Creates pull requests with fixes' },
  { name: 'API', status: 'operational' as const, description: 'REST API for dashboard and integrations' },
  { name: 'Dashboard', status: 'operational' as const, description: 'Web dashboard and analytics' },
];

type ServiceStatus = 'operational' | 'degraded' | 'down';

export default function Status() {
  const [health, setHealth] = useState<{ status: string; uptime: number } | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    fetch('/health', { signal: ctrl.signal }).then(r => r.json()).then(setHealth).catch(() => {});
    return () => ctrl.abort();
  }, []);

  const operationalCount = SERVICES.filter((s: { status: ServiceStatus }) => s.status === 'operational').length;
  const degradedCount = SERVICES.filter((s: { status: ServiceStatus }) => s.status === 'degraded').length;
  const downCount = SERVICES.filter((s: { status: ServiceStatus }) => s.status === 'down').length;

  return (
    <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 lg:px-8">
      <div className="text-center"><h1 className="text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl">System Status</h1><p className="mt-4 text-lg text-gray-600">Real-time status of STAS services.</p></div>
      <div className="mt-8 rounded-2xl border p-8 text-center" style={{ borderColor: downCount > 0 ? '#fecaca' : degradedCount > 0 ? '#fde68a' : '#bbf7d0', backgroundColor: downCount > 0 ? '#fef2f2' : degradedCount > 0 ? '#fffbeb' : '#f0fdf4' }}>
        <div className="text-5xl mb-4">{downCount > 0 ? '🔴' : degradedCount > 0 ? '🟡' : '🟢'}</div>
        <h2 className="text-2xl font-bold text-gray-900">{downCount > 0 ? 'Service Disruption' : degradedCount > 0 ? 'Degraded Performance' : 'All Systems Operational'}</h2>
        <p className="mt-2 text-sm text-gray-600">{operationalCount} operational, {degradedCount} degraded, {downCount} down</p>
        {health && <p className="mt-2 text-xs text-gray-400">API uptime: {Math.floor(health.uptime / 3600)}h {Math.floor((health.uptime % 3600) / 60)}m</p>}
      </div>
      <div className="mt-8 space-y-3">{SERVICES.map(s => (
        <div key={s.name} className="flex items-center justify-between rounded-lg border border-gray-200 p-4">
          <div className="flex items-center gap-4">
            <span className={s.status === 'operational' ? 'text-green-500' : s.status === 'degraded' ? 'text-yellow-500' : 'text-red-500'}>{s.status === 'operational' ? '●' : s.status === 'degraded' ? '◐' : '○'}</span>
            <div><p className="text-sm font-medium text-gray-900">{s.name}</p><p className="text-xs text-gray-500">{s.description}</p></div>
          </div>
          <span className={`badge ${s.status === 'operational' ? 'badge-success' : s.status === 'degraded' ? 'badge-warning' : 'badge-error'}`}>{s.status === 'operational' ? 'Operational' : s.status === 'degraded' ? 'Degraded' : 'Down'}</span>
        </div>
      ))}</div>
      <div className="mt-12 rounded-xl border border-gray-200 p-6"><h3 className="text-base font-semibold text-gray-900">Status History</h3><p className="mt-2 text-sm text-gray-600">For full incident history visit <a href="https://status.stas.aimino.ai" className="text-brand-600 underline" target="_blank" rel="noopener noreferrer">status.stas.aimino.ai</a>.</p></div>
    </div>
  );
}
