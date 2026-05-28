/**
 * Unit tests for BullMQ job queue (src/queue/issueQueue.ts).
 *
 * Covers: Queue creation, worker processing, job dedup, event handling.
 * All external dependencies (bullmq, runIssueAgent, config) are mocked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { IssueJobData } from "../../utils/types.js";
import type { AgentResult } from "../../agent/types.js";

// ---------------------------------------------------------------------------
// Mocks — hoisted before imports by vitest
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const mockRunIssueAgent = vi.fn<(...args: unknown[]) => Partial<AgentResult>>();
  const mockQueueAdd = vi.fn<(name: string, data: IssueJobData, opts?: unknown) => Promise<{ id: string }>>();
  const mockQueueInstance = { add: mockQueueAdd, close: vi.fn() };
  const mockWorkerOn = vi.fn<(event: string, handler: unknown) => void>();
  const mockWorkerInstance = { on: mockWorkerOn, close: vi.fn() };
  const mockQueueEventsOn = vi.fn<(event: string, handler: unknown) => void>();
  const mockQueueEventsInstance = { on: mockQueueEventsOn, close: vi.fn() };

  /**
   * Mutable ref that captures the worker processor so tests
   * can invoke it directly without Redis.
   */
  const workerProcessorRef: {
    current: ((job: { id: string; data: IssueJobData }) => Promise<unknown>) | null;
  } = { current: null };

  return {
    mockRunIssueAgent,
    mockQueueAdd,
    mockQueueInstance,
    mockWorkerOn,
    mockWorkerInstance,
    mockQueueEventsOn,
    mockQueueEventsInstance,
    workerProcessorRef,
  };
});

vi.mock("../../agent/issueAgent.js", () => ({
  runIssueAgent: mocks.mockRunIssueAgent,
}));

vi.mock("../../config.js", () => ({
  config: {
    queue: {
      redisUrl: "redis://localhost:6379",
      workerConcurrency: 2,
      dedupTtl: 120,
      keepCompleted: 200,
      keepFailed: 100,
    },
  },
}));

vi.mock("../../utils/logger.js", () => ({
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

vi.mock("bullmq", () => ({
  Queue: vi.fn(() => mocks.mockQueueInstance),
  Worker: vi.fn(
    (
      _queueName: string,
      processor: (job: { id: string; data: IssueJobData }) => Promise<unknown>,
    ) => {
      mocks.workerProcessorRef.current = processor;
      return mocks.mockWorkerInstance;
    },
  ),
  QueueEvents: vi.fn(() => mocks.mockQueueEventsInstance),
}));

// ---------------------------------------------------------------------------
// Imports under test (mocks are already installed)
// ---------------------------------------------------------------------------

import { Queue, Worker, QueueEvents } from "bullmq";
import {
  createIssueQueue,
  createIssueWorker,
  createQueueEvents,
  enqueueIssue,
} from "../../queue/issueQueue.js";
import { sampleJobData, sampleAgentResult, sampleNoFixAgentResult } from "../fixtures.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createIssueQueue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

it("returns a Queue instance with stas-issues name and Redis connection", () => {
    const queue = createIssueQueue();
    expect(Queue).toHaveBeenCalledWith(
      "stas-issues",
      expect.objectContaining({
        connection: expect.objectContaining({
          url: "redis://localhost:6379",
          maxRetriesPerRequest: null,
          enableReadyCheck: true,
        }),
        defaultJobOptions: expect.objectContaining({
          attempts: 2,
          backoff: { type: "exponential", delay: 5000 },
          removeOnComplete: { count: 200 },
          removeOnFail: { count: 100 },
        }),
      }),
    );

    expect(queue).toBe(mocks.mockQueueInstance);
  });
});

describe("createIssueWorker", () => {
  beforeEach(() => {
    mocks.workerProcessorRef.current = null;
    vi.clearAllMocks();
  });

  it("returns a Worker instance with correct concurrency from config", () => {
    const worker = createIssueWorker();

    expect(Worker).toHaveBeenCalledWith(
      "stas-issues",
      expect.any(Function),
      expect.objectContaining({
        connection: expect.objectContaining({ url: "redis://localhost:6379" }),
        concurrency: 2,
      }),
    );

    expect(worker).toBe(mocks.mockWorkerInstance);
  });

  it("registers completed, failed, and error event handlers", () => {
    createIssueWorker();

    expect(mocks.mockWorkerOn).toHaveBeenCalledWith("completed", expect.any(Function));
    expect(mocks.mockWorkerOn).toHaveBeenCalledWith("failed", expect.any(Function));
    expect(mocks.mockWorkerOn).toHaveBeenCalledWith("error", expect.any(Function));
  });

  it("processes a job by calling runIssueAgent with job data and id", async () => {
    const data = sampleJobData();
    const agentResult = sampleAgentResult();
    mocks.mockRunIssueAgent.mockResolvedValue(agentResult);

    createIssueWorker();
    const output = await mocks.workerProcessorRef.current!({ id: "j-001", data });

    expect(mocks.mockRunIssueAgent).toHaveBeenCalledTimes(1);
    expect(mocks.mockRunIssueAgent).toHaveBeenCalledWith(data, "j-001");
    expect(output).toBe(agentResult);
  });

  it("returns the agent result even when fix is not ready", async () => {
    const data = sampleJobData({ issueNumber: 99 });
    const noFixResult = sampleNoFixAgentResult();
    mocks.mockRunIssueAgent.mockResolvedValue(noFixResult);

    createIssueWorker();
    const output = await mocks.workerProcessorRef.current!({ id: "j-002", data });

    expect(output).toBe(noFixResult);
    expect((output as AgentResult).fixReady).toBe(false);
    expect((output as AgentResult).noFixReason).toBe(
      "Issue could not be reproduced on latest main branch.",
    );
  });

  it("passes undefined job id when job.id is null", async () => {
    const data = sampleJobData();
    mocks.mockRunIssueAgent.mockResolvedValue(sampleAgentResult());

    createIssueWorker();
    // job.id ?? undefined — null triggers the fallback to undefined
    await mocks.workerProcessorRef.current!({ id: null as unknown as string, data });

    expect(mocks.mockRunIssueAgent).toHaveBeenCalledWith(data, undefined);
  });

  it("propagates worker concurrency value from config to Worker constructor", () => {
    createIssueWorker();

    expect(Worker).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Function),
      expect.objectContaining({ concurrency: 2 }),
    );
  });
});

