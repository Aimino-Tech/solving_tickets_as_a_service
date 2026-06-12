/**
 * Unit tests for issue queue (src/queue/issueQueue.ts) — RabbitMQ-only.
 *
 * Covers: enqueueIssue function with RabbitMQ publish.
 * All external dependencies (producers, config) are mocked.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sampleJobData } from '../fixtures.js';

// ---------------------------------------------------------------------------
// Mocks — hoisted before imports by vitest
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const mockPublishFixJob = vi.fn<(...args: unknown[]) => Promise<boolean>>();
  return {
    mockPublishFixJob,
  };
});

vi.mock('../../config.js', () => ({
  config: {
    queue: {
      redisUrl: 'redis://localhost:6379',
      workerConcurrency: 2,
      dedupTtl: 120,
      keepCompleted: 200,
      keepFailed: 100,
      maxRetries: 4,
      retryDelays: [30000, 120000, 300000, 900000],
      backend: 'rabbitmq',
    },
  },
}));

vi.mock('../../utils/logger.js', () => ({
  rootLogger: {
    child: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      fatal: vi.fn(),
    })),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  },
}));

vi.mock('../../monitoring/sentry.js', () => ({
  addBreadcrumb: vi.fn(),
}));

// Mock producers module for enqueueIssue's dynamic import
vi.mock('../../queue/producers.js', () => ({
  publishFixJob: mocks.mockPublishFixJob,
}));

// ---------------------------------------------------------------------------
// Imports under test (mocks are already installed)
// ---------------------------------------------------------------------------

import { enqueueIssue } from '../../queue/issueQueue.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('enqueueIssue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('publishes a fix job and returns "rabbitmq" on success', async () => {
    mocks.mockPublishFixJob.mockResolvedValue(true);
    const data = sampleJobData();

    const result = await enqueueIssue(undefined, data);

    expect(result).toBe('rabbitmq');
    expect(mocks.mockPublishFixJob).toHaveBeenCalledWith(data);
  });

  it('returns undefined when publishFixJob returns false', async () => {
    mocks.mockPublishFixJob.mockResolvedValue(false);
    const data = sampleJobData();

    const result = await enqueueIssue(undefined, data);

    expect(result).toBeUndefined();
  });

  it('returns undefined when publishFixJob throws', async () => {
    mocks.mockPublishFixJob.mockRejectedValue(new Error('RabbitMQ connection refused'));
    const data = sampleJobData();

    const result = await enqueueIssue(undefined, data);

    expect(result).toBeUndefined();
  });

  it('calls publishFixJob with the correct job data', async () => {
    mocks.mockPublishFixJob.mockResolvedValue(true);
    const data = sampleJobData({ issueNumber: 99, repoName: 'my-repo' });

    await enqueueIssue(undefined, data);

    expect(mocks.mockPublishFixJob).toHaveBeenCalledWith(
      expect.objectContaining({
        issueNumber: 99,
        repoName: 'my-repo',
      }),
    );
  });
});
