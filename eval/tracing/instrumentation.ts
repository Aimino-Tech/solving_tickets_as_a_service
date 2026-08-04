import { trace, Span, SpanStatusCode, context } from "@opentelemetry/api";
import { TraceSpans, type SpanSchemas } from "./trace-schema";

const tracer = trace.getTracer("syntaro-eval");

// ---------------------------------------------------------------------------
// Helper: create a child span with automatic error handling
// ---------------------------------------------------------------------------

/**
 * Wraps an async function with an OpenTelemetry span.
 *
 * The span is automatically:
 *  - created as a child of the currently active span
 *  - ended when the function completes (or rejects)
 *  - marked as error if the function throws
 *
 * @param spanName  One of the well-known span names from `TraceSpans`
 * @param attrs     Attributes conforming to the schema for that span
 * @param fn        Async function to trace
 * @returns         The return value of `fn`
 */
export async function traceAsync<Name extends keyof SpanSchemas>(
  spanName: Name,
  attrs: SpanSchemas[Name],
  fn: (span: Span) => Promise<unknown>,
): Promise<unknown> {
  return tracer.startActiveSpan(spanName, (span: Span) => {
    // Set all attributes on the span
    for (const [key, value] of Object.entries(attrs)) {
      span.setAttribute(key, value as string | number | boolean);
    }

    return fn(span)
      .then((result) => {
        span.setStatus({ code: SpanStatusCode.OK });
        span.end();
        return result;
      })
      .catch((err: Error) => {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: err.message,
        });
        span.recordException(err);
        span.end();
        throw err;
      });
  });
}

/**
 * Wraps a synchronous function with an OpenTelemetry span.
 * Semantics are identical to `traceAsync` but for sync callbacks.
 */
export function traceSync<Name extends keyof SpanSchemas>(
  spanName: Name,
  attrs: SpanSchemas[Name],
  fn: (span: Span) => unknown,
): unknown {
  return tracer.startActiveSpan(spanName, (span: Span) => {
    for (const [key, value] of Object.entries(attrs)) {
      span.setAttribute(key, value as string | number | boolean);
    }

    try {
      const result = fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      span.end();
      return result;
    } catch (err) {
      const error = err as Error;
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error.message,
      });
      span.recordException(error);
      span.end();
      throw err;
    }
  });
}

// ---------------------------------------------------------------------------
// High-level decorator helpers
// ---------------------------------------------------------------------------

/**
 * Creates the root span for an eval run.
 *
 * @example
 *   await withRunSpan({ testCase: { id: "tc-01" }, repo: "owner/repo", model: "gpt-4", attempt: 1 }, async (span) => {
 *     // … agent execution, sandbox creation, evaluation …
 *   });
 */
export function withRunSpan(
  attrs: SpanSchemas["syntaro-eval.run"],
  fn: (span: Span) => Promise<unknown>,
): Promise<unknown> {
  return traceAsync(TraceSpans.RUN, attrs, fn);
}

/**
 * Wraps sandbox creation inside a child span.
 */
export function withSandboxCreateSpan(
  attrs: SpanSchemas["syntaro-eval.sandbox.create"],
  fn: (span: Span) => Promise<unknown>,
): Promise<unknown> {
  return traceAsync(TraceSpans.SANDBOX_CREATE, attrs, fn);
}

/**
 * Wraps an agent command execution inside a child span.
 */
export function withAgentExecuteSpan(
  attrs: SpanSchemas["syntaro-eval.agent.execute"],
  fn: (span: Span) => Promise<unknown>,
): Promise<unknown> {
  return traceAsync(TraceSpans.AGENT_EXECUTE, attrs, fn);
}

/**
 * Wraps a single tool call inside a child span.
 */
export function withToolCallSpan(
  attrs: SpanSchemas["syntaro-eval.agent.tool_call"],
  fn: (span: Span) => Promise<unknown>,
): Promise<unknown> {
  return traceAsync(TraceSpans.AGENT_TOOL_CALL, attrs, fn);
}

/**
 * Wraps artifact collection inside a child span.
 */
export function withArtifactCollectSpan(
  attrs: SpanSchemas["syntaro-eval.artifact.collect"],
  fn: (span: Span) => Promise<unknown>,
): Promise<unknown> {
  return traceAsync(TraceSpans.ARTIFACT_COLLECT, attrs, fn);
}

/**
 * Wraps evaluation / assertion logic inside a child span.
 */
export function withEvaluateSpan(
  attrs: SpanSchemas["syntaro-eval.evaluate"],
  fn: (span: Span) => Promise<unknown>,
): Promise<unknown> {
  return traceAsync(TraceSpans.EVALUATE, attrs, fn);
}

// ---------------------------------------------------------------------------
// Tracer accessor (for advanced use cases)
// ---------------------------------------------------------------------------

/**
 * Returns the SYNTARO eval tracer instance for direct use when the helper
 * functions above do not suffice (e.g. creating multiple concurrent spans).
 */
export function getTracer() {
  return tracer;
}
