import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TaskQueue, getTaskQueue } from "../services/task-queue.js";
import type { PendingTask } from "../services/task-queue.js";

vi.mock("amqplib", () => {
  const mockChannel = {
    assertExchange: vi.fn().mockResolvedValue(undefined),
    assertQueue: vi.fn().mockResolvedValue({ queue: "mock-queue", messageCount: 0, consumerCount: 0 }),
    bindQueue: vi.fn().mockResolvedValue(undefined),
    consume: vi.fn().mockResolvedValue({ consumerTag: "mock-consumer-tag" }),
    sendToQueue: vi.fn().mockReturnValue(true),
    publish: vi.fn().mockReturnValue(true),
    ack: vi.fn(),
    nack: vi.fn(),
    cancel: vi.fn().mockResolvedValue(undefined),
    prefetch: vi.fn().mockResolvedValue(undefined),
    checkQueue: vi.fn().mockResolvedValue({ messageCount: 3, consumerCount: 1 }),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const mockConnection = {
    createChannel: vi.fn().mockResolvedValue(mockChannel),
    close: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  };
  return {
    default: {
      connect: vi.fn().mockResolvedValue(mockConnection),
    },
    connect: vi.fn().mockResolvedValue(mockConnection),
  };
});

describe("TaskQueue", () => {
  let queue: TaskQueue;

  beforeEach(() => {
    queue = new TaskQueue();
  });

  afterEach(async () => {
    await queue.shutdown();
  });

  it("adds a task and returns a task ID", async () => {
    const taskId = await queue.addTask("test", { foo: "bar" });
    expect(taskId).toBeTruthy();
    expect(typeof taskId).toBe("string");
  });

  it("adds a task with custom priority", async () => {
    const taskId = await queue.addTask("priority-test", { data: "high" }, { priority: 1 });
    expect(taskId).toBeTruthy();
  });

  it("adds a task with custom max retries", async () => {
    const taskId = await queue.addTask("retry-test", { data: "test" }, { maxRetries: 5 });
    expect(taskId).toBeTruthy();
  });

  it("gets queue status", async () => {
    const status = await queue.getQueueStatus("test-type");
    expect(status).toHaveProperty("pending");
    expect(status).toHaveProperty("active");
  });

  it("starts and stops a consumer", async () => {
    const handler = vi.fn().mockResolvedValue({ ok: true });
    await queue.startConsumer("consumer-test", handler, { concurrency: 3 });
    await queue.stopConsumer("consumer-test");
  });

  it("emits task:update events", async () => {
    const handler = vi.fn();
    queue.onUpdate(handler);
    await queue.addTask("events-test", { data: 1 });
    expect(handler).toHaveBeenCalled();
    queue.offUpdate(handler);
  });

  it("provides singleton instance", () => {
    const instance1 = getTaskQueue();
    const instance2 = getTaskQueue();
    expect(instance1).toBe(instance2);
  });
});
