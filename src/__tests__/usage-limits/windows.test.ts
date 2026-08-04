import { describe, it, expect } from 'vitest';
import {
  computeContinuousWindow,
  computeWeeklyWindow,
  computeMonthlyWindow,
} from '../../usage-limits/routes.js';

describe('usage-limits window helpers', () => {
  const now = Date.UTC(2026, 7, 15, 12, 0, 0); // 2026-08-15T12:00:00Z

  it('continuous window spans 24h before and after now', () => {
    const w = computeContinuousWindow(now);
    expect(w.endMs - w.startMs).toBe(48 * 3_600_000);
    expect(w.startMs).toBe(now - 24 * 3_600_000);
    expect(w.endMs).toBe(now + 24 * 3_600_000);
  });

  it('weekly window spans 7d before and after now', () => {
    const w = computeWeeklyWindow(now);
    expect(w.endMs - w.startMs).toBe(14 * 24 * 3_600_000);
    expect(w.startMs).toBe(now - 7 * 24 * 3_600_000);
    expect(w.endMs).toBe(now + 7 * 24 * 3_600_000);
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
