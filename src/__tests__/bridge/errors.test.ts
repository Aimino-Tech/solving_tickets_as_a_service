/**
 * Unit tests for src/bridge/errors.ts — error handling and poison tracking.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  createErrorEnvelope,
  isErrorEnvelope,
  PoisonMessageTracker,
} from '../../bridge/errors.js';
import { createMessage } from '../../bridge/types.js';

describe('bridge errors', () => {
  describe('createErrorEnvelope', () => {
    it('creates a valid ErrorEnvelope', () => {
      const err = createErrorEnvelope(
        'TASK_TIMEOUT',
        'Operation timed out',
        'msg-123',
        { queue: 'test-queue' },
      );

      expect(err.error).toBe(true);
      expect(err.code).toBe('TASK_TIMEOUT');
      expect(err.message).toBe('Operation timed out');
      expect(err.originalMessageId).toBe('msg-123');
      expect(err.details).toEqual({ queue: 'test-queue' });
    });

    it('creates error envelope without details', () => {
      const err = createErrorEnvelope('TASK_FAILED', 'Something went wrong', 'msg-456');
      expect(err.details).toBeUndefined();
    });

    it('accepts all error codes', () => {
      const codes = ['TASK_TIMEOUT', 'TASK_FAILED', 'INVALID_PAYLOAD'] as const;
      for (const code of codes) {
        const err = createErrorEnvelope(code, 'test', 'msg-1');
        expect(err.code).toBe(code);
      }
    });
  });

  describe('isErrorEnvelope', () => {
    it('returns true for a valid error envelope', () => {
      const err = createErrorEnvelope('TASK_FAILED', 'err', 'msg-1');
      expect(isErrorEnvelope(err)).toBe(true);
    });

    it('returns false for null', () => {
      expect(isErrorEnvelope(null)).toBe(false);
    });

    it('returns false when error field is not true', () => {
      expect(isErrorEnvelope({ error: false, code: 'TASK_FAILED', originalMessageId: 'x' })).toBe(false);
    });

    it('returns false when code is missing', () => {
      expect(isErrorEnvelope({ error: true, originalMessageId: 'x' })).toBe(false);
    });
  });

  describe('PoisonMessageTracker', () => {
    it('tracks first failure without quarantining', () => {
      const tracker = new PoisonMessageTracker(3);
      const msg = createMessage('job.fix', 'nodejs-webhook', {});
      const err = createErrorEnvelope('TASK_FAILED', 'fail', msg.messageId);

      const shouldQuarantine = tracker.recordFailure(msg, err);

      expect(shouldQuarantine).toBe(false);
      expect(tracker.size).toBe(1);
    });

    it('quarantines after exceeding max retries', () => {
      const tracker = new PoisonMessageTracker(3);
      const msg = createMessage('job.fix', 'nodejs-webhook', {});
      const err = createErrorEnvelope('TASK_FAILED', 'fail', msg.messageId);

      // First two failures — should NOT quarantine
      expect(tracker.recordFailure(msg, err)).toBe(false);
      expect(tracker.recordFailure(msg, err)).toBe(false);

      // Third failure — should quarantine
      expect(tracker.recordFailure(msg, err)).toBe(true);
      expect(tracker.size).toBe(1);
    });

    it('emits quarantined event when message is quarantined', () => {
      const tracker = new PoisonMessageTracker(2);
      const msg = createMessage('job.fix', 'nodejs-webhook', {});
      const err = createErrorEnvelope('TASK_FAILED', 'fail', msg.messageId);

      const quarantinedSpy = vi.fn();
      tracker.events.on('quarantined', quarantinedSpy);

      tracker.recordFailure(msg, err); // 1st failure, retry
      tracker.recordFailure(msg, err); // 2nd failure, quarantine

      expect(quarantinedSpy).toHaveBeenCalledTimes(1);
      expect(quarantinedSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.objectContaining({ messageId: msg.messageId }),
          failCount: 2,
        }),
      );
    });

    it('emits retry event on non-fatal failures', () => {
      const tracker = new PoisonMessageTracker(3);
      const msg = createMessage('job.fix', 'nodejs-webhook', {});
      const err = createErrorEnvelope('TASK_FAILED', 'fail', msg.messageId);

      const retrySpy = vi.fn();
      tracker.events.on('retry', retrySpy);

      tracker.recordFailure(msg, err);

      expect(retrySpy).toHaveBeenCalledTimes(1);
    });

    it('getRecord returns undefined for unknown message', () => {
      const tracker = new PoisonMessageTracker(3);
      expect(tracker.getRecord('unknown-id')).toBeUndefined();
    });

    it('getRecord returns the failure record', () => {
      const tracker = new PoisonMessageTracker(3);
      const msg = createMessage('job.fix', 'nodejs-webhook', {});
      const err = createErrorEnvelope('TASK_FAILED', 'fail', msg.messageId);

      tracker.recordFailure(msg, err);
      const record = tracker.getRecord(msg.messageId);

      expect(record).toBeDefined();
      expect(record!.failCount).toBe(1);
      expect(record!.message.messageId).toBe(msg.messageId);
    });

    it('clearRecord removes message from tracking', () => {
      const tracker = new PoisonMessageTracker(3);
      const msg = createMessage('job.fix', 'nodejs-webhook', {});

      tracker.recordFailure(msg, createErrorEnvelope('TASK_FAILED', 'fail', msg.messageId));
      expect(tracker.size).toBe(1);

      tracker.clearRecord(msg.messageId);
      expect(tracker.size).toBe(0);
      expect(tracker.getRecord(msg.messageId)).toBeUndefined();
    });

    it('getAllRecords returns all tracked messages', () => {
      const tracker = new PoisonMessageTracker(3);
      const msg1 = createMessage('job.fix', 'nodejs-webhook', {});
      const msg2 = createMessage('job.triage', 'celery-beat', {});

      tracker.recordFailure(msg1, createErrorEnvelope('TASK_FAILED', 'fail', msg1.messageId));
      tracker.recordFailure(msg2, createErrorEnvelope('TASK_FAILED', 'fail', msg2.messageId));

      expect(tracker.getAllRecords()).toHaveLength(2);
    });

    it('uses default maxRetries of 3', () => {
      const tracker = new PoisonMessageTracker();
      const msg = createMessage('job.fix', 'nodejs-webhook', {});
      const err = createErrorEnvelope('TASK_FAILED', 'fail', msg.messageId);

      expect(tracker.recordFailure(msg, err)).toBe(false);
      expect(tracker.recordFailure(msg, err)).toBe(false);
      expect(tracker.recordFailure(msg, err)).toBe(true); // 3rd = quarantine
    });

    it('quarantines on first failure when maxRetries is 1', () => {
      const tracker = new PoisonMessageTracker(1);
      const msg = createMessage('job.fix', 'nodejs-webhook', {});
      const err = createErrorEnvelope('TASK_FAILED', 'fail', msg.messageId);

      expect(tracker.recordFailure(msg, err)).toBe(true);
    });
  });
});
