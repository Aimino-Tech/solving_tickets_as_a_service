/**
 * E2E Tests: Slack Notification Dispatch
 *
 * Validates the Slack notification integration:
 *   1. buildTextMessage formats all 5 event types correctly
 *   2. SlackNotificationService.sendNotification posts to webhook URL
 *   3. SlackNotificationService.sendNotification handles missing config gracefully
 *   4. SlackNotificationService.sendNotification handles HTTP errors
 *   5. createSlackNotifier returns a valid SlackNotificationService
 *   6. SlackBoltApp instantiation without config (no throw)
 *   7. getSlackBoltApp returns singleton instance
 */

import { afterAll, beforeAll, describe, expect, it, vi, beforeEach } from 'vitest';
import { createTestHarness } from './harness/index.js';
import type { TestHarness } from './harness/index.js';
import type { NotificationEvent, NotificationData } from '../../src/notifications/base.js';

let harness: TestHarness;

beforeAll(async () => {
  harness = await createTestHarness({ verbose: false });
}, 30_000);

afterAll(async () => {
  await harness.stop();
}, 10_000);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sampleData: NotificationData = {
  repoOwner: 'owner',
  repoName: 'test-repo',
  issueNumber: 42,
  issueTitle: 'Fix broken user login',
  prUrl: 'https://github.com/owner/test-repo/pull/43',
  reason: 'Tests failed',
  errorMessage: 'Connection timeout after 30s',
  botName: 'STAS',
};

// ---------------------------------------------------------------------------
// buildTextMessage Tests
// ---------------------------------------------------------------------------

describe('buildTextMessage() — formats Slack messages for all event types', () => {
  it.each([
    ['fix_started', ':mag: *STAS* is investigating <https://github.com/owner/test-repo/issues/42|#42>'],
    ['pr_created', ':rocket: *STAS* opened a PR for <https://github.com/owner/test-repo/issues/42|#42>'],
    ['fix_failed', ":x: *STAS* couldn't fix <https://github.com/owner/test-repo/issues/42|#42>"],
    ['verification_failed', ':warning: *STAS* fix for <https://github.com/owner/test-repo/issues/42|#42> failed verification'],
    ['error', ':fire: *STAS* encountered an error on <https://github.com/owner/test-repo/issues/42|#42>'],
  ] as const)('should format %s event correctly', async (event, expectedPrefix) => {
    const { buildTextMessage } = await import('../../src/notifications/slack.js');
    const msg = buildTextMessage(event as NotificationEvent, sampleData);

    expect(msg).toContain(expectedPrefix);
    expect(msg).toContain('> Fix broken user login');
    expect(msg).toContain('> Repo: <https://github.com/owner/test-repo|owner/test-repo>');
  });

  it('should include PR URL in pr_created message', async () => {
    const { buildTextMessage } = await import('../../src/notifications/slack.js');
    const msg = buildTextMessage('pr_created', sampleData);

    expect(msg).toContain('PR: <https://github.com/owner/test-repo/pull/43|#43>');
  });

  it('should include reason in fix_failed message', async () => {
    const { buildTextMessage } = await import('../../src/notifications/slack.js');
    const msg = buildTextMessage('fix_failed', sampleData);

    expect(msg).toContain('Reason: Tests failed');
  });

  it('should include reason in verification_failed message', async () => {
    const { buildTextMessage } = await import('../../src/notifications/slack.js');
    const msg = buildTextMessage('verification_failed', sampleData);

    expect(msg).toContain('Details: Tests failed');
  });

  it('should include errorMessage in error message', async () => {
    const { buildTextMessage } = await import('../../src/notifications/slack.js');
    const msg = buildTextMessage('error', sampleData);

    expect(msg).toContain('Error: Connection timeout after 30s');
  });

  it('should omit reason/reason when not provided', async () => {
    const { buildTextMessage } = await import('../../src/notifications/slack.js');
    const dataWithoutReason: NotificationData = {
      repoOwner: 'owner',
      repoName: 'test-repo',
      issueNumber: 42,
      issueTitle: 'Fix',
    };

    const msg = buildTextMessage('fix_failed', dataWithoutReason);
    expect(msg).not.toContain('Reason:');
    expect(msg).not.toContain('Details:');
    expect(msg).not.toContain('Error:');
  });

  it('should omit PR URL when not provided in pr_created', async () => {
    const { buildTextMessage } = await import('../../src/notifications/slack.js');
    const dataWithoutPr: NotificationData = {
      repoOwner: 'owner',
      repoName: 'test-repo',
      issueNumber: 42,
      issueTitle: 'Fix',
    };

    const msg = buildTextMessage('pr_created', dataWithoutPr);
    expect(msg).not.toContain('PR:');
  });
});

