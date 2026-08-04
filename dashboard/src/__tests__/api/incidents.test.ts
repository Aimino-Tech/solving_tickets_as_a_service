import { describe, it, expect, vi, beforeEach } from 'vitest';

const API_BASE = '/api';

describe('incidents API client', () => {
  let client: typeof import('@/api/client');

  beforeEach(async () => {
    localStorage.clear();
    vi.clearAllMocks();
    client = await import('@/api/client');
  });

  function mockFetchOk(json: unknown) {
    (window.fetch as any).mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(json),
    });
  }

  function lastCall() {
    return (window.fetch as any).mock.calls.at(-1);
  }

  it('lists incidents with filters as query params', async () => {
    mockFetchOk({ data: [], total: 0, limit: 20, offset: 0 });
    await client.incidents.list({ severity: 'SEV1', status: 'open', from: '2026-08-01', to: '2026-08-04' });

    const [url] = lastCall();
    expect(url).toBe(`${API_BASE}/v1/incidents?severity=SEV1&status=open&from=2026-08-01&to=2026-08-04`);
  });

  it('lists incidents without params when filters are empty', async () => {
    mockFetchOk({ data: [], total: 0 });
    await client.incidents.list({});

    const [url] = lastCall();
    expect(url).toBe(`${API_BASE}/v1/incidents`);
  });

  it('gets an incident detail', async () => {
    mockFetchOk({ data: { id: 1 } });
    await client.incidents.get(1);
    expect(lastCall()[0]).toBe(`${API_BASE}/v1/incidents/1`);
  });

  it('gets incident stats', async () => {
    mockFetchOk({ total: 3 });
    await client.incidents.getStats();
    expect(lastCall()[0]).toBe(`${API_BASE}/v1/incidents/stats`);
  });

  it('transitions an incident status via POST', async () => {
    mockFetchOk({ data: { id: 1, status: 'resolved' } });
    await client.incidents.transition(1, 'resolved');

    const [url, opts] = lastCall();
    expect(url).toBe(`${API_BASE}/v1/incidents/1/status`);
    expect(opts.method).toBe('POST');
    expect(opts.body).toBe(JSON.stringify({ status: 'resolved' }));
  });

  it('creates a service catalog entry', async () => {
    mockFetchOk({ data: { id: 1 } });
    await client.serviceCatalog.create({ name: 'auth', repos: [{ owner: 'acme', repo: 'auth-svc' }] });

    const [url, opts] = lastCall();
    expect(url).toBe(`${API_BASE}/v1/incidents/services`);
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({
      name: 'auth',
      repos: [{ owner: 'acme', repo: 'auth-svc' }],
    });
  });

  it('updates and removes a service catalog entry', async () => {
    mockFetchOk({ data: { id: 2 } });
    await client.serviceCatalog.update(2, { purpose: 'core' });
    expect(lastCall()[0]).toBe(`${API_BASE}/v1/incidents/services/2`);

    mockFetchOk({ success: true });
    await client.serviceCatalog.remove(2);
    expect(lastCall()[0]).toBe(`${API_BASE}/v1/incidents/services/2`);
    expect(lastCall()[1].method).toBe('DELETE');
  });
});
