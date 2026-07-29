import React from 'react';

interface SkeletonProps {
  className?: string;
  style?: React.CSSProperties;
}

/** Base pulse-animated bar primitive. */
function Bar({ className = '' }: SkeletonProps) {
  return (
    <div
      className={`animate-pulse rounded bg-gray-200 dark:bg-gray-700 ${className}`}
      aria-hidden="true"
    />
  );
}

// ---------------------------------------------------------------------------
// SkeletonCard — stat card placeholder (icon + label + value)
// ---------------------------------------------------------------------------

export function SkeletonCard({ className = '' }: SkeletonProps) {
  return (
    <div className={`card animate-pulse ${className}`}>
      <div className="inline-flex h-10 w-10 rounded-lg bg-gray-200 dark:bg-gray-700" />
      <Bar className="mt-3 h-4 w-24" />
      <Bar className="mt-2 h-8 w-16" />
    </div>
  );
}

// SkeletonCardGrid — renders a responsive grid of SkeletonCards
export function SkeletonCardGrid({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SkeletonTable — table-row placeholders for data tables
// ---------------------------------------------------------------------------

function SkeletonTableRow({ columns }: { columns: number }) {
  return (
    <tr className="border-b border-gray-100 dark:border-gray-700 last:border-0">
      {Array.from({ length: columns }, (_, i) => (
        <td key={i} className="px-4 py-3">
          <Bar
            className={`h-4 ${
              i === 0
                ? 'w-16'
                : i === 1
                  ? 'w-40'
                  : i === 2
                    ? 'w-20'
                    : 'w-12'
            }`}
          />
        </td>
      ))}
    </tr>
  );
}

export function SkeletonTable({ rows = 5, columns = 6 }: { rows?: number; columns?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, i) => (
        <SkeletonTableRow key={i} columns={columns} />
      ))}
    </>
  );
}

// SkeletonTableFull — renders a full table skeleton including chrome
export function SkeletonTableFull({ rows = 5, columns = 6 }: { rows?: number; columns?: number }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm animate-pulse">
      <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
        <thead className="bg-gray-50 dark:bg-gray-700/50">
          <tr>
            {Array.from({ length: columns }, (_, i) => (
              <th key={i} className="px-4 py-3">
                <Bar className="h-3 w-16 rounded" />
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
          <SkeletonTable rows={rows} columns={columns} />
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SkeletonChart — chart area placeholder (title bar + chart rectangle)
// ---------------------------------------------------------------------------

export function SkeletonChart({ className = '' }: SkeletonProps) {
  return (
    <div className={`card animate-pulse ${className}`}>
      <Bar className="h-5 w-48" />
      <div className="mt-4 space-y-2">
        {/* Fake x-axis bars */}
        <div className="flex items-end gap-1" style={{ height: 120 }}>
          {[40, 65, 50, 80, 35, 70, 55, 45, 75, 60].map((h, i) => (
            <div key={i} className="flex-1 flex flex-col justify-end">
              <Bar className="w-full rounded-t" style={{ height: `${h}%` }} />
            </div>
          ))}
        </div>
        {/* Fake axis line */}
        <Bar className="h-px w-full" />
        {/* Fake labels */}
        <div className="flex gap-4">
          <Bar className="h-3 w-12" />
          <Bar className="h-3 w-12" />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SkeletonText — text-line placeholders (e.g. detail pages)
// ---------------------------------------------------------------------------

export function SkeletonText({
  lines = 5,
  className = '',
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div className={`animate-pulse space-y-3 ${className}`} aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <Bar
          key={i}
          className="h-4"
          style={{ width: `${60 + i * 8}%` }}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SkeletonRunDetail — full detail-page skeleton (card + grid + text)
// ---------------------------------------------------------------------------

export function SkeletonRunDetail() {
  return (
    <div className="max-w-4xl space-y-6 animate-pulse">
      {/* Header card */}
      <div className="card">
        <div className="flex items-start justify-between">
          <div className="min-w-0 flex-1">
            <Bar className="h-6 w-48" />
            <Bar className="mt-2 h-4 w-64" />
          </div>
          <Bar className="h-6 w-20 rounded-full shrink-0" />
        </div>
      </div>

      {/* Two-column detail cards */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <div className="card space-y-4">
          <Bar className="h-4 w-24" />
          <SkeletonText lines={3} />
        </div>
        <div className="card space-y-4">
          <Bar className="h-4 w-24" />
          <SkeletonText lines={3} />
        </div>
      </div>

      {/* Diff card */}
      <div className="card">
        <Bar className="h-4 w-24" />
        <Bar className="mt-4 h-48 w-full rounded-lg" />
      </div>
    </div>
  );
}
