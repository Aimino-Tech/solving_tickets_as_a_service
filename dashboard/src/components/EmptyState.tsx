interface EmptyStateProps {
  title: string;
  hint?: string;
  action?: React.ReactNode;
  className?: string;
}

export default function EmptyState({ title, hint, action, className = '' }: EmptyStateProps) {
  return (
    <div className={`card text-center py-8 ${className}`}>
      <p className="text-sm text-gray-400 dark:text-gray-500">{title}</p>
      {hint && <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">{hint}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}
