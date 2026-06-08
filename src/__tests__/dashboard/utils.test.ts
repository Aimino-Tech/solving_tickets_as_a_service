/**
 * Unit tests for dashboard utility functions.
 *
 * The formatDuration helper is extracted from DashboardHome.tsx where it is
 * used to display run durations in a human-readable format.
 *
 * Tests:
 *   - formatDuration(seconds) returns formatted strings
 *   - Edge cases: 0, negative, large values
 */

import { describe, expect, it } from 'vitest';

/**
 * Format a duration in seconds to a human-readable string.
 * Extracted from dashboard/src/pages/DashboardHome.tsx.
 */
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

describe('formatDuration', () => {
  it('returns seconds for durations under 60 seconds', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(30)).toBe('30s');
    expect(formatDuration(59)).toBe('59s');
  });

  it('returns minutes and seconds for durations under 1 hour', () => {
    expect(formatDuration(60)).toBe('1m 0s');
    expect(formatDuration(90)).toBe('1m 30s');
    expect(formatDuration(150)).toBe('2m 30s');
    expect(formatDuration(3599)).toBe('59m 59s');
  });

  it('returns hours and minutes for durations 1 hour or more', () => {
    expect(formatDuration(3600)).toBe('1h 0m');
    expect(formatDuration(3661)).toBe('1h 1m');
    expect(formatDuration(7200)).toBe('2h 0m');
    expect(formatDuration(9000)).toBe('2h 30m');
  });

  it('rounds seconds', () => {
    expect(formatDuration(30.7)).toBe('31s');
    expect(formatDuration(90.4)).toBe('1m 30s');
  });

  it('handles negative values by rounding', () => {
    // Negative doesn't make sense but the function should not crash
    expect(typeof formatDuration(-1)).toBe('string');
  });

  it('handles very large values', () => {
    expect(formatDuration(100000)).toBe('27h 46m');
  });
});
