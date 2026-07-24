import { useNavigate } from 'react-router-dom';

const NEXT_STEPS = [
  {
    title: 'Label an issue',
    description: 'Add the label stas:fix to any GitHub issue to trigger STAS.',
    action: 'Go to Dashboard',
    href: '/',
  },
  {
    title: 'Connect a repository',
    description: 'Configure which repositories STAS should monitor and auto-fix.',
    action: 'Manage Repos',
    href: '/repos',
  },
  {
    title: 'Invite your team',
    description: 'Add team members to collaborate on fixes and review pull requests.',
    action: 'Team Settings',
    href: '/settings',
  },
];

export default function Complete() {
  const navigate = useNavigate();

  return (
    <div className="text-center">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
        <svg className="h-8 w-8 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
        </svg>
      </div>

      <h2 className="mt-6 text-2xl font-bold text-gray-900">You&apos;re all set!</h2>
      <p className="mt-2 text-gray-600">
        Your STAS onboarding is complete. Here are some things you can do next:
      </p>

      <div className="mt-10 grid gap-6 text-left sm:grid-cols-3">
        {NEXT_STEPS.map((step) => (
          <div key={step.title} className="rounded-lg border border-gray-200 p-6">
            <h3 className="font-semibold text-gray-900">{step.title}</h3>
            <p className="mt-2 text-sm text-gray-500">{step.description}</p>
            <button type="button" onClick={() => navigate(step.href)} className="btn-primary mt-4 w-full">
              {step.action}
            </button>
          </div>
        ))}
      </div>

      <button type="button" onClick={() => navigate('/')} className="mt-8 text-sm font-medium text-brand-600 hover:text-brand-500">
        Go to Dashboard &rarr;
      </button>
    </div>
  );
}
