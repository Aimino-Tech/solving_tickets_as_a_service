import { useState, useEffect } from 'react';
import { runs } from '@/api/client';
import type { Run } from '@/api/types';
import { useParams, Link } from 'react-router-dom';

export default function RunDetail() {
  const { id } = useParams<{ id: string }>();
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    runs
      .get(id)
      .then(setRun)
      .catch((err) => setError(err.message));
  }, [id]);

  if (error) {
    return (
      <div className="card">
        <p className="text-red-600">{error}</p>
        <Link to="/runs" className="mt-4 inline-block text-sm font-medium text-brand-600 hover:text-brand-700">
          &larr; Back to runs
        </Link>
      </div>
    );
  }

  if (!run) {
    return (
      <div className="card animate-pulse">
        <div className="h-6 w-48 rounded bg-gray-200" />
        <div className="mt-4 space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-4 rounded bg-gray-200" style={{ width: `${60 + i * 10}%` }} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      {/* Breadcrumb */}
      <nav className="text-sm text-gray-500">
        <Link to="/runs" className="hover:text-brand-600">Runs</Link>
        <span className="mx-2">/</span>
        <span className="text-gray-900 font-mono">{run.id.slice(0, 8)}</span>
      </nav>

      {/* Header */}
      <div className="card">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">
              {run.repoOwner}/{run.repoName}
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              Issue #{run.issueNumber} &mdash; {run.issueTitle}
            </p>
          </div>
          <StatusBadge status={run.status} />
        </div>
      </div>

      {/* Details grid */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <div className="card space-y-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Timing</h3>
          <DetailRow label="Created" value={new Date(run.createdAt).toLocaleString()} />
          <DetailRow label="Updated" value={new Date(run.updatedAt).toLocaleString()} />
          <DetailRow label="Duration" value={formatDuration(run.durationSeconds)} />
        </div>

        <div className="card space-y-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Cost & Model</h3>
          <DetailRow label="Cost" value={run.costCents ? `$${(run.costCents / 100).toFixed(2)}` : '—'} />
          <DetailRow label="Model" value={run.modelUsed || '—'} />
        </div>
      </div>

      {/* PR Link */}
      {run.prUrl && (
        <div className="card">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Pull Request</h3>
          <a
            href={run.prUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex items-center gap-2 text-sm font-medium text-brand-600 hover:text-brand-700"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
            </svg>
            View Pull Request
          </a>
        </div>
      )}

      {/* Error message */}
      {run.errorMessage && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4">
          <h3 className="text-sm font-semibold text-red-800">Error</h3>
          <pre className="mt-2 whitespace-pre-wrap text-sm text-red-700 font-mono">
            {run.errorMessage}
          </pre>
        </div>
      )}

      {/* Back link */}
      <Link
        to="/runs"
        className="inline-flex items-center gap-1 text-sm font-medium text-gray-500 hover:text-gray-700"
      >
        &larr; Back to runs
      </Link>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-sm text-gray-500">{label}</span>
      <span className="text-sm font-medium text-gray-900">{value}</span>
    </div>
  );
}

function StatusBadge({ status }: { status: Run['status'] }) {
  const styles: Record<string, string> = {
    success: 'badge-success',
    running: 'badge-info',
    queued: 'badge-neutral',
    failed: 'badge-error',
    cancelled: 'badge-warning',
  };
  return <span className={`${styles[status] || 'badge-neutral'} text-sm px-3 py-1`}>{status}</span>;
}

function formatDuration(seconds?: number): string {
  if (!seconds) return '—';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}
