import { useState } from 'react';
import { onboarding } from '@/api/client';
import type { WizardStepProps } from './types';

export default function BillingSetup({ progress, onUpdate }: WizardStepProps) {
  const [saving, setSaving] = useState(false);

  const handleSelectPlan = async (planId?: string) => {
    setSaving(true);
    try {
      const updated = await onboarding.completeBillingSetup({ planId, skipBilling: !planId });
      onUpdate(updated);
    } catch (err) {
      alert('Failed to save billing: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  if (progress.steps.billingSetup) {
    return (
      <div className="text-center py-8">
        <div className="text-5xl mb-4">{'\u2705'}</div>
        <h2 className="text-xl font-semibold text-gray-900">Billing Configured</h2>
        <p className="mt-2 text-sm text-gray-500">Your billing plan has been set up.</p>
        <button onClick={() => handleSelectPlan()} className="btn-primary mt-6">
          Continue
        </button>
      </div>
    );
  }

  return (
    <div className="py-6">
      <h2 className="text-xl font-semibold text-gray-900">Step 3: Choose Your Plan</h2>
      <p className="mt-2 text-sm text-gray-500">
        Start with the Free tier — no credit card required. Upgrade anytime.
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-gray-200 p-4 text-center">
          <h3 className="font-semibold text-gray-900">Free</h3>
          <p className="mt-1 text-2xl font-bold text-gray-900">$0</p>
          <p className="text-sm text-gray-500">100 fixes/month</p>
          <ul className="mt-3 space-y-1 text-xs text-gray-500">
            <li>1 concurrent fix</li>
            <li>Community support</li>
          </ul>
          <button
            onClick={() => handleSelectPlan('free')}
            disabled={saving}
            className="btn-primary mt-4 w-full text-sm"
          >
            {saving ? '...' : 'Start Free'}
          </button>
        </div>

        <div className="rounded-lg border-2 border-brand-500 p-4 text-center">
          <span className="rounded-full bg-brand-100 px-2 py-0.5 text-xs font-semibold text-brand-700">
            Popular
          </span>
          <h3 className="mt-2 font-semibold text-gray-900">Solo</h3>
          <p className="mt-1 text-2xl font-bold text-gray-900">$29</p>
          <p className="text-sm text-gray-500">/month</p>
          <ul className="mt-3 space-y-1 text-xs text-gray-500">
            <li>500 fixes/month</li>
            <li>3 concurrent fixes</li>
            <li>Email support</li>
          </ul>
          <button
            onClick={() => handleSelectPlan('solo')}
            disabled={saving}
            className="btn-primary mt-4 w-full text-sm"
          >
            {saving ? '...' : 'Choose Solo'}
          </button>
        </div>

        <div className="rounded-lg border border-gray-200 p-4 text-center">
          <h3 className="font-semibold text-gray-900">Team</h3>
          <p className="mt-1 text-2xl font-bold text-gray-900">$99</p>
          <p className="text-sm text-gray-500">/month</p>
          <ul className="mt-3 space-y-1 text-xs text-gray-500">
            <li>2000 fixes/month</li>
            <li>10 concurrent fixes</li>
            <li>Priority support</li>
          </ul>
          <button
            onClick={() => handleSelectPlan('team')}
            disabled={saving}
            className="btn-primary mt-4 w-full text-sm"
          >
            {saving ? '...' : 'Choose Team'}
          </button>
        </div>
      </div>

      <div className="mt-6 text-center">
        <button
          onClick={() => handleSelectPlan(undefined)}
          disabled={saving}
          className="text-sm text-gray-400 hover:text-gray-600"
        >
          Skip billing for now
        </button>
      </div>
    </div>
  );
}
