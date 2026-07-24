import { Link } from 'react-router-dom';
import type { WizardProgress } from '@/api/client';

interface Props {
  progress: WizardProgress;
}

export default function Complete({ progress }: Props) {
  return (
    <div className="space-y-6 text-center">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
        <svg className="h-8 w-8 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
        </svg>
      </div>

      <div>
        <h2 className="text-2xl font-bold text-gray-900">You're all set!</h2>
        <p className="mt-2 text-gray-500">Your onboarding is complete. Here's what to do next:</p>
      </div>

      <div className="space-y-4 text-left">
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
          <h3 className="font-semibold text-gray-900">1. Label an issue</h3>
          <p className="mt-1 text-sm text-gray-500">
            Go to any GitHub issue in your connected repository and add the label{' '}
            <code className="rounded bg-gray-200 px-1 py-0.5 text-sm font-semibold text-brand-600">stas:fix</code>.
          </p>
        </div>

        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
          <h3 className="font-semibold text-gray-900">2. Watch the magic happen</h3>
          <p className="mt-1 text-sm text-gray-500">
            STAS will automatically investigate the issue, write a fix, run tests, and open a pull request.
          </p>
        </div>

        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
          <h3 className="font-semibold text-gray-900">3. Review and merge</h3>
          <p className="mt-1 text-sm text-gray-500">
            Review the generated PR, make any adjustments, and merge. You remain in full control.
          </p>
        </div>
      </div>

      <div className="flex items-center justify-center gap-4 pt-4">
        <Link to="/" className="btn-primary">Go to Dashboard</Link>
        <Link to="/repos" className="btn-secondary">Manage Repositories</Link>
      </div>
    </div>
  );
}
