import type { RunStatus } from '@/api/types';

const BADGE_CLASSES: Record<RunStatus, string> = {
  success: 'badge-success',
  completed: 'badge-success',
  running: 'badge-warning',
  queued: 'badge-warning',
  pending: 'badge-warning',
  failed: 'badge-error',
  cancelled: 'badge-warning',
};

// queued/pending/running are one pipeline state — show a single "pending" tag
const MERGED_LABEL: Partial<Record<RunStatus, string>> = {
  queued: 'pending',
  running: 'pending',
};

export default function StatusBadge({ status }: { status: RunStatus }) {
  return <span className={BADGE_CLASSES[status] || 'badge-neutral'}>{MERGED_LABEL[status] ?? status}</span>;
}
