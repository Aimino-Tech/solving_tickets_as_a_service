import { useState } from 'react';
import { onboarding } from '@/api/client';
import type { WizardStepProps } from './types';

export default function GitHubInstall({ progress, config, onUpdate }: WizardStepProps) {
  const [installing, setInstalling] = useState(false);

  const handleInstall = () => {
    window.open(config.githubAppUrl, '_blank', 'width=800,height=700');
  };

  const handleConfirm = async () => {
    setInstalling(true);
    try {
      const updated = await onboarding.completeGitHubInstall(
        Date.now(),
        undefined,
        0,
      );
      onUpdate(updated);
    } catch (err) {
      alert('Failed to confirm installation: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setInstalling(false);
    }
  };

  if (progress.steps.githubInstalled) {
    return (
      <div className="text-center py-8">
        <div className="text-5xl mb-4">{'\u2705'}</div>
        <h2 className="text-xl font-semibold text-gray-900">GitHub App Installed</h2>
        <p className="mt-2 text-sm text-gray-500">
          STAS has been installed on your GitHub account.
        </p>
        <button onClick={handleConfirm} className="btn-primary mt-6">
          Continue
        </button>
      </div>
    );
  }

  return (
    <div className="py-6">
      <h2 className="text-xl font-semibold text-gray-900">Step 1: Install the GitHub App</h2>
      <p className="mt-2 text-sm text-gray-500">
        Install STAS on your GitHub repositories to enable automated issue fixing.
      </p>

      <div className="mt-6 space-y-4">
        <div className="rounded-lg border border-gray-200 p-4">
          <h3 className="font-medium text-gray-900">What happens when you install?</h3>
          <ul className="mt-2 space-y-2 text-sm text-gray-500">
            <li className="flex items-start gap-2">
              <span className="text-brand-600 mt-0.5">{'\u2022'}</span>
              STAS gains access to your selected repositories
            </li>
            <li className="flex items-start gap-2">
              <span className="text-brand-600 mt-0.5">{'\u2022'}</span>
              Webhooks are created to listen for labeled issues
            </li>
            <li className="flex items-start gap-2">
              <span className="text-brand-600 mt-0.5">{'\u2022'}</span>
              STAS will create pull requests with fixes
            </li>
          </ul>
        </div>

        <button
          onClick={handleInstall}
          className="btn-primary flex w-full items-center justify-center gap-2"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
          </svg>
          Install GitHub App
        </button>

        <p className="text-center text-xs text-gray-400">
          After installing, come back here and click "Continue" to proceed.
        </p>
      </div>

      <div className="mt-6 flex justify-end">
        <button
          onClick={handleConfirm}
          disabled={installing}
          className="btn-primary"
        >
          {installing ? 'Confirming...' : "I've installed the app"}
        </button>
      </div>
    </div>
  );
}
