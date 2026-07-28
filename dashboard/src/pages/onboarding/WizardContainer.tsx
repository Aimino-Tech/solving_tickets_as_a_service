import { useState, useEffect } from 'react';
import { onboarding, type WizardProgress, type WizardConfig } from '@/api/client';
import GitHubInstall from './steps/GitHubInstall';
import RepoSelection from './steps/RepoSelection';
import BillingSetup from './steps/BillingSetup';
import TeamSetup from './steps/TeamSetup';
import Complete from './steps/Complete';

const STEP_LABELS: Record<string, string> = {
  'github-install': 'GitHub Installation',
  'repo-selection': 'Repository Selection',
  'billing-setup': 'Billing Setup',
  'team-setup': 'Team Setup',
  complete: 'Complete',
};

const STEP_ORDER = ['github-install', 'repo-selection', 'billing-setup', 'team-setup', 'complete'];

function getStepIndex(step: string): number {
  return STEP_ORDER.indexOf(step);
}

export default function WizardContainer() {
  const [progress, setProgress] = useState<WizardProgress | null>(null);
  const [config, setConfig] = useState<WizardConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadWizardState();
  }, []);

  async function loadWizardState() {
    try {
      const data = await onboarding.getStatus();
      setProgress(data.progress);
      setConfig(data.config);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load wizard');
    } finally {
      setLoading(false);
    }
  }

  async function handleStart() {
    try {
      const data = await onboarding.start();
      setProgress(data.progress);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to start wizard');
    }
  }

  function handleStepComplete(newProgress: WizardProgress) {
    setProgress(newProgress);
  }

  async function handleSkip() {
    try {
      const data = await onboarding.skip();
      setProgress(data.progress);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to skip wizard');
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="card">
        <p className="text-red-600">{error}</p>
        <button onClick={loadWizardState} className="btn-secondary mt-4">Retry</button>
      </div>
    );
  }

  if (!progress) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <h1 className="text-3xl font-bold text-gray-900">Welcome to STAS</h1>
        <p className="mt-2 text-gray-500">Let's get you set up in a few quick steps.</p>
        <button onClick={handleStart} className="btn-primary mt-8">Get Started</button>
      </div>
    );
  }

  if (progress.state === 'completed' || progress.currentStep === 'complete') {
    return (
      <div className="mx-auto max-w-lg py-8">
        <Complete progress={progress} />
      </div>
    );
  }

  if (progress.state === 'skipped') {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <h2 className="text-2xl font-bold text-gray-900">Onboarding Skipped</h2>
        <p className="mt-2 text-gray-500">You can always complete the setup later from the dashboard.</p>
        <a href="/" className="btn-primary mt-8 inline-block">Go to Dashboard</a>
      </div>
    );
  }

  const currentStep = progress.currentStep;
  const currentIndex = getStepIndex(currentStep);

  return (
    <div className="mx-auto max-w-2xl py-8">
      <div className="mb-8">
        <div className="flex items-center justify-between">
          {STEP_ORDER.filter((s) => s !== 'complete').map((step, index) => (
            <div key={step} className="flex items-center">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium ${
                  index <= currentIndex ? 'bg-brand-600 text-white' : 'bg-gray-200 text-gray-500'
                }`}
              >
                {index + 1}
              </div>
              {index < STEP_ORDER.filter((s) => s !== 'complete').length - 1 && (
                <div
                  className={`mx-2 h-1 w-12 rounded ${
                    index < currentIndex ? 'bg-brand-600' : 'bg-gray-200'
                  }`}
                />
              )}
            </div>
          ))}
        </div>
        <div className="mt-2 flex justify-between">
          {STEP_ORDER.filter((s) => s !== 'complete').map((step) => (
            <span
              key={step}
              className={`text-xs ${
                getStepIndex(step) <= currentIndex ? 'text-brand-600 font-medium' : 'text-gray-400'
              }`}
            >
              {STEP_LABELS[step]}
            </span>
          ))}
        </div>
      </div>

      <div className="card">
        {currentStep === 'github-install' && (
          <GitHubInstall progress={progress} onComplete={handleStepComplete} onSkip={handleSkip} />
        )}
        {currentStep === 'repo-selection' && (
          <RepoSelection progress={progress} onComplete={handleStepComplete} onSkip={handleSkip} />
        )}
        {currentStep === 'billing-setup' && (
          <BillingSetup progress={progress} onComplete={handleStepComplete} onSkip={handleSkip} />
        )}
        {currentStep === 'team-setup' && (
          <TeamSetup progress={progress} onComplete={handleStepComplete} onSkip={handleSkip} />
        )}
      </div>
    </div>
  );
}
