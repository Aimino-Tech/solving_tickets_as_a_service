import { useState } from 'react';
import { onboarding, type WizardProgress } from '@/api/client';

interface Props {
  progress: WizardProgress;
  onComplete: (progress: WizardProgress) => void;
  onSkip: () => void;
}

export default function TeamSetup({ progress, onComplete, onSkip }: Props) {
  const [teamName, setTeamName] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleCreateTeam() {
    setSaving(true);
    try {
      const result = await onboarding.completeStep('team-setup', {
        teamName: teamName || undefined,
        skipTeam: false,
      });
      onComplete(result.progress);
    } catch {
      setSaving(false);
    }
  }

  async function handleSkipTeam() {
    setSaving(true);
    try {
      const result = await onboarding.completeStep('team-setup', { skipTeam: true });
      onComplete(result.progress);
    } catch {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Set Up Your Team</h2>
        <p className="mt-2 text-gray-500">
          Create a team to collaborate with others. You can skip this and set it up later.
        </p>
      </div>

      <div className="rounded-lg border border-gray-200 bg-gray-50 p-6">
        <label className="block text-sm font-medium text-gray-700">Team Name</label>
        <input
          type="text"
          value={teamName}
          onChange={(e) => setTeamName(e.target.value)}
          placeholder="My Team"
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
        <p className="mt-1 text-xs text-gray-400">
          Optional. You can invite members later from the settings page.
        </p>
      </div>

      <div className="flex items-center justify-between pt-4">
        <button onClick={handleSkipTeam} disabled={saving} className="text-sm text-gray-400 hover:text-gray-600">
          Skip — I'll set up a team later
        </button>
        <button onClick={handleCreateTeam} disabled={saving} className="btn-primary">
          {saving ? 'Saving...' : 'Create Team'}
        </button>
      </div>
    </div>
  );
}
