import { useState, useEffect } from 'react';
import { onboarding } from '@/api/client';
import type { WizardProgress, WizardConfig } from '@/api/client';
import { useNavigate } from 'react-router-dom';

export default function OnboardingWizard() {
  const navigate = useNavigate();
  const [progress, setProgress] = useState<WizardProgress | null>(null);
  const [config, setConfig] = useState<WizardConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    Promise.all([
      onboarding.status().catch(() => null),
      onboarding.config().catch(() => null),
    ])
      .then(([statusRes, configRes]) => {
        if (statusRes?.progress) setProgress(statusRes.progress);
        if (configRes?.config) setConfig(configRes.config);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!loading && progress?.state === 'completed') {
      navigate('/', { replace: true });
    }
  }, [loading, progress, navigate]);

  async function startWizard() {
    setSubmitting(true);
    try {
      const res = await onboarding.start();
      setProgress(res.progress);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start wizard');
    } finally {
      setSubmitting(false);
    }
  }

  async function submitStep(stepName: string, data: Record<string, unknown> = {}) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await onboarding.step(stepName, data);
      setProgress(res.progress);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to complete ${stepName}`);
    } finally {
      setSubmitting(false);
    }
  }

  async function skipWizard() {
    setSubmitting(true);
    try {
      await onboarding.skip();
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to skip');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" />
      </div>
    );
  }

  if (error && !progress) {
    return (
      <div className="mx-auto max-w-lg py-16">
        <div className="card text-center">
          <p className="text-red-600">{error}</p>
          <button onClick={() => window.location.reload()} className="btn-primary mt-4">
            Retry
          </button>
        </div>
      </div>
    );
  }

  const currentStep = progress?.currentStep;

  return (
    <div className="mx-auto max-w-2xl py-8 px-4">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Set up STAS</h1>
      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
        Complete the steps below to start automating your issue fixes.
      </p>

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="mt-8 space-y-6">
        {(!progress || progress.state === 'not_started') && (
          <div className="card text-center py-12">
            <div className="text-5xl mb-4">⚡</div>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Welcome to STAS</h2>
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400 max-w-md mx-auto">
              Label a GitHub issue. Get a pull request. We&apos;ll guide you through the setup.
            </p>
            <button
              onClick={startWizard}
              disabled={submitting}
              className="btn-primary mt-6 inline-flex items-center gap-2"
            >
              {submitting ? 'Starting...' : 'Get Started'}
            </button>
            <button onClick={skipWizard} disabled={submitting} className="btn-secondary mt-3 ml-3">
              Skip for now
            </button>
          </div>
        )}

        {progress?.state === 'in_progress' && (
          <>
            <StepCard
              number={1}
              title="Install GitHub App"
              description="Authorize STAS to access your repositories."
              active={currentStep === 'github_install'}
              completed={progress.steps.githubInstalled}
              onComplete={async () => {
                const githubAppUrl = config?.githubAppUrl || 'https://github.com/apps/stas/installations/new';
                window.open(githubAppUrl, '_blank');
                const installationId = prompt('Enter the installation ID from GitHub (or leave empty to skip):');
                if (installationId) {
                  await submitStep('github-install', { installationId: Number(installationId) });
                }
              }}
            />

            <StepCard
              number={2}
              title="Select Repository"
              description="Choose a repository to start fixing issues."
              active={currentStep === 'repo_selection'}
              completed={progress.steps.repoSelected}
              disabled={!progress.steps.githubInstalled}
              showForm
              onSubmit={async (data) => {
                await submitStep('repo-selection', data);
              }}
            />

            <StepCard
              number={3}
              title="Billing Setup"
              description="Choose your plan or start with the free tier."
              active={currentStep === 'billing_setup'}
              completed={progress.steps.billingSetup}
              disabled={!progress.steps.repoSelected}
              onComplete={async () => {
                await submitStep('billing-setup', { skipBilling: true });
              }}
              onChoosePlan={async () => {
                await submitStep('billing-setup', { planId: 'free', trialDays: 14 });
              }}
            />

            <StepCard
              number={4}
              title="Team Setup"
              description="Invite teammates (optional)."
              active={currentStep === 'team_setup'}
              completed={progress.steps.teamSetup}
              disabled={!progress.steps.billingSetup}
              onComplete={async () => {
                await submitStep('team-setup', { skipTeam: true });
              }}
              showTeamForm
              onSubmit={async (data) => {
                await submitStep('team-setup', data);
              }}
            />
          </>
        )}

        {progress?.state === 'completed' && (
          <div className="card text-center py-12">
            <div className="text-5xl mb-4">🎉</div>
            <h2 className="text-xl font-semibold text-gray-900">All set!</h2>
            <p className="mt-2 text-sm text-gray-500">
              Your STAS onboarding is complete. You can now label issues to get automated fixes.
            </p>
            <button onClick={() => navigate('/', { replace: true })} className="btn-primary mt-6">
              Go to Dashboard
            </button>
          </div>
        )}

        {progress?.state === 'skipped' && (
          <div className="card text-center py-12">
            <h2 className="text-xl font-semibold text-gray-900">Onboarding skipped</h2>
            <p className="mt-2 text-sm text-gray-500">
              You can restart the wizard anytime from Settings.
            </p>
            <button onClick={() => navigate('/', { replace: true })} className="btn-primary mt-6">
              Go to Dashboard
            </button>
          </div>
        )}
      </div>

      {progress?.state === 'in_progress' && (
        <div className="mt-6 text-center">
          <button onClick={skipWizard} disabled={submitting} className="text-sm text-gray-400 hover:text-gray-600">
            Skip onboarding
          </button>
        </div>
      )}
    </div>
  );
}

function StepCard({
  number,
  title,
  description,
  active,
  completed,
  disabled,
  onComplete,
  onChoosePlan,
  showForm,
  showTeamForm,
  onSubmit,
}: {
  number: number;
  title: string;
  description: string;
  active: boolean;
  completed: boolean;
  disabled?: boolean;
  onComplete?: () => Promise<void>;
  onChoosePlan?: () => Promise<void>;
  showForm?: boolean;
  showTeamForm?: boolean;
  onSubmit?: (data: Record<string, unknown>) => Promise<void>;
}) {
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [localSubmitting, setLocalSubmitting] = useState(false);

  if (completed) return null;

  return (
    <div className={`card ${active ? 'ring-2 ring-brand-500' : 'opacity-60'} ${disabled ? 'pointer-events-none' : ''}`}>
      <div className="flex items-start gap-4">
        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
          active ? 'bg-brand-600 text-white' : 'bg-gray-200 text-gray-500'
        }`}>
          {number}
        </div>
        <div className="flex-1">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{description}</p>

          {active && onComplete && !showForm && !showTeamForm && (
            <div className="mt-4 flex gap-3">
              <button
                onClick={onComplete}
                disabled={localSubmitting}
                className="btn-primary text-sm"
              >
                {title === 'Install GitHub App' ? 'Open GitHub App' : 'Complete'}
              </button>
              {onChoosePlan && (
                <button
                  onClick={onChoosePlan}
                  disabled={localSubmitting}
                  className="btn-secondary text-sm"
                >
                  Choose Free Plan
                </button>
              )}
            </div>
          )}

          {active && showForm && (
            <div className="mt-4 space-y-3">
              <input
                type="text"
                placeholder="Repository owner (e.g., my-org)"
                onChange={(e) => setFormData((d) => ({ ...d, repoOwner: e.target.value }))}
                className="input-field min-h-[44px] w-full max-w-xs"
              />
              <input
                type="text"
                placeholder="Repository name (e.g., my-repo)"
                onChange={(e) => setFormData((d) => ({ ...d, repoName: e.target.value }))}
                className="input-field min-h-[44px] w-full max-w-xs"
              />
              <button
                onClick={async () => {
                  if (!formData.repoOwner || !formData.repoName) return;
                  setLocalSubmitting(true);
                  await onSubmit?.({ repoOwner: formData.repoOwner, repoName: formData.repoName });
                  setLocalSubmitting(false);
                }}
                disabled={localSubmitting || !formData.repoOwner || !formData.repoName}
                className="btn-primary text-sm"
              >
                {localSubmitting ? 'Saving...' : 'Select Repository'}
              </button>
            </div>
          )}

          {active && showTeamForm && (
            <div className="mt-4 space-y-3">
              <input
                type="text"
                placeholder="Team name (optional)"
                onChange={(e) => setFormData((d) => ({ ...d, teamName: e.target.value }))}
                className="input-field min-h-[44px] w-full max-w-xs"
              />
              <div className="flex gap-3">
                <button
                  onClick={async () => {
                    setLocalSubmitting(true);
                    await onSubmit?.({
                      teamName: formData.teamName || 'My Team',
                      skipTeam: false,
                    });
                    setLocalSubmitting(false);
                  }}
                  disabled={localSubmitting}
                  className="btn-primary text-sm"
                >
                  {localSubmitting ? 'Saving...' : 'Create Team'}
                </button>
                <button
                  onClick={async () => {
                    setLocalSubmitting(true);
                    await onSubmit?.({ skipTeam: true });
                    setLocalSubmitting(false);
                  }}
                  disabled={localSubmitting}
                  className="btn-secondary text-sm"
                >
                  Skip
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
