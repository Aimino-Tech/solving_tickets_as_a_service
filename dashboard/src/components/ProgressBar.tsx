interface ProgressBarProps {
  value: number;
  max?: number;
  displayValue?: string;
  className?: string;
  barClassName?: string;
}

export default function ProgressBar({
  value,
  max = 100,
  displayValue,
  className = '',
  barClassName = 'bg-brand-600 dark:bg-brand-500',
}: ProgressBarProps) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className={className}>
      <div className="h-2 rounded-full bg-gray-200 dark:bg-gray-700">
        <div className={`h-2 rounded-full transition-all ${barClassName}`} style={{ width: `${pct}%` }} />
      </div>
      {displayValue !== undefined && <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{displayValue}</p>}
    </div>
  );
}
