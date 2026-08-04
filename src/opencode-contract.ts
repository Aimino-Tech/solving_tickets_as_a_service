/**
 * OpenCode Contract — TypeScript types and Zod validation schemas
 * for the contract between SYNTARO and OpenCode Serve.
 *
 * This file codifies the request/response contract documented in
 * `docs/opencode-contract.md`.  Use the Zod schemas at dispatch
 * boundaries to enforce contract adherence.
 *
 * ## Usage
 *
 * ```ts
 * import { openCodeDispatchRequestSchema } from './opencode-contract.js';
 *
 * const payload = { prompt: '...', model: '...' };
 * const parsed = openCodeDispatchRequestSchema.parse(payload);
 * // parsed is now typed as OpenCodeDispatchRequest
 * ```
 *
 * @module opencode-contract
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Identity / constant
// ---------------------------------------------------------------------------

/** The OpenCode Serve API endpoint path (appended to the base URL). */
export const OPENCODE_RUN_ENDPOINT = '/api/run';

// ---------------------------------------------------------------------------
// Confidence level
// ---------------------------------------------------------------------------

export const CONFIDENCE_LEVELS = ['high', 'medium', 'low'] as const;
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

export const confidenceLevelSchema = z.enum(CONFIDENCE_LEVELS);

// ---------------------------------------------------------------------------
// 1. OpenCodeDispatchRequest — what SYNTARO sends to OpenCode Serve
// ---------------------------------------------------------------------------

/**
 * The HTTP request body sent via POST to `{opencode.url}/api/run`.
 *
 * Spec:
 * - Content-Type: application/json
 * - Authorization: Bearer <github-installation-token>
 * - Timeout: 10 minutes per model (config.phaseTimeouts.openCodeAgent)
 */
export interface OpenCodeDispatchRequest {
  /** The full system + user prompt for the agent (see buildOpenCodePrompt). */
  prompt: string;

  /**
   * Model identifier, e.g. "anthropic/claude-sonnet-4-20250514".
   * SYNTARO iterates through a model chain on failure.
   */
  model: string;
}

export const openCodeDispatchRequestSchema = z.object({
  prompt: z
    .string()
    .min(1, 'prompt is required and must be non-empty')
    .max(100_000, 'prompt exceeds maximum length of 100,000 characters'),
  model: z
    .string()
    .min(1, 'model is required and must be non-empty')
    .max(200, 'model identifier exceeds maximum length of 200 characters'),
}).strict();

// ---------------------------------------------------------------------------
// 2. OpenCodeDispatchResponse — what OpenCode Serve returns
// ---------------------------------------------------------------------------

/**
 * The JSON response body from a successful OpenCode Serve run (HTTP 2xx).
 *
 * The agent is instructed (via the prompt's Output Format section) to produce
 * a JSON object matching this shape.
 */
export interface OpenCodeDispatchResponse {
  /** Human-readable description of what was done. */
  summary: string;

  /** How confident the agent is in the fix. */
  confidence: ConfidenceLevel;

  /** Unified diff of all changes made (optional). */
  diff?: string;

  /** Branch name if changes were pushed to a remote (optional). */
  branch?: string;

  /** Test run output if tests were executed (optional). */
  testOutput?: string;

  /** Non-fatal warnings or partial failures (optional). */
  errors?: string[];

  /** Optional structured metadata from the agent. */
  metadata?: Record<string, unknown>;
}

