import { useState } from 'react';

interface Props {
  onComplete: (params: { teamName?: string; skipTeam?: boolean }) => void;
  onSkip: () => void;
}

export default function TeamSetup({ onComplete, onSkip }: Props) {
  const [teamName, setTeamName] = useState('');
  const [skipTeam, setSkipTeam] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (skipTeam) {
      onComplete({ skipTeam: true });
    } else if (teamName.trim()) {
      onComplete({ teamName: teamName.trim() });
    }
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900">Create Your Team</h2>
      <p className="mt-2 text-gray-600">
        Create a team to collaborate with others. You can always do this later.
      </p>

      <form onSubmit={handleSubmit} className="mt-8 space-y-5">
        <div>
          <label className="label">Team Name</label>
          <input
            type="text"
            value={teamName}
            onChange={(e) => setTeamName(e.target.value)}
            placeholder="e.g. My Engineering Team"
            className="input mt-1"
            disabled={skipTeam}
          />
        </div>

        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={skipTeam}
            onChange={(e) => setSkipTeam(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
          />
          <span className="text-sm text-gray-600">Skip this for now — I&apos;ll set up a team later</span>
        </label>

        <div className="flex items-center gap-4 pt-4">
          <button
            type="submit"
            disabled={!teamName.trim() && !skipTeam}
            className="btn-primary"
          >
            {skipTeam ? 'Skip & Finish' : 'Create Team & Finish'}
          </button>
          <button type="button" onClick={onSkip} className="text-sm text-gray-400 hover:text-gray-600">
            Skip all
          </button>
        </div>
      </form>
    </div>
  );
}
