import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../config.js', () => ({
  config: {
    whatsapp: { phoneNumberId: '123456', accessToken: 'test-token', webhookPath: '/webhook/whatsapp', verifyToken: 'verify-me' },
    trackers: { defaultRepoOwner: 'testowner', defaultRepoName: 'testrepo', installationId: 123 },
    queue: { redisUrl: 'redis://localhost:6379' },
    n8n: { whatsappWebhookUrl: 'https://n8n.example.com/webhook/whatsapp' },
  },
}));

vi.mock('../../utils/logger.js', () => ({
  rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
}));

describe('channels/whatsapp', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('verifyWhatsAppWebhook returns challenge when token matches', async () => {
    const mod = await import('../../channels/whatsapp.js');
    const result = mod.verifyWhatsAppWebhook({
      query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'verify-me', 'hub.challenge': 'challenge123' },
    });
    expect(result.verified).toBe(true);
    expect(result.challenge).toBe('challenge123');
  });

  it('verifyWhatsAppWebhook returns not verified when token mismatches', async () => {
    const mod = await import('../../channels/whatsapp.js');
    const result = mod.verifyWhatsAppWebhook({
      query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong-token', 'hub.challenge': 'challenge123' },
    });
    expect(result.verified).toBe(false);
  });

  it('returns ok for non-text messages', async () => {
    const mod = await import('../../channels/whatsapp.js');
    const result = await mod.handleWhatsAppWebhook({ entry: [{ changes: [{ value: { messages: [] } }] }] });
    expect(result.ok).toBe(true);
  });

  it('handles fix command in text messages', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true } as Response);
    const mod = await import('../../channels/whatsapp.js');
    const result = await mod.handleWhatsAppWebhook({
      entry: [{ changes: [{ value: { messages: [{ from: '15551234567', type: 'text', text: { body: 'fix login validation broken' } }] } }] }],
    });
    expect(result.ok).toBe(true);
  });

  it('WhatsAppProgressSender sends progress updates', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true } as Response);
    const mod = await import('../../channels/whatsapp.js');
    const sender = new mod.WhatsAppProgressSender();
    await sender.sendProgress({
      channel: 'whatsapp', channelTarget: '15551234567', runId: 'run-1',
      phase: 'fixing', message: 'Working...', timestamp: new Date().toISOString(),
    });
    expect(fetch).toHaveBeenCalled();
  });
});
