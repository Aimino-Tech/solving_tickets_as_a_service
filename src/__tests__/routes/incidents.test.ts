import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFetchOsQueue, mockNotify, mockPersist, mockCatalog, mockRequireAuth } = vi.hoisted(() => ({
  mockFetchOsQueue: vi.fn(),
  mockNotify: vi.fn(async () => {}),
  mockPersist: vi.fn(async () => {}),
  mockCatalog: {
    list: vi.fn(async () => []),
    create: vi.fn(),
    findByName: vi.fn(async () => undefined),
    findById: vi.fn(async () => undefined),
    update: vi.fn(),
    delete: vi.fn(async () => true),
  },
  mockRequireAuth: vi.fn(),
}));

vi.mock('../../auth/middleware.js', () => ({
  requireAuth: mockRequireAuth,
}));

vi.mock('../../config.js', () => ({
  config: {
    incidents: { osUrl: 'http://os.test', timeoutMs: 1000, resolveNotifications: true },
    osy: { apiKey: 'test-key' },
  },
}));

vi.mock('../../incidents/osClient.js', () => ({
  fetchOsQueue: mockFetchOsQueue,
  computeStats: (incidents: unknown[]) => ({
    active: incidents.filter((i: { status: string }) => i.status === 'active').length,
    resolved: incidents.filter((i: { status: string }) => i.status === 'resolved').length,
    total: incidents.length,
    mttrSeconds: null,
    bySeverity: { SEV1: 0, SEV2: 0, SEV3: 0 },
  }),
}));

vi.mock('../../incidents/incidentNotifications.js', () => ({
  notifyIncidentResolutions: mockNotify,
  persistIncidentStates: mockPersist,
}));

vi.mock('../../db/repositories/index.js', () => ({
  incidentServiceCatalogRepository: mockCatalog,
}));

vi.mock('../../db/connection.js', () => ({
  isTableNotFoundError: () => false,
}));

vi.mock('../../utils/logger.js', () => ({
  rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
}));

function makeIncident(overrides: Record<string, unknown> = {}) {
  return {
    fingerprint: 'fp-1',
    service: 'payments-api',
    title: 'High error rate on checkout',
    severity: 1,
    severityLabel: 'SEV1',
    environment: 'prod',
    labels: [],
    firstSeenAt: '2026-08-01T10:00:00Z',
    lastSeenAt: '2026-08-01T10:30:00Z',
    dispatchedAt: '2026-08-01T10:05:00Z',
    status: 'active',
    difficulty: 1,
    variant: 'low',
    repos: ['owner/repo'],
    prs: [],
    ...overrides,
  };
}

async function startTestApp(): Promise<{ server: Server; baseUrl: string }> {
  const { incidentsRouter } = await import('../../routes/incidents.js');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    mockRequireAuth(req, _res, next);
  });
  app.use('/api/v1/incidents', incidentsRouter);
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

describe('routes/incidents', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = await startTestApp();
    server = app.server;
    baseUrl = app.baseUrl;
  });

  afterAll(() => {
    server?.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockImplementation((_req: unknown, _res: unknown, next: () => void) => next());
    mockCatalog.list.mockResolvedValue([]);
  });

  it('returns incidents with stats and filters', async () => {
    mockFetchOsQueue.mockResolvedValue({
      incidents: [
        makeIncident(),
        makeIncident({ fingerprint: 'fp-2', status: 'resolved', severity: 2, severityLabel: 'SEV2', service: 'checkout-api' }),
      ],
      reachable: true,
    });

    const res = await fetch(`${baseUrl}/api/v1/incidents?status=active&severity=SEV1&page=1&perPage=20`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].fingerprint).toBe('fp-1');
    expect(body.stats.total).toBe(1);
    expect(body.source).toBe('opensymphony');
    expect(mockNotify).toHaveBeenCalled();
    expect(mockPersist).toHaveBeenCalled();
  });

  it('returns all incidents without filters', async () => {
    mockFetchOsQueue.mockResolvedValue({
      incidents: [makeIncident(), makeIncident({ fingerprint: 'fp-2', status: 'resolved' })],
      reachable: true,
    });

    const res = await fetch(`${baseUrl}/api/v1/incidents`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(2);
    expect(body.stats.active).toBe(1);
    expect(body.stats.resolved).toBe(1);
  });

  it('degrades gracefully when OS is unreachable', async () => {
    mockFetchOsQueue.mockResolvedValue(null);

    const res = await fetch(`${baseUrl}/api/v1/incidents`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(0);
    expect(body.source).toBe('unavailable');
  });

  it('returns incident detail by fingerprint', async () => {
    mockFetchOsQueue.mockResolvedValue({
      incidents: [makeIncident({ prs: [{ repo: 'owner/repo', prUrl: 'https://github.com/owner/repo/pull/1' }] })],
      reachable: true,
    });

    const res = await fetch(`${baseUrl}/api/v1/incidents/fp-1`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.incident.fingerprint).toBe('fp-1');
    expect(body.incident.prs).toHaveLength(1);
  });

  it('returns 404 for unknown fingerprint', async () => {
    mockFetchOsQueue.mockResolvedValue({ incidents: [makeIncident()], reachable: true });

    const res = await fetch(`${baseUrl}/api/v1/incidents/nope`);
    expect(res.status).toBe(404);
  });

  it('creates a service catalog entry', async () => {
    mockCatalog.findByName.mockResolvedValue(undefined);
    mockCatalog.create.mockResolvedValue({ id: 1, name: 'payments-api', repos: ['owner/repo'], purpose: null, runbook: null, providers: [] });

    const res = await fetch(`${baseUrl}/api/v1/incidents/service-catalog`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'payments-api', repos: ['owner/repo'] }),
    });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.id).toBe(1);
    expect(mockCatalog.create).toHaveBeenCalledWith({
      name: 'payments-api',
      repos: ['owner/repo'],
      purpose: null,
      runbook: null,
      providers: [],
    });
  });

  it('rejects duplicate service names with 409', async () => {
    mockCatalog.findByName.mockResolvedValue({ id: 1, name: 'payments-api' });

    const res = await fetch(`${baseUrl}/api/v1/incidents/service-catalog`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'payments-api' }),
    });

    expect(res.status).toBe(409);
  });

  it('updates and deletes service catalog entries', async () => {
    mockCatalog.findById.mockResolvedValue({ id: 1, name: 'payments-api' });
    mockCatalog.update.mockResolvedValue({ id: 1, name: 'payments-api-v2' });

    const put = await fetch(`${baseUrl}/api/v1/incidents/service-catalog/1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'payments-api-v2' }),
    });
    expect(put.status).toBe(200);

    mockCatalog.delete.mockResolvedValue(true);
    const del = await fetch(`${baseUrl}/api/v1/incidents/service-catalog/1`, { method: 'DELETE' });
    expect(del.status).toBe(204);
    expect(mockCatalog.delete).toHaveBeenCalledWith(1);
  });
});
