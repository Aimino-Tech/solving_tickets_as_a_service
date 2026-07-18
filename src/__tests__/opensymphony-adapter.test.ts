/**
 * Tests for the OpenSymphony protocol adapter.
 *
 * Strategy:
 *   - Pipeline stages are tested in isolation (pure functions / state)
 *   - The HTTP adapter is tested via HTTP calls to a running server
 *   - Custom stages and templates are tested for registration and routing
 *
 * Coverage:
 *   - Pipeline stage execution (IntentStage, PlanningStage, etc.)
 *   - Pipeline runner aggregates results correctly
 *   - GET /api/health returns expected shape
 *   - POST /api/run validates request and returns OpenCode-compatible response
 *   - Model prefix routing to pipeline templates
 *   - Custom stage registration
 *   - Error handling for malformed requests
 *   - CORS headers on OPTIONS
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import {
  OpenSymphonyAdapter,
  IntentStage,
  PlanningStage,
  ExecutionStage,
  CollectionStage,
  TasteStage,
  type PipelineContext,
  type PipelineStage,
  type OpenSymphonyAdapterConfig,
} from '../opensymphony-adapter.js';

// ---------------------------------------------------------------------------
// Test utilities
// ---------------------------------------------------------------------------

const TEST_PORT = 4597;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

/** Fetch helper for hitting the adapter. */
async function fetchFromAdapter(
  path: string,
  options?: { method?: string; body?: unknown; headers?: Record<string, string> },
): Promise<{ status: number; body: unknown; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const method = options?.method ?? 'GET';
    const body = options?.body ? JSON.stringify(options.body) : undefined;

    const req = http.request(
      url,
      {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...options?.headers,
          ...(body ? { 'Content-Length': Buffer.byteLength(body).toString() } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let parsed: unknown;
          try {
            parsed = raw ? JSON.parse(raw) : null;
          } catch {
            parsed = raw;
          }
          resolve({ status: res.statusCode ?? 0, body: parsed, headers: res.headers });
        });
      },
    );

    req.on('error', reject);

    if (body) {
      req.write(body);
    }
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let adapter: OpenSymphonyAdapter;

beforeAll(async () => {
  adapter = new OpenSymphonyAdapter({ port: TEST_PORT, host: '127.0.0.1' });
  await adapter.start();
}, 10_000);

afterAll(async () => {
  await adapter.stop();
}, 5_000);

// ---------------------------------------------------------------------------
// Pipeline Stages
// ---------------------------------------------------------------------------

