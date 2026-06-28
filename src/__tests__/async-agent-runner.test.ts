import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AsyncAgentRunner, getAsyncAgentRunner } from "../services/async-agent-runner.js";

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

describe("AsyncAgentRunner", () => {
  let runner: AsyncAgentRunner;

  beforeEach(() => {
    runner = new AsyncAgentRunner();
  });

  it("starts a session and returns a task ID", async () => {
    const taskId = await runner.startSession("session-test-1", {
      prompt: "Fix the bug in the login form",
      model: "deepseek-v4-flash",
      sessionTimeoutMs: 300_000,
    });
    expect(taskId).toBeTruthy();
    expect(typeof taskId).toBe("string");
  });

  it("returns null for unknown session", async () => {
    const result = await runner.getSessionResult("nonexistent");
    expect(result).toBeNull();
  });

  it("cancels a session", async () => {
    await runner.startSession("session-cancel-test", {
      prompt: "Test prompt",
      sessionTimeoutMs: 300_000,
    });
    await expect(
      runner.cancelSession("session-cancel-test"),
    ).resolves.toBeUndefined();
  });

  it("provides singleton instance", () => {
    const instance1 = getAsyncAgentRunner();
    const instance2 = getAsyncAgentRunner();
    expect(instance1).toBe(instance2);
  });
});
