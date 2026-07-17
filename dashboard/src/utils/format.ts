/**
 * Localized date/time/number formatting utilities using Intl APIs.
 * All functions use navigator.language as default locale fallback.
 */

const defaultLocale = (): string =>
  typeof navigator !== 'undefined' ? navigator.language : 'en-US';

/**
 * Format a date as a localized date string (e.g., "Jul 17, 2026")
 */
export function formatDate(date: string | Date, locale?: string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat(locale ?? defaultLocale(), {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(d);
}

/**
 * Format a date as a localized time string (e.g., "3:04 PM")
 */
export function formatTime(date: string | Date, locale?: string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat(locale ?? defaultLocale(), {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(d);
}

/**
 * Format a date as a localized date+time string (e.g., "Jul 17, 2026, 3:04 PM")
 */
export function formatDateTime(date: string | Date, locale?: string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat(locale ?? defaultLocale(), {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(d);
}

/**
 * Format a number with locale-appropriate grouping (e.g., "1,234")
 */
export function formatNumber(num: number, locale?: string): string {
  return new Intl.NumberFormat(locale ?? defaultLocale()).format(num);
}

/**
 * Format a number as a percentage (e.g., "73.5%")
 */
export function formatPercentage(num: number, locale?: string, decimals = 1): string {
  return new Intl.NumberFormat(locale ?? defaultLocale(), {
    style: 'percent',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(num);
}

/**
 * Format a duration in minutes as a compact string (e.g., "2h 15m").
 * Also handles seconds via an internal helper for sub-minute values.
 */
export function formatDuration(minutes: number): string {
  if (minutes < 1) return '<1m';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

/**
 * Format a duration in seconds as a compact string (e.g., "2h 15m").
 */
export function formatDurationSeconds(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

/**
 * Format a date as a relative time string (e.g., "3m ago", "just now").
 */
export function formatRelativeTime(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const now = Date.now();
  const then = d.getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return formatDate(d);
}
