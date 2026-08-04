const SEVERITY_CLASSES: Record<string, string> = {
  SEV1: 'badge-error',
  SEV2: 'badge-warning',
  SEV3: 'badge-neutral',
};

const STATUS_CLASSES: Record<string, string> = {
  open: 'badge-neutral',
  investigating: 'badge-warning',
  fixing: 'badge-info',
  resolved: 'badge-success',
};

export function SeverityBadge({ severity }: { severity: string }) {
  const normalized = String(severity || '').toUpperCase();
  const classes = SEVERITY_CLASSES[normalized] || 'badge-neutral';
  return <span className={classes}>{normalized || '—'}</span>;
}

export default function IncidentStatusBadge({ status }: { status: string }) {
  const classes = STATUS_CLASSES[status] || 'badge-neutral';
  return <span className={classes}>{status}</span>;
}
