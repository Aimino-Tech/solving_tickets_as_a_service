import { useState } from 'react';

interface Props {
  onComplete: (data: Record<string, unknown>) => Promise<void>;
}

export default function TeamSetup({ onComplete }: Props) {
  const [teamName, setTeamName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await onComplete({ teamName: teamName || undefined });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">Set up your team</h2>
        <p className="mt-2 text-gray-500">Create a team to collaborate. You can do this later.</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700">Team name</label>
          <input type="text" value={teamName} onChange={(e) => setTeamName(e.target.value)}
            placeholder="e.g., My Team" className="input-field mt-1 w-full min-h-[44px]" />
        </div>
        {error && <p className="text-sm text-red-500">{error}</p>}
        <div className="flex items-center justify-between">
          <button type="button" onClick={() => onComplete({ skipTeam: true })} className="text-sm text-gray-400 hover:text-gray-600">Skip</button>
          <button type="submit" disabled={submitting} className="btn-primary">
            {submitting ? 'Saving...' : 'Create Team & Finish'}
          </button>
        </div>
      </form>
    </div>
  );
}