export const openCodeDispatchResponseSchema = z.object({
  summary: z.string().min(1, 'summary is required'),
  confidence: confidenceLevelSchema,
  diff: z.string().optional(),
  branch: z.string().optional(),
  testOutput: z.string().optional(),
  errors: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).strict();

// ---------------------------------------------------------------------------
// 3. OpenCodeProgress — progress updates (for future streaming support)
// ---------------------------------------------------------------------------

/**
 * A progress update emitted by OpenCode Serve during a long-running fix.
 *
 * Currently, SYNTARO does not receive streaming progress from OpenCode —
 * it polls via a single blocking POST to `/api/run`.  This interface
 * documents the shape that future streaming or polling-based progress
 * updates would take.
 *
 * When progress reporting is added, OpenCode Serve would emit events
 * at key lifecycle points so SYNTARO can post real-time status to the issue.
 */
export interface OpenCodeProgress {
  /** Unique identifier for the run session. */
  runId: string;

  /** The current phase of the agent lifecycle. */
  phase:
    | 'cloning'
    | 'investigating'
    | 'fixing'
    | 'testing'
    | 'verifying'
    | 'committing'
    | 'done'
    | 'error';

  /** Human-readable description of what the agent is doing right now. */
  message: string;

  /** Percentage progress estimate (0–100), if known. */
  progress?: number;

  /** Any intermediate output produced so far. */
  detail?: string;

  /** ISO-8601 timestamp of the progress event. */
  timestamp: string;
}

export const openCodeProgressSchema = z.object({
  runId: z.string().min(1, 'runId is required'),
  phase: z.enum([
    'cloning',
    'investigating',
    'fixing',
    'testing',
    'verifying',
    'committing',
    'done',
    'error',
  ]),
  message: z.string().min(1, 'message is required'),
  progress: z.number().int().min(0).max(100).optional(),
  detail: z.string().optional(),
  timestamp: z.string().datetime({ offset: true }).or(z.string().min(1)),
}).strict();

// ---------------------------------------------------------------------------
// 4. OpenCodeResult — the consolidated result after dispatch
// ---------------------------------------------------------------------------

/**
 * The consolidated result returned by the `dispatchToOpenCode()` function
 * in `src/agent/issueAgent.ts`.
 *
 * This wraps the raw HTTP response with a `success` flag and extracts the
 * fields SYNTARO cares about.  It's the contract boundary between the HTTP
 * transport layer and the rest of the agent pipeline.
 */
export interface OpenCodeResult {
  /** Whether the dispatch was successful (HTTP 2xx + valid JSON). */
  success: boolean;

  /** Human-readable summary of work done (empty on failure). */
  summary: string;

  /** Confidence level from the agent. */
  confidence: ConfidenceLevel;

  /** Branch name pushed by the agent (present on success). */
  branchName?: string;

  /** Unified diff of all changes (present on success). */
  diff?: string;

  /** Test run output (present if tests were executed). */
  testOutput?: string;

  /** Non-fatal warnings or error details. */
  errors?: string[];

  /** Optional structured metadata. */
  metadata?: Record<string, unknown>;
}

export const openCodeResultSchema = z.object({
  success: z.boolean(),
  summary: z.string(),
  confidence: confidenceLevelSchema,
  branchName: z.string().optional(),
  diff: z.string().optional(),
  testOutput: z.string().optional(),
  errors: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).strict();

// ---------------------------------------------------------------------------
// 5. ModelChainConfig — model fallback chain
// ---------------------------------------------------------------------------

/**
 * Configuration for the OpenCode model chain: a primary model and an
 * ordered list of fallback models tried in sequence on failure.
 */
export interface ModelChainConfig {
  /** Primary model identifier. */
  primary: string;

  /** Ordered list of fallback model identifiers. */
  fallbacks: string[];
}

export const modelChainConfigSchema = z.object({
  primary: z.string().min(1, 'primary model is required'),
  fallbacks: z.array(z.string().min(1)),
}).strict();

// ---------------------------------------------------------------------------
// 6. Helpers
// ---------------------------------------------------------------------------

/**
 * Validate and parse an unknown value as an OpenCodeDispatchRequest.
 * Returns the parsed value or throws a ZodError.
 */
export function parseDispatchRequest(raw: unknown): OpenCodeDispatchRequest {
  return openCodeDispatchRequestSchema.parse(raw);
}

/**
 * Safely validate an unknown value as an OpenCodeDispatchRequest.
 * Returns a Zod result object (no throw).
 */
export function safeParseDispatchRequest(raw: unknown) {
  return openCodeDispatchRequestSchema.safeParse(raw);
}

/**
 * Validate and parse an unknown value as an OpenCodeDispatchResponse.
 * Returns the parsed value or throws a ZodError.
 */
export function parseDispatchResponse(raw: unknown): OpenCodeDispatchResponse {
  return openCodeDispatchResponseSchema.parse(raw);
}

/**
 * Safely validate an unknown value as an OpenCodeDispatchResponse.
 * Returns a Zod result object (no throw).
 */
export function safeParseDispatchResponse(raw: unknown) {
  return openCodeDispatchResponseSchema.safeParse(raw);
}

/**
 * Validate and parse an unknown value as an OpenCodeResult.
 * Returns the parsed value or throws a ZodError.
 */
export function parseResult(raw: unknown): OpenCodeResult {
  return openCodeResultSchema.parse(raw);
}

/**
 * Safely validate an unknown value as an OpenCodeResult.
 * Returns a Zod result object (no throw).
 */
export function safeParseResult(raw: unknown) {
  return openCodeResultSchema.safeParse(raw);
}

/**
 * Validate a single confidence value.
 */
export function parseConfidence(raw: unknown): ConfidenceLevel {
  return confidenceLevelSchema.parse(raw);
}

export interface McpSubmitIssueRequest {
  repoOwner: string;
  repoName: string;
  issueTitle: string;
  issueBody: string;
  labels?: string[];
  channel?: string;
  channelTarget?: string;
}

export interface McpSubmitIssueResponse {
  runId: string;
  status: 'queued' | 'accepted';
  pollUrl: string;
  createdAt: string;
}

export interface McpJobStatus {
  runId: string;
  status: 'queued' | 'investigating' | 'fixing' | 'testing' | 'verifying' | 'committing' | 'completed' | 'failed' | 'error';
  progress?: number;
  message?: string;
  prUrl?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  errorMessage?: string;
}

export interface McpRunHistoryEntry {
  runId: string;
  repoOwner: string;
  repoName: string;
  issueTitle: string;
  status: string;
  confidence?: string;
  prUrl?: string;
  createdAt: string;
  completedAt?: string;
}

export const mcpSubmitIssueRequestSchema = z.object({
  repoOwner: z.string().min(1),
  repoName: z.string().min(1),
  issueTitle: z.string().min(1).max(500),
  issueBody: z.string().min(1).max(50000),
  labels: z.array(z.string()).optional(),
  channel: z.string().optional(),
  channelTarget: z.string().optional(),
}).strict();
