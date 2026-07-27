import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { pricing } from '@/api/client';
import type { VsComparisonData } from '@/api/types';

const VALID_COMPETITORS = ['copilot', 'devin', 'plip'] as const;
type CompetitorSlug = (typeof VALID_COMPETITORS)[number];

const COMPETITOR_NAMES: Record<CompetitorSlug, string> = {
  copilot: 'GitHub Copilot',
  devin: 'Devin',
  plip: 'Plip.io',
};

function LoadingSkeleton() {
  return (
    <div className="space-y-8">
      <div className="h-8 w-64 animate-pulse rounded bg-gray-200" />
      <div className="h-4 w-96 animate-pulse rounded bg-gray-200" />
      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="card animate-pulse">
            <div className="h-4 w-24 rounded bg-gray-200" />
            <div className="mt-3 h-8 w-16 rounded bg-gray-200" />
            <div className="mt-4 space-y-2">
              <div className="h-3 w-full rounded bg-gray-200" />
              <div className="h-3 w-3/4 rounded bg-gray-200" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AdvantageBadge({ advantage }: { advantage: 'us' | 'them' | 'tie' }) {
  if (advantage === 'us') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5L12 3m0 0l7.5 7.5M12 3v18" />
        </svg>
        STAS wins
      </span>
    );
  }
  if (advantage === 'them') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-500">Them</span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-600">Tie</span>
  );
}

export default function VsPage() {
  const { competitor } = useParams<{ competitor: string }>();
  const [data, setData] = useState<VsComparisonData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const slug = competitor && VALID_COMPETITORS.includes(competitor as CompetitorSlug)
    ? (competitor as CompetitorSlug)
    : null;

  useEffect(() => {
    if (!slug) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    pricing.vs(slug).then((result: import('@/api/types').VsComparisonData) => { setData(result); setLoading(false); }).catch((err: Error) => { setError(err.message); setLoading(false); });
  }, [slug]);

  if (!slug) {
    return (
      <div className="space-y-8">
        <div className="text-center">
          <h2 className="text-3xl font-bold text-gray-900">STAS vs Competitors</h2>
          <p className="mt-3 text-lg text-gray-600">See how STAS compares head-to-head against leading AI coding agents.</p>
        </div>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {VALID_COMPETITORS.map((c) => (
            <Link key={c} to={`/vs/${c}`} className="card group border-gray-200 hover:border-brand-200 hover:shadow-md transition-all">
              <h3 className="text-lg font-semibold text-gray-900 group-hover:text-brand-600">STAS vs {COMPETITOR_NAMES[c]}</h3>
              <p className="mt-2 text-sm text-gray-500">
                {c === 'copilot' && 'AI pair programmer vs autonomous fix agent.'}
                {c === 'devin' && 'Premium AI agent showdown. STAS delivers better results.'}
                {c === 'plip' && 'The closest competitor. See how STAS wins on every metric.'}
              </p>
              <span className="mt-4 inline-block text-sm font-medium text-brand-600 group-hover:text-brand-700">View comparison &rarr;</span>
            </Link>
          ))}
        </div>
      </div>
    );
  }

  if (loading) return <LoadingSkeleton />;
  if (error || !data) {
    return <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error || 'Failed to load comparison data.'}</div>;
  }

  const { priceComparison: pc, benchmarkComparison: bc } = data;

  return (
    <div className="space-y-12">
      <nav className="flex items-center gap-2 text-sm text-gray-500">
        <Link to="/pricing" className="hover:text-brand-600">Pricing</Link>
        <span>/</span>
        <span className="text-gray-900">vs {data.competitorName}</span>
      </nav>

      <div className="text-center">
        <h2 className="text-4xl font-bold tracking-tight text-gray-900">STAS vs {data.competitorName}</h2>
        <p className="mt-3 text-lg text-gray-600">{data.tagline}</p>
        <p className="mt-4 max-w-2xl mx-auto text-base text-brand-700 font-medium">{data.ourAdvantage}</p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="card border-brand-200 bg-brand-50 text-center">
          <p className="text-sm font-medium text-brand-600">STAS Pass Rate</p>
          <p className="mt-1 text-4xl font-bold text-brand-700">{(bc.ourPassRate * 100).toFixed(0)}%</p>
          <p className="mt-1 text-xs text-gray-500">XOR Benchmark</p>
        </div>
        <div className="card border-gray-200 bg-gray-50 text-center">
          <p className="text-sm font-medium text-gray-500">{data.competitorName} Pass Rate</p>
          <p className="mt-1 text-4xl font-bold text-gray-400">{(bc.theirPassRate * 100).toFixed(0)}%</p>
          <p className="mt-1 text-xs text-gray-500">XOR Benchmark</p>
        </div>
        <div className="card border-green-200 bg-green-50 text-center">
          <p className="text-sm font-medium text-green-600">Savings per Fix</p>
          <p className="mt-1 text-4xl font-bold text-green-700">
            ${((bc.theirCostPerFixCents - bc.ourCostPerFixCents) / 100).toFixed(2)}
          </p>
          <p className="mt-1 text-xs text-gray-500">Per fix vs {data.competitorName}</p>
        </div>
      </div>

      <div className="card border-gray-200">
        <h3 className="text-lg font-bold text-gray-900">Price Comparison</h3>
        <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-sm text-gray-500">STAS monthly</p>
            <p className="text-2xl font-bold text-gray-900">${(pc.ourMonthlyCents / 100).toFixed(0)}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">{data.competitorName} monthly</p>
            <p className="text-2xl font-bold text-gray-900">${(pc.theirMonthlyCents / 100).toFixed(0)}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">STAS per fix</p>
            <p className="text-2xl font-bold text-green-600">${(pc.ourPerFixCents / 100).toFixed(2)}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">{data.competitorName} per fix</p>
            <p className="text-2xl font-bold text-gray-900">${(pc.theirPerFixCents / 100).toFixed(2)}</p>
          </div>
        </div>
        {pc.annualSavingsCents > 0 && (
          <div className="mt-6 rounded-lg bg-green-50 p-4 text-center">
            <p className="text-sm font-medium text-green-700">
              Annual savings with STAS: <span className="text-xl font-bold">${(pc.annualSavingsCents / 100).toLocaleString()}</span>
            </p>
          </div>
        )}
      </div>

      {data.categories.map((category) => (
        <div key={category.name}>
          <h3 className="text-lg font-bold text-gray-900">{category.name}</h3>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead>
                <tr className="bg-gray-50">
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Feature</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-brand-700">STAS</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">{data.competitorName}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Edge</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {category.items.map((item, idx) => (
                  <tr key={idx} className={item.advantage === 'us' ? 'bg-brand-50/50' : 'hover:bg-gray-50'}>
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{item.feature}</td>
                    <td className="px-4 py-3 text-sm text-gray-700">{item.us}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{item.them}</td>
                    <td className="px-4 py-3"><AdvantageBadge advantage={item.advantage} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      <div className="card border-brand-200 bg-brand-50 text-center">
        <h3 className="text-lg font-semibold text-brand-900">Ready to ship better fixes?</h3>
        <p className="mt-2 text-sm text-brand-700">Start with 10 free fixes per month. No credit card required.</p>
        <div className="mt-4 flex items-center justify-center gap-4">
          <Link to="/pricing" className="rounded-lg bg-brand-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 transition-colors">See Pricing</Link>
          <Link to="/login" className="rounded-lg border border-brand-600 bg-white px-6 py-2.5 text-sm font-semibold text-brand-600 hover:bg-brand-50 transition-colors">Get Started Free</Link>
        </div>
      </div>
    </div>
  );
}
