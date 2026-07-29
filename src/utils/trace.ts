/**
 * Trace ID utilities — W3C Trace Context propagation for STAS.
 *
 * Generates and propagates trace IDs across STAS → Governance → OpenSymphony
 * for end-to-end log correlation.
 *
 * ── Usage ──────────────────────────────────────────────────────────────
 *   import { generateTraceId, TRACE_HEADER } from './utils/trace.js';
 *
 *   const traceId = generateTraceId();
 *   // → "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
 *
 *   // Attach to outgoing requests
 *   headers[TRACE_HEADER] = traceId;
 * ────────────────────────────────────────────────────────────────────────
 */

import { randomUUID } from 'node:crypto';

/** HTTP header name for trace ID propagation. */
export const TRACE_HEADER = 'x-stas-trace-id';

/** W3C Trace Context traceparent header. */
export const TRACEPARENT_HEADER = 'traceparent';

/**
 * Generate a new trace ID (UUID v4).
 */
export function generateTraceId(): string {
  return randomUUID();
}

/**
 * Extract or generate a trace ID from request headers.
 * Checks for existing trace headers in order of priority:
 *   1. x-stas-trace-id (STAS-specific)
 *   2. traceparent (W3C Trace Context)
 *   3. x-request-id (generic request ID)
 * Falls back to generating a new UUID.
 */
export function extractOrGenerateTraceId(headers: Record<string, string | string[] | undefined>): string {
  const stasTrace = headers[TRACE_HEADER];
  if (stasTrace) return Array.isArray(stasTrace) ? stasTrace[0] : stasTrace;

  const w3cTrace = headers[TRACEPARENT_HEADER];
  if (w3cTrace) {
    const val = Array.isArray(w3cTrace) ? w3cTrace[0] : w3cTrace;
    // traceparent format: "00-traceid-spanid-01" — extract the trace ID part
    const parts = val.split('-');
    if (parts.length >= 2 && parts[0] === '00') {
      return parts[1];
    }
    return val;
  }

  const reqId = headers['x-request-id'];
  if (reqId) return Array.isArray(reqId) ? reqId[0] : reqId;

  return generateTraceId();
}

/**
 * Build a W3C traceparent header value from a trace ID.
 * Span ID is set to a random value (the first trace node).
 */
export function buildTraceparent(traceId: string): string {
  const spanId = randomUUID().replace(/-/g, '').slice(0, 16);
  return `00-${traceId.replace(/-/g, '')}-${spanId}-01`;
}

/**
 * Add trace headers to a headers object.
 */
export function addTraceHeaders(
  headers: Record<string, string>,
  traceId: string,
): Record<string, string> {
  return {
    ...headers,
    [TRACE_HEADER]: traceId,
    [TRACEPARENT_HEADER]: buildTraceparent(traceId),
  };
}
