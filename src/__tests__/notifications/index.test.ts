/**
 * Unit tests for src/notifications/index.ts — Barrel export.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../notifications/slack.js', () => ({ SlackNotificationService: vi.fn(), createSlackNotifier: vi.fn() }));
vi.mock('../../notifications/slack-bolt.js', () => ({ SlackBoltApp: vi.fn(), getSlackBoltApp: vi.fn(), resetSlackBoltApp: vi.fn() }));

describe('notifications/index', () => {
  it('exports all notification types and services', async () => {
    const mod = await import('../../notifications/index.js');
    expect(mod.SlackNotificationService).toBeDefined();
    expect(mod.createSlackNotifier).toBeDefined();
    expect(mod.SlackBoltApp).toBeDefined();
    expect(mod.getSlackBoltApp).toBeDefined();
    expect(mod.resetSlackBoltApp).toBeDefined();
  });
});
