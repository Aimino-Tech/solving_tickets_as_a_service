/**
 * E2E Test Harness for STAS.
 *
 * Provides a programmatic way to spin up:
 * - The real STAS Express app (with mocked dependencies)
 * - Mock GitHub API server
 * - Mock OpenCode serve endpoint
 * - Redis connection (with ioredis mock fallback)
 *
 * Usage:
 * ```ts
 * const harness = await createTestHarness();
 * await harness.start();
 *
 * // Send a webhook event
 * const res = await harness.sendWebhook('/webhook', payload, headers);
 * expect(res.status).toBe(202);
 *
 * await harness.stop();
 * ```
 */

import http from 'node:http';
import crypto from 'node:crypto';
import express, { type Express, type Request, type Response } from 'express';
import { createApp } from '../../../src/server.js';
import type { TestHarnessOptions } from './env.js';
import { setupTestEnvironment } from './env.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MockGitHubApiServer {
  server: http.Server;
  port: number;
  /** All received requests (for assertions) */
  receivedRequests: Array<{ method: string; url: string; body: unknown; headers: Record<string, string | string[] | undefined> }>;
  /** Pre-configured responses keyed by endpoint pattern */
  responses: Map<string, { status: number; body: unknown }>;
  /** URLs that this server has been asked to handle */
  baseUrl: string;
}

export interface MockOpenCodeServer {
  server: http.Server;
  port: number;
  /** All received requests */
  receivedRequests: Array<{ method: string; url: string; body: unknown }>;
  /** Default response for any incoming request */
  defaultResponse: { status: number; body: unknown };
  baseUrl: string;
}

export interface TestHarness {
  /** The STAS Express application */
  app: Express;
  /** STAS HTTP server instance */
  stasServer: http.Server;
  /** Port the STAS server is listening on */
  stasPort: number;
  /** Mock GitHub API server */
  githubApi: MockGitHubApiServer;
  /** Mock OpenCode server */
  openCode: MockOpenCodeServer;
  /** Start all servers */
  start: () => Promise<void>;
  /** Stop all servers and clean up */
  stop: () => Promise<void>;
  /** Send a webhook event to the STAS server */
  sendWebhook: (
    path: string,
    body: unknown,
    headers?: Record<string, string>,
  ) => Promise<{ status: number; body: unknown; headers: http.IncomingHttpHeaders }>;
  /** Base URL of the STAS server */
  baseUrl: string;
}

// ---------------------------------------------------------------------------
// Mock GitHub API Server
// ---------------------------------------------------------------------------

