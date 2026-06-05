/**
 * Unit tests for src/bridge/types.ts — message protocol types.
 */

import { describe, expect, it } from 'vitest';
import {
  createMessage,
  generateCorrelationId,
  isMessageEnvelope,
  MESSAGE_PROTOCOL_VERSION,
} from '../../bridge/types.js';

describe('bridge types', () => {
  describe('MESSAGE_PROTOCOL_VERSION', () => {
    it('is version 1', () => {
      expect(MESSAGE_PROTOCOL_VERSION).toBe(1);
    });
  });

  describe('generateCorrelationId', () => {
    it('returns a UUID v4 string', () => {
      const id = generateCorrelationId();
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    });

    it('returns unique values on each call', () => {
      const ids = new Set(Array.from({ length: 100 }, () => generateCorrelationId()));
      expect(ids.size).toBe(100);
    });
  });

  describe('createMessage', () => {
    it('creates a valid MessageEnvelope with required fields', () => {
      const msg = createMessage('job.fix', 'nodejs-webhook', { issueId: 42 });

      expect(msg.version).toBe(MESSAGE_PROTOCOL_VERSION);
      expect(msg.messageId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      expect(msg.timestamp).toBeDefined();
      expect(new Date(msg.timestamp).toISOString()).toBe(msg.timestamp);
      expect(msg.source).toBe('nodejs-webhook');
      expect(msg.type).toBe('job.fix');
      expect(msg.correlationId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      expect(msg.payload).toEqual({ issueId: 42 });
      expect(msg.replyTo).toBeUndefined();
    });

    it('accepts optional correlationId and replyTo', () => {
      const correlationId = generateCorrelationId();
      const msg = createMessage('result.fix', 'python-worker', { status: 'ok' }, {
        correlationId,
        replyTo: 'amq.rabbitmq.reply-to',
      });

      expect(msg.correlationId).toBe(correlationId);
      expect(msg.replyTo).toBe('amq.rabbitmq.reply-to');
    });

    it('generates unique messageId for each call', () => {
      const msg1 = createMessage('job.triage', 'celery-beat', {});
      const msg2 = createMessage('job.triage', 'celery-beat', {});
      expect(msg1.messageId).not.toBe(msg2.messageId);
    });
  });

  describe('isMessageEnvelope', () => {
    it('returns true for a valid envelope', () => {
      const msg = createMessage('event.webhook', 'nodejs-webhook', {});
      expect(isMessageEnvelope(msg)).toBe(true);
    });

    it('returns false for null', () => {
      expect(isMessageEnvelope(null)).toBe(false);
    });

    it('returns false for a plain object', () => {
      expect(isMessageEnvelope({ foo: 'bar' })).toBe(false);
    });

    it('returns false for a string', () => {
      expect(isMessageEnvelope('hello')).toBe(false);
    });

    it('returns false when version is missing', () => {
      const { version, ...rest } = createMessage('job.fix', 'nodejs-webhook', {});
      expect(isMessageEnvelope(rest)).toBe(false);
    });

    it('returns false when payload is not an object', () => {
      const msg = createMessage('job.fix', 'nodejs-webhook', {});
      (msg as any).payload = 'not-an-object';
      expect(isMessageEnvelope(msg)).toBe(false);
    });
  });
});
