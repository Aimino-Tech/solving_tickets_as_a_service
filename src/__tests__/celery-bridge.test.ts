import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CeleryBridge, getCeleryBridge } from "../services/celery-bridge.js";

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

describe("CeleryBridge", () => {
  let bridge: CeleryBridge;

  beforeEach(() => {
    bridge = new CeleryBridge();
  });

  afterEach(async () => {
    await bridge.shutdown();
  });

  it("dispatches a task", async () => {
    const taskId = await bridge.sendTask({
      taskName: "workers.tasks.agent_session.execute_agent_session",
      args: ["session-1", {}, "test prompt"],
      queue: "celery",
    });
    expect(taskId).toBeTruthy();
    expect(typeof taskId).toBe("string");
  });

  it("dispatches a task with timeout limits", async () => {
    const taskId = await bridge.sendTask({
      taskName: "workers.tasks.agent_session.execute_agent_session",
      args: ["session-2", {}, "test prompt"],
      softTimeLimit: 300,
      hardTimeLimit: 360,
    });
    expect(taskId).toBeTruthy();
  });

  it("revokes a task", async () => {
    await expect(
      bridge.revokeTask("mock-task-id"),
    ).resolves.toBeUndefined();
  });

  it("provides singleton instance", () => {
    const instance1 = getCeleryBridge();
    const instance2 = getCeleryBridge();
    expect(instance1).toBe(instance2);
  });
});