export function createMockGitHubApiServer(): MockGitHubApiServer {
  const receivedRequests: MockGitHubApiServer['receivedRequests'] = [];
  const responses = new Map<string, { status: number; body: unknown }>();

  // Default responses
  responses.set('POST /repos/*/issues/*/comments', { status: 201, body: { id: 1, html_url: 'https://github.com/mock/comment/1' } });
  responses.set('POST /repos/*/pulls', { status: 201, body: { id: 1, number: 42, html_url: 'https://github.com/owner/repo/pull/42' } });
  responses.set('PATCH /repos/*/pulls/*', { status: 200, body: {} });
  responses.set('POST /repos/*/git/refs', { status: 201, body: { ref: 'refs/heads/stas/fix-42' } });
  responses.set('GET /repos/*/git/ref/*', { status: 200, body: { object: { sha: 'abc123' } } });
  responses.set('GET /repos/*/contents/*', { status: 200, body: { content: Buffer.from('test').toString('base64') } });
  responses.set('GET /app/installations/*/access_tokens', { status: 201, body: { token: 'mock-token' } });

  const app = express();
  app.use(express.json());

  // Catch-all handler
  app.all('*', (req: Request, res: Response) => {
    receivedRequests.push({
      method: req.method,
      url: req.path,
      body: req.body,
      headers: req.headers as Record<string, string | string[] | undefined>,
    });

    // Try to find a matching response
    const methodPath = `${req.method} ${req.path}`;
    let matchedResponse = responses.get(methodPath);

    // Fallback: try wildcard matching
    if (!matchedResponse) {
      for (const [pattern, resp] of responses) {
        const [patMethod, patPath] = pattern.split(' ');
        if (patMethod !== req.method) continue;
        const patRegex = new RegExp('^' + patPath.replace(/\//g, '\\/').replace(/\*/g, '[^/]+') + '$');
        if (patRegex.test(req.path)) {
          matchedResponse = resp;
          break;
        }
      }
    }

    const defaultResp = { status: 200, body: { ok: true } };
    const { status, body } = matchedResponse ?? defaultResp;
    res.status(status).json(body);
  });

  return {
    server: http.createServer(app),
    port: 0,
    receivedRequests,
    responses,
    baseUrl: '',
  };
}

// ---------------------------------------------------------------------------
// Mock OpenCode Server
// ---------------------------------------------------------------------------

export function createMockOpenCodeServer(): MockOpenCodeServer {
  const receivedRequests: MockOpenCodeServer['receivedRequests'] = [];

  const app = express();
  app.use(express.json({ limit: '10mb' }));

  app.all('*', (req: Request, res: Response) => {
    receivedRequests.push({
      method: req.method,
      url: req.path,
      body: req.body,
    });

    res.status(200).json({
      id: 'mock-session-id',
      status: 'completed',
      result: {
        summary: 'Mock fix applied',
        confidence: 'high',
        fixReady: true,
        prUrl: 'https://github.com/owner/repo/pull/42',
        branchName: 'stas/fix-42-mock',
        diff: 'diff --git a/src/test.ts b/src/test.ts\nindex abc..def 100644\n--- a/src/test.ts\n+++ b/src/test.ts\n@@ -1,3 +1,5 @@\n+console.log("fixed");',
        testOutput: 'PASS tests/login.test.ts (42ms)\n  ✓ handles special characters\n\nTests: 1 passed, 1 total',
        errors: [],
        verification: {
          baseline: { passed: true, output: 'PASS', command: 'npm test', durationMs: 5000 },
          postFix: { passed: true, output: 'PASS', command: 'npm test', durationMs: 5200 },
          regressionTestCreated: true,
          regressionTestPassedOnOriginal: true,
          regressionTestPassedOnFix: true,
          preExistingTestsRegressed: false,
          unverified: false,
          details: ['All tests passed'],
        },
      },
    });
  });

  const server = http.createServer(app);
  return {
    server,
    port: 0,
    receivedRequests,
    defaultResponse: { status: 200, body: { status: 'completed' } },
    baseUrl: '',
  };
}

// ---------------------------------------------------------------------------
// Environment setup
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Harness creation
// ---------------------------------------------------------------------------

/**
 * Create a complete E2E test harness.
 *
 * Starts mock servers, creates the STAS app, and returns helpers for
 * sending webhook events and making assertions.
 */
export async function createTestHarness(options?: TestHarnessOptions): Promise<TestHarness> {
  // Set up environment first
  setupTestEnvironment(options);

  // Create mock servers
  const githubApi = createMockGitHubApiServer();
  const openCode = createMockOpenCodeServer();

  // Start mock servers and get their ports
  await new Promise<void>((resolve, reject) => {
    githubApi.server.listen(options?.githubApiPort ?? 0, () => {
      const addr = githubApi.server.address();
      if (addr && typeof addr === 'object') {
        githubApi.port = addr.port;
        githubApi.baseUrl = `http://localhost:${githubApi.port}`;
      }
      resolve();
    });
    githubApi.server.on('error', reject);
  });

  await new Promise<void>((resolve, reject) => {
    openCode.server.listen(options?.openCodePort ?? 0, () => {
      const addr = openCode.server.address();
      if (addr && typeof addr === 'object') {
        openCode.port = addr.port;
        openCode.baseUrl = `http://localhost:${openCode.port}`;
      }
      resolve();
    });
    openCode.server.on('error', reject);
  });

  // Override env vars with mock server ports
  process.env.GITHUB_API_URL = githubApi.baseUrl;
  process.env.OPENCODE_URL = openCode.baseUrl;

  // Create the STAS app
  const app = createApp();

  // Start the STAS server
  const stasServer = http.createServer(app);

  await new Promise<void>((resolve, reject) => {
    stasServer.listen(options?.stasPort ?? 0, () => {
      resolve();
    });
    stasServer.on('error', reject);
  });

  const stasPort = (stasServer.address() as import('net').AddressInfo).port;
  const baseUrl = `http://localhost:${stasPort}`;

  // --- Helpers ---

  async function sendWebhook(
    path: string,
    body: unknown,
    headers: Record<string, string> = {},
  ): Promise<{ status: number; body: unknown; headers: http.IncomingHttpHeaders }> {
    const bodyStr = JSON.stringify(body);

    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-GitHub-Event': 'issues.labeled',
        'X-GitHub-Delivery': `test-delivery-${Date.now()}`,
        'X-Hub-Signature-256': `sha256=${createMockSignature(bodyStr)}`,
        ...headers,
      },
      body: bodyStr,
    });

    const responseBody = await response.json().catch(() => null);
    return {
      status: response.status,
      body: responseBody,
      headers: Object.fromEntries(response.headers.entries()),
    };
  }

  return {
    app,
    stasServer,
    stasPort,
    githubApi,
    openCode,
    baseUrl,
    start: async () => {}, // already started
    stop: async () => {
      stasServer.close();
      githubApi.server.close();
      openCode.server.close();
    },
    sendWebhook,
  };
}

// ---------------------------------------------------------------------------
// Mock signature helper
// ---------------------------------------------------------------------------

function createMockSignature(payload: string): string {
  return crypto.createHmac('sha256', 'test-secret').update(payload).digest('hex');
}
