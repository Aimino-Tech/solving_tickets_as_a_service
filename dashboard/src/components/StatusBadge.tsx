import type { RunStatus } from '@/api/types';

const BADGE_CLASSES: Record<RunStatus, string> = {
  success: 'badge-success',
  running: 'badge-info',
  queued: 'badge-neutral',
  failed: 'badge-error',
  cancelled: 'badge-warning',
};

export default function StatusBadge({ status }: { status: RunStatus }) {
  return <span className={BADGE_CLASSES[status] || 'badge-neutral'}>{status}</span>;
}
