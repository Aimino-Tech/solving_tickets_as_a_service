import { AlertTriangle, ArrowDown, ArrowUp, CheckCircle, XCircle } from 'lucide-react';
import { useState } from 'react';
import type { Run } from '@/api/types';
import StatusBadge from '@/components/StatusBadge';
import { formatCost, formatDurationShort } from '@/utils/format';

interface RunDetailContentProps {
  run: Run;
  onClose?: () => void;
}

export default function RunDetailContent({ run }: RunDetailContentProps) {
  const [showFullDiff, setShowFullDiff] = useState(false);

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
    <div className="space-y-5">
      {/* Header card */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
        <div className="flex items-start justify-between">
          <div className="min-w-0">
            <h2 className="text-xl font-semibold text-gray-900 truncate">
              {run.repoOwner}/{run.repoName}
            </h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 truncate">
              Issue #{run.issueNumber} &mdash; {run.issueTitle}
            </p>
          </div>
          <StatusBadge status={run.status} />
        </div>
      </div>

      {/* Timing + Cost/Model grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Timing</h3>
          <DetailRow label="Created" value={new Date(run.createdAt).toLocaleString()} />
          <DetailRow label="Updated" value={new Date(run.updatedAt).toLocaleString()} />
          <DetailRow label="Duration" value={formatDurationShort(run.durationSeconds)} />
        </div>

        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Cost &amp; Model
          </h3>
          <DetailRow label="Cost" value={formatCost(run.costCents)} />
          <DetailRow label="Model" value={run.modelUsed || '\u2014'} />
          <DetailRow
            label="Routed Variant"
            value={
              run.routingTier
                ? `Tier ${run.routingTier}${run.routingVariant ? ` (${run.routingVariant})` : ''}`
                : '\u2014'
            }
          />
          <DetailRow label="Credits Used" value={run.creditsUsed != null ? String(run.creditsUsed) : '\u2014'} />
        </div>
      </div>

      {/* Confidence Score */}
      {run.confidence && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Confidence Score
          </h3>
          <div className="mt-2 flex items-center gap-3">
            <span
              className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ${confStyles[run.confidence] || 'text-gray-600 bg-gray-50'}`}
            >
              {run.confidence === 'high' && <CheckCircle size={16} className="mr-1" />}
              {run.confidence === 'medium' && <AlertTriangle size={16} className="mr-1" />}
              {run.confidence === 'low' && <XCircle size={16} className="mr-1" />}
              {run.confidence}
            </span>
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {run.confidence === 'high' && 'Tests pass and the fix looks clean.'}
              {run.confidence === 'medium' && 'Basic verification passed, manual review recommended.'}
              {run.confidence === 'low' && 'Some checks did not pass. Review carefully.'}
            </span>
          </div>
        </div>
      )}

      {/* Diff */}
      {diff && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Changes</h3>
          <pre
            id="diff-content"
            className="mt-2 max-h-96 overflow-auto rounded-lg bg-gray-900 p-4 text-xs leading-relaxed text-green-400 font-mono"
          >
            {diffPreview || '(no diff preview available)'}
          </pre>
          {hasMoreDiff && (
            <button
              onClick={() => setShowFullDiff(!showFullDiff)}
              aria-expanded={showFullDiff}
              aria-controls="diff-content"
              className="mt-2 text-sm font-medium text-brand-600 hover:text-brand-700"
            >
              {showFullDiff ? (
                <>
                  Show less <ArrowUp size={14} className="inline" />
                </>
              ) : (
                <>
                  Show all ({formatBytes(diff.length)})<ArrowDown size={14} className="inline" />
                </>
              )}
            </button>
          )}
        </div>
      )}

      {/* Test Results */}
      {run.testOutput && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Test Results
          </h3>
          <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-gray-50 p-4 text-xs leading-relaxed text-gray-700 font-mono border border-gray-200">
            {run.testOutput.slice(0, 5000)}
          </pre>
          {run.testOutput.length > 5000 && (
            <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">(truncated to 5000 characters)</p>
          )}
        </div>
      )}

      {/* PR Link */}
      {run.prUrl && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Pull Request
          </h3>
          <a
            href={run.prUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex items-center gap-2 text-sm font-medium text-brand-600 hover:text-brand-700"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
              />
            </svg>
            View Pull Request
          </a>
        </div>
      )}

      {/* Error */}
      {run.errorMessage && (
        <div className="rounded-xl border border-red-200 dark:border-red-700 bg-red-50 dark:bg-red-900/30 p-4">
          <h3 className="text-sm font-semibold text-red-800 dark:text-red-200">Error</h3>
          <pre className="mt-2 whitespace-pre-wrap text-sm text-red-700 dark:text-red-300 font-mono">
            {run.errorMessage}
          </pre>
        </div>
      )}

      {/* Share section */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-brand-50 dark:bg-brand-900/30 p-4">
        <div className="flex flex-col gap-3 text-center sm:flex-row sm:text-left">
          <div className="flex-1">
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Share this run</h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Share the public link to show the fix result, test output, and confidence score.
            </p>
          </div>
          <div className="flex shrink-0 gap-2 justify-center">
            <button
              onClick={() => {
                navigator.clipboard.writeText(shareUrl).catch(() => {});
              }}
              className="rounded-lg bg-white dark:bg-gray-700 px-4 py-2 text-sm font-semibold text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
            >
              Copy link
            </button>
            <a
              href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(`SYNTARO fix for ${run.repoOwner}/${run.repoName} (${run.status}): ${shareUrl}`)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg bg-white dark:bg-gray-700 px-4 py-2 text-sm font-semibold text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
            >
              Share on X
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-sm text-gray-500 dark:text-gray-400">{label}</span>
      <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{value}</span>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1048576).toFixed(1)}MB`;
}
