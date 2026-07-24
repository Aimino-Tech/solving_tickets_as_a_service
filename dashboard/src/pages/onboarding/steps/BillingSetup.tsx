import { useState } from 'react';

interface Props {
  onComplete: (params: { planId?: string; skipBilling?: boolean }) => void;
  onSkip: () => void;
}

const PLANS = [
  {
    id: 'free',
    name: 'Free',
    price: '$0',
    period: 'forever',
    fixes: '5 fixes/month',
    description: 'Perfect for trying STAS on personal projects.',
  },
  {
    id: 'solo',
    name: 'Solo',
    price: '$29',
    period: '/month',
    fixes: '50 fixes/month',
    description: 'For individual developers and small teams.',
    highlighted: true,
  },
  {
    id: 'team',
    name: 'Team',
    price: '$99',
    period: '/month',
    fixes: 'Unlimited fixes',
    description: 'For teams that need continuous automated fixes.',
  },
];

export default function BillingSetup({ onComplete, onSkip }: Props) {
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function handleContinue() {
    if (selectedPlan) {
      setSubmitting(true);
      onComplete({ planId: selectedPlan });
    }
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900">Choose Your Plan</h2>
      <p className="mt-2 text-gray-600">
        Start with a free trial. No credit card required.
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        {PLANS.map((plan) => (
          <button type="button"
            key={plan.id}
            onClick={() => setSelectedPlan(plan.id)}
            className={`rounded-xl border-2 p-6 text-left transition-all ${
              selectedPlan === plan.id
                ? 'border-brand-500 bg-brand-50 shadow-md'
                : plan.highlighted
                  ? 'border-brand-200 bg-white hover:border-brand-300'
                  : 'border-gray-200 bg-white hover:border-gray-300'
            }`}
          >
            {plan.highlighted && (
              <span className="mb-2 inline-block rounded-full bg-brand-100 px-2.5 py-0.5 text-xs font-medium text-brand-700">
                Popular
              </span>
            )}
            <h3 className="text-lg font-bold text-gray-900">{plan.name}</h3>
            <p className="mt-1 text-2xl font-bold text-gray-900">
              {plan.price}
              <span className="text-sm font-normal text-gray-500">{plan.period}</span>
            </p>
            <p className="mt-1 text-sm text-gray-500">{plan.fixes}</p>
            <p className="mt-2 text-xs text-gray-400">{plan.description}</p>
          </button>
        ))}
      </div>

      <div className="mt-8 flex items-center gap-4">
        <button type="button" onClick={handleContinue} disabled={!selectedPlan || submitting} className="btn-primary">
          {submitting ? 'Processing...' : 'Continue with selected plan'}
        </button>
        <button type="button" onClick={onSkip} className="text-sm text-gray-400 hover:text-gray-600">
          Skip billing (free tier)
        </button>
      </div>
    </div>
  );
}
