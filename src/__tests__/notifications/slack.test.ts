/**
 * Unit tests for src/notifications/slack.ts — Slack notification service.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetSlackBoltApp = vi.fn();
const mockSendInteractiveMessage = vi.fn();

vi.mock('../../notifications/slack-bolt.js', () => ({
  getSlackBoltApp: mockGetSlackBoltApp,
}));

vi.mock('../../config.js', () => ({
  config: { stas: { botName: 'STAS' }, slack: { webhookUrl: '' }, n8n: { webhookUrl: '' } },
}));

vi.mock('../../utils/logger.js', () => ({
  rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
}));

describe('notifications/slack', () => {
  let slack: typeof import('../../notifications/slack.js');

  beforeEach(async () => {
    vi.clearAllMocks();
    mockGetSlackBoltApp.mockReturnValue({
      app: null,
      sendInteractiveMessage: mockSendInteractiveMessage,
    });
    slack = await import('../../notifications/slack.js');
  });

  describe('SlackNotificationService', () => {
    it('warns and skips when no Slack integration configured', async () => {
      const service = new slack.SlackNotificationService('');
      await service.sendNotification('fix_started', {
        repoOwner: 'owner',
        repoName: 'repo',
        issueNumber: 1,
        issueTitle: 'Test',
      });
      // No error, just warn
    });

    it('sends via webhook when URL is configured', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: true, text: vi.fn() });
      const service = new slack.SlackNotificationService('https://hooks.slack.com/test');
      await service.sendNotification('fix_started', {
        repoOwner: 'owner',
        repoName: 'repo',
        issueNumber: 1,
        issueTitle: 'Test',
      });
      expect(global.fetch).toHaveBeenCalled();
    });

    it('sends via Bolt app when configured', async () => {
      mockGetSlackBoltApp.mockReturnValue({
        app: { client: { chat: { postMessage: vi.fn() } } },
        sendInteractiveMessage: mockSendInteractiveMessage,
      });
      const service = new slack.SlackNotificationService('');
      await service.sendNotification('fix_started', {
        repoOwner: 'owner',
        repoName: 'repo',
        issueNumber: 1,
        issueTitle: 'Test',
      });
      expect(mockSendInteractiveMessage).toHaveBeenCalled();
    });
  });

  describe('createSlackNotifier', () => {
    it('creates a SlackNotificationService', () => {
      const notifier = slack.createSlackNotifier();
      expect(notifier).toBeDefined();
    });
  });
});
