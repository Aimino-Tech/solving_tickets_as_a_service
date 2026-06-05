/**
 * Smoke test — verifies vitest is configured correctly.
 */

import { describe, expect, it } from 'vitest';

describe('vitest smoke test', () => {
  it('should run a basic test', () => {
    expect(1 + 1).toBe(2);
  });

  it('should handle strings', () => {
    expect('hello'.toUpperCase()).toBe('HELLO');
  });

  it('should handle arrays', () => {
    expect([1, 2, 3]).toHaveLength(3);
    expect([1, 2, 3]).toContain(2);
  });
});
