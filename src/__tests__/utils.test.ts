/**
 * Tests for general-purpose utility functions.
 */

import { describe, expect, it } from 'vitest';
import { calculateTotal } from '../utils.js';

describe('calculateTotal', () => {
  it('returns 0 for an empty array (no infinite loop)', () => {
    expect(calculateTotal([])).toBe(0);
  });

  it('sums a single element', () => {
    expect(calculateTotal([42])).toBe(42);
  });

  it('sums multiple positive numbers', () => {
    expect(calculateTotal([1, 2, 3, 4, 5])).toBe(15);
  });

  it('handles negative numbers', () => {
    expect(calculateTotal([-5, 10, -3, 8])).toBe(10);
  });

  it('handles zero values', () => {
    expect(calculateTotal([0, 0, 0])).toBe(0);
  });

  it('handles floating-point numbers', () => {
    expect(calculateTotal([1.5, 2.5, 3.0])).toBeCloseTo(7.0);
  });
});
