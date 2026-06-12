/**
 * Unit tests for RabbitMQ producer functions (src/queue/producers.ts).
 *
 * Covers: publishFixJob, publishTriageJob, deduplication, retry headers,
 * envelope format, and error handling when Redis/RabbitMQ is unavailable.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IssueJobData, TriageData } from '../../utils/types.js';
import { sampleJobData } from '../fixtures.js';

// ---------------------------------------------------------------------------
// Mocks — hoisted before imports by vitest
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const mockRedisSet = vi.fn();
  const mockRedisQuit = vi.fn();
  const mockPublish = vi.fn();
  const mockIsConnected = vi.fn();
  const mockConnect = vi.fn();

  return {
    mockRedisSet,
    mockRedisQuit,
    mockPublish,
    mockIsConnected,
    mockConnect,
  };
});

vi.mock('ioredis', () => {
  return {
    default: vi.fn(() => ({
      set: mocks.mockRedisSet,
      quit: mocks.mockRedisQuit,
    })),
  };
});

vi.mock('../../queue/rabbitmq.js', () => ({
  connect: mocks.mockConnect,
  publish: mocks.mockPublish,
  isConnected: mocks.mockIsConnected,
}));

vi.mock('../../config.js', () => ({
  config: {
    queue: {
      redisUrl: 'redis://localhost:6379',
      dedupTtl: 120,
      backend: 'rabbitmq',
    },
    rabbitmq: {
      url: 'amqp://localhost:5672/stas',
    },
  },
}));

vi.mock('../../utils/logger.js', () => ({
  rootLogger: {
    child: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

// ---------------------------------------------------------------------------
// Imports under test
// ---------------------------------------------------------------------------

import { publishFixJob, publishTriageJob } from '../../queue/producers.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sampleTriageData(overrides?: Partial<TriageData>): TriageData {
  return {
    installationId: 555,
    repoOwner: 'owner',
    repoName: 'test-repo',
    repoPrivate: false,
    issueNumber: 42,
    issueTitle: 'Fix broken user login',
    issueBody: 'Users are unable to log in when the password contains special characters.',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('publishFixJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('publishes a fix job with correct envelope format', async () => {
    mocks.mockRedisSet.mockResolvedValue('OK' as never);
    mocks.mockIsConnected.mockReturnValue(true);
    mocks.mockPublish.mockResolvedValue(true);

    const data = sampleJobData();
    const result = await publishFixJob(data);

    expect(result).toBe(true);

    // Verify RabbitMQ publish was called with correct exchange and routing key
    expect(mocks.mockPublish).toHaveBeenCalledWith(
      'stas.issues',
      'fix',
      expect.objectContaining({
        version: 1,
        source: 'stas-bot',
        type: 'fix',
        payload: expect.objectContaining({
          installationId: 555,
          repoOwner: 'owner',
          issueNumber: 42,
        }),
      }),
      expect.objectContaining({
        persistent: true,
        expiration: '120000',
        headers: {},
      }),
    );
  });

  it('sets x-retry-count header when retryCount is provided', async () => {
    mocks.mockRedisSet.mockResolvedValue('OK' as never);
    mocks.mockIsConnected.mockReturnValue(true);
    mocks.mockPublish.mockResolvedValue(true);

    const data = sampleJobData();
    await publishFixJob(data, { retryCount: 2 });

    expect(mocks.mockPublish).toHaveBeenCalledWith(
      'stas.issues',
      'fix',
      expect.any(Object),
      expect.objectContaining({
        headers: { 'x-retry-count': '2' },
      }),
    );
  });

  it('returns false when dedup detects a duplicate', async () => {
    // Redis SET NX returns null when key already exists
    mocks.mockRedisSet.mockResolvedValue(null as never);

    const data = sampleJobData();
    const result = await publishFixJob(data);

    expect(result).toBe(false);
    expect(mocks.mockPublish).not.toHaveBeenCalled();
  });

  it('allows publish when Redis is unavailable', async () => {
    mocks.mockRedisSet.mockRejectedValue(new Error('Redis connection refused') as never);
    mocks.mockIsConnected.mockReturnValue(true);
    mocks.mockPublish.mockResolvedValue(true);

    const data = sampleJobData();
    const result = await publishFixJob(data);

    // Should still try to publish despite Redis failure
    expect(result).toBe(true);
    expect(mocks.mockPublish).toHaveBeenCalled();
  });

  it('returns false when RabbitMQ is not connected and connect fails', async () => {
    mocks.mockRedisSet.mockResolvedValue('OK' as never);
    mocks.mockIsConnected.mockReturnValue(false);
    mocks.mockConnect.mockRejectedValue(new Error('Connection refused') as never);

    const data = sampleJobData();
    const result = await publishFixJob(data);

    expect(result).toBe(false);
    expect(mocks.mockPublish).not.toHaveBeenCalled();
  });

  it('returns false when RabbitMQ publish returns false', async () => {
    mocks.mockRedisSet.mockResolvedValue('OK' as never);
    mocks.mockIsConnected.mockReturnValue(true);
    mocks.mockPublish.mockResolvedValue(false);

    const data = sampleJobData();
    const result = await publishFixJob(data);

    expect(result).toBe(false);
  });

  it('includes correlationId and replyTo in envelope when provided', async () => {
    mocks.mockRedisSet.mockResolvedValue('OK' as never);
    mocks.mockIsConnected.mockReturnValue(true);
    mocks.mockPublish.mockResolvedValue(true);

    const data = sampleJobData();
    await publishFixJob(data, {
      correlationId: 'corr-123',
      replyTo: 'stas.agents.verification',
    });

    expect(mocks.mockPublish).toHaveBeenCalledWith(
      'stas.issues',
      'fix',
      expect.objectContaining({
        correlationId: 'corr-123',
        replyTo: 'stas.agents.verification',
      }),
      expect.any(Object),
    );
  });
});

describe('publishTriageJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('publishes a triage job with correct routing', async () => {
    mocks.mockRedisSet.mockResolvedValue('OK' as never);
    mocks.mockIsConnected.mockReturnValue(true);
    mocks.mockPublish.mockResolvedValue(true);

    const data = sampleTriageData();
    const result = await publishTriageJob(data);

    expect(result).toBe(true);

    expect(mocks.mockPublish).toHaveBeenCalledWith(
      'stas.agents',
      'triage',
      expect.objectContaining({
        version: 1,
        source: 'stas-bot',
        type: 'triage',
      }),
      expect.objectContaining({
        persistent: true,
        expiration: '120000',
      }),
    );
  });

  it('returns false on duplicate triage job', async () => {
    mocks.mockRedisSet.mockResolvedValue(null as never);

    const data = sampleTriageData();
    const result = await publishTriageJob(data);

    expect(result).toBe(false);
    expect(mocks.mockPublish).not.toHaveBeenCalled();
  });

  it('uses different dedup key prefix than fix jobs', async () => {
    mocks.mockRedisSet.mockResolvedValue('OK' as never);
    mocks.mockIsConnected.mockReturnValue(true);
    mocks.mockPublish.mockResolvedValue(true);

    const data = sampleTriageData({ issueNumber: 99 });
    await publishTriageJob(data);

    // Verify dedup key prefix is "triage:" not "fix:"
    expect(mocks.mockRedisSet).toHaveBeenCalledWith(
      expect.stringContaining('triage:'),
      '1',
      'PX',
      120000,
      'NX',
    );
  });

  it('propagates retry count in headers', async () => {
    mocks.mockRedisSet.mockResolvedValue('OK' as never);
    mocks.mockIsConnected.mockReturnValue(true);
    mocks.mockPublish.mockResolvedValue(true);

    await publishTriageJob(sampleTriageData(), { retryCount: 1 });

    expect(mocks.mockPublish).toHaveBeenCalledWith(
      'stas.agents',
      'triage',
      expect.any(Object),
      expect.objectContaining({
        headers: { 'x-retry-count': '1' },
      }),
    );
  });
});
