import http from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  childLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('dotenv/config', () => ({}));

vi.mock('../../utils/logger.js', () => ({
  rootLogger: { child: () => mocks.childLogger },
}));

interface MockGovernance {
  port: number;
  received: {
    path: string;
    method: string;
    headers: http.IncomingHttpHeaders;
    body: Record<string, unknown>;
  };
  close: () => Promise<void>;
}

function startMockGovernance(status: number): Promise<MockGovernance> {
  return new Promise((resolve) => {
    const received: MockGovernance['received'] = {
      path: '',
      method: '',
      headers: {},
      body: {},
    };

    const server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => {
        raw += chunk;
      });
      req.on('end', () => {
        received.path = req.url ?? '';
        received.method = req.method ?? '';
        received.headers = req.headers;
        received.body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
        res.writeHead(status, { 'Content-Type': 'application/json' });
        const body =
          status === 200
            ? { status: 'ok', run_id: 'run-123', trace_id: received.body.trace_id }
            : { error: { message: 'blocked', type: 'kill_switch' } };
        res.end(JSON.stringify(body));
      });
    });

    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      resolve({
        port,
        received,
        close: () =>
          new Promise((r) => {
            server.close(() => r());
          }),
      });
    });
  });
}

async function loadModules() {
  vi.resetModules();
  const client = await import('../../governance/client.js');
  const configModule = await import('../../config.js');
  return { client, configModule };
}

const PAYLOAD = {
  installationId: 123,
  repoOwner: 'acme',
  repoName: 'repo',
  issueNumber: 42,
  issueTitle: 'Fix login',
  issueBody: 'Body text',
  labels: ['bug'],
};

describe('governance/client', () => {
  beforeEach(() => {
    vi.stubEnv('GITHUB_APP_ID', 'test-app-id');
    vi.stubEnv('GITHUB_WEBHOOK_SECRET', 'test-webhook-secret');
    vi.stubEnv('GITHUB_APP_PRIVATE_KEY', 'test-private-key');
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('OPENCODE_API_KEY', 'test-opencode-key');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('POSTs dispatch to GOVERNANCE_URL with x-trace-id header when enabled', async () => {
    const mock = await startMockGovernance(200);
    try {
      vi.stubEnv('GOVERNANCE_ENABLED', 'true');
      vi.stubEnv('GOVERNANCE_URL', `http://127.0.0.1:${mock.port}`);
      const { client } = await loadModules();
      const traceId = 'trace-4451-abc';

      const result = await client.dispatchThroughGovernance({ ...PAYLOAD, traceId });

      expect(result.success).toBe(true);
      expect(mock.received.method).toBe('POST');
      expect(mock.received.path).toBe('/api/stas/webhook');
      expect(mock.received.headers['x-trace-id']).toBe(traceId);
      expect(mock.received.body.trace_id).toBe(traceId);
      expect(mock.received.body.repo).toBe('acme/repo');
      expect(mock.received.body.source).toBe('stas');
    } finally {
      await mock.close();
    }
  });

  it('includes trace_id in structured log lines from the dispatch path', async () => {
    const mock = await startMockGovernance(200);
    try {
      vi.stubEnv('GOVERNANCE_ENABLED', 'true');
      vi.stubEnv('GOVERNANCE_URL', `http://127.0.0.1:${mock.port}`);
      const { client } = await loadModules();
      const traceId = 'trace-log-4451';

      await client.dispatchThroughGovernance({ ...PAYLOAD, traceId });

      const infoCalls = mocks.childLogger.info.mock.calls as Array<[Record<string, unknown>, string]>;
      const dispatchLine = infoCalls.find(([, msg]) => msg === 'Dispatching through governance proxy');
      expect(dispatchLine).toBeDefined();
      expect(dispatchLine?.[0].traceId).toBe(traceId);

      const successLine = infoCalls.find(([, msg]) => msg === 'Governance proxy dispatch succeeded');
      expect(successLine?.[0].traceId).toBe(traceId);
    } finally {
      await mock.close();
    }
  });

  it('aborts dispatch (no agent run) when governance responds 402 kill-switch', async () => {
    const mock = await startMockGovernance(402);
    try {
      vi.stubEnv('GOVERNANCE_ENABLED', 'true');
      vi.stubEnv('GOVERNANCE_URL', `http://127.0.0.1:${mock.port}`);
      const { client } = await loadModules();
      const traceId = 'trace-kill-402';

      const result = await client.dispatchThroughGovernance({ ...PAYLOAD, traceId });

      expect(result.success).toBe(false);
      expect(result.status).toBe(402);
      expect(result.error).toContain('Tenant killed');
    } finally {
      await mock.close();
    }
  });

  it('aborts dispatch (no agent run) when governance responds 503 kill-switch', async () => {
    const mock = await startMockGovernance(503);
    try {
      vi.stubEnv('GOVERNANCE_ENABLED', 'true');
      vi.stubEnv('GOVERNANCE_URL', `http://127.0.0.1:${mock.port}`);
      const { client } = await loadModules();
      const traceId = 'trace-kill-503';

      const result = await client.dispatchThroughGovernance({ ...PAYLOAD, traceId });

      expect(result.success).toBe(false);
      expect(result.status).toBe(503);
      expect(result.error).toContain('Tenant killed');
    } finally {
      await mock.close();
    }
  });

  it('makes no governance request when GOVERNANCE_ENABLED=false', async () => {
    const mock = await startMockGovernance(200);
    try {
      vi.stubEnv('GOVERNANCE_ENABLED', 'false');
      vi.stubEnv('GOVERNANCE_URL', `http://127.0.0.1:${mock.port}`);
      const { client } = await loadModules();

      const result = await client.dispatchThroughGovernance({ ...PAYLOAD, traceId: 'trace-disabled' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not configured');
      expect(mock.received.path).toBe('');
    } finally {
      await mock.close();
    }
  });

  describe('config defaults', () => {
    it('defaults GOVERNANCE_ENABLED to false and GOVERNANCE_URL to the compose value', async () => {
      const { configModule } = await loadModules();
      expect(configModule.config.governance.enabled).toBe(false);
      expect(configModule.config.governance.url).toBe('http://llm-governance:4002');
      expect(configModule.config.governance.timeoutMs).toBe(10_000);
    });

    it('parses GOVERNANCE_ENABLED=true and custom GOVERNANCE_URL', async () => {
      vi.stubEnv('GOVERNANCE_ENABLED', 'true');
      vi.stubEnv('GOVERNANCE_URL', 'http://127.0.0.1:9999');
      const { configModule } = await loadModules();
      expect(configModule.config.governance.enabled).toBe(true);
      expect(configModule.config.governance.url).toBe('http://127.0.0.1:9999');
    });
  });
});
