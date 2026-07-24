import { useState, useEffect } from 'react';
import { onboarding, billing } from '@/api/client';
import type { WizardProgress, BillingPlan } from '@/api/client';

interface Props {
  progress: WizardProgress;
  onComplete: (progress: WizardProgress) => void;
  onSkip: () => void;
}

export default function BillingSetup({ progress, onComplete, onSkip }: Props) {
  const [plans, setPlans] = useState<BillingPlan[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    billing.listPlans().then(setPlans).catch(() => {});
  }, []);

  async function handleSelect() {
    setSaving(true);
    try {
      const result = await onboarding.completeStep('billing-setup', {
        planId: selectedPlan,
        skipBilling: !selectedPlan,
      });
      onComplete(result.progress);
    } catch {
      setSaving(false);
    }
  }

  async function handleSkipBilling() {
    setSaving(true);
    try {
      const result = await onboarding.completeStep('billing-setup', { skipBilling: true });
      onComplete(result.progress);
    } catch {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Choose Your Plan</h2>
        <p className="mt-2 text-gray-500">
          Select a plan that fits your needs. You can change or upgrade anytime.
        </p>
      </div>

      {plans.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-3">
          {plans.map((plan) => (
            <button
              key={plan.id}
              onClick={() => setSelectedPlan(plan.id)}
              className={`rounded-lg border p-6 text-left transition-colors ${
                selectedPlan === plan.id
                  ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-500'
                  : plan.highlighted
                    ? 'border-brand-300 bg-white'
                    : 'border-gray-200 bg-white hover:border-gray-300'
              }`}
            >
              <h3 className="text-lg font-semibold text-gray-900">{plan.name}</h3>
              <p className="mt-1 text-3xl font-bold text-gray-900">{plan.price}</p>
              <p className="text-sm text-gray-500">per {plan.period}</p>
              <ul className="mt-4 space-y-2">
                {plan.features.slice(0, 3).map((f) => (
                  <li key={f} className="flex items-center gap-2 text-sm text-gray-600">
                    <svg className="h-4 w-4 text-green-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                    {f}
                  </li>
                ))}
              </ul>
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between pt-4">
        <button onClick={handleSkipBilling} disabled={saving} className="text-sm text-gray-400 hover:text-gray-600">
          Skip billing — use free tier
        </button>
        <button onClick={handleSelect} disabled={!selectedPlan || saving} className="btn-primary">
          {saving ? 'Saving...' : 'Continue with selected plan'}
        </button>
      </div>
    </div>
  );
}
