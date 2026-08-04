interface PaginationProps {
  page: number;
  totalPages: number;
  total?: number;
  onPageChange: (page: number) => void;
  className?: string;
}

export default function Pagination({ page, totalPages, total, onPageChange, className = '' }: PaginationProps) {
  if (totalPages <= 1) return null;
  return (
    <div className={`flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between ${className}`}>
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Page {page} of {totalPages}
        {typeof total === 'number' ? ` (${total} total)` : ''}
      </p>
      <div className="flex gap-2">
        <button disabled={page <= 1} onClick={() => onPageChange(page - 1)} className="btn-secondary text-xs">
          Previous
        </button>
        <button disabled={page >= totalPages} onClick={() => onPageChange(page + 1)} className="btn-secondary text-xs">
          Next
        </button>
      </div>
    </div>
  );
}
