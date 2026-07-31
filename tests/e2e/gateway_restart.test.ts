import { describe, expect, it, vi } from "vitest";
import { ChatGateway } from "../../src/chat/gateway.js";
import type { PodHandle } from "../../src/chat/gateway.js";
import { MemoryChatSessionStore } from "../../src/chat/sessionStore.js";

function podHandle(): PodHandle {
  return {
    userId: "u1",
    sessionId: "s1",
    lastHeartbeat: 0,
    send: vi.fn(),
    close: vi.fn(),
  };
}

describe("gateway restart (US5)", () => {
  it("pods reconnect and the conversation continues after a restart", async () => {
    const store = new MemoryChatSessionStore();
    const gateway1 = new ChatGateway(store);
    const pod1 = podHandle();
    gateway1.registerPod("u1", pod1);

    const first = await gateway1.route({
      threadTs: "t1",
      channelId: "c1",
      userId: "u1",
      text: "first",
      ts: "t1",
    });
    expect(first.delivered).toBe(true);

    gateway1.shutdown();

    const gateway2 = new ChatGateway(store);
    const pod2 = podHandle();
    gateway2.registerPod("u1", pod2);

    const second = await gateway2.route({
      threadTs: "t1",
      channelId: "c1",
      userId: "u1",
      text: "second",
      ts: "t1",
    });

    expect(second.delivered).toBe(true);
    expect(second.sessionId).toBe(first.sessionId);
    expect(pod2.send).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "dispatch", text: "second" }),
    );
  });
});
