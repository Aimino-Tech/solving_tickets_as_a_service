import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../config.js', () => ({
  config: {
    telegram: { botToken: 'test:token', webhookPath: '/webhook/telegram' },
    trackers: { defaultRepoOwner: 'testowner', defaultRepoName: 'testrepo', installationId: 123 },
    queue: { redisUrl: 'redis://localhost:6379' },
  },
}));

vi.mock('../../utils/logger.js', () => ({
  rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
}));

describe('channels/telegram', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns ok for non-command messages', async () => {
    const mod = await import('../../channels/telegram.js');
    const result = await mod.handleTelegramWebhook({
      message: { chat: { id: 123 }, text: 'hello', entities: [] },
    });
    expect(result.ok).toBe(true);
  });

  it('handles /start command', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true } as Response);
    const mod = await import('../../channels/telegram.js');
    const result = await mod.handleTelegramWebhook({
      message: { chat: { id: 123 }, text: '/start', entities: [{ type: 'bot_command', offset: 0, length: 6 }] },
    });
    expect(result.ok).toBe(true);
  });

  it('handles /fix command', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true } as Response);
    const mod = await import('../../channels/telegram.js');
    const result = await mod.handleTelegramWebhook({
      message: {
        chat: { id: 456 }, text: '/fix login button not working',
        entities: [{ type: 'bot_command', offset: 0, length: 4 }],
        from: { id: 789 },
      },
    });
    expect(result.ok).toBe(true);
  });

  it('TelegramProgressSender sends progress updates', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true } as Response);
    const mod = await import('../../channels/telegram.js');
    const sender = new mod.TelegramProgressSender();
    await sender.sendProgress({
      channel: 'telegram', channelTarget: '123', runId: 'run-1',
      phase: 'investigating', message: 'Working...', timestamp: new Date().toISOString(),
    });
    expect(fetch).toHaveBeenCalled();
  });
});
