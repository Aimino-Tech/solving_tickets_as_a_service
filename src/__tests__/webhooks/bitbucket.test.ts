import crypto from "node:crypto";
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockLogger } = vi.hoisted(() => {
  const logger = {
    child: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    silent: vi.fn(),
    level: "silent",
  };
  logger.child = vi.fn(() => logger);
  return { mockLogger: logger };
});

vi.mock("../../utils/logger.js", () => ({
  rootLogger: mockLogger,
}));

vi.mock("../../config.js", () => ({
  config: {
    syntaro: { label: "syntaro:fix" },
    bitbucket: {
      username: "testuser",
      appPassword: "test-password",
      webhookSecret: "test-secret",
    },
  },
}));



import { bitbucketWebhook, createBitbucketWebhooks } from "../../webhooks/bitbucket.js";
import type { PlatformWebhookEvent } from "../../webhooks/base.js";

const mockEnqueue = vi.fn<(...args: unknown[]) => Promise<string | undefined>>().mockResolvedValue("job-mock-id");

function sampleBitbucketIssueCreatedPayload() {
  return {
    event: "issue:created",
    actor: { username: "testuser", uuid: "{abc-123}" },
    repository: {
      uuid: "{repo-uuid}",
      name: "test-repo",
      full_name: "owner/test-repo",
      owner: { username: "owner" },
      is_private: false,
    },
    issue: {
      id: 42,
      title: "Fix broken login",
      content: { raw: "Users cannot log in" },
      state: "new",
      kind: "bug",
      priority: "major",
    },
  };
}

function sampleBitbucketPullRequestCreatedPayload() {
  return {
    event: "pullrequest:created",
    actor: { username: "testuser", uuid: "{abc-123}" },
    repository: {
      uuid: "{repo-uuid}",
      name: "test-repo",
      full_name: "owner/test-repo",
      owner: { username: "owner" },
      is_private: false,
    },
    pullrequest: {
      id: 10,
      title: "Add new feature",
      description: "Description of the PR",
      state: "OPEN",
      source: { branch: { name: "feature-branch" } },
      destination: { branch: { name: "main" } },
      links: { html: { href: "https://bitbucket.org/owner/test-repo/pull-requests/10" } },
    },
  };
}

describe("bitbucketWebhook", () => {
  describe("verify", () => {
    it("returns true for valid HMAC-SHA256 signature", () => {
      const payload = JSON.stringify({ test: "data" });
      const expected = crypto.createHmac("sha256", "test-secret").update(payload, "utf8").digest("hex");
      const signature = `sha256=${expected}`;
      expect(bitbucketWebhook.verify(payload, signature, "test-secret")).toBe(true);
    });

    it("returns false for invalid signature", () => {
      expect(bitbucketWebhook.verify("{}", "sha256=invalid", "test-secret")).toBe(false);
    });

    it("returns false for mismatched length signature", () => {
      expect(bitbucketWebhook.verify("{}", "sha256=short", "test-secret")).toBe(false);
    });
  });

  describe("parse", () => {
    it("parses issue created event", () => {
      const result = bitbucketWebhook.parse("issue:created", sampleBitbucketIssueCreatedPayload());
      expect(result).not.toBeNull();
      expect(result!.platform).toBe("bitbucket");
      expect(result!.eventType).toBe("issue.opened");
      expect(result!.issue.number).toBe(42);
      expect(result!.issue.title).toBe("Fix broken login");
      expect(result!.issue.repoOwner).toBe("owner");
      expect(result!.issue.repoName).toBe("test-repo");
    });

    it("parses pull request created event", () => {
      const result = bitbucketWebhook.parse("pullrequest:created", sampleBitbucketPullRequestCreatedPayload());
      expect(result).not.toBeNull();
      expect(result!.eventType).toBe("pull_request.created");
      expect(result!.issue.number).toBe(10);
    });

    it("returns null for missing event field", () => {
      const result = bitbucketWebhook.parse("", {});
      expect(result).toBeNull();
    });

    it("returns null for unsupported event types", () => {
      const result = bitbucketWebhook.parse("repo:push", { event: "repo:push" });
      expect(result).toBeNull();
    });
  });
});

describe("createBitbucketWebhooks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnqueue.mockResolvedValue("job-mock-id");
    mockEnqueue.mockClear();
  });

  it("enqueues a job for issue created event", async () => {
    const handler = createBitbucketWebhooks(mockEnqueue);

    const rawPayload = JSON.stringify(sampleBitbucketIssueCreatedPayload());
    const expected = crypto.createHmac("sha256", "test-secret").update(rawPayload, "utf8").digest("hex");
    const signature = `sha256=${expected}`;

    await handler.handle(rawPayload, signature);

    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        repoOwner: "owner",
        repoName: "test-repo",
        issueNumber: 42,
        issueTitle: "Fix broken login",
      }),
    );
  });

  it("does NOT enqueue for pull request created events", async () => {
    const handler = createBitbucketWebhooks(mockEnqueue);

    const rawPayload = JSON.stringify(sampleBitbucketPullRequestCreatedPayload());
    const expected = crypto.createHmac("sha256", "test-secret").update(rawPayload, "utf8").digest("hex");
    const signature = `sha256=${expected}`;

    await handler.handle(rawPayload, signature);

    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("does NOT enqueue when signature verification fails", async () => {
    const handler = createBitbucketWebhooks(mockEnqueue);
    await handler.handle(JSON.stringify({ event: "issue:created" }), "sha256=invalid");

    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("does NOT enqueue for non-matching events", async () => {
    const handler = createBitbucketWebhooks(mockEnqueue);

    const rawPayload = JSON.stringify({ event: "repo:push" });
    const expected = crypto.createHmac("sha256", "test-secret").update(rawPayload, "utf8").digest("hex");
    const signature = `sha256=${expected}`;

    await handler.handle(rawPayload, signature);

    expect(mockEnqueue).not.toHaveBeenCalled();
  });
});
