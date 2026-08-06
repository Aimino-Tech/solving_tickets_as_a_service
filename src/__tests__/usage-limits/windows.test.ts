import { describe, it, expect } from 'vitest';
import {
  computeContinuousWindow,
  computeWeeklyWindow,
  computeMonthlyWindow,
} from '../../usage-limits/routes.js';

describe('usage-limits window helpers', () => {
  const now = Date.UTC(2026, 7, 15, 12, 0, 0); // 2026-08-15T12:00:00Z

  it('daily window is today 00:00 UTC to tomorrow 00:00 UTC', () => {
    const w = computeContinuousWindow(now);
    expect(w.startMs).toBe(Date.UTC(2026, 7, 15, 0, 0, 0, 0));
    expect(w.endMs).toBe(Date.UTC(2026, 7, 16, 0, 0, 0, 0));
    expect(w.endMs - w.startMs).toBe(24 * 3_600_000);
  });

  it('weekly window is the ISO week from Monday 00:00 UTC', () => {
    const w = computeWeeklyWindow(now);
    expect(w.startMs).toBe(Date.UTC(2026, 7, 10, 0, 0, 0, 0));
    expect(w.endMs).toBe(Date.UTC(2026, 7, 17, 0, 0, 0, 0));
    expect(w.endMs - w.startMs).toBe(7 * 24 * 3_600_000);
  });

  it('weekly window handles Sunday by rewinding to the previous Monday', () => {
    const sunday = Date.UTC(2026, 7, 16, 8, 0, 0); // 2026-08-16 is Sunday
    const w = computeWeeklyWindow(sunday);
    expect(w.startMs).toBe(Date.UTC(2026, 7, 10, 0, 0, 0, 0));
    expect(w.endMs).toBe(Date.UTC(2026, 7, 17, 0, 0, 0, 0));
  });

  it('monthly window is the calendar month with reset at next month start', () => {
    const w = computeMonthlyWindow(now);
    expect(w.startMs).toBe(Date.UTC(2026, 7, 1, 0, 0, 0, 0));
    expect(w.endMs).toBe(Date.UTC(2026, 8, 1, 0, 0, 0, 0));
  });

  it('monthly window rolls over into the next year in December', () => {
    const w = computeMonthlyWindow(Date.UTC(2026, 11, 20, 6, 30, 0));
    expect(w.startMs).toBe(Date.UTC(2026, 11, 1, 0, 0, 0, 0));
    expect(w.endMs).toBe(Date.UTC(2027, 0, 1, 0, 0, 0, 0));
  });
});
