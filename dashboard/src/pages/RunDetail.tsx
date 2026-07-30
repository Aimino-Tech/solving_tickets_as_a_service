import { useState, useEffect } from 'react';
import { runs } from '@/api/client';
import type { Run } from '@/api/types';
import { useParams, Link } from 'react-router-dom';
import { SkeletonRunDetail } from '@/components/LoadingSkeleton';
import RunDetailContent from '@/components/RunDetailContent';

export default function RunDetail() {
  const { id } = useParams<{ id: string }>();
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    const ac = new AbortController();
    runs
      .get(id, { signal: ac.signal })
      .then(setRun)
      .catch((err: Error) => {
        if (err.name !== 'AbortError') setError(err.message);
      });
    return () => ac.abort();
  }, [id]);

  if (error) {
    return (
      <div className="card">
        <p className="text-red-600 dark:text-red-400">{error}</p>
        <Link to="/runs" className="mt-4 inline-block text-sm font-medium text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300">
          &larr; Back to runs
        </Link>
      </div>
    );
  }

  if (!run) {
    return <SkeletonRunDetail />;
  }

  return (
    <div className="max-w-4xl space-y-6">
      <nav className="flex items-center justify-between text-sm text-gray-500 dark:text-gray-400">
        <div>
          <Link to="/runs" className="hover:text-brand-600">Runs</Link>
          <span className="mx-2">/</span>
          <span className="text-gray-900 font-mono">{String(run.id).slice(0, 8)}</span>
        </div>
        <a
          href="https://github.com/tamnguyen08/solving_tickets_as_a_service"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 transition-colors"
        >
          <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
          Get STAS
        </a>
      </nav>

      <RunDetailContent run={run} />

      <Link
        to="/runs"
        className="inline-flex items-center gap-1 text-sm font-medium text-gray-500 hover:text-gray-700"
      >
        &larr; Back to runs
      </Link>
    </div>
  );
}
