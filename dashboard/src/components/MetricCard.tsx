import type { Severity } from '@/utils/evaluation';
import Sparkline from './Sparkline';

interface MetricCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  severity?: Severity;
  sparkline?: number[];
  footer?: string;
  className?: string;
  onClick?: () => void;
}

const SEVERITY_BADGE: Record<Severity, string> = {
  good: 'badge-success',
  warning: 'badge-warning',
  critical: 'badge-error',
  empty: '',
};

const SEVERITY_LABELS: Record<Severity, string> = {
  good: 'Good',
  warning: 'Warning',
  critical: 'Critical',
  empty: '',
};

export default function MetricCard({
  icon,
  label,
  value,
  severity,
  sparkline,
  footer,
  className = '',
  onClick,
}: MetricCardProps) {
  const content = (
    <>
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="inline-flex items-center justify-center rounded-md bg-brand-50 p-1.5 dark:bg-brand-900/50">
              {icon}
            </div>
            <p className="text-sm font-medium text-gray-500 dark:text-gray-400">{label}</p>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <p className="text-2xl font-bold tabular-nums text-gray-900 dark:text-gray-100">{value}</p>
            {severity && severity !== 'empty' && (
              <span className={SEVERITY_BADGE[severity]}>{SEVERITY_LABELS[severity]}</span>
            )}
          </div>
        </div>
        {sparkline && sparkline.length >= 2 && (
          <div className="ml-2 shrink-0 text-brand-600 dark:text-brand-400">
            <Sparkline data={sparkline} width={80} height={28} color="currentColor" />
          </div>
        )}
      </div>
      {footer && <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">{footer}</p>}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`card w-full text-left transition-colors hover:border-brand-200 hover:shadow-md dark:hover:border-brand-700 ${className}`}
      >
        {content}
      </button>
    );
  }

  return <div className={`card ${className}`}>{content}</div>;
}