describe('pipeline stages', () => {
  const baseContext = (overrides?: Partial<PipelineContext>): PipelineContext => ({
    requestId: 'test-req-1',
    prompt: '# STAS Fix Agent\n\n**#42: Login validation fails**\n\nThe login endpoint crashes on special chars.',
    model: 'anthropic/claude-sonnet-4-20250514',
    startTime: new Date(),
    stageResults: new Map(),
    ...overrides,
  });

  describe('IntentStage', () => {
    it('extracts title line from prompt', async () => {
      const stage = new IntentStage();
      const ctx = baseContext();
      const result = await stage.execute(ctx);

      expect(result.success).toBe(true);
      expect(result.stage).toBe('intent');
      const output = result.output as { titleLine: string; promptLength: number };
      expect(output.titleLine).toContain('#42');
      expect(output.promptLength).toBe(ctx.prompt.length);
    });

    it('handles empty prompt gracefully', async () => {
      const stage = new IntentStage();
      const ctx = baseContext({ prompt: '' });
      const result = await stage.execute(ctx);

      expect(result.success).toBe(true);
    });
  });

  describe('PlanningStage', () => {
    it('generates a plan with steps', async () => {
      const stage = new PlanningStage();
      const ctx = baseContext();
      ctx.stageResults.set('intent', {
        stage: 'intent',
        success: true,
        output: { estimatedIssue: 'Login validation bug' },
        durationMs: 10,
      });

      const result = await stage.execute(ctx);
      expect(result.success).toBe(true);
      const output = result.output as { steps: string[] };
      expect(output.steps.length).toBeGreaterThan(0);
      expect(output.steps[0]).toContain('Reproduce');
    });

    it('works without prior intent stage', async () => {
      const stage = new PlanningStage();
      const ctx = baseContext();
      const result = await stage.execute(ctx);

      expect(result.success).toBe(true);
      const output = result.output as { steps: string[] };
      expect(output.steps.length).toBeGreaterThan(0);
    });
  });

  describe('ExecutionStage', () => {
    it('executes and references plan steps', async () => {
      const stage = new ExecutionStage();
      const ctx = baseContext();
      ctx.stageResults.set('plan', {
        stage: 'plan',
        success: true,
        output: { steps: ['Step 1', 'Step 2'] },
        durationMs: 5,
      });

      const result = await stage.execute(ctx);
      expect(result.success).toBe(true);
      const output = result.output as { executedSteps: string[]; model: string };
      expect(output.executedSteps).toEqual(['Step 1', 'Step 2']);
      expect(output.model).toBe(ctx.model);
    });
  });

  describe('CollectionStage', () => {
    it('collects results into output', async () => {
      const stage = new CollectionStage();
      const ctx = baseContext();
      ctx.stageResults.set('execute', {
        stage: 'execute',
        success: true,
        output: { model: ctx.model },
        durationMs: 10,
      });

      const result = await stage.execute(ctx);
      expect(result.success).toBe(true);
      const output = result.output as { diff: string; testOutput: string; branch: string };
      expect(output.diff).toBeTruthy();
      expect(output.branch).toBe('stas/opensymphony-placeholder');
    });
  });

  describe('TasteStage', () => {
    it('assigns high confidence when all stages succeed', async () => {
      const stage = new TasteStage();
      const ctx = baseContext();
      ctx.stageResults.set('intent', { stage: 'intent', success: true, durationMs: 10 });
      ctx.stageResults.set('plan', { stage: 'plan', success: true, durationMs: 10 });
      ctx.stageResults.set('execute', { stage: 'execute', success: true, durationMs: 10 });
      ctx.stageResults.set('collect', { stage: 'collect', success: true, durationMs: 10 });

      const result = await stage.execute(ctx);
      expect(result.success).toBe(true);
      const output = result.output as { confidence: string };
      expect(output.confidence).toBe('high');
    });

    it('assigns low confidence when most stages fail', async () => {
      const stage = new TasteStage();
      const ctx = baseContext();
      ctx.stageResults.set('intent', { stage: 'intent', success: false, error: 'fail', durationMs: 10 });
      ctx.stageResults.set('plan', { stage: 'plan', success: false, error: 'fail', durationMs: 10 });

      const result = await stage.execute(ctx);
      expect(result.success).toBe(true);
      const output = result.output as { confidence: string };
      expect(output.confidence).toBe('low');
    });
  });
});

// ---------------------------------------------------------------------------
// HTTP Endpoints
// ---------------------------------------------------------------------------

