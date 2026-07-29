/**
 * OpenSymphony Protocol Adapter.
 *
 * A drop-in replacement for OpenCode's HTTP serve protocol.
 * Implements the `/api/run` and `/api/health` endpoints that
 * STAS's `dispatchToOpenCode()` calls, backed by the OpenSymphony
 * pipeline (intent → plan → execute → collect → taste).
 *
 * ## Usage
 *
 * ```ts
 * const adapter = new OpenSymphonyAdapter({ port: 4097 });
 * adapter.start();
 * // STAS now points OPENCODE_URL=http://localhost:4097
 * ```
 *
 * ## Pipeline Architecture
 *
 * Each request flows through stages registered by name.  The model
 * parameter selects a pipeline template — a named list of stages.
 * A default template routes every model through all five stages.
 * Register custom templates via `setPipelineTemplate()`.
 *
 * ## Backwards Compatibility
 *
 * STAS sets `config.opencode.url` via `OPENCODE_URL` env var.
 * Pointing it at this adapter requires zero code changes in STAS.
 * The adapter speaks the exact OpenCode contract defined in
 * `src/opencode-contract.ts`.
 *
 * @module opensymphony-adapter
 */

import crypto from 'node:crypto';
import http from 'node:http';
import { rootLogger } from './utils/logger.js';

type Logger = ReturnType<typeof rootLogger.child>;
import {
  openCodeDispatchRequestSchema,
  safeParseDispatchRequest,
  type ConfidenceLevel,
  type OpenCodeDispatchResponse,
} from './opencode-contract.js';

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

const log: Logger = rootLogger.child({ module: 'opensymphony-adapter' });

const WIP_MSG = 'OpenSymphony adapter is a WIP placeholder — all pipeline stages are no-ops. Set OPENSYMPHONY_ENABLED=false or implement real stages per AIM-3378.';

log.warn(WIP_MSG);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PipelineContext {
  /** Unique request identifier. */
  requestId: string;

  /** Raw prompt from the caller. */
  prompt: string;

  /** Model identifier (e.g. "anthropic/claude-sonnet-4-20250514"). */
  model: string;

  /** When the pipeline started. */
  startTime: Date;

  /** Accumulated results from each stage (populated as stages run). */
  stageResults: Map<string, PipelineStageResult>;
}

export interface PipelineStageResult {
  /** Stage name. */
  stage: string;

  /** Whether the stage completed without error. */
  success: boolean;

  /** Arbitrary output from the stage. */
  output?: unknown;

  /** Error message if the stage failed. */
  error?: string;

  /** Wall-clock duration of the stage in milliseconds. */
  durationMs: number;
}

/**
 * A single stage in the OpenSymphony pipeline.
 * Stages are executed in registration order for each model template.
 */
export interface PipelineStage {
  /** Short, unique name (e.g. "intent", "plan"). */
  name: string;

  /**
   * Execute this stage.
   * Return a PipelineStageResult.  If it throws, the adapter catches
   * the error and records a failure result, then continues to the
   * next stage (the pipeline does NOT short-circuit on stage failure).
   */
  execute(context: PipelineContext): Promise<PipelineStageResult>;
}

/**
 * Configuration for the OpenSymphony adapter.
 */
export interface OpenSymphonyAdapterConfig {
  /** Port to listen on (default: 4097). */
  port: number;

  /** Host to bind to (default: "127.0.0.1"). */
  host: string;

  /**
   * Default pipeline template — stage names to run for any model
   * that does not have an explicit template registered.
   */
  defaultTemplate: string[];
}

const DEFAULT_CONFIG: OpenSymphonyAdapterConfig = {
  port: 4097,
  host: '127.0.0.1',
  defaultTemplate: ['intent', 'plan', 'execute', 'collect', 'taste'],
};

// ---------------------------------------------------------------------------
// Built-in Pipeline Stages
// ---------------------------------------------------------------------------

export class IntentStage implements PipelineStage {
  name = 'intent';

  async execute(context: PipelineContext): Promise<PipelineStageResult> {
    const start = Date.now();
    log.warn({ requestId: context.requestId }, '[IntentStage] WIP placeholder — skipping');
    return {
      stage: this.name,
      success: false,
      error: WIP_MSG,
      durationMs: Date.now() - start,
    };
  }
}

export class PlanningStage implements PipelineStage {
  name = 'plan';

