interface ErrorStateProps {
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}

export default function ErrorState({ message, onRetry, retryLabel = 'Retry', className = '' }: ErrorStateProps) {
  return (
    <div
      className={`rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/50 dark:text-red-400 ${className}`}
      role="alert"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <span>{message}</span>
        {onRetry && (
          <button onClick={onRetry} className="btn-secondary text-xs shrink-0">
            {retryLabel}
          </button>
        )}
      </div>
    </div>
  );
}
