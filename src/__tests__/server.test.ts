/**
 * Unit tests for src/server.ts — Express API server.
 *
 * Tests createApp() and startServer().
 *
 * Strategy:
 *   We mock all external modules (config, queue, webhooks, trackers,
 *   stripe, logger) so the Express app can be created without real
 *   Redis, E2B, or Slack connections.
 *
 *   We then test:
 *   - GET /health returns 200 with status ok
 *   - POST /webhook returns 202 for valid payloads
 *   - POST /webhook returns 400 for invalid payloads
 *   - POST /webhook returns 401 for bad signatures
 *   - POST /webhook/stripe delegates to stripe handler
 *   - 404 handler for unknown routes
 *   - Request ID middleware
 *   - Access log middleware
 *   - Global error handler
 *   - startServer()
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockLoggerChild } = vi.hoisted(() => {
  const logger = {
    level: 'silent',
    child: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    silent: vi.fn(),
  };
  logger.child = vi.fn(() => logger);
  return { mockLoggerChild: logger };
});

const mockEnqueueIssue = vi.hoisted(() => vi.fn().mockResolvedValue('job-mock-id'));
const mockVerifyAndReceive = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockCreateGithubWebhooks = vi.hoisted(() =>
  vi.fn().mockReturnValue({
    verifyAndReceive: mockVerifyAndReceive,
    on: vi.fn(),
    receive: vi.fn(),
  }),
);
const mockCreateGitlabWebhooks = vi.hoisted(() => vi.fn().mockReturnValue({ handle: vi.fn() }));
const mockCreateBitbucketWebhooks = vi.hoisted(() => vi.fn().mockReturnValue({ handle: vi.fn() }));
const mockValidateWebhookPayload = vi.hoisted(
  () => vi.fn().mockReturnValue({ success: true, data: {} }),
);
const mockStripeHandler = vi.hoisted(() => vi.fn());
const mockCreateStripeWebhookHandler = vi.hoisted(() => vi.fn().mockReturnValue(mockStripeHandler));
const mockGetSlackBoltApp = vi.hoisted(() =>
  vi.fn().mockReturnValue({
    mountOn: vi.fn(),
    client: { conversations: { open: vi.fn(), invite: vi.fn() } },
  }),
);
const mockGetTracker = vi.hoisted(() => vi.fn().mockReturnValue(null));
const mockInitTrackers = vi.hoisted(() => vi.fn());
const mockInitMetering = vi.hoisted(() => vi.fn());

// ---------------------------------------------------------------------------
// Module-level mocks (paths relative to test file location)
// ---------------------------------------------------------------------------

vi.mock('../config.js', () => ({
  config: {
    port: 0,
    nodeEnv: 'test',
    logLevel: 'silent',
    runMode: 'api',
    github: {
      appId: 'test-app',
      webhookSecret: 'test-secret',
      webhookPath: '/webhook',
      privateKeyPath: undefined,
      privateKeyEnv: '-----BEGIN PRIVATE KEY-----\nMOCK\n-----END PRIVATE KEY-----',
    },
    gitlab: { url: 'https://gitlab.com', token: '', webhookSecret: '' },
    bitbucket: { username: '', appPassword: '', webhookSecret: '' },
    stas: {
      label: 'stas:fix',
      botName: 'STAS',
      devSkipWebhookVerify: false,
      rateLimit: { windowMs: 60000, max: 30 },

      maxIssueComments: 15,
    },
    rabbitmq: {
      url: 'amqp://localhost:5672/stas',
      prefetchCount: 10,
      reconnectDelayMs: 5000,
      maxReconnectAttempts: 10,
      tls: {
        certPath: undefined,
        keyPath: undefined,
        caPath: undefined,
        servername: undefined,
        rejectUnauthorized: true,
      },
    },
    queue: {
      redisUrl: 'redis://localhost:6379',
      workerConcurrency: 2,
      backend: 'rabbitmq',
      dedupTtl: 120,
      keepCompleted: 200,
      keepFailed: 100,
      maxRetries: 4,
      retryDelays: [30000, 120000, 300000, 900000],
    },
    phaseTimeouts: {
      triage: 30000,
      sandboxBoot: 300000,
      openCodeAgent: 600000,
      prCreation: 30000,
    },
    opencode: {
      url: 'http://localhost:4096',
      model: 'test-model',
      fallbackModels: ['gpt-4o'],
    },
    opencodeHealth: {
      pollIntervalMs: 15000,
      cacheTtlMs: 30000,
      circuitBreakerThreshold: 3,
      requestTimeoutMs: 5000,
      startupTimeoutMs: 30000,
    },
    e2b: { apiKey: 'test', templateId: 'test', sandboxTimeoutMs: 300000 },
    docker: {
      image: 'ubuntu:24.04',
      sandboxTimeoutMs: 300000,
      networkRestrict: true,
      allowedHosts: ['api.github.com'],
      containerMemory: '4g',
      containerCpu: 2,
    },
    openai: { apiKey: undefined, cheapModel: 'gpt-4o-mini' },
    slack: {
      webhookUrl: undefined,
      channel: undefined,
      botToken: undefined,
      signingSecret: undefined,
      interactionsPath: '/slack/events',
    },
    trackers: {
      linear: undefined,
      jira: undefined,
      defaultRepoOwner: undefined,
      defaultRepoName: undefined,
      installationId: 0,
    },
    security: {
      corsOrigin: '*',
      requestBodyLimit: '1mb',
      webhookBodyLimit: '5mb',
      cspReportUri: '/api/v1/csp-violation-report',
      ipAllowlist: { enabled: false, ips: [] },
      sandbox: {
        privileged: false,
        readOnlyRoot: true,
        memoryLimit: '512m',
        cpuLimit: '0.5',
        pidsLimit: 256,
        diskLimit: '2gb',
        networkEnabled: false,
      },
    },
    sentry: { dsn: undefined, environment: 'test', tracesSampleRate: 0.1 },
    stripe: { secretKey: undefined, webhookSecret: undefined },
    database: { url: 'postgres://localhost:5432/stas', poolMin: 2, poolMax: 10, ssl: false },
    fixTimeoutMs: 600000,
    featureFlags: { defaultTtlSeconds: 30, autoDisableThreshold: 0.05 },
    webhookRetry: { pollIntervalMs: 15000, batchSize: 10 },
    metering: { freeMonthlyCredits: 100 },
    usageCredits: { fixRun: 50, triage: 10, sandbox: 5 },
  },
}));

vi.mock('../utils/logger.js', () => ({
  rootLogger: mockLoggerChild,
}));

vi.mock('../queue/issueQueue.js', () => ({
  enqueueIssue: mockEnqueueIssue,
}));

vi.mock('../webhooks/github.js', () => ({
  createGithubWebhooks: mockCreateGithubWebhooks,
}));

vi.mock('../webhooks/gitlab.js', () => ({
  createGitlabWebhooks: mockCreateGitlabWebhooks,
}));

vi.mock('../webhooks/bitbucket.js', () => ({
  createBitbucketWebhooks: mockCreateBitbucketWebhooks,
}));

vi.mock('../validation.js', () => ({
  validateWebhookPayload: mockValidateWebhookPayload,
}));

vi.mock('../stripe/index.js', () => ({
  createStripeWebhookHandler: mockCreateStripeWebhookHandler,
}));

vi.mock('../notifications/slack-bolt.js', () => ({
  getSlackBoltApp: vi.fn().mockReturnValue({
    mountOn: vi.fn(),
    client: { conversations: { open: vi.fn(), invite: vi.fn() } },
  }),
}));

vi.mock('../trackers/index.js', () => ({
  getTracker: mockGetTracker,
  initTrackers: mockInitTrackers,
}));

vi.mock('../metering/index.js', () => ({
  initMetering: mockInitMetering,
  usageRouter: vi.fn(),
}));

vi.mock('../routes/featureFlags.js', () => ({
  featureFlagsRouter: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('server', () => {
  let app: import('express').Application;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createApp()', () => {
    it('creates an Express application with expected middleware', async () => {
      const { createApp } = await import('../server.js');
      app = createApp();
      expect(app).toBeDefined();
      expect(typeof app.use).toBe('function');
      expect(typeof app.get).toBe('function');
      expect(typeof app.post).toBe('function');
    });

    it('returns an app that can listen on a port', async () => {
      const { createApp } = await import('../server.js');
      app = createApp();
      expect(typeof app.listen).toBe('function');
    });
  });

  describe('GET /health', () => {
    it('returns 200 with status ok', async () => {
      const { createApp } = await import('../server.js');
      app = createApp();

      const response = await fetchApp(app, '/health');
      expect(response.status).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBe('ok');
    });

    it('returns JSON with uptime and timestamp fields', async () => {
      const { createApp } = await import('../server.js');
      app = createApp();

      const response = await fetchApp(app, '/health');
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('uptime');
      expect(body).toHaveProperty('timestamp');
      expect(typeof body.uptime).toBe('number');
      expect(typeof body.timestamp).toBe('string');
    });

    it('includes the STAS label in health response', async () => {
      const { createApp } = await import('../server.js');
      app = createApp();

      const response = await fetchApp(app, '/health');
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('label');
    });
  });

  describe('POST /webhook', () => {
    it('returns 202 for a valid webhook payload', async () => {
      const { createApp } = await import('../server.js');
      app = createApp();

      const response = await fetchApp(app, '/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-github-event': 'issues.labeled',
          'x-github-delivery': 'test-delivery-id',
          'x-hub-signature-256': 'sha256=test',
        },
        body: JSON.stringify({
          action: 'labeled',
          issue: { number: 42, title: 'Fix bug', body: 'Details' },
          repository: { name: 'repo', owner: { login: 'owner' } },
          installation: { id: 555 },
          label: { name: 'stas:fix' },
        }),
      });

      expect(response.status).toBe(202);
      const body = JSON.parse(response.body);
      expect(body.accepted).toBe(true);
    });

    it('returns 400 when payload validation fails', async () => {
      mockValidateWebhookPayload.mockReturnValueOnce({
        success: false,
        errors: ['Missing required field: installation'],
      });

      const { createApp } = await import('../server.js');
      app = createApp();

      const response = await fetchApp(app, '/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-github-event': 'issues.labeled',
          'x-github-delivery': 'test-id',
        },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Invalid payload');
      expect(body.details).toBeDefined();
    });

    it('returns 400 when JSON is malformed', async () => {
      const { createApp } = await import('../server.js');
      app = createApp();

      const response = await fetchApp(app, '/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-github-event': 'issues.labeled',
          'x-github-delivery': 'test-id',
        },
        body: 'not-json',
      });

      expect(response.status).toBe(400);
    });

    it('returns 401 when signature verification fails', async () => {
      mockValidateWebhookPayload.mockReturnValueOnce({ success: true, data: {} });
      mockVerifyAndReceive.mockRejectedValueOnce(new Error('Invalid signature'));

      const { createApp } = await import('../server.js');
      app = createApp();

      const response = await fetchApp(app, '/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-github-event': 'issues.labeled',
          'x-github-delivery': 'test-id',
          'x-hub-signature-256': 'sha256=badsig',
        },
        body: JSON.stringify({ action: 'labeled' }),
      });

      expect(response.status).toBe(401);
    });

    it('handles requests without x-github-delivery header', async () => {
      const { createApp } = await import('../server.js');
      app = createApp();

      const response = await fetchApp(app, '/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-github-event': 'issues.labeled',
        },
        body: JSON.stringify({
          action: 'labeled',
          issue: { number: 1, title: 't', body: 'b' },
          repository: { name: 'r', owner: { login: 'o' } },
          installation: { id: 1 },
          label: { name: 'stas:fix' },
        }),
      });

      expect(response.status).toBe(202);
    });
  });

  describe('POST /webhook/github', () => {
    it('handles webhook at /webhook/github path', async () => {
      const { createApp } = await import('../server.js');
      app = createApp();

      const response = await fetchApp(app, '/webhook/github', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-github-event': 'issues.labeled',
          'x-github-delivery': 'test-delivery',
        },
        body: JSON.stringify({
          action: 'labeled',
          issue: { number: 1, title: 't', body: 'b' },
          repository: { name: 'r', owner: { login: 'o' } },
          installation: { id: 1 },
          label: { name: 'stas:fix' },
        }),
      });

      expect(response.status).toBe(202);
    });
  });

  describe('POST /webhook/gitlab', () => {
    it('returns 202 for GitLab webhook with valid payload', async () => {
      const { createApp } = await import('../server.js');
      app = createApp();

      const response = await fetchApp(app, '/webhook/gitlab', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-gitlab-event': 'Push Hook',
        },
        body: JSON.stringify({ object_kind: 'push' }),
      });

      expect(response.status).toBe(202);
    });

    it('returns 400 for GitLab webhook with malformed JSON', async () => {
      const { createApp } = await import('../server.js');
      app = createApp();

      const response = await fetchApp(app, '/webhook/gitlab', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-gitlab-event': 'Push Hook',
        },
        body: 'not-json',
      });

      expect(response.status).toBe(400);
    });

    it('returns 400 when raw body is missing', async () => {
      const { createApp } = await import('../server.js');
      app = createApp();

      const response = await fetchApp(app, '/webhook/gitlab', {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
          'x-gitlab-event': 'Push Hook',
        },
        body: '',
      });

      expect(response.status).toBe(400);
    });
  });

  describe('POST /webhook/bitbucket', () => {
    it('returns 202 for Bitbucket webhook', async () => {
      const { createApp } = await import('../server.js');
      app = createApp();

      const response = await fetchApp(app, '/webhook/bitbucket', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-hub-signature': 'sha1=test',
        },
        body: JSON.stringify({ push: { changes: [] } }),
      });

      expect(response.status).toBe(202);
    });

    it('returns 400 when raw body is missing', async () => {
      const { createApp } = await import('../server.js');
      app = createApp();

      const response = await fetchApp(app, '/webhook/bitbucket', {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
          'x-hub-signature': 'sha1=test',
        },
        body: '',
      });

      expect(response.status).toBe(400);
    });
  });

  describe('POST /webhook/stripe', () => {
    it('routes to stripe webhook handler', async () => {
      const { createApp } = await import('../server.js');
      app = createApp();

      await fetchApp(app, '/webhook/stripe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'stripe-signature': 'test_sig',
        },
        body: JSON.stringify({ type: 'checkout.session.completed' }),
      });

      expect(mockCreateStripeWebhookHandler).toHaveBeenCalled();
    });
  });

  describe('404 handler', () => {
    it('returns 404 for unknown routes', async () => {
      const { createApp } = await import('../server.js');
      app = createApp();

      const response = await fetchApp(app, '/unknown-route');
      expect(response.status).toBe(404);
    });

    it('returns 404 for POST to unknown path', async () => {
      const { createApp } = await import('../server.js');
      app = createApp();

      const response = await fetchApp(app, '/api/unknown', { method: 'POST' });
      expect(response.status).toBe(404);
    });
  });

  describe('Request ID middleware', () => {
    it('adds x-request-id header to responses', async () => {
      const { createApp } = await import('../server.js');
      app = createApp();

      const response = await fetchApp(app, '/health');
      expect(response.headers['x-request-id']).toBeDefined();
    });

    it('propagates incoming x-request-id header', async () => {
      const { createApp } = await import('../server.js');
      app = createApp();

      const response = await fetchApp(app, '/health', {
        headers: { 'x-request-id': 'client-provided-id' },
      });
      expect(response.headers['x-request-id']).toBe('client-provided-id');
    });
  });

  describe('startServer()', () => {
    it('starts the server and returns a Server instance', async () => {
      const { startServer } = await import('../server.js');
      const server = startServer();

      expect(server).toBeDefined();
      expect(server.listening).toBe(true);

      await new Promise<void>((resolve) => server.close(() => resolve()));
    });
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface FetchResponse {
  status: number;
  body: string;
  headers: Record<string, string>;
}

/**
 * Make an HTTP request to an Express app without needing a real port.
 */
