import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  registerWebhook, unregisterWebhook, listWebhooks,
  dispatchPipelineEvent, getDeliveries, clearDeliveries,
} from '../../pipeline/pipelineWebhooks.js';
import { createSessionState } from '../../pipeline/stateMachine.js';

describe('pipelineWebhooks', () => {
  beforeEach(() => {
    clearDeliveries();
    for (const { id } of listWebhooks()) {
      unregisterWebhook(id);
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers and lists webhooks', () => {
    registerWebhook('wh-1', {
      url: 'https://example.com/webhook',
      events: ['session.created', 'stage.advanced'],
    });
    const hooks = listWebhooks();
    expect(hooks.length).toBe(1);
    expect(hooks[0].id).toBe('wh-1');
  });

  it('unregisters a webhook', () => {
    registerWebhook('wh-1', {
      url: 'https://example.com/webhook',
      events: ['session.created'],
    });
    expect(listWebhooks().length).toBe(1);
    unregisterWebhook('wh-1');
    expect(listWebhooks().length).toBe(0);
  });

  it('dispatches to matching webhooks', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '' });
    vi.stubGlobal('fetch', fetchMock);

    registerWebhook('wh-1', {
      url: 'https://example.com/webhook',
      events: ['session.created'],
    });

    const state = createSessionState('sess-1', 'issue-1', 'stas:fix');
    await dispatchPipelineEvent('session.created', state);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.com/webhook',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'X-Pipeline-Event': 'session.created',
        }),
      }),
    );
  });

  it('does not dispatch when no webhooks match', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    registerWebhook('wh-1', {
      url: 'https://example.com/webhook',
      events: ['session.created'],
    });

    const state = createSessionState('sess-1', 'issue-1', 'stas:fix');
    await dispatchPipelineEvent('session.failed', state);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('records delivery history', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '' });
    vi.stubGlobal('fetch', fetchMock);

    registerWebhook('wh-1', {
      url: 'https://example.com/webhook',
      events: ['*'],
    });

    const state = createSessionState('sess-1', 'issue-1', 'stas:fix');
    await dispatchPipelineEvent('session.created', state);

    const deliveries = getDeliveries();
    expect(deliveries.length).toBe(1);
    expect(deliveries[0].status).toBe('delivered');
    expect(deliveries[0].event).toBe('session.created');
  });
});
