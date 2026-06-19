import crypto from 'node:crypto';
/**
 * Cross-Service Bridge — Message Protocol Types
 *
 * Standard envelope format for all inter-service communication
 * between Node.js (Express webhook server) and Python (Celery workers).
 *
 * ── Schema Versioning ──────────────────────────────────────────────
 * Every message carries a `version` field. Backward-incompatible changes
 * increment the version. Consumers MUST check version before processing.
 * ───────────────────────────────────────────────────────────────────
 */

export const MESSAGE_PROTOCOL_VERSION = 1;

/**
 * Source services that can originate messages.
 */
export type MessageSource = 'nodejs-webhook' | 'python-worker' | 'celery-beat';

/**
 * Message types used across the bridge.
 */
export type MessageType =
  | 'job.fix'
  | 'job.triage'
  | 'event.webhook'
  | 'result.fix'
  | 'error.task';

/**
 * Standard envelope wrapping every cross-service message.
 */
export interface MessageEnvelope {
  /** Protocol version — consumers MUST check this before processing. */
  version: number;
  /** Unique message identifier (UUID v4). */
  messageId: string;
  /** ISO-8601 timestamp of when this message was created. */
  timestamp: string;
  /** Originating service identifier. */
  source: MessageSource;
  /** Message type for routing and dispatching. */
  type: MessageType;
  /** Correlation ID for request/reply (RPC) patterns. */
  correlationId: string;
  /** Optional queue name for RPC replies (uses Direct Reply-To if omitted). */
  replyTo?: string;
  /** Application-specific payload data. */
  payload: Record<string, unknown>;
}

/**
 * Generate a UUID v4 string using crypto.randomUUID().
 */
export function generateCorrelationId(): string {
  return crypto.randomUUID();
}

/**
 * Create a fully-formed MessageEnvelope with sensible defaults.
 *
 * @param type - Message type
 * @param source - Originating service
 * @param payload - Message payload
 * @param options - Optional overrides (correlationId, replyTo)
 * @returns A complete MessageEnvelope
 */
export function createMessage(
  type: MessageType,
  source: MessageSource,
  payload: Record<string, unknown>,
  options?: {
    correlationId?: string;
    replyTo?: string;
  },
): MessageEnvelope {
  return {
    version: MESSAGE_PROTOCOL_VERSION,
    messageId: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    source,
    type,
    correlationId: options?.correlationId ?? crypto.randomUUID(),
    replyTo: options?.replyTo,
    payload,
  };
}

/**
 * Type guard to check if an unknown value is a valid MessageEnvelope.
 */
export function isMessageEnvelope(value: unknown): value is MessageEnvelope {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.version === 'number' &&
    typeof v.messageId === 'string' &&
    typeof v.timestamp === 'string' &&
    typeof v.source === 'string' &&
    typeof v.type === 'string' &&
    typeof v.correlationId === 'string' &&
    typeof v.payload === 'object' &&
    v.payload !== null
  );
}
