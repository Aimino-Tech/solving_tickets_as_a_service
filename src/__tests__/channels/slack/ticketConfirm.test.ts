import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LinearTicketInfo } from '../../../channels/slack/ticketConfirm.js';
import {
  createLinearTicketConfirmer,
  LINEAR_API_URL,
  resolveLinearApiKey,
} from '../../../channels/slack/ticketConfirm.js';

/** Builds a fake GraphQL JSON response. */
function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as Response;
}

const viewerOk = { data: { viewer: { id: 'user-1' } } };
const ticket: LinearTicketInfo = {
  id: 'uuid-1',
  identifier: 'AIM-4441',
  title: 'Fix the bridge',
  description: 'The bridge returns 500s.',
  url: 'https://linear.app/aimino/issue/AIM-4441/xyz',
  state: { name: 'Todo', type: 'unstarted' },
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('createLinearTicketConfirmer', () => {
  it('returns ticket info when viewer and issue queries succeed', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(viewerOk))
      .mockResolvedValueOnce(jsonResponse({ data: { issue: ticket } }));
    const confirmer = createLinearTicketConfirmer({ apiKey: 'key-1', fetchImpl });

    await expect(confirmer.confirm('AIM-4441')).resolves.toEqual(ticket);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [firstCall, secondCall] = fetchImpl.mock.calls;
    expect(firstCall[0]).toBe(LINEAR_API_URL);
    const firstInit = firstCall[1] as RequestInit;
    expect(firstInit.headers).toMatchObject({ Authorization: 'key-1' });
    const secondInit = secondCall[1] as RequestInit;
    const body = JSON.parse(String(secondInit.body));
    expect(body.query).toContain('issue(identifier: $identifier)');
    expect(body.variables).toEqual({ identifier: 'AIM-4441' });
  });

  it('returns null when the issue does not exist', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(viewerOk))
      .mockResolvedValueOnce(jsonResponse({ data: { issue: null } }));
    const confirmer = createLinearTicketConfirmer({ apiKey: 'key-1', fetchImpl });

    await expect(confirmer.confirm('AIM-9999')).resolves.toBeNull();
  });

  it('rejects when the viewer health check fails (401)', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ errors: [{ message: 'Unauthorized' }] }, false, 401));
    const confirmer = createLinearTicketConfirmer({ apiKey: 'bad-key', fetchImpl });

    await expect(confirmer.confirm('AIM-4441')).rejects.toThrow(/Unauthorized/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rejects when the issue query returns GraphQL errors', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(viewerOk))
      .mockResolvedValueOnce(jsonResponse({ errors: [{ message: 'Ticket not found' }] }, true, 200));
    const confirmer = createLinearTicketConfirmer({ apiKey: 'key-1', fetchImpl });

    await expect(confirmer.confirm('AIM-4441')).rejects.toThrow(/Ticket not found/);
  });

  it('rejects when no API key is configured', async () => {
    vi.stubEnv('SYMPHONY_LINEAR_API_KEY', '');
    vi.stubEnv('LINEAR_API_KEY', '');
    const confirmer = createLinearTicketConfirmer({ apiKey: '', fetchImpl: vi.fn() });

    await expect(confirmer.confirm('AIM-4441')).rejects.toThrow(/not configured/);
  });

  it('prefers SYMPHONY_LINEAR_API_KEY over LINEAR_API_KEY', () => {
    vi.stubEnv('SYMPHONY_LINEAR_API_KEY', 'symphony-key');
    vi.stubEnv('LINEAR_API_KEY', 'legacy-key');
    expect(resolveLinearApiKey()).toBe('symphony-key');
  });

  it('falls back to LINEAR_API_KEY', () => {
    vi.stubEnv('SYMPHONY_LINEAR_API_KEY', undefined);
    vi.stubEnv('LINEAR_API_KEY', 'legacy-key');
    expect(resolveLinearApiKey()).toBe('legacy-key');
  });
});
