import { useState, useEffect } from 'react';
import { onboarding, repos } from '@/api/client';
import type { WizardProgress } from '@/api/client';

interface Props {
  progress: WizardProgress;
  onComplete: (progress: WizardProgress) => void;
  onSkip: () => void;
}

export default function RepoSelection({ progress, onComplete, onSkip }: Props) {
  const [repoList, setRepoList] = useState<{ id: string; owner: string; repo: string }[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    repos.list().then(setRepoList).catch(() => {});
  }, []);

  async function handleSelect() {
    if (!selectedRepo) return;
    setSaving(true);
    try {
      const [owner, repo] = selectedRepo.split('/');
      const result = await onboarding.completeStep('repo-selection', { repoOwner: owner, repoName: repo });
      onComplete(result.progress);
    } catch {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Select a Repository</h2>
        <p className="mt-2 text-gray-500">
          Choose the repository where SYNTARO should watch for labeled issues.
        </p>
      </div>

      {repoList.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-6 text-center">
          <p className="text-gray-500">No repositories connected yet.</p>
          <p className="mt-1 text-sm text-gray-400">
            Complete the GitHub App installation to see your repositories here.
          </p>
        </div>
      ) : (
        <div className="grid gap-3">
          {repoList.map((repo) => (
            <button
              key={repo.id}
              onClick={() => setSelectedRepo(`${repo.owner}/${repo.repo}`)}
              className={`flex items-center gap-3 rounded-lg border p-4 text-left transition-colors ${
                selectedRepo === `${repo.owner}/${repo.repo}`
                  ? 'border-brand-500 bg-brand-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100">
                <svg className="h-5 w-5 text-gray-500" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
                </svg>
              </div>
              <div className="flex-1">
                <p className="font-medium text-gray-900">{repo.owner}/{repo.repo}</p>
              </div>
              {selectedRepo === `${repo.owner}/${repo.repo}` && (
                <svg className="h-5 w-5 text-brand-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between pt-4">
        <button onClick={onSkip} className="text-sm text-gray-400 hover:text-gray-600">Skip this step</button>
        <button onClick={handleSelect} disabled={!selectedRepo || saving} className="btn-primary">
          {saving ? 'Saving...' : 'Continue'}
        </button>
      </div>
    </div>
  );
}
