import { useState, useEffect } from 'react';
import { onboarding, repos } from '@/api/client';
import type { WizardStepProps } from './types';

export default function RepoSelection({ progress, onUpdate }: WizardStepProps) {
  const [repoOwner, setRepoOwner] = useState('');
  const [repoName, setRepoName] = useState('');
  const [saving, setSaving] = useState(false);
  const [availableRepos, setAvailableRepos] = useState<{ owner: string; repo: string }[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(true);

  useEffect(() => {
    repos
      .list()
      .then((list) => {
        const mapped = Array.isArray(list)
          ? list.map((r: { owner: string; repo: string }) => ({ owner: r.owner, repo: r.repo }))
          : [];
        setAvailableRepos(mapped);
        if (mapped.length > 0) {
          setRepoOwner(mapped[0].owner);
          setRepoName(mapped[0].repo);
        }
      })
      .catch(() => {})
      .finally(() => setLoadingRepos(false));
  }, []);

  const handleSubmit = async () => {
    if (!repoOwner || !repoName) return;
    setSaving(true);
    try {
      const updated = await onboarding.completeRepoSelection(repoOwner, repoName);
      onUpdate(updated);
    } catch (err) {
      alert('Failed to save repo selection: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  if (progress.steps.repoSelected) {
    return (
      <div className="text-center py-8">
        <div className="text-5xl mb-4">{'\u2705'}</div>
        <h2 className="text-xl font-semibold text-gray-900">Repository Selected</h2>
        <p className="mt-2 text-sm text-gray-500">Your repository has been configured.</p>
        <button onClick={() => handleSubmit()} className="btn-primary mt-6">
          Continue
        </button>
      </div>
    );
  }

  return (
    <div className="py-6">
      <h2 className="text-xl font-semibold text-gray-900">Step 2: Select a Repository</h2>
      <p className="mt-2 text-sm text-gray-500">
        Choose which repository STAS should monitor for labeled issues.
      </p>

      <div className="mt-6 space-y-4">
        {!loadingRepos && availableRepos.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-gray-700">Available Repositories</label>
            <select
              onChange={(e) => {
                const [owner, repo] = e.target.value.split('/');
                setRepoOwner(owner);
                setRepoName(repo);
              }}
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              {availableRepos.map((r) => (
                <option key={`${r.owner}/${r.repo}`} value={`${r.owner}/${r.repo}`}>
                  {r.owner}/{r.repo}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700">Repository Owner</label>
          <input
            type="text"
            value={repoOwner}
            onChange={(e) => setRepoOwner(e.target.value)}
            placeholder="e.g. my-org"
            className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">Repository Name</label>
          <input
            type="text"
            value={repoName}
            onChange={(e) => setRepoName(e.target.value)}
            placeholder="e.g. my-repo"
            className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>

        <button
          onClick={handleSubmit}
          disabled={saving || !repoOwner || !repoName}
          className="btn-primary w-full"
        >
          {saving ? 'Saving...' : 'Confirm Repository'}
        </button>
      </div>
    </div>
  );
}