  async execute(context: PipelineContext): Promise<PipelineStageResult> {
    const start = Date.now();
    log.warn({ requestId: context.requestId }, '[PlanningStage] WIP placeholder — skipping');
    return {
      stage: this.name,
      success: false,
      error: WIP_MSG,
      durationMs: Date.now() - start,
    };
  }
}

export class ExecutionStage implements PipelineStage {
  name = 'execute';

  async execute(context: PipelineContext): Promise<PipelineStageResult> {
    const start = Date.now();
    log.warn({ requestId: context.requestId }, '[ExecutionStage] WIP placeholder — skipping');
    return {
      stage: this.name,
      success: false,
      error: WIP_MSG,
      durationMs: Date.now() - start,
    };
  }
}

export class CollectionStage implements PipelineStage {
  name = 'collect';

  async execute(context: PipelineContext): Promise<PipelineStageResult> {
    const start = Date.now();
    log.warn({ requestId: context.requestId }, '[CollectionStage] WIP placeholder — skipping');
    return {
      stage: this.name,
      success: false,
      error: WIP_MSG,
      durationMs: Date.now() - start,
    };
  }
}

export class TasteStage implements PipelineStage {
  name = 'taste';

  async execute(context: PipelineContext): Promise<PipelineStageResult> {
    const start = Date.now();
    log.warn({ requestId: context.requestId }, '[TasteStage] WIP placeholder — skipping');
    return {
      stage: this.name,
      success: false,
      error: WIP_MSG,
      durationMs: Date.now() - start,
    };
  }
}

// ---------------------------------------------------------------------------
// Pipeline Runner
// ---------------------------------------------------------------------------

/**
 * Run a list of pipeline stages against a context.
 *
 * Each stage executes in order; failures are logged but do NOT
 * halt subsequent stages.  The overall pipeline result is derived
 * from the composite stage results.
 */
async function runPipeline(
  stages: PipelineStage[],
  context: PipelineContext,
): Promise<{ success: boolean; summary: string; confidence: ConfidenceLevel; output: OpenCodeDispatchResponse['diff']; branch: OpenCodeDispatchResponse['branch']; testOutput: OpenCodeDispatchResponse['testOutput']; errors: string[]; metadata: Record<string, unknown> }> {
  const errors: string[] = [];

  for (const stage of stages) {
    try {
      const result = await stage.execute(context);
      context.stageResults.set(stage.name, result);
      if (!result.success) {
        errors.push(`[${stage.name}] ${result.error ?? 'Unknown error'}`);
      }
    } catch (err) {
      const msg = `[${stage.name}] Unhandled exception: ${String(err)}`;
      errors.push(msg);
      context.stageResults.set(stage.name, {
        stage: stage.name,
        success: false,
        error: msg,
        durationMs: 0,
      });
    }
  }

  // Derive overall confidence from the taste stage, or fall back
  const tasteResult = context.stageResults.get('taste');
  const tasteOutput = tasteResult?.output as { confidence?: ConfidenceLevel } | undefined;
  const confidence: ConfidenceLevel = tasteOutput?.confidence ?? 'medium';

  // Extract outputs from collect stage
  const collectResult = context.stageResults.get('collect');
  const collectOutput = collectResult?.output as
    | { diff?: string; testOutput?: string; branch?: string }
    | undefined;

  const totalDurationMs = Array.from(context.stageResults.values()).reduce(
    (sum, r) => sum + r.durationMs,
    0,
  );

  const stageCount = stages.length;
  const successCount = Array.from(context.stageResults.values()).filter((r) => r.success).length;

  return {
    success: errors.length === 0,
    summary: errors.length === 0
      ? `OpenSymphony pipeline completed successfully (${successCount}/${stageCount} stages passed in ${totalDurationMs}ms).`
      : `OpenSymphony pipeline completed with ${errors.length} error(s) (${successCount}/${stageCount} stages passed).`,
    confidence,
    output: collectOutput?.diff ?? undefined,
    branch: collectOutput?.branch ?? undefined,
    testOutput: collectOutput?.testOutput ?? undefined,
    errors,
    metadata: {
      requestId: context.requestId,
      stageCount,
      successCount,
      totalDurationMs,
      model: context.model,
      pipelineTimestamp: context.startTime.toISOString(),
    },
  };
}

// ---------------------------------------------------------------------------
// OpenSymphonyAdapter
// ---------------------------------------------------------------------------

/**
 * HTTP server adapter that speaks the OpenCode protocol
 * (`/api/run`, `/api/health`) backed by OpenSymphony's pipeline.
 *
 * Create an instance, optionally register custom stages / templates,
 * then call `start()`.
 *
 * @example
 * ```ts
 * const adapter = new OpenSymphonyAdapter({ port: 4097 });
 * adapter.start();
 * ```
 */
