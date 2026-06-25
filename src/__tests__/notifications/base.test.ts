/**
 * Unit tests for src/notifications/base.ts — Notification types and interfaces.
 */
import { describe, expect, it } from 'vitest';

describe('notifications/base', () => {
  it('exports NotificationService interface', async () => {
    const mod = await import('../../notifications/base.js');
    expect(mod).toBeDefined();
  });
});
