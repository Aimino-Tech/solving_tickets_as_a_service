import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search, ArrowLeft, Home } from 'lucide-react';

/**
 * 404 Not Found page — shown for any unmatched route via catch-all `path="*"`.
 *
 * Includes a search bar so users can jump directly to a run, plus navigation
 * options to get back on track. This satisfies AIM-4350: deleted/unmatched
 * pages show a consistent error state instead of rendering nothing.
 */
export default function NotFound() {
  const [query, setQuery] = useState('');
  const navigate = useNavigate();

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      navigate(`/runs?q=${encodeURIComponent(query.trim())}`);
    }
  };

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4">
      <div className="w-full max-w-md text-center">
        {/* SYNTARO Logo */}
        <div className="mb-8">
          <Link to="/" className="inline-flex items-center gap-2 text-2xl font-bold text-gray-900 dark:text-white">
            <span className="text-brand-600 dark:text-brand-400">SYNTARO</span>
            <span className="text-gray-400 dark:text-gray-500">/</span>
            <span>Dashboard</span>
          </Link>
        </div>

        {/* 404 visual */}
        <div className="mb-4 text-9xl font-black tracking-tighter text-gray-100 dark:text-gray-800 select-none">
          404
        </div>

        {/* Message */}
        <h1 className="mb-2 text-2xl font-semibold text-gray-900 dark:text-gray-100">
          Page not found
        </h1>
        <p className="mb-8 text-gray-500 dark:text-gray-400">
          The page you're looking for doesn't exist or has been moved.
        </p>

        {/* Search Bar */}
        <form onSubmit={handleSearch} className="mb-8">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search runs..."
              aria-label="Search runs"
              className="w-full rounded-lg border border-gray-200 bg-white py-3 pl-10 pr-4 text-gray-900 placeholder-gray-400 transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500 dark:focus:border-brand-400 dark:focus:ring-brand-400/20"
            />
          </div>
        </form>

        {/* Action Buttons */}
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Link
            to="/"
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-brand-700 dark:bg-brand-500 dark:hover:bg-brand-600"
          >
            <Home size={18} />
            Back to Dashboard
          </Link>
          <button
            onClick={() => navigate(-1)}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-6 py-3 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            <ArrowLeft size={18} />
            Go Back
          </button>
        </div>

        {/* Attribution link to report broken links */}
        <p className="mt-12 text-xs text-gray-400 dark:text-gray-600">
          Broken link?{' '}
          <a
            href="https://github.com/Aimino-Tech/solving_tickets_as_a_service/issues/new?template=bug_report.md&title=Broken%20link%20on%20dashboard"
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300 underline"
          >
            Report it on GitHub
          </a>
        </p>
      </div>
    </div>
  );
}
