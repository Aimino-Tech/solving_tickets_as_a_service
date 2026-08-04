import type { LucideIcon } from 'lucide-react';

interface StatCardProps {
  label: string;
  value: string | number;
  subLabel?: string;
  icon?: LucideIcon;
  className?: string;
}

export default function StatCard({ label, value, subLabel, icon: Icon, className = '' }: StatCardProps) {
  return (
    <div className={`card ${className}`}>
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <p className="text-sm text-gray-500 dark:text-gray-400">{label}</p>
          <p className="mt-1 text-2xl font-semibold text-gray-900 dark:text-gray-100">{value}</p>
          {subLabel && <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{subLabel}</p>}
        </div>
        {Icon && (
          <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 dark:bg-brand-900/30 text-brand-600 dark:text-brand-400">
            <Icon className="h-5 w-5" />
          </div>
        )}
      </div>
    </div>
  );
}
