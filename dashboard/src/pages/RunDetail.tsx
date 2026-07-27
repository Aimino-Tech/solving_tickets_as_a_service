import { useState, useEffect } from 'react';
import { runs } from '@/api/client';
import type { Run } from '@/api/types';
import { useParams, Link } from 'react-router-dom';
import { formatDateTime, formatDurationSeconds } from '@/utils/format';
import { SkeletonRunDetail } from '@/components/LoadingSkeleton';

export default function RunDetail() {
  const { id } = useParams<{ id: string }>();
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showFullDiff, setShowFullDiff] = useState(false);

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

  const statusStyles: Record<string, string> = {
    success: 'text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-900/50 border-green-200 dark:border-green-700',
    running: 'text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/50 border-blue-200 dark:border-blue-700',
    queued: 'text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-700 border-gray-200 dark:border-gray-600',
    failed: 'text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/50 border-red-200 dark:border-red-700',
    cancelled: 'text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/50 border-amber-200 dark:border-amber-700',
  };

  const confStyles: Record<string, string> = {
    high: 'text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-900/50',
    medium: 'text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/50',
    low: 'text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/50',
  };

  const diff = run.diff || '';
  const diffPreview = showFullDiff ? diff : diff.slice(0, 2000);
  const hasMoreDiff = diff.length > 2000;

  const shareUrl = `${window.location.origin}/runs/${run.id}`;

  return (
    <div className="max-w-4xl space-y-6">
      <nav className="flex items-center justify-between text-sm text-gray-500 dark:text-gray-400 dark:text-gray-500">
        <div>
          <Link to="/runs" className="hover:text-brand-600">Runs</Link>
          <span className="mx-2">/</span>
          <span className="text-gray-900 font-mono">{run.id.slice(0, 8)}</span>
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

      <div className="card">
        <div className="flex items-start justify-between">
          <div className="min-w-0">
            <h2 className="text-xl font-semibold text-gray-900 truncate">
              {run.repoOwner}/{run.repoName}
            </h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 truncate">
              Issue #{run.issueNumber} &mdash; {run.issueTitle}
            </p>
          </div>
          <span className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold ${statusStyles[run.status] || 'text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-700 border-gray-200 dark:border-gray-600'}`}>
            {run.status}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <div className="card space-y-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 dark:text-gray-500">Timing</h3>
          <DetailRow label="Created" value={new Date(run.createdAt).toLocaleString()} />
          <DetailRow label="Updated" value={new Date(run.updatedAt).toLocaleString()} />
          <DetailRow label="Duration" value={formatDuration(run.durationSeconds)} />
        </div>

        <div className="card space-y-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 dark:text-gray-500">Cost &amp; Model</h3>
          <DetailRow label="Cost" value={run.costCents ? `$${(run.costCents / 100).toFixed(2)}` : '\u2014'} />
          <DetailRow label="Model" value={run.modelUsed || '\u2014'} />
          <DetailRow label="Credits Used" value={run.creditsUsed != null ? String(run.creditsUsed) : '\u2014'} />
        </div>
      </div>

      {run.confidence && (
        <div className="card">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 dark:text-gray-500">Confidence Score</h3>
          <div className="mt-2 flex items-center gap-3">
            <span className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ${confStyles[run.confidence] || 'text-gray-600 bg-gray-50'}`}>
              {run.confidence === 'high' && '\u2705 '}
              {run.confidence === 'medium' && '\u26A0\uFE0F '}
              {run.confidence === 'low' && '\u274C '}
              {run.confidence}
            </span>
            <span className="text-sm text-gray-500 dark:text-gray-400 dark:text-gray-500">
              {run.confidence === 'high' && 'Tests pass and the fix looks clean.'}
              {run.confidence === 'medium' && 'Basic verification passed, manual review recommended.'}
              {run.confidence === 'low' && 'Some checks did not pass. Review carefully.'}
            </span>
          </div>
        </div>
      )}

      {diff && (
        <div className="card">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 dark:text-gray-500">Changes</h3>
          <pre className="mt-2 max-h-96 overflow-auto rounded-lg bg-gray-900 p-4 text-xs leading-relaxed text-green-400 font-mono">
            {diffPreview || '(no diff preview available)'}
          </pre>
          {hasMoreDiff && (
            <button
              onClick={() => setShowFullDiff(!showFullDiff)}
              className="mt-2 text-sm font-medium text-brand-600 hover:text-brand-700"
            >
              {showFullDiff ? 'Show less \u2191' : `Show all (${formatBytes(diff.length)})\u2193`}
            </button>
          )}
        </div>
      )}

      {run.testOutput && (
        <div className="card">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 dark:text-gray-500">Test Results</h3>
          <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-gray-50 p-4 text-xs leading-relaxed text-gray-700 font-mono border border-gray-200">
            {run.testOutput.slice(0, 5000)}
          </pre>
          {run.testOutput.length > 5000 && (
            <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">(truncated to 5000 characters)</p>
          )}
        </div>
      )}

      {run.prUrl && (
        <div className="card">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 dark:text-gray-500">Pull Request</h3>
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

      {run.errorMessage && (
        <div className="rounded-xl border border-red-200 dark:border-red-700 bg-red-50 dark:bg-red-900/30 p-4">
          <h3 className="text-sm font-semibold text-red-800 dark:text-red-200">Error</h3>
          <pre className="mt-2 whitespace-pre-wrap text-sm text-red-700 dark:text-red-300 font-mono">
            {run.errorMessage}
          </pre>
        </div>
      )}

      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-brand-50 dark:bg-brand-900/30 p-6">
        <div className="flex flex-col items-center gap-3 text-center sm:flex-row sm:text-left">
          <div className="flex-1">
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Share this run</h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 dark:text-gray-500">
              Share the public link to show the fix result, test output, and confidence score.
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              onClick={() => {
                navigator.clipboard.writeText(shareUrl).catch(() => {});
              }}
              className="rounded-lg bg-white dark:bg-gray-700 px-4 py-2 text-sm font-semibold text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
            >
              Copy link
            </button>
            <a
              href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(`STAS fix for ${run.repoOwner}/${run.repoName} (${run.status}): ${shareUrl}`)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg bg-white dark:bg-gray-700 px-4 py-2 text-sm font-semibold text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
            >
              Share on X
            </a>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-brand-200 dark:border-brand-700 bg-gradient-to-br from-brand-50 dark:from-brand-900/50 to-white dark:to-gray-800 p-8 text-center">
        <h3 className="text-lg font-bold text-gray-900">Label a GitHub issue. Get a PR.</h3>
        <p className="mt-2 text-sm text-gray-500 max-w-md mx-auto">
          STAS is an open-source bot that turns labeled issues into pull requests.
          Backed by OpenCode, the 162K star coding agent.
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
          <a
            href="https://github.com/tamnguyen08/solving_tickets_as_a_service"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 transition-colors shadow-sm"
          >
            <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
            Get STAS on GitHub
          </a>
          <span className="inline-flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500">
            <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
            162K+ stars
          </span>
        </div>
      </div>

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
      <span className="text-sm text-gray-500 dark:text-gray-400 dark:text-gray-500">{label}</span>
      <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{value}</span>
    </div>
  );
}

function formatDuration(seconds?: number): string {
  if (!seconds) return '\u2014';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1048576).toFixed(1)}MB`;
}