describe("createQueueEvents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a QueueEvents instance with the queue name", () => {
    const events = createQueueEvents();

    expect(QueueEvents).toHaveBeenCalledWith(
      "stas-issues",
      expect.objectContaining({
        connection: expect.objectContaining({ url: "redis://localhost:6379" }),
      }),
    );

    expect(events).toBe(mocks.mockQueueEventsInstance);
  });

  it("registers completed and failed event handlers", () => {
    createQueueEvents();

    expect(mocks.mockQueueEventsOn).toHaveBeenCalledWith("completed", expect.any(Function));
    expect(mocks.mockQueueEventsOn).toHaveBeenCalledWith("failed", expect.any(Function));
  });
});

describe("enqueueIssue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("adds a job and returns the job id", async () => {
    mocks.mockQueueAdd.mockResolvedValue({ id: "job-foo-42" });
    const data = sampleJobData();

    const jobId = await enqueueIssue(mocks.mockQueueInstance as never, data);

    expect(jobId).toBe("job-foo-42");
  });

  it("calls queue.add with process-issue name, job data, and dedup options", async () => {
    mocks.mockQueueAdd.mockResolvedValue({ id: "j-1" });
    const data = sampleJobData();

    await enqueueIssue(mocks.mockQueueInstance as never, data);

    expect(mocks.mockQueueAdd).toHaveBeenCalledWith(
      "process-issue",
      data,
      expect.objectContaining({
        deduplication: expect.objectContaining({
          id: "issue:555:owner/test-repo#42",
          ttl: 120_000,
        }),
      }),
    );
  });

  it("returns undefined when queue.add throws (e.g. Redis unreachable)", async () => {
    mocks.mockQueueAdd.mockRejectedValue(new Error("Redis connection refused"));
    const data = sampleJobData();

    const jobId = await enqueueIssue(mocks.mockQueueInstance as never, data);

    expect(jobId).toBeUndefined();
  });

  it("generates the same dedup key for identical issue data", async () => {
    mocks.mockQueueAdd.mockResolvedValue({ id: "j-1" });
    const data = sampleJobData();

    await enqueueIssue(mocks.mockQueueInstance as never, data);
    await enqueueIssue(mocks.mockQueueInstance as never, data);

    expect(mocks.mockQueueAdd).toHaveBeenCalledTimes(2);
    expect(mocks.mockQueueAdd).toHaveBeenNthCalledWith(
      1,
      "process-issue",
      data,
      expect.objectContaining({
        deduplication: expect.objectContaining({ id: "issue:555:owner/test-repo#42" }),
      }),
    );
    expect(mocks.mockQueueAdd).toHaveBeenNthCalledWith(
      2,
      "process-issue",
      data,
      expect.objectContaining({
        deduplication: expect.objectContaining({ id: "issue:555:owner/test-repo#42" }),
      }),
    );
  });

  it("generates different dedup keys for different repos", async () => {
    mocks.mockQueueAdd.mockResolvedValue({ id: "j-1" });
    const data1 = sampleJobData({ repoName: "repo-a" });
    const data2 = sampleJobData({ repoName: "repo-b" });

    await enqueueIssue(mocks.mockQueueInstance as never, data1);
    await enqueueIssue(mocks.mockQueueInstance as never, data2);

    const opts1 = mocks.mockQueueAdd.mock.calls[0][2] as { deduplication: { id: string } };
    const opts2 = mocks.mockQueueAdd.mock.calls[1][2] as { deduplication: { id: string } };
    expect(opts1.deduplication.id).not.toBe(opts2.deduplication.id);
  });
});
