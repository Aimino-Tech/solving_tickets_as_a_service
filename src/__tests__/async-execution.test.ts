import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AsyncExecutionManager, getAsyncExecutionManager, type ExecutionState } from "../services/async-execution.js";

vi.mock("amqplib", () => {
  const mockChannel = {
    assertExchange: vi.fn().mockResolvedValue(undefined),
    assertQueue: vi.fn().mockResolvedValue({ queue: "mock-queue" }),
    bindQueue: vi.fn().mockResolvedValue(undefined),
    consume: vi.fn().mockResolvedValue({ consumerTag: "mock-tag" }),
    publish: vi.fn().mockReturnValue(true),
    ack: vi.fn(),
    cancel: vi.fn().mockResolvedValue(undefined),
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

vi.mock("ioredis", () => {
  const RedisMock = vi.fn(() => ({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue("OK"),
    on: vi.fn(),
  }));
  return { default: RedisMock };
});

describe("AsyncExecutionManager", () => {
  let manager: AsyncExecutionManager;

  beforeEach(() => {
    manager = new AsyncExecutionManager();
  });

  afterEach(async () => {
    await manager.shutdown();
  });

  it("registers an execution", async () => {
    await manager.registerExecution("test-1", { source: "test" });
    const state = await manager.getExecution("test-1");
    expect(state).not.toBeNull();
    expect(state!.id).toBe("test-1");
    expect(state!.status).toBe("registered");
  });

  it("updates execution status", async () => {
    await manager.registerExecution("test-2");
    await manager.updateStatus("test-2", "running");
    const state = await manager.getExecution("test-2");
    expect(state!.status).toBe("running");
  });

  it("cancels an execution", async () => {
    await manager.registerExecution("test-3");
    await manager.cancelExecution("test-3");
    const state = await manager.getExecution("test-3");
    expect(state!.status).toBe("cancelled");
  });

  it("emits execution:update events", async () => {
    const handler = vi.fn();
    manager.onUpdate(handler);
    await manager.registerExecution("test-4");
    expect(handler).toHaveBeenCalled();
    manager.offUpdate(handler);
  });

  it("emits execution:complete event", async () => {
    const handler = vi.fn();
    manager.onComplete(handler);
    await manager.registerExecution("test-5");
    await manager.updateStatus("test-5", "completed", { url: "https://example.com" });
    expect(handler).toHaveBeenCalled();
    manager.offComplete(handler);
  });

  it("returns null for unknown execution", async () => {
    const state = await manager.getExecution("nonexistent");
    expect(state).toBeNull();
  });

  it("provides singleton instance", () => {
    const instance1 = getAsyncExecutionManager();
    const instance2 = getAsyncExecutionManager();
    expect(instance1).toBe(instance2);
  });
});
