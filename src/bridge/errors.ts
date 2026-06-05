/**
 * Cross-Service Bridge — Error Handling
 *
 * Defines the ErrorEnvelope for failed cross-service operations,
 * poison message detection, and an error notification emitter.
 *
 * ── Dead Letter Queue ─────────────────────────────────────────────
 * Failed tasks are routed to a DLQ after N retries. The DLQ name
 * follows the pattern: <original-queue>.dlq
 *
 * ── Poison Message Detection ──────────────────────────────────────
 * Messages that repeatedly fail processing (exceed max retries) are
 * quarantined to a poison queue with full context preserved.
 * ───────────────────────────────────────────────────────────────────
 */

import { EventEmitter } from 'node:events';
import type { MessageEnvelope } from './types.js';

// ── Error Codes ───────────────────────────────────────────────────

export type ErrorCode = 'TASK_TIMEOUT' | 'TASK_FAILED' | 'INVALID_PAYLOAD';

// ── Error Envelope ────────────────────────────────────────────────

/**
 * Standard error envelope for reporting failed cross-service operations.
 * Every field is explicitly typed for structured log aggregation.
 */
export interface ErrorEnvelope {
  /** Always true — discriminator for error responses. */
  error: true;
  /** Machine-readable error code. */
  code: ErrorCode;
  /** Human-readable error description. */
  message: string;
  /** Optional structured error context. */
  details?: Record<string, unknown>;
  /** The messageId of the original message that caused this error. */
  originalMessageId: string;
}

/**
 * Create an ErrorEnvelope from a failed operation.
 */
export function createErrorEnvelope(
  code: ErrorCode,
  message: string,
  originalMessageId: string,
  details?: Record<string, unknown>,
): ErrorEnvelope {
  return {
    error: true,
    code,
    message,
    details,
    originalMessageId,
  };
}

/**
 * Type guard for ErrorEnvelope.
 */
export function isErrorEnvelope(value: unknown): value is ErrorEnvelope {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return v.error === true && typeof v.code === 'string' && typeof v.originalMessageId === 'string';
}

// ── Poison Message Tracking ───────────────────────────────────────

interface PoisonMessageRecord {
  message: MessageEnvelope;
  error: ErrorEnvelope;
  failCount: number;
  lastFailedAt: string;
}

/**
 * Tracks messages that repeatedly fail processing.
 * After `maxRetries` failures, the message is quarantined.
 */
export class PoisonMessageTracker {
  private readonly records = new Map<string, PoisonMessageRecord>();
  private readonly maxRetries: number;
  private readonly emitter: EventEmitter;

  constructor(maxRetries: number = 3, emitter?: EventEmitter) {
    this.maxRetries = maxRetries;
    this.emitter = emitter ?? new EventEmitter();
  }

  /**
   * Event emitter for poison message notifications.
   * Events:
   *   - 'quarantined' (record: PoisonMessageRecord) — message sent to quarantine
   *   - 'retry' (record: PoisonMessageRecord) — message being retried
   */
  get events(): EventEmitter {
    return this.emitter;
  }

  /**
   * Record a failure for a message. Returns true if the message should be
   * quarantined (exceeded max retries), false if it can be retried.
   */
  recordFailure(message: MessageEnvelope, error: ErrorEnvelope): boolean {
    const key = message.messageId;
    const existing = this.records.get(key);

    if (existing) {
      existing.failCount++;
      existing.lastFailedAt = new Date().toISOString();
      existing.error = error;

      if (existing.failCount >= this.maxRetries) {
        this.emitter.emit('quarantined', existing);
        return true; // should be quarantined
      }

      this.emitter.emit('retry', existing);
      return false;
    }

    const record: PoisonMessageRecord = {
      message,
      error,
      failCount: 1,
      lastFailedAt: new Date().toISOString(),
    };

    this.records.set(key, record);

    if (record.failCount >= this.maxRetries) {
      this.emitter.emit('quarantined', record);
      return true;
    }

    this.emitter.emit('retry', record);
    return false;
  }

  /**
   * Get the failure record for a message, or undefined if not tracked.
   */
  getRecord(messageId: string): PoisonMessageRecord | undefined {
    return this.records.get(messageId);
  }

  /**
   * Remove a message from failure tracking (e.g., after successful retry).
   */
  clearRecord(messageId: string): void {
    this.records.delete(messageId);
  }

  /**
   * Get all currently quarantined (or tracked) messages.
   */
  getAllRecords(): PoisonMessageRecord[] {
    return Array.from(this.records.values());
  }

  /**
   * Number of currently tracked messages.
   */
  get size(): number {
    return this.records.size;
  }
}