function fetchApp(
  app: import('express').Application,
  path: string,
  options?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
): Promise<FetchResponse> {
  return new Promise((resolve, reject) => {
    const method = options?.method ?? 'GET';
    const headers = options?.headers ?? {};
    const body = options?.body;

    const chunks: Buffer[] = [];

    // Create a minimal Request-like object
    const req = {
      method,
      url: path,
      headers,
      rawBody: body ? Buffer.from(body) : undefined,
      socket: { setTimeout: () => {} },
      on: () => {},
      push: () => {},
    } as any;

    if (body) {
      req.push(body);
    }
    req.push(null);

    // Create a minimal Response-like object
    const res = {
      statusCode: 200,
      _headers: {} as Record<string, string>,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(obj: any) {
        const str = JSON.stringify(obj);
        chunks.push(Buffer.from(str));
        this._headers['content-type'] = 'application/json';
        this.end();
        return this;
      },
      setHeader(name: string, value: string) {
        this._headers[name] = value;
        return this;
      },
      getHeader(name: string) {
        return this._headers[name];
      },
      getHeaderNames() {
        return Object.keys(this._headers);
      },
      getHeaders() {
        return { ...this._headers };
      },
      end(chunk?: any) {
        if (chunk) chunks.push(Buffer.from(chunk));
        resolve({
          status: this.statusCode,
          body: Buffer.concat(chunks).toString('utf-8'),
          headers: { ...this._headers },
        });
      },
      write(chunk: any) {
        if (chunk) chunks.push(Buffer.from(chunk));
        return true;
      },
      writeHead(statusCode: number) {
        this.statusCode = statusCode;
        return this;
      },
      on: () => {},
    } as any;

    app(req, res, (err?: any) => {
      if (err) reject(err);
    });
  });
}
