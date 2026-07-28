import { useState, useEffect } from 'react';
import { kpi } from '@/api/client';
import type { KpiMetric } from '@/api/types';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Area,
  AreaChart,
} from 'recharts';
import { formatNumber, formatPercentage, formatDate } from '@/utils/format';

export default function KpiDashboard() {
  const [metrics, setMetrics] = useState<KpiMetric[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    kpi
      .get({ days: 90 })
      .then((res: any) => { if (!cancelled) setMetrics(res.metrics); })
      .catch((err: Error) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="card animate-pulse">
            <div className="h-5 w-48 rounded bg-gray-200" />
            <div className="mt-4 h-48 rounded bg-gray-200" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="card">
        <p className="text-red-600">Failed to load KPI data: {error}</p>
        <p className="mt-2 text-sm text-gray-500">
          KPI data requires the <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs">x-admin-key</code> header. The
          Celery beat task in{' '}
          <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs">workers/tasks/kpi_etl.py</code> must run daily to
          populate the <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs">kpi_metrics</code> table.
        </p>
      </div>
    );
  }

  const latest = metrics[0];
  const prev = metrics[1];

  function trend(current: number, previous: number | undefined): 'up' | 'down' | 'neutral' {
    if (previous === undefined) return 'neutral';
    if (current > previous) return 'up';
    if (current < previous) return 'down';
    return 'neutral';
  }

  const latestRate = latest ? (latest.fixCompletionRate * 100).toFixed(1) : '—';
  const prevRate = prev ? (prev.fixCompletionRate * 100).toFixed(1) : undefined;
  const latestChurn = latest ? (latest.churnRate * 100).toFixed(2) : '—';
  const prevChurn = prev ? (prev.churnRate * 100).toFixed(2) : undefined;
  const latestViral = latest ? latest.viralCoefficient.toFixed(3) : '—';
  const prevViral = prev ? prev.viralCoefficient.toFixed(3) : undefined;
  const latestRevenue = latest ? `$${(latest.netRevenueCents / 100).toLocaleString()}` : '—';
  const prevRevenue = prev ? prev.netRevenueCents / 100 : undefined;

  const kpiCards = [
    {
      label: 'Active Repos (MA)',
      value: String(latest?.activeReposMa ?? '—'),
      trend: trend(latest?.activeReposMa ?? 0, prev?.activeReposMa),
    },
    {
      label: 'Fix Completion Rate',
      value: `${latestRate}%`,
      trend: trend(Number(latestRate), prevRate ? Number(prevRate) : undefined),
    },
    {
      label: 'Free → Paid Conversion',
      value: String(latest?.freeToPaidConversion ?? '—'),
      trend: trend(latest?.freeToPaidConversion ?? 0, prev?.freeToPaidConversion),
    },
    {
      label: 'Net Revenue',
      value: latestRevenue,
      trend: trend(latest?.netRevenueCents ?? 0, prev ? prev.netRevenueCents : undefined),
    },
    {
      label: 'Churn Rate',
      value: `${latestChurn}%`,
      trend:
        latestChurn !== '—' && prevChurn !== undefined
          ? Number(latestChurn) <= Number(prevChurn)
            ? 'up'
            : 'down'
          : 'neutral',
      invert: true,
    },
    {
      label: 'Viral Coeff (K)',
      value: latestViral,
      trend: trend(Number(latestViral), prevViral ? Number(prevViral) : undefined),
    },
    {
      label: 'Paid Accounts',
      value: String(latest?.paidAccounts ?? '—'),
      trend: trend(latest?.paidAccounts ?? 0, prev?.paidAccounts),
    },
  ];

  const sorted = [...metrics].sort(
    (a, b) => new Date(a.snapshotDate).getTime() - new Date(b.snapshotDate).getTime(),
  );

  const activeReposData = sorted.map((m) => ({
    date: new Date(m.snapshotDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    repos: m.activeReposMa,
  }));

  const fixRateData = sorted.map((m) => ({
    date: new Date(m.snapshotDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    rate: Number((m.fixCompletionRate * 100).toFixed(1)),
  }));

  const revenueData = sorted.map((m) => ({
    date: new Date(m.snapshotDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    revenue: m.netRevenueCents / 100,
  }));

  const conversionData = sorted.map((m) => ({
    date: new Date(m.snapshotDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    converted: m.freeToPaidConversion,
  }));

  const churnData = sorted.map((m) => ({
    date: new Date(m.snapshotDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    rate: Number((m.churnRate * 100).toFixed(2)),
  }));

  const viralData = sorted.map((m) => ({
    date: new Date(m.snapshotDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    k: m.viralCoefficient,
  }));

  const paidAccountsData = sorted.map((m) => ({
    date: new Date(m.snapshotDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    paid: m.paidAccounts,
    free: m.freeAccounts,
  }));

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpiCards.map((card) => {
          const trendColors: Record<string, string> = {
            up: card.invert ? 'text-red-600' : 'text-green-600',
            down: card.invert ? 'text-green-600' : 'text-red-600',
            neutral: 'text-brand-600',
          };
          const trendArrows: Record<string, string> = { up: '\u2191', down: '\u2193', neutral: '\u2192' };
          return (
            <div key={card.label} className="card">
              <p className="text-sm text-gray-500">{card.label}</p>
              <p className={`mt-1 text-2xl font-bold ${trendColors[card.trend]}`}>{card.value}</p>
              <p className={`mt-0.5 text-xs ${trendColors[card.trend]}`}>
                {trendArrows[card.trend]} vs previous day
              </p>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="card">
          <h3 className="text-base font-semibold text-gray-900">Active Repos (Monthly Active)</h3>
          {activeReposData.length > 1 ? (
            <div className="mt-4" style={{ height: 250 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={activeReposData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="#9ca3af" />
                  <YAxis tick={{ fontSize: 11 }} stroke="#9ca3af" />
                  <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb' }} />
                  <Area type="monotone" dataKey="repos" stroke="#6366f1" fill="#6366f1" fillOpacity={0.15} strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="mt-4 text-sm text-gray-400">Need at least 2 data points.</p>
          )}
        </div>

        <div className="card">
          <h3 className="text-base font-semibold text-gray-900">Fix Completion Rate</h3>
          {fixRateData.length > 1 ? (
            <div className="mt-4" style={{ height: 250 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={fixRateData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="#9ca3af" />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} stroke="#9ca3af" unit="%" />
                  <Tooltip formatter={(value: number) => [`${value}%`, 'Fix Rate']} contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb' }} />
                  <Line type="monotone" dataKey="rate" stroke="#22c55e" strokeWidth={2} dot={{ r: 3, fill: '#22c55e' }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="mt-4 text-sm text-gray-400">Need at least 2 data points.</p>
          )}
        </div>

        <div className="card">
          <h3 className="text-base font-semibold text-gray-900">Net Revenue</h3>
          {revenueData.length > 1 ? (
            <div className="mt-4" style={{ height: 250 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={revenueData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="#9ca3af" />
                  <YAxis tick={{ fontSize: 11 }} stroke="#9ca3af" unit="$" />
                  <Tooltip formatter={(value: number) => [`$${value.toFixed(2)}`, 'Revenue']} contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb' }} />
                  <Area type="monotone" dataKey="revenue" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.15} strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="mt-4 text-sm text-gray-400">Need at least 2 data points.</p>
          )}
        </div>

        <div className="card">
          <h3 className="text-base font-semibold text-gray-900">Free → Paid Conversion</h3>
          {conversionData.length > 1 ? (
            <div className="mt-4" style={{ height: 250 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={conversionData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="#9ca3af" />
                  <YAxis tick={{ fontSize: 11 }} stroke="#9ca3af" />
                  <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb' }} />
                  <Bar dataKey="converted" fill="#a855f7" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="mt-4 text-sm text-gray-400">Need at least 2 data points.</p>
          )}
        </div>

        <div className="card">
          <h3 className="text-base font-semibold text-gray-900">Churn Rate</h3>
          {churnData.length > 1 ? (
            <div className="mt-4" style={{ height: 250 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={churnData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="#9ca3af" />
                  <YAxis tick={{ fontSize: 11 }} stroke="#9ca3af" unit="%" domain={[0, 'auto']} />
                  <Tooltip formatter={(value: number) => [`${value}%`, 'Churn']} contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb' }} />
                  <Line type="monotone" dataKey="rate" stroke="#ef4444" strokeWidth={2} dot={{ r: 3, fill: '#ef4444' }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="mt-4 text-sm text-gray-400">Need at least 2 data points.</p>
          )}
        </div>

        <div className="card">
          <h3 className="text-base font-semibold text-gray-900">Viral Coefficient (K)</h3>
          {viralData.length > 1 ? (
            <div className="mt-4" style={{ height: 250 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={viralData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="#9ca3af" />
                  <YAxis tick={{ fontSize: 11 }} stroke="#9ca3af" domain={[0, 'auto']} />
                  <Tooltip formatter={(value: number) => [value.toFixed(3), 'K-factor']} contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb' }} />
                  <Line type="monotone" dataKey="k" stroke="#06b6d4" strokeWidth={2} dot={{ r: 3, fill: '#06b6d4' }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="mt-4 text-sm text-gray-400">Need at least 2 data points.</p>
          )}
        </div>
      </div>

      {paidAccountsData.length > 1 && (
        <div className="card">
          <h3 className="text-base font-semibold text-gray-900">Account Mix: Free vs Paid</h3>
          <div className="mt-4" style={{ height: 250 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={paidAccountsData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="#9ca3af" />
                <YAxis tick={{ fontSize: 11 }} stroke="#9ca3af" />
                <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb' }} />
                <Bar dataKey="free" name="Free" stackId="a" fill="#d1d5db" radius={[0, 0, 0, 0]} />
                <Bar dataKey="paid" name="Paid" stackId="a" fill="#6366f1" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          {metrics.length > 0
            ? `${metrics.length} daily snapshots available (${metrics[metrics.length - 1]?.snapshotDate} \u2013 ${metrics[0]?.snapshotDate})`
            : 'No data yet'}
        </p>
        <a
          href={kpi.exportUrl(90)}
          download
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 transition-colors"
        >
          Export CSV
        </a>
      </div>
    </div>
  );
}
