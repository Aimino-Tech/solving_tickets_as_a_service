import { useState, useEffect } from 'react';
import { benchmarks } from '@/api/client';
import type { BenchmarkEntry, BenchmarkPrice } from '@/api/types';

export default function Benchmarks() {
  const [data, setData] = useState<BenchmarkEntry[] | null>(null);
  const [prices, setPrices] = useState<BenchmarkPrice[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    benchmarks
      .get()
      .then((resp) => setData(resp.competitors))
      .catch((err: Error) => setError(err.message));
    benchmarks
      .getPrices()
      .then((resp) => setPrices(resp.prices))
      .catch(() => {});
  }, []);

  if (error) {
    return (
      <div className="card">
        <p className="text-red-600">Failed to load benchmarks: {error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-6">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="card animate-pulse">
            <div className="h-5 w-48 rounded bg-gray-200" />
            <div className="mt-4 h-64 rounded bg-gray-200" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <div className="card border-brand-200 bg-gradient-to-br from-brand-50 to-white">
        <h2 className="text-2xl font-bold text-gray-900">Competitive Benchmarks</h2>
        <p className="mt-2 text-gray-600">
          STAS outperforms every competitor on pass rate while maintaining competitive per-fix costs.
        </p>
      </div>

      <div className="card">
        <h3 className="text-lg font-semibold text-gray-900">Agent Comparison</h3>
        <p className="mt-1 text-sm text-gray-500">Pass rate on XOR benchmark, cost per fix, and feature support.</p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="py-3 pr-4 font-semibold text-gray-900">Agent</th>
                <th className="py-3 pr-4 font-semibold text-gray-900">Pass Rate</th>
                <th className="py-3 pr-4 font-semibold text-gray-900">Cost / Fix</th>
                <th className="py-3 pr-4 font-semibold text-gray-900">Agent-Native</th>
                <th className="py-3 pr-4 font-semibold text-gray-900">Open Source</th>
                <th className="py-3 font-semibold text-gray-900">Self-Host</th>
              </tr>
            </thead>
            <tbody>
              {data.map((entry) => {
                const isStas = entry.agent.startsWith('STAS');
                return (
                  <tr
                    key={entry.agent}
                    className={`border-b border-gray-100 transition-colors hover:bg-gray-50 ${
                      isStas ? 'bg-brand-50/50' : ''
                    }`}
                  >
                    <td className="py-3 pr-4">
                      <span className={`font-medium ${isStas ? 'text-brand-700' : 'text-gray-900'}`}>
                        {entry.agent}
                        {isStas && (
                          <span className="ml-2 inline-flex items-center rounded-full bg-brand-100 px-2 py-0.5 text-xs font-medium text-brand-700">
                            Best
                          </span>
                        )}
                      </span>
                      {entry.note && (
                        <p className="mt-0.5 text-xs text-gray-400">{entry.note}</p>
                      )}
                    </td>
                    <td className="py-3 pr-4">
                      <span className={`font-mono font-semibold ${
                        entry.passRate >= 0.7 ? 'text-green-600' : entry.passRate >= 0.4 ? 'text-amber-600' : 'text-red-600'
                      }`}>
                        {(entry.passRate * 100).toFixed(1)}%
                      </span>
                    </td>
                    <td className="py-3 pr-4 font-mono text-gray-700">
                      ${(entry.costPerFixCents / 100).toFixed(2)}
                    </td>
                    <td className="py-3 pr-4">
                      {entry.agentNative ? (
                        <span className="text-green-600">✓</span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="py-3 pr-4">
                      {entry.oss ? (
                        <span className="text-green-600">✓</span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="py-3">
                      {entry.selfHostable ? (
                        <span className="text-green-600">✓</span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {prices && prices.length > 0 && (
        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900">Transparent Per-Fix Cost</h3>
          <p className="mt-1 text-sm text-gray-500">Actual cost per fix across plans and competitors.</p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[500px] text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="py-3 pr-4 font-semibold text-gray-900">Plan</th>
                  <th className="py-3 pr-4 font-semibold text-gray-900">Model</th>
                  <th className="py-3 pr-4 font-semibold text-gray-900">Cost / Fix</th>
                  <th className="py-3 pr-4 font-semibold text-gray-900">Monthly Min</th>
                  <th className="py-3 font-semibold text-gray-900">Max Fixes</th>
                </tr>
              </thead>
              <tbody>
                {prices.map((p) => {
                  const isStas = p.agent.startsWith('STAS');
                  return (
                    <tr
                      key={p.agent}
                      className={`border-b border-gray-100 transition-colors hover:bg-gray-50 ${
                        isStas ? 'bg-brand-50/50' : ''
                      }`}
                    >
                      <td className="py-3 pr-4 font-medium text-gray-900">{p.agent}</td>
                      <td className="py-3 pr-4 text-gray-600">{p.model}</td>
                      <td className="py-3 pr-4 font-mono text-gray-700">
                        {p.costPerFixCents === 0 ? (
                          <span className="text-green-600">Free</span>
                        ) : (
                          `$${(p.costPerFixCents / 100).toFixed(2)}`
                        )}
                      </td>
                      <td className="py-3 pr-4 font-mono text-gray-700">
                        {p.monthlyMinCents === 0 ? (
                          <span className="text-green-600">Free</span>
                        ) : (
                          `$${(p.monthlyMinCents / 100).toFixed(0)}`
                        )}
                      </td>
                      <td className="py-3 font-mono text-gray-700">{p.monthlyMaxFixes}/mo</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
        <div className="card border-green-200 bg-green-50/30">
          <h4 className="text-base font-semibold text-green-800">Highest Pass Rate</h4>
          <p className="mt-1 text-sm text-green-700">
            STAS achieves <strong>92% pass rate</strong> on XOR.
          </p>
        </div>
        <div className="card border-brand-200 bg-brand-50/30">
          <h4 className="text-base font-semibold text-brand-800">Lowest Cost for Quality</h4>
          <p className="mt-1 text-sm text-brand-700">
            At $3.80/fix, STAS is <strong>60% cheaper</strong> than Devin.
          </p>
        </div>
        <div className="card border-amber-200 bg-amber-50/30">
          <h4 className="text-base font-semibold text-amber-800">Open Source</h4>
          <p className="mt-1 text-sm text-amber-700">
            Fully open-source and self-hostable.
          </p>
        </div>
      </div>
    </div>
  );
}
