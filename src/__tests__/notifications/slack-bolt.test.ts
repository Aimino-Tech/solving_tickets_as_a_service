/**
 * Unit tests for src/notifications/slack-bolt.ts — Slack Bolt integration.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@slack/bolt', () => ({
  App: vi.fn(function() { return {
    client: { chat: { postMessage: vi.fn() } },
    action: vi.fn(),
  }; }),
  ExpressReceiver: vi.fn(function() { return { router: { post: vi.fn() } }; }),
  LogLevel: { INFO: 'info' },
}));

const mockConfig: any = {
  config: {
    stas: { botName: 'STAS' },
    slack: { botToken: '', signingSecret: '', channel: '#stas-test', interactionsPath: '/slack/events' },
  },
};

vi.mock('../../config.js', () => mockConfig);

vi.mock('../../utils/logger.js', () => ({
  rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
}));

describe('notifications/slack-bolt', () => {
  let bolt: typeof import('../../notifications/slack-bolt.js');

  beforeEach(async () => {
    vi.clearAllMocks();
    bolt = await import('../../notifications/slack-bolt.js');
  });

  describe('SlackBoltApp', () => {
    it('creates app as null when not configured', () => {
      const app = new bolt.SlackBoltApp();
      expect(app.app).toBeNull();
    });

    it('creates a configured Bolt app when tokens are present', async () => {
      vi.resetModules();
      mockConfig.config.slack.botToken = 'xoxb-test';
      mockConfig.config.slack.signingSecret = 'secret';
      const mod = await import('../../notifications/slack-bolt.js');
      const app = new mod.SlackBoltApp();
      expect(app.app).not.toBeNull();
    });
  });

  describe('getSlackBoltApp', () => {
    it('returns a singleton instance', () => {
      const instance1 = bolt.getSlackBoltApp();
      const instance2 = bolt.getSlackBoltApp();
      expect(instance1).toBe(instance2);
    });
  });

  describe('resetSlackBoltApp', () => {
    it('clears the singleton instance', () => {
      const instance1 = bolt.getSlackBoltApp();
      bolt.resetSlackBoltApp();
      const instance2 = bolt.getSlackBoltApp();
      expect(instance1).not.toBe(instance2);
    });
  });

  describe('sendInteractiveMessage', () => {
    it('skips when app is null', async () => {
      const app = new bolt.SlackBoltApp();
      await expect(app.sendInteractiveMessage('fix_started', {
        repoOwner: 'owner', repoName: 'repo', issueNumber: 1, issueTitle: 'Test',
      })).resolves.toBeUndefined();
    });
  });
});