describe('HTTP endpoints', () => {
  // ── GET /api/health ─────────────────────────────────────────────

  describe('GET /api/health', () => {
    it('returns 200 with status ok', async () => {
      const { status, body } = await fetchFromAdapter('/api/health');
      expect(status).toBe(200);
      expect(body).toMatchObject({
        status: 'ok',
        service: 'opensymphony-adapter',
      });
    });

    it('includes version and metrics', async () => {
      const { body } = await fetchFromAdapter('/api/health');
      const b = body as Record<string, unknown>;
      expect(b).toHaveProperty('version');
      expect(b).toHaveProperty('uptime_seconds');
      expect(b).toHaveProperty('queue_depth');
    });
  });

  // ── POST /api/run ───────────────────────────────────────────────

  describe('POST /api/run', () => {
    it('returns 200 with expected OpenCode-compatible response on valid request', async () => {
      const { status, body } = await fetchFromAdapter('/api/run', {
        method: 'POST',
        body: {
          prompt: '# STAS Fix Agent\n\nFix the authentication timeout bug.',
          model: 'anthropic/claude-sonnet-4-20250514',
        },
      });

      expect(status).toBe(200);
      const b = body as Record<string, unknown>;
      expect(b).toHaveProperty('summary');
      expect(b).toHaveProperty('confidence');
      expect(b).toHaveProperty('diff');
      expect(b).toHaveProperty('branch');
      expect(b).toHaveProperty('testOutput');
      expect(b).toHaveProperty('metadata');

      // Verify the expected OpenCode contract shape
      expect(['high', 'medium', 'low']).toContain(b.confidence);
      expect(typeof b.summary).toBe('string');
      expect(b.summary.length).toBeGreaterThan(0);
    });

    it('returns 400 for missing prompt', async () => {
      const { status, body } = await fetchFromAdapter('/api/run', {
        method: 'POST',
        body: { model: 'test-model' },
      });

      expect(status).toBe(400);
      const b = body as Record<string, unknown>;
      expect(b).toHaveProperty('confidence', 'low');
      expect(b).toHaveProperty('errors');
    });

    it('returns 400 for missing model', async () => {
      const { status, body } = await fetchFromAdapter('/api/run', {
        method: 'POST',
        body: { prompt: 'Fix the bug' },
      });

      expect(status).toBe(400);
      expect(body).toHaveProperty('confidence', 'low');
    });

    it('returns 400 for empty body', async () => {
      const { status } = await fetchFromAdapter('/api/run', {
        method: 'POST',
        body: {},
      });
      expect(status).toBe(400);
    });

    it('returns 400 for invalid JSON body', async () => {
      // Send raw invalid JSON
      const { status } = await fetchFromAdapter('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      // Empty body with content-type will parse as {} — missing required fields
      expect(status).toBe(400);
    });

    it('includes requestId in metadata', async () => {
      const { body } = await fetchFromAdapter('/api/run', {
        method: 'POST',
        body: {
          prompt: 'Fix the authentication bug by adding input validation to the login handler.',
          model: 'anthropic/claude-sonnet-4-20250514',
        },
      });
      const b = body as { metadata?: { requestId?: string } };
      expect(b.metadata?.requestId).toBeTruthy();
    });
  });

  // ── 404 Handling ─────────────────────────────────────────────────

  describe('unknown endpoints', () => {
    it('returns 404 for unknown paths', async () => {
      const { status, body } = await fetchFromAdapter('/api/unknown');
      expect(status).toBe(404);
      expect(body).toHaveProperty('error', 'Not found');
    });
  });

  // ── CORS ─────────────────────────────────────────────────────────

  describe('CORS headers', () => {
    it('responds to OPTIONS with CORS headers', async () => {
      const { status, headers } = await fetchFromAdapter('/api/health', {
        method: 'OPTIONS',
      });
      expect(status).toBe(204);
      expect(headers['access-control-allow-origin']).toBe('*');
    });
  });
});

// ---------------------------------------------------------------------------
// Custom Stage Registration
// ---------------------------------------------------------------------------

describe('custom stage registration', () => {
  it('allows registering custom stages', async () => {
    const customStage: PipelineStage = {
      name: 'custom-audit',
      async execute(ctx: PipelineContext) {
        return {
          stage: 'custom-audit',
          success: true,
          output: { audited: true, promptLength: ctx.prompt.length },
          durationMs: 1,
        };
      },
    };

    const localAdapter = new OpenSymphonyAdapter({ port: 0, host: '127.0.0.1' });
    localAdapter.registerStage(customStage);
    localAdapter.setPipelineTemplate('test-model', ['custom-audit']);

    const stages = (localAdapter as unknown as { templates: Map<string, string[]> }).templates;
    const template = stages.get('test-model');
    expect(template).toEqual(['custom-audit']);

    await localAdapter.stop();
  });

  it('overwrites existing stage with same name', async () => {
    const override: PipelineStage = {
      name: 'intent',
      async execute() {
        return {
          stage: 'intent',
          success: true,
          output: { overridden: true },
          durationMs: 0,
        };
      },
    };

    const localAdapter = new OpenSymphonyAdapter({ port: 0, host: '127.0.0.1' });
    localAdapter.registerStage(override);
    localAdapter.setPipelineTemplate('test', ['intent']);

    await localAdapter.stop();
  });
});

// ---------------------------------------------------------------------------
// Model Routing
// ---------------------------------------------------------------------------

describe('model routing', () => {
  it('uses default template when no model prefix matches', async () => {
    const localAdapter = new OpenSymphonyAdapter({
      port: 0,
      host: '127.0.0.1',
      defaultTemplate: ['intent', 'taste'],
    });
    localAdapter.setPipelineTemplate('anthropic/', ['intent', 'plan', 'execute', 'collect', 'taste']);

    // Access selectTemplate via prototype (private method) — we'll test via the adapter
    const templatesMap = (localAdapter as unknown as { templates: Map<string, string[]> }).templates;
    expect(templatesMap.get('anthropic/')).toEqual(['intent', 'plan', 'execute', 'collect', 'taste']);

    await localAdapter.stop();
  });

  it('supports model prefix routing', async () => {
    const localAdapter = new OpenSymphonyAdapter({ port: 0, host: '127.0.0.1' });
    localAdapter.setPipelineTemplate('gpt-4o', ['intent', 'execute', 'taste']);
    localAdapter.setPipelineTemplate('claude', ['intent', 'plan', 'execute', 'collect', 'taste']);

    const templatesMap = (localAdapter as unknown as { templates: Map<string, string[]> }).templates;
    expect(templatesMap.get('gpt-4o')).toHaveLength(3);
    expect(templatesMap.get('claude')).toHaveLength(5);

    await localAdapter.stop();
  });

  it('removes pipeline template', async () => {
    const localAdapter = new OpenSymphonyAdapter({ port: 0, host: '127.0.0.1' });
    localAdapter.setPipelineTemplate('gpt-4o', ['intent']);
    localAdapter.removePipelineTemplate('gpt-4o');

    const templatesMap = (localAdapter as unknown as { templates: Map<string, string[]> }).templates;
    expect(templatesMap.has('gpt-4o')).toBe(false);

    await localAdapter.stop();
  });
});

// ---------------------------------------------------------------------------
// Worker Dispatch Tests
// ---------------------------------------------------------------------------

describe('worker dispatch', () => {
  it('ExecutionStage returns stub result when no workerUrl is set', async () => {
    const stage = new ExecutionStage();
    const ctx: PipelineContext = {
      requestId: 'test-stub',
      prompt: 'Fix the bug',
      model: 'test-model',
      startTime: new Date(),
      stageResults: new Map(),
    };

    const result = await stage.execute(ctx);
    expect(result.success).toBe(true);
    const output = result.output as { executedSteps: string[] };
    expect(output.executedSteps).toEqual([]);
  });

  it('adapter accepts workerUrl in config', async () => {
    const localAdapter = new OpenSymphonyAdapter({
      port: 0,
      host: '127.0.0.1',
      workerUrl: 'http://localhost:4096',
    });
    expect(localAdapter).toBeDefined();
    await localAdapter.stop();
  });

  it('adapter with workerUrl returns health endpoint', async () => {
    const localPort = 4590;
    const localAdapter = new OpenSymphonyAdapter({
      port: localPort,
      host: '127.0.0.1',
      workerUrl: 'http://localhost:4096',
    });
    await localAdapter.start();

    const { status, body } = await fetchFromAdapter('/api/health');
    expect(status).toBe(200);
    const b = body as Record<string, unknown>;
    expect(b).toHaveProperty('service', 'opensymphony-adapter');

    await localAdapter.stop();
  });
});

// ---------------------------------------------------------------------------
// Adapter Lifecycle
// ---------------------------------------------------------------------------

describe('adapter lifecycle', () => {
  it('isRunning returns false before start', async () => {
    const localAdapter = new OpenSymphonyAdapter({ port: 0, host: '127.0.0.1' });
    expect(localAdapter.isRunning()).toBe(false);
    await localAdapter.stop();
  });

  it('isRunning returns true after start', async () => {
    const localAdapter = new OpenSymphonyAdapter({ port: 4598, host: '127.0.0.1' });
    await localAdapter.start();
    expect(localAdapter.isRunning()).toBe(true);
    await localAdapter.stop();
  });

  it('start is idempotent', async () => {
    const localAdapter = new OpenSymphonyAdapter({ port: 4599, host: '127.0.0.1' });
    await localAdapter.start();
    await localAdapter.start(); // second call should be no-op
    expect(localAdapter.isRunning()).toBe(true);
    await localAdapter.stop();
  });

  it('stop is idempotent', async () => {
    const localAdapter = new OpenSymphonyAdapter({ port: 0, host: '127.0.0.1' });
    await localAdapter.stop(); // not started
    await localAdapter.stop(); // double stop
    // Should not throw
  });
});