export class OpenSymphonyAdapter {
  private readonly config: OpenSymphonyAdapterConfig;
  private server: http.Server | null = null;
  private started = false;
  private readonly stages = new Map<string, PipelineStage>();
  private readonly templates = new Map<string, string[]>();

  constructor(config?: Partial<OpenSymphonyAdapterConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Register the built-in stages
    this.registerStage(new IntentStage());
    this.registerStage(new PlanningStage());
    this.registerStage(new ExecutionStage());
    this.registerStage(new CollectionStage());
    this.registerStage(new TasteStage());
  }

  // ── Stage / Template Registration ──────────────────────────────────

  /**
   * Register a pipeline stage.
   * If a stage with the same name already exists it is overwritten.
   */
  registerStage(stage: PipelineStage): this {
    this.stages.set(stage.name, stage);
    return this;
  }

  /**
   * Register a pipeline template for a model (or model prefix).
   *
   * The template is a list of stage names (in execution order).
   * When a request arrives, the adapter selects the template whose
   * key matches the start of the model string (longest prefix wins).
   * If no match is found, `defaultTemplate` is used.
   *
   * @example
   * ```ts
   * adapter.setPipelineTemplate('claude-sonnet', ['intent', 'plan', 'execute', 'collect', 'taste']);
   * adapter.setPipelineTemplate('gpt-4o', ['intent', 'execute', 'taste']);
   * ```
   */
  setPipelineTemplate(modelPrefix: string, stageNames: string[]): this {
    this.templates.set(modelPrefix, stageNames);
    return this;
  }

