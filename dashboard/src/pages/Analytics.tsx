import { useState, useEffect } from 'react';
import { stats } from '@/api/client';
import type { DashboardStats } from '@/api/types';
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
  Legend,
} from 'recharts';
import { formatNumber, formatDate } from '@/utils/format';

export default function Analytics() {
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
        <p className="text-red-600">Failed to load analytics: {error}</p>
      </div>
    );
  }

  if (!data) {
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

  const costData = data.costByDay.map((d) => ({
    date: new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    cost: d.costCents / 100,
  }));

  const fixRateData = data.fixRateByWeek.map((d) => ({
    week: d.week,
    rate: Number((d.rate * 100).toFixed(1)),
  }));

  const runsByDayData = data.runsByDay.map((d) => ({
    date: new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    Total: d.count,
    Passed: d.passed,
  }));

  return (
    <div className="space-y-8">
      {/* Summary metrics */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
        <MetricCard
          label="Overall Pass Rate"
          value={`${(data.passRate * 100).toFixed(1)}%`}
          trend={data.passRate >= 0.7 ? 'up' : data.passRate >= 0.5 ? 'neutral' : 'down'}
        />
        <MetricCard
          label="Total Runs"
          value={String(data.totalRuns)}
          trend="neutral"
        />
        <MetricCard
          label="Avg Cost / Run"
          value={data.costByDay.length > 0
            ? `$${(data.costByDay.reduce((s, d) => s + d.costCents, 0) / Math.max(data.costByDay.length, 1) / 100).toFixed(2)}`
            : '—'}
          trend="neutral"
        />
      </div>

      {/* Fix Rate Over Time */}
      <div className="card">
        <h3 className="text-base font-semibold text-gray-900">Fix Rate Over Time</h3>
        {fixRateData.length > 0 ? (
          <div className="mt-4 overflow-x-auto">
            <div className="min-w-[400px]" style={{ height: 300 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={fixRateData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="week" tick={{ fontSize: 12 }} stroke="#9ca3af" />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} stroke="#9ca3af" unit="%" />
                  <Tooltip
                    formatter={(value: number) => [`${value}%`, 'Fix Rate']}
                    contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb' }}
                  />
                  <Line
                    type="monotone"
                    dataKey="rate"
                    stroke="#6366f1"
                    strokeWidth={2}
                    dot={{ r: 3, fill: '#6366f1' }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        ) : (
          <p className="mt-4 text-sm text-gray-400">Not enough data yet.</p>
        )}
      </div>

      {/* Runs per day */}
      <div className="card">
        <h3 className="text-base font-semibold text-gray-900">Runs Per Day</h3>
        {runsByDayData.length > 0 ? (
          <div className="mt-4 overflow-x-auto">
            <div className="min-w-[400px]" style={{ height: 300 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={runsByDayData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="date" tick={{ fontSize: 12 }} stroke="#9ca3af" />
                  <YAxis tick={{ fontSize: 12 }} stroke="#9ca3af" />
                  <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb' }} />
                  <Legend />
                  <Bar dataKey="Total" fill="#a5b4fc" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Passed" fill="#4ade80" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        ) : (
          <p className="mt-4 text-sm text-gray-400">No run data available yet.</p>
        )}
      </div>

      {/* Cost per fix */}
      <div className="card">
        <h3 className="text-base font-semibold text-gray-900">Cost Per Fix</h3>
        {costData.length > 0 ? (
          <div className="mt-4 overflow-x-auto">
            <div className="min-w-[400px]" style={{ height: 300 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={costData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="date" tick={{ fontSize: 12 }} stroke="#9ca3af" />
                  <YAxis tick={{ fontSize: 12 }} stroke="#9ca3af" unit="$" />
                  <Tooltip
                    formatter={(value: number) => [`$${value.toFixed(2)}`, 'Cost']}
                    contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb' }}
                  />
                  <Line
                    type="monotone"
                    dataKey="cost"
                    stroke="#f59e0b"
                    strokeWidth={2}
                    dot={{ r: 3, fill: '#f59e0b' }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        ) : (
          <p className="mt-4 text-sm text-gray-400">No cost data available yet.</p>
        )}
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  trend,
}: {
  label: string;
  value: string;
  trend: 'up' | 'down' | 'neutral';
}) {
  const trendColors = {
    up: 'text-green-600',
    down: 'text-red-600',
    neutral: 'text-brand-600',
  };

  return (
    <div className="card">
      <p className="text-sm text-gray-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${trendColors[trend]}`}>{value}</p>
    </div>
  );
}
