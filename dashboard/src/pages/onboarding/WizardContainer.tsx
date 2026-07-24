import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { onboarding } from '@/api/client';
import type { WizardProgress, WizardStep, WizardConfig } from '@/api/types';
import BillingSetup from './steps/BillingSetup';
import Complete from './steps/Complete';
import GitHubInstall from './steps/GitHubInstall';
import RepoSelection from './steps/RepoSelection';
import TeamSetup from './steps/TeamSetup';

const STEP_LABELS: Record<WizardStep, string> = {
  github_install: 'GitHub App',
  repo_selection: 'Repository',
  billing_setup: 'Billing',
  team_setup: 'Team',
  complete: 'Done',
};

const STEP_ORDER: WizardStep[] = ['github_install', 'repo_selection', 'billing_setup', 'team_setup', 'complete'];

export default function WizardContainer() {
  const navigate = useNavigate();
  const [progress, setProgress] = useState<WizardProgress | null>(null);
  const [config, setConfig] = useState<WizardConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadWizard = useCallback(async () => {
    try {
      setLoading(true);
      const { progress: p, config: c } = await onboarding.getStatus();
      setProgress(p);
      setConfig(c);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load wizard');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadWizard();
  }, [loadWizard]);

  async function handleStart() {
    try {
      setLoading(true);
      const { progress: p } = await onboarding.start();
      setProgress(p);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start wizard');
    } finally {
      setLoading(false);
    }
  }

  async function handleStepComplete(step: string, body: Record<string, unknown> = {}) {
    try {
      const { progress: p } = await onboarding.completeStep(step, body);
      setProgress(p);
      const nextIndex = STEP_ORDER.indexOf(p.currentStep);
      if (nextIndex < STEP_ORDER.length - 1) {
        const nextStep = STEP_ORDER[nextIndex];
        navigate(`/onboarding/step-${STEP_ORDER.indexOf(nextStep) + 1}`);
      } else {
        navigate('/onboarding/complete');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to complete step');
    }
  }

  async function handleSkip() {
    try {
      await onboarding.skip();
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to skip wizard');
    }
  }

  if (loading && !progress) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" />
      </div>
    );
  }

  if (error && !progress) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="rounded-lg bg-red-50 p-6 text-center">
          <p className="text-red-600">{error}</p>
          <button type="button" onClick={loadWizard} className="btn-primary mt-4">
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!progress || progress.state === 'not_started') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="max-w-md text-center">
          <h1 className="text-3xl font-bold text-gray-900">Welcome to STAS</h1>
          <p className="mt-4 text-gray-600">
            Set up your account in just a few steps. Connect GitHub, select a repository, configure billing, and create your team.
          </p>
          <button type="button" onClick={handleStart} disabled={loading} className="btn-primary mt-8 px-8 py-3 text-lg">
            {loading ? 'Starting...' : 'Get started'}
          </button>
          <button type="button" onClick={handleSkip} className="mt-4 block w-full text-sm text-gray-400 hover:text-gray-600">
            Skip onboarding
          </button>
        </div>
      </div>
    );
  }

  if (progress.state === 'skipped' || progress.state === 'completed') {
    navigate('/', { replace: true });
    return null;
  }

  const currentStepIndex = STEP_ORDER.indexOf(progress.currentStep);

  function renderStep() {
    const step = progress.currentStep;
    switch (step) {
      case 'github_install':
        return (
          <GitHubInstall
            githubAppUrl={config?.githubAppUrl ?? ''}
            onComplete={(params) => handleStepComplete('github-install', params)}
            onSkip={handleSkip}
          />
        );
      case 'repo_selection':
        return (
          <RepoSelection
            onComplete={(params) => handleStepComplete('repo-selection', params)}
            onSkip={handleSkip}
          />
        );
      case 'billing_setup':
        return (
          <BillingSetup
            onComplete={(params) => handleStepComplete('billing-setup', params)}
            onSkip={handleSkip}
          />
        );
      case 'team_setup':
        return (
          <TeamSetup
            onComplete={(params) => handleStepComplete('team-setup', params)}
            onSkip={handleSkip}
          />
        );
      case 'complete':
        return <Complete />;
      default:
        return <p className="text-gray-500">Unknown step</p>;
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4">
          <div className="flex items-center gap-3">
            <span className="text-2xl">⚡</span>
            <span className="text-xl font-bold text-gray-900">STAS</span>
          </div>
          <button type="button" onClick={handleSkip} className="text-sm text-gray-400 hover:text-gray-600">
            Skip setup
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-4 py-8">
        <div className="mb-8 flex items-center justify-center gap-2">
          {STEP_ORDER.filter((s) => s !== 'complete').map((step, idx) => (
            <div key={step} className="flex items-center gap-2">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium ${
                  idx <= currentStepIndex
                    ? 'bg-brand-600 text-white'
                    : 'bg-gray-200 text-gray-500'
                }`}
              >
                {idx < currentStepIndex ? '\u2713' : idx + 1}
              </div>
              <span
                className={`text-sm ${
                  idx <= currentStepIndex ? 'text-brand-700 font-medium' : 'text-gray-400'
                } hidden sm:inline`}
              >
                {STEP_LABELS[step]}
              </span>
              {idx < STEP_ORDER.filter((s) => s !== 'complete').length - 1 && (
                <div
                  className={`mx-2 h-0.5 w-8 ${
                    idx < currentStepIndex ? 'bg-brand-400' : 'bg-gray-200'
                  }`}
                />
              )}
            </div>
          ))}
        </div>

        {error && (
          <div className="mb-6 rounded-lg bg-red-50 p-4 text-sm text-red-600">{error}</div>
        )}

        <div className="rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
          {renderStep()}
        </div>
      </div>
    </div>
  );
}
