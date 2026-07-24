import { useState } from 'react';

interface Props {
  githubAppUrl: string;
  onComplete: (params: { installationId: number; accountLogin?: string; accountType?: string; reposGranted?: number }) => void;
  onSkip: () => void;
}

export default function GitHubInstall({ githubAppUrl, onComplete, onSkip }: Props) {
  const [installationId, setInstallationId] = useState('');

  function handleInstall() {
    window.open(githubAppUrl, '_blank');
  }

  function handleConfirm() {
    const id = Number(installationId);
    if (!id || Number.isNaN(id)) return;
    onComplete({ installationId: id });
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900">Install the GitHub App</h2>
      <p className="mt-2 text-gray-600">
        STAS needs access to your repositories to investigate issues and open pull requests.
      </p>

      <div className="mt-8 space-y-6">
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-6">
          <h3 className="font-semibold text-gray-900">Step 1: Install the App</h3>
          <p className="mt-1 text-sm text-gray-500">
            Click the button below to install the STAS GitHub App on your repositories.
          </p>
          <button type="button" onClick={handleInstall} className="btn-primary mt-4 inline-flex items-center gap-2">
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
            </svg>
            Install STAS on GitHub
          </button>
        </div>

        <div className="rounded-lg border border-gray-200 bg-gray-50 p-6">
          <h3 className="font-semibold text-gray-900">Step 2: Confirm Installation</h3>
          <p className="mt-1 text-sm text-gray-500">
            After installing, enter the Installation ID shown in the GitHub redirect URL.
          </p>
          <div className="mt-4 flex gap-3">
            <input
              type="number"
              value={installationId}
              onChange={(e) => setInstallationId(e.target.value)}
              placeholder="Installation ID from URL"
              className="input flex-1"
            />
            <button type="button" onClick={handleConfirm} disabled={!installationId} className="btn-primary">
              Confirm
            </button>
          </div>
          <p className="mt-2 text-xs text-gray-400">
            The Installation ID is the number after &quot;installations/&quot; in the URL after installation.
          </p>
        </div>
      </div>

      <div className="mt-8 border-t border-gray-200 pt-6 text-center">
        <button type="button" onClick={onSkip} className="text-sm text-gray-400 hover:text-gray-600">
          Skip this step (not recommended)
        </button>
      </div>
    </div>
  );
}