  /**
   * Remove a previously registered pipeline template.
   */
  removePipelineTemplate(modelPrefix: string): this {
    this.templates.delete(modelPrefix);
    return this;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────

  /**
   * Start the HTTP server.
   * Resolves when the server is listening.
   */
  start(): Promise<void> {
    if (this.started) {
      log.warn('OpenSymphony adapter already started');
      return Promise.resolve();
    }
    this.started = true;

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res).catch((err) => {
          log.error({ err: String(err) }, 'Unhandled request error');
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Internal server error' }));
          }
        });
      });

      this.server.listen(this.config.port, this.config.host, () => {
        log.info(
          { port: this.config.port, host: this.config.host },
          'OpenSymphony adapter listening',
        );
        resolve();
      });

      this.server.on('error', (err) => {
        log.error({ err: String(err) }, 'OpenSymphony adapter server error');
        reject(err);
      });
    });
  }

  /**
   * Gracefully stop the HTTP server.
   * Resolves when the server is closed.
   */
  stop(): Promise<void> {
    this.started = false;
    if (!this.server) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.server!.close(() => {
        log.info('OpenSymphony adapter stopped');
        this.server = null;
        resolve();
      });
    });
  }

  /**
   * Whether the adapter is currently running.
   */
  isRunning(): boolean {
    return this.started && this.server !== null;
  }

  // ── Request Routing ────────────────────────────────────────────────

  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    // CORS headers (required for health checks from the STAS dashboard)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Parse the URL
    const url = req.url ?? '/';
    const parsedUrl = new URL(url, `http://${req.headers.host ?? 'localhost'}`);

    try {
      if (req.method === 'GET' && parsedUrl.pathname === '/api/health') {
        await this.handleHealth(req, res);
      } else if (req.method === 'POST' && parsedUrl.pathname === '/api/run') {
        await this.handleRun(req, res);
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found', path: parsedUrl.pathname }));
      }
    } catch (err) {
      log.error({ err: String(err), path: parsedUrl.pathname }, 'Request handler error');
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error' }));
      }
    }
  }

  // ── GET /api/health ────────────────────────────────────────────────

  /**
   * Health check endpoint.
   *
   * Called by:
   * - STAS's `OpenCodeHealthClient.poll()` at `{opencode.url}/api/health`
   * - The STAS health status / circuit breaker
   *
   * Returns the same shape as OpenCode serve for transparent compatibility:
   * ```json
   * { "status": "ok", "model": "...", "queue_depth": 0, ... }
   * ```
   */
  private async handleHealth(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const body = {
      status: 'ok',
      service: 'opensymphony-adapter',
      version: '0.1.0',
      wip: true,
      wipNotice: WIP_MSG,
      model: Array.from(this.templates.keys()).join(',') || 'default',
      queue_depth: 0,
      active_sessions: 0,
      uptime_seconds: process.uptime(),
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  }

  // ── POST /api/run ──────────────────────────────────────────────────

  /**
   * Main dispatch endpoint.
   *
   * Receives the same payload as OpenCode serve:
   * ```json
   * { "prompt": "...", "model": "..." }
   * ```
   *
   * Returns the same response shape that `dispatchToOpenCode()` parses:
   * ```json
   * { "summary": "...", "confidence": "high", "diff": "...", ... }
   * ```
   */
  private async handleRun(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const body = await readBody(req);

    // Validate the request against the OpenCode contract
    const parsed = safeParseDispatchRequest(body);
    if (!parsed.success) {
      const zodErrors = parsed.error.issues.map(
        (i) => `${i.path.join('.')}: ${i.message}`,
      );
      log.warn({ errors: zodErrors }, 'Invalid dispatch request');

      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          summary: 'Invalid request payload',
          confidence: 'low',
          errors: zodErrors,
        }),
      );
      return;
    }

    const { prompt, model } = parsed.data;
    const requestId = crypto.randomUUID();

    log.info(
      { requestId, model, promptLength: prompt.length },
      'Received dispatch request',
    );

    // Select pipeline template based on model prefix (longest match wins)
    const stageNames = this.selectTemplate(model);
    const stages: PipelineStage[] = [];
    for (const name of stageNames) {
      const stage = this.stages.get(name);
      if (!stage) {
        log.warn({ stageName: name, model }, 'Pipeline stage not found, skipping');
        continue;
      }
      stages.push(stage);
    }

    if (stages.length === 0) {
      log.error({ requestId, model }, 'No valid pipeline stages found');
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          summary: 'No pipeline stages available for the requested model',
          confidence: 'low',
          errors: [`No valid stages found for model "${model}"`],
        }),
      );
      return;
    }

    // Build the pipeline context
    const context: PipelineContext = {
      requestId,
      prompt,
      model,
      startTime: new Date(),
      stageResults: new Map(),
    };

    // Run the pipeline
    const result = await runPipeline(stages, context);

    // Build the OpenCode-compatible response
    const response: OpenCodeDispatchResponse = {
      summary: result.summary,
      confidence: result.confidence,
      diff: result.output ?? undefined,
      branch: result.branch ?? undefined,
      testOutput: result.testOutput ?? undefined,
      errors: result.errors.length > 0 ? result.errors : undefined,
      metadata: result.metadata,
    };

    const httpStatus = result.success ? 200 : 500;
    log.info(
      {
        requestId,
        httpStatus,
        confidence: response.confidence,
        errorCount: result.errors.length,
      },
      'Dispatch response sent',
    );

    res.writeHead(httpStatus, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response));
  }

  // ── Helpers ────────────────────────────────────────────────────────

  /**
   * Select a pipeline template for the given model identifier.
   *
   * Matches by longest prefix key in the registered templates.
   * Falls back to `defaultTemplate` if no match is found.
   *
   * Examples:
   * - model "anthropic/claude-sonnet-4-20250514" matches key "anthropic/"
   * - model "gpt-4o" matches key "gpt-4o"
   * - model "unknown-model" falls back to defaultTemplate
   */
  private selectTemplate(model: string): string[] {
    let bestMatch: string | null = null;
    let bestLength = 0;

    for (const prefix of this.templates.keys()) {
      if (model.startsWith(prefix) && prefix.length > bestLength) {
        bestLength = prefix.length;
        bestMatch = prefix;
      }
    }

    if (bestMatch) {
      return this.templates.get(bestMatch)!;
    }

    return this.config.defaultTemplate;
  }
}

// ---------------------------------------------------------------------------
// Utility: read a JSON body from an IncomingMessage
// ---------------------------------------------------------------------------

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new Error(`Invalid JSON body: ${String(err)}`));
      }
    });
    req.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Convenience: create and start in one call
// ---------------------------------------------------------------------------

/**
 * Create and start an OpenSymphonyAdapter with default settings.
 * Useful for scripts and quick-start scenarios.
 *
 * @example
 * ```ts
 * const server = await startOpenSymphonyAdapter({ port: 4097 });
 * // ... later ...
 * await server.stop();
 * ```
 */
export async function startOpenSymphonyAdapter(
  config?: Partial<OpenSymphonyAdapterConfig>,
): Promise<OpenSymphonyAdapter> {
  const adapter = new OpenSymphonyAdapter(config);
  await adapter.start();
  return adapter;
}
