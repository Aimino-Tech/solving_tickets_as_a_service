import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { pricing } from '@/api/client';
import type { PricingPlan, CompetitorPrice } from '@/api/types';

export default function PricingPage() {
  const [plans, setPlans] = useState<PricingPlan[]>([]);
  const [competitors, setCompetitors] = useState<CompetitorPrice[]>([]);
  const [fixSlider, setFixSlider] = useState(50);
  const [selectedTier, setSelectedTier] = useState('solo');
  const [calcResult, setCalcResult] = useState<{
    monthlyCostCents: number;
    costPerFixCents: number;
    vsCompetitors: Array<{ name: string; monthlyCostCents: number; savingsCents: number; savingsPercent: number }>;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    pricing
      .get()
      .then((data) => { setPlans(data.plans); setCompetitors(data.competitors); })
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    pricing
      .calculate(fixSlider, selectedTier)
      .then((data) => setCalcResult(data))
      .catch(() => {});
  }, [fixSlider, selectedTier]);

  return (
    <div className="space-y-16">
      <div className="text-center">
        <h2 className="text-4xl font-bold tracking-tight text-gray-900">Simple, Transparent Pricing</h2>
        <p className="mt-4 text-lg text-gray-600">Start free. Scale as you grow. Our AGI delivers 92% pass rate.</p>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">Failed to load pricing data: {error}</div>}

      {plans.length > 0 && (
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-4">
          {plans.map((plan) => (
            <div key={plan.id} className={`card relative flex flex-col ${plan.highlighted ? 'border-brand-400 ring-2 ring-brand-400 scale-105 z-10' : 'border-gray-200'}`}>
              {plan.highlighted && <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-brand-600 px-4 py-1 text-xs font-semibold text-white">Most Popular</span>}
              <div className="mb-6">
                <h3 className="text-lg font-semibold text-gray-900">{plan.name}</h3>
                <p className="mt-1 text-sm text-gray-500">{plan.description}</p>
                <div className="mt-4 flex items-baseline gap-1">
                  <span className="text-4xl font-bold text-gray-900">{plan.price}</span>
                  {plan.period && <span className="text-sm text-gray-500">{plan.period}</span>}
                </div>
                <p className="mt-1 text-sm font-medium text-brand-600">{plan.fixes}</p>
              </div>
              <ul className="mb-8 flex-1 space-y-3">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2 text-sm text-gray-600">
                    <svg className="mt-0.5 h-4 w-4 flex-shrink-0 text-green-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                    {feature}
                  </li>
                ))}
              </ul>
              <Link to={plan.cta === 'Contact Sales' ? '/contact' : '/login'}
                className={`inline-flex items-center justify-center rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors ${plan.highlighted ? 'bg-brand-600 text-white hover:bg-brand-700' : plan.id === 'enterprise' ? 'border border-brand-600 text-brand-600 hover:bg-brand-50' : 'bg-gray-100 text-gray-900 hover:bg-gray-200'}`}>
                {plan.cta}
              </Link>
            </div>
          ))}
        </div>
      )}

      <div className="card border-gray-200">
        <h3 className="text-xl font-bold text-gray-900">Cost Calculator</h3>
        <p className="mt-1 text-sm text-gray-500">See how STAS compares to competitors.</p>
        <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-2">
          <div className="space-y-6">
            <div>
              <label htmlFor="fix-slider" className="block text-sm font-medium text-gray-700">
                Fixes per month: <span className="font-bold text-brand-600">{fixSlider}</span>
              </label>
              <input id="fix-slider" type="range" min={1} max={1000} step={1} value={fixSlider}
                onChange={(e) => setFixSlider(Number(e.target.value))} className="mt-2 block w-full accent-brand-600" />
              <div className="mt-1 flex justify-between text-xs text-gray-400"><span>1</span><span>250</span><span>500</span><span>750</span><span>1000</span></div>
            </div>
            <div className="flex flex-wrap gap-3">
              {['free', 'solo', 'team', 'enterprise'].map((tier) => (
                <button key={tier} onClick={() => setSelectedTier(tier)}
                  className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${selectedTier === tier ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                  {tier.charAt(0).toUpperCase() + tier.slice(1)}
                </button>
              ))}
            </div>
          </div>
          {calcResult && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-6">
              <div className="grid grid-cols-2 gap-4">
                <div><p className="text-sm text-gray-500">Monthly cost</p><p className="text-2xl font-bold text-gray-900">${(calcResult.monthlyCostCents / 100).toFixed(0)}</p></div>
                <div><p className="text-sm text-gray-500">Cost per fix</p><p className="text-2xl font-bold text-gray-900">${(calcResult.costPerFixCents / 100).toFixed(2)}</p></div>
              </div>
              {calcResult.vsCompetitors.length > 0 && (
                <div className="mt-4 border-t border-gray-200 pt-4">
                  <p className="mb-2 text-sm font-medium text-gray-700">vs competitors</p>
                  <div className="space-y-2">
                    {calcResult.vsCompetitors.filter((c) => c.savingsCents > 0).slice(0, 4).map((c) => (
                      <div key={c.name} className="flex items-center justify-between text-sm">
                        <span className="text-gray-600">{c.name}</span>
                        <span className="font-medium text-green-600">Save ${(c.savingsCents / 100).toFixed(0)}/mo ({c.savingsPercent}%)</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {competitors.length > 0 && (
        <div>
          <h3 className="text-xl font-bold text-gray-900">STAS vs Competitors</h3>
          <p className="mt-1 text-sm text-gray-500">Real benchmark data from XOR results.</p>
          <div className="mt-6 overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead>
                <tr className="bg-gray-50">
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Competitor</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Pass Rate</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Cost / Fix</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Monthly</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Self-Host</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Open Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {competitors.map((c) => {
                  const isStas = c.ourAgi;
                  return (
                    <tr key={c.competitor} className={isStas ? 'bg-brand-50' : 'hover:bg-gray-50'}>
                      <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-gray-900">
                        {c.competitor}
                        {isStas && <span className="ml-2 rounded-full bg-brand-100 px-2 py-0.5 text-xs font-medium text-brand-700">Best</span>}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600"><span className={`font-medium ${isStas ? 'text-green-600' : ''}`}>{(c.passRate * 100).toFixed(1)}%</span></td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">${(c.costPerFixCents / 100).toFixed(2)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">${(c.monthlyCostCents / 100).toFixed(0)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm">{c.selfHosted ? <span className="text-green-600">Yes</span> : <span className="text-gray-400">No</span>}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm">{c.openSource ? <span className="text-green-600">Yes</span> : <span className="text-gray-400">No</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card border-gray-200 bg-gray-50">
        <h3 className="text-lg font-semibold text-gray-900">See How We Stack Up</h3>
        <p className="mt-1 text-sm text-gray-600">Head-to-head comparisons against leading competitors.</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link to="/vs/copilot" className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:border-brand-200 hover:text-brand-600">STAS vs GitHub Copilot &rarr;</Link>
          <Link to="/vs/devin" className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:border-brand-200 hover:text-brand-600">STAS vs Devin &rarr;</Link>
          <Link to="/vs/plip" className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:border-brand-200 hover:text-brand-600">STAS vs Plip &rarr;</Link>
        </div>
      </div>

      <div className="card border-gray-200 bg-gray-50 text-center">
        <h3 className="text-base font-semibold text-gray-900">Prefer Self-Hosted?</h3>
        <p className="mt-2 text-sm text-gray-600">STAS is fully open-source under the MIT license.</p>
        <a href="https://github.com/tamnguyen08/solving_tickets_as_a_service" target="_blank" rel="noopener noreferrer"
          className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-brand-600 hover:text-brand-700">
          View on GitHub</a>
      </div>
    </div>
  );
}
