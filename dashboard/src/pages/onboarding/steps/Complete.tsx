import { useNavigate } from 'react-router-dom';
import type { WizardStepProps } from './types';

export default function Complete({ progress }: WizardStepProps) {
  const navigate = useNavigate();

  return (
    <div className="py-8 text-center">
      <div className="text-6xl mb-4">🎉</div>
      <h2 className="text-2xl font-bold text-gray-900">You're All Set!</h2>
      <p className="mt-2 text-gray-500">
        Your STAS onboarding is complete. Here's what to do next:
      </p>

      <div className="mt-8 space-y-4 text-left">
        <div className="rounded-lg border border-gray-200 p-4">
          <h3 className="font-semibold text-gray-900">1. Label an Issue</h3>
          <p className="mt-1 text-sm text-gray-500">
            Go to any GitHub issue in your connected repository and add the label{' '}
            <code className="rounded bg-gray-100 px-1 py-0.5 text-xs">stas:fix</code>.
            STAS will automatically investigate, write a fix, and open a PR.
          </p>
        </div>

        <div className="rounded-lg border border-gray-200 p-4">
          <h3 className="font-semibold text-gray-900">2. Monitor Progress</h3>
          <p className="mt-1 text-sm text-gray-500">
            Check the dashboard to see fix runs in real-time. Each run shows status,
            duration, confidence score, and links to the generated PR.
          </p>
        </div>

        <div className="rounded-lg border border-gray-200 p-4">
          <h3 className="font-semibold text-gray-900">3. Manage Credits</h3>
          <p className="mt-1 text-sm text-gray-500">
            Keep an eye on your credit balance. You can purchase more credits or
            upgrade your plan from the Credits page in the dashboard.
          </p>
        </div>
      </div>

      <button
        onClick={() => navigate('/')}
        className="btn-primary mt-8"
      >
        Go to Dashboard
      </button>
    </div>
  );
}
