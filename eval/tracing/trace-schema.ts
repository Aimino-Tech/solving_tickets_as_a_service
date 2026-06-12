/**
 * Trace Schema for STAS Eval Pipeline
 *
 * Defines span names and their expected attributes.
 * Every span emitted by the eval pipeline should conform to one of these
 * well-known schemas so that LangFuse dashboards and queries remain
 * consistent across runs.
 *
 * Usage:
 *   import { SpanSchemas, TraceSpans } from "./trace-schema";
 *   tracer.startActiveSpan(TraceSpans.RUN, ...);
 */

// ---------------------------------------------------------------------------
// Span name constants
// ---------------------------------------------------------------------------
export const TraceSpans = {
  /** Root span for a single eval run */
  RUN: "stas-eval.run",
  /** Creating / provisioning the sandbox environment */
  SANDBOX_CREATE: "stas-eval.sandbox.create",
  /** Executing a command inside the agent sandbox */
  AGENT_EXECUTE: "stas-eval.agent.execute",
  /** A single tool invocation made by the agent */
  AGENT_TOOL_CALL: "stas-eval.agent.tool_call",
  /** Collecting artifacts (files) produced by the agent */
  ARTIFACT_COLLECT: "stas-eval.artifact.collect",
  /** Running the evaluation / assertion against expected output */
  EVALUATE: "stas-eval.evaluate",
} as const;

export type TraceSpanName = (typeof TraceSpans)[keyof typeof TraceSpans];

// ---------------------------------------------------------------------------
// Attribute schemas per span
// ---------------------------------------------------------------------------
export interface RunAttributes {
  /** Unique identifier for the test case */
  "testCase.id": string;
  /** Repository under test (e.g. "owner/repo") */
  repo: string;
  /** Model identifier used by the provider */
  model: string;
  /** Attempt number for retries */
  attempt: number;
}

export interface SandboxCreateAttributes {
  /** Sandbox template identifier */
  template: string;
  /** Number of CPU cores allocated */
  cpuCount: number;
  /** Memory limit in megabytes */
  memoryMB: number;
}

export interface AgentExecuteAttributes {
  /** Shell command executed */
  command: string;
  /** Process exit code (0 for success) */
  exitCode: number;
  /** Wall-clock duration in milliseconds */
  duration: number;
}

export interface AgentToolCallAttributes {
  /** Name of the tool invoked */
  toolName: string;
  /** Arguments passed to the tool (JSON-stringified) */
  args: string;
  /** Result returned by the tool (JSON-stringified) */
  result: string;
}

export interface ArtifactCollectAttributes {
  /** Number of files collected */
  fileCount: number;
  /** Total size in bytes */
  totalBytes: number;
}

export interface EvaluateAttributes {
  /** Expected output / ground truth */
  expected: string;
  /** Actual output produced */
  actual: string;
  /** Whether the assertion passed */
  passed: boolean;
}

// ---------------------------------------------------------------------------
// Schema registry — maps span names to their attribute interfaces
// ---------------------------------------------------------------------------
export interface SpanSchemas {
  [TraceSpans.RUN]: RunAttributes;
  [TraceSpans.SANDBOX_CREATE]: SandboxCreateAttributes;
  [TraceSpans.AGENT_EXECUTE]: AgentExecuteAttributes;
  [TraceSpans.AGENT_TOOL_CALL]: AgentToolCallAttributes;
  [TraceSpans.ARTIFACT_COLLECT]: ArtifactCollectAttributes;
  [TraceSpans.EVALUATE]: EvaluateAttributes;
}