// ---------------------------------------------------------------------------
// SlackNotificationService Tests
// ---------------------------------------------------------------------------

describe('SlackNotificationService.sendNotification()', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('should send a POST request to webhook URL with correct payload', async () => {
    // Mock fetch to intercept the webhook call
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue('ok'),
    });
    vi.stubGlobal('fetch', mockFetch);

    const { SlackNotificationService } = await import('../../src/notifications/slack.js');
    const service = new SlackNotificationService('https://hooks.slack.com/test-webhook');

    await service.sendNotification('fix_started', sampleData);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://hooks.slack.com/test-webhook',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: expect.stringContaining('STAS is investigating'),
      }),
    );

    vi.unstubAllGlobals();
  });

  it('should log warning and not throw when webhook URL is empty', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    const { SlackNotificationService } = await import('../../src/notifications/slack.js');
    // Pass empty string as webhookUrl — the service checks hasWebhook
    const service = new SlackNotificationService('');

    // Should not throw — just logs a warning
    await expect(
      service.sendNotification('fix_started', sampleData),
    ).resolves.not.toThrow();

    // fetch should NOT be called since webhookUrl is empty
    expect(mockFetch).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it('should handle HTTP error response from webhook', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: vi.fn().mockResolvedValue('Forbidden'),
    });
    vi.stubGlobal('fetch', mockFetch);

    const { SlackNotificationService } = await import('../../src/notifications/slack.js');
    const service = new SlackNotificationService('https://hooks.slack.com/test-webhook');

    // Should not throw — just logs the error
    await expect(
      service.sendNotification('fix_failed', sampleData),
    ).resolves.not.toThrow();

    expect(mockFetch).toHaveBeenCalledTimes(1);

    vi.unstubAllGlobals();
  });

  it('should handle network error gracefully', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Network failure'));
    vi.stubGlobal('fetch', mockFetch);

    const { SlackNotificationService } = await import('../../src/notifications/slack.js');
    const service = new SlackNotificationService('https://hooks.slack.com/test-webhook');

    // Should not throw — error is caught and logged
    await expect(
      service.sendNotification('error', sampleData),
    ).resolves.not.toThrow();

    vi.unstubAllGlobals();
  });

  it('should send all 5 event types without error', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue('ok'),
    });
    vi.stubGlobal('fetch', mockFetch);

    const events: NotificationEvent[] = [
      'fix_started',
      'pr_created',
      'fix_failed',
      'verification_failed',
      'error',
    ];

    const { SlackNotificationService } = await import('../../src/notifications/slack.js');
    const service = new SlackNotificationService('https://hooks.slack.com/test-webhook');

    for (const event of events) {
      await expect(
        service.sendNotification(event, sampleData),
      ).resolves.not.toThrow();
    }

    expect(mockFetch).toHaveBeenCalledTimes(events.length);

    vi.unstubAllGlobals();
  });
});

// ---------------------------------------------------------------------------
// createSlackNotifier Tests
// ---------------------------------------------------------------------------

describe('createSlackNotifier()', () => {
  it('should return a SlackNotificationService instance', async () => {
    const { createSlackNotifier } = await import('../../src/notifications/slack.js');
    const notifier = createSlackNotifier();

    expect(notifier).toBeDefined();
    expect(typeof notifier.sendNotification).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// SlackBoltApp Tests
// ---------------------------------------------------------------------------

describe('SlackBoltApp (getSlackBoltApp)', () => {
  it('should return a singleton instance without throwing (no config)', async () => {
    // getSlackBoltApp is already mocked by the test harness (returns a mock).
    // We test the mock interface here.
    const { getSlackBoltApp } = await import('../../src/notifications/slack-bolt.js');
    const bolt = getSlackBoltApp();

    expect(bolt).toBeDefined();
    expect(typeof bolt.mountOn).toBe('function');
  });

  it('should allow resetting the singleton', async () => {
    const { resetSlackBoltApp, getSlackBoltApp } = await import('../../src/notifications/slack-bolt.js');
    const first = getSlackBoltApp();
    resetSlackBoltApp();
    const second = getSlackBoltApp();

    // After reset, a new instance could be created
    expect(second).toBeDefined();
  });
});
