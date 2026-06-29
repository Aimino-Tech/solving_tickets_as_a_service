import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IssueJobData } from '../../utils/types.js';

const mocks = vi.hoisted(() => {
  const mockPublishMessage = vi.fn();
  const mockConsumeQueue = vi.fn();
  const mockGetChannel = vi.fn(() => ({ ack: vi.fn(), nack: vi.fn() }));
  const mockAcquireRepoLock = vi.fn();
  const mockReleaseRepoLock = vi.fn();
  const mockRunIssueAgent = vi.fn();

  return {
    mockPublishMessage,
    mockConsumeQueue,
    mockGetChannel,
    mockAcquireRepoLock,
    mockReleaseRepoLock,
    mockRunIssueAgent,
  };
});

vi.mock('../../queue/rabbitmq.js', () => ({
  getChannel: mocks.mockGetChannel,
  publishMessage: mocks.mockPublishMessage,
  consumeQueue: mocks.mockConsumeQueue,
}));

vi.mock('../../queue/repoLock.js', () => ({
  acquireRepoLock: mocks.mockAcquireRepoLock,
  releaseRepoLock: mocks.mockReleaseRepoLock,
}));

vi.mock('../../agent/issueAgent.js', () => ({
  runIssueAgent: mocks.mockRunIssueAgent,
}));

vi.mock('../../config.js', () => ({
  config: {
    queue: {
      maxRetries: 4,
      retryDelays: [30000, 120000, 300000, 900000],
      dedupTtl: 120,
      workerConcurrency: 2,
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
    })),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../bridge/metrics.js', () => ({
  bridgeMetrics: {
    incrementCounter: vi.fn(),
    setGauge: vi.fn(),
  },
}));

vi.mock('../../github/messages.js', () => ({
  deadLetterComment: vi.fn(() => 'DLQ comment'),
  queueRetryComment: vi.fn(() => 'Retry comment'),
}));

const sampleData: IssueJobData = {
  installationId: 555,
  repoOwner: 'owner',
  repoName: 'test-repo',
  repoPrivate: false,
  issueNumber: 42,
  issueTitle: 'Fix broken login',
  issueBody: 'Users cannot log in',
};

describe('rabbitmqIssueQueue enqueueIssue', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.mockPublishMessage.mockResolvedValue(true);
    const { clearDedupCache } = await import('../../queue/rabbitmqIssueQueue.js');
    clearDedupCache();
  });

  it('publishes a message to the issue exchange', async () => {
    const { enqueueIssue } = await import('../../queue/rabbitmqIssueQueue.js');
    const result = await enqueueIssue(sampleData);

    expect(result).toBeTruthy();
    expect(mocks.mockPublishMessage).toHaveBeenCalledWith(
      'stas.direct',
      'issue.fix',
      sampleData,
      expect.objectContaining({
        persistent: true,
        headers: expect.objectContaining({
          'x-dedup-key': 'issue:555:owner/test-repo#42',
          'x-retry-count': '0',
        }),
      }),
    );
  });

  it('returns undefined when publish fails', async () => {
    mocks.mockPublishMessage.mockResolvedValue(false);
    const { enqueueIssue } = await import('../../queue/rabbitmqIssueQueue.js');
    const result = await enqueueIssue(sampleData);
    expect(result).toBeUndefined();
  });

  it('returns undefined on publish error', async () => {
    mocks.mockPublishMessage.mockRejectedValue(new Error('connection lost'));
    const { enqueueIssue } = await import('../../queue/rabbitmqIssueQueue.js');
    const result = await enqueueIssue(sampleData);
    expect(result).toBeUndefined();
  });

  it('detects duplicate messages within dedup TTL', async () => {
    const { enqueueIssue } = await import('../../queue/rabbitmqIssueQueue.js');
    await enqueueIssue(sampleData);
    const duplicate = await enqueueIssue(sampleData);
    expect(duplicate).toBeUndefined();
    expect(mocks.mockPublishMessage).toHaveBeenCalledTimes(1);
  });
});

describe('rabbitmqIssueQueue createIssueWorker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockAcquireRepoLock.mockResolvedValue(true);
    mocks.mockReleaseRepoLock.mockResolvedValue(undefined);
    mocks.mockRunIssueAgent.mockResolvedValue({ fixReady: true, confidence: 0.95, prUrl: 'https://github.com/owner/test-repo/pull/1' });
    mocks.mockConsumeQueue.mockImplementation(async (_queue: string, handler: (msg: unknown) => Promise<void>) => {});
  });

  it('starts consuming from the issue queue', async () => {
    const { createIssueWorker } = await import('../../queue/rabbitmqIssueQueue.js');
    await createIssueWorker();

    expect(mocks.mockConsumeQueue).toHaveBeenCalledWith(
      'stas.issues.fix',
      expect.any(Function),
      { noAck: false },
    );
  });
});
