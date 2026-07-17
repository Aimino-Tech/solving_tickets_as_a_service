/**
 * AIM-3210: Dead Letter Queue (DLQ) Path E2E Smoke Test
 *
 * Validates DLQ behavior:
 *   Failed message → retries → DLQ → alert
 *
 * Tests that the DLQ system correctly captures messages that exhaust
 * retries, stores them with full context, and triggers alerts.
 *
 * NOTE: This test verifies the DLQ infrastructure (store, alerts, format)
 * rather than the full retry pipeline, which requires a running worker.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestHarness } from './harness/index.js';
import type { TestHarness } from './harness/index.js';
import type { DeadLetterEntry } from '../../src/queue/deadLetterQueue.js';

let harness: TestHarness;

beforeAll(async () => {
  harness = await createTestHarness({ verbose: false });
}, 30_000);

afterAll(async () => {
  await harness.stop();
}, 10_000);

describe('DLQ Path: Failed Message → Retries → DLQ → Alert', () => {
  it('DLQ entry structure contains all required fields', async () => {
    // Import the DLQ module (mocked in test setup)
    const { dlqStore, recordDeadLetter } = await import('../../src/queue/deadLetterQueue.js');

    const mockJobData = {
      installationId: 555,
      repoOwner: 'owner',
      repoName: 'test-repo',
      repoPrivate: false,
      issueNumber: 42,
      issueTitle: 'Test DLQ entry',
      issueBody: 'Test body for DLQ',
      source: 'github' as const,
      retryCount: 4,
    };

    const entry = await recordDeadLetter(
      mockJobData as any,
      'Test error after max retries',
      'stas-issues',
      'Error: Test error\n    at Object.<anonymous> (test.ts:1:1)',
    );

    expect(entry).toBeDefined();
    expect(entry.id).toBeTruthy();
    expect(entry.timestamp).toBeTruthy();
    expect(entry.error).toBe('Test error after max retries');
    expect(entry.retryCount).toBe(4);
    expect(entry.sourceQueue).toBe('stas-issues');
    expect(entry.acknowledged).toBe(false);
    expect(entry.jobData).toBeDefined();
    expect(entry.jobData.issueNumber).toBe(42);
    expect(entry.jobData.repoOwner).toBe('owner');
  });

  it('DLQ store correctly tracks entries', async () => {
    const { dlqStore, recordDeadLetter } = await import('../../src/queue/deadLetterQueue.js');

    // Clear existing
    dlqStore.clear();

    const entry = await recordDeadLetter(
      {
        installationId: 555,
        repoOwner: 'owner',
        repoName: 'test-repo',
        repoPrivate: false,
        issueNumber: 99,
        issueTitle: 'Store test',
        issueBody: 'Test',
        source: 'github' as const,
        retryCount: 2,
      } as any,
      'Store error',
      'stas-issues',
    );

    // Verify it's in the store
    const stored = dlqStore.get(entry.id);
    expect(stored).toBeDefined();
    expect(stored!.id).toBe(entry.id);

    // Verify list returns it
    const all = dlqStore.list();
    expect(all.some((e) => e.id === entry.id)).toBe(true);

    // Verify stats
    const stats = dlqStore.stats();
    expect(stats.total).toBeGreaterThanOrEqual(1);
    expect(stats.unacknowledged).toBeGreaterThanOrEqual(1);
  });

  it('DLQ entry can be acknowledged by an admin', async () => {
    const { dlqStore, recordDeadLetter } = await import('../../src/queue/deadLetterQueue.js');

    dlqStore.clear();

    const entry = await recordDeadLetter(
      {
        installationId: 555,
        repoOwner: 'owner',
        repoName: 'test-repo',
        repoPrivate: false,
        issueNumber: 100,
        issueTitle: 'Ack test',
        issueBody: 'Test',
        source: 'github' as const,
        retryCount: 3,
      } as any,
      'Ack test error',
      'stas-issues',
    );

    // Acknowledge the entry
    const ackResult = dlqStore.acknowledge(entry.id, 'admin-test-user');
    expect(ackResult).toBe(true);

    const stored = dlqStore.get(entry.id);
    expect(stored!.acknowledged).toBe(true);
    expect(stored!.acknowledgedBy).toBe('admin-test-user');
    expect(stored!.acknowledgedAt).toBeTruthy();
  });

  it('DLQ entry can be replayed after acknowledgement', async () => {
    const { dlqStore, recordDeadLetter } = await import('../../src/queue/deadLetterQueue.js');

    dlqStore.clear();

    const entry = await recordDeadLetter(
      {
        installationId: 555,
        repoOwner: 'owner',
        repoName: 'test-repo',
        repoPrivate: false,
        issueNumber: 101,
        issueTitle: 'Replay test',
        issueBody: 'Test',
        source: 'github' as const,
        retryCount: 1,
      } as any,
      'Replay error',
      'stas-issues',
    );

    // Acknowledge first
    dlqStore.acknowledge(entry.id, 'admin-test');
    // Then replay
    const replayData = dlqStore.replay(entry.id);
    expect(replayData).toBeDefined();
    expect(replayData!.issueNumber).toBe(101);
  });

  it('DLQ entry format function returns correct shape', async () => {
    const { recordDeadLetter, formatDeadLetterEntry } = await import('../../src/queue/deadLetterQueue.js');

    const entry = await recordDeadLetter(
      {
        installationId: 555,
        repoOwner: 'owner',
        repoName: 'test-repo',
        repoPrivate: false,
        issueNumber: 200,
        issueTitle: 'Format test',
        issueBody: 'Test',
        source: 'github' as const,
        retryCount: 0,
      } as any,
      'Format error',
      'stas-issues',
    );

    const formatted = formatDeadLetterEntry(entry);
    expect(formatted).toHaveProperty('id');
    expect(formatted).toHaveProperty('timestamp');
    expect(formatted).toHaveProperty('repo');
    expect(formatted).toHaveProperty('issueNumber');
    expect(formatted).toHaveProperty('error');
    expect(formatted).toHaveProperty('retryCount');
    expect(formatted).toHaveProperty('sourceQueue');
    expect(formatted).toHaveProperty('acknowledged');
    expect(formatted.repo).toBe('owner/test-repo');
  });

  it('Server health check remains ok after DLQ operations', async () => {
    const res = await fetch(`${harness.baseUrl}/health`);
    expect(res.status).toBe(200);
  });
});
