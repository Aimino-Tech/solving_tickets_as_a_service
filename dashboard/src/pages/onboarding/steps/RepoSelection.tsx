import { useState } from 'react';

interface Props {
  onComplete: (params: { repoOwner: string; repoName: string }) => void;
  onSkip: () => void;
}

export default function RepoSelection({ onComplete, onSkip }: Props) {
  const [repoOwner, setRepoOwner] = useState('');
  const [repoName, setRepoName] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!repoOwner || !repoName) return;
    onComplete({ repoOwner: repoOwner.trim(), repoName: repoName.trim() });
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900">Select a Repository</h2>
      <p className="mt-2 text-gray-600">
        Choose the repository where STAS should monitor issues and create pull requests.
      </p>

      <form onSubmit={handleSubmit} className="mt-8 space-y-5">
        <div>
          <label htmlFor="repoOwner" className="label">Repository Owner</label>
          <input
            id="repoOwner"
            type="text"
            value={repoOwner}
            onChange={(e) => setRepoOwner(e.target.value)}
            placeholder="e.g. my-org or my-username"
            className="input mt-1"
            required
          />
        </div>

        <div>
          <label htmlFor="repoName" className="label">Repository Name</label>
          <input
            id="repoName"
            type="text"
            value={repoName}
            onChange={(e) => setRepoName(e.target.value)}
            placeholder="e.g. my-repo"
            className="input mt-1"
            required
          />
        </div>

        <div className="flex items-center gap-4 pt-4">
          <button type="submit" disabled={!repoOwner || !repoName} className="btn-primary">
            Continue
          </button>
          <button type="button" onClick={onSkip} className="text-sm text-gray-400 hover:text-gray-600">
            Skip
          </button>
        </div>
      </form>
    </div>
  );
}
