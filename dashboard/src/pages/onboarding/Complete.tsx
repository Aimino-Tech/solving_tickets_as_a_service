import { Link } from 'react-router-dom';

export default function Complete() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-2xl px-4 py-20 sm:px-6 lg:px-8">
        <div className="text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
            <svg className="h-8 w-8 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          </div>
          <h1 className="mt-6 text-3xl font-bold text-gray-900">You are all set!</h1>
          <p className="mt-4 text-lg text-gray-500">STAS is ready to go.</p>
        </div>
        <div className="mt-8 space-y-4">
          <div className="card">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-600">1</span>
            <div className="mt-2"><h3 className="font-semibold text-gray-900">Label an issue</h3>
            <p className="mt-1 text-sm text-gray-500">Add the label <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-semibold text-brand-600">stas:fix</code> to any issue.</p></div>
          </div>
          <div className="card">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-600">2</span>
            <div className="mt-2"><h3 className="font-semibold text-gray-900">STAS investigates</h3>
            <p className="mt-1 text-sm text-gray-500">STAS analyzes the issue, writes a fix, and opens a PR.</p></div>
          </div>
          <div className="card">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-600">3</span>
            <div className="mt-2"><h3 className="font-semibold text-gray-900">Review the PR</h3>
            <p className="mt-1 text-sm text-gray-500">Review the pull request and merge it.</p></div>
          </div>
        </div>
        <div className="mt-10 text-center">
          <Link to="/dashboard" className="btn-primary inline-flex items-center gap-2 px-8 py-3 text-base">Go to Dashboard</Link>
        </div>
      </div>
    </div>
  );
}
