import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockEnqueueIssue } = vi.hoisted(() => ({
  mockEnqueueIssue: vi
    .fn<(queue: unknown, data: unknown) => Promise<string | undefined>>()
    .mockResolvedValue("job-mock-id"),
}));

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
    stas: { label: "stas:fix" },
    gitlab: { url: "https://gitlab.com", token: "test-token", webhookSecret: "test-secret" },
  },
}));

vi.mock("../../queue/issueQueue.js", () => ({
  enqueueIssue: mockEnqueueIssue,
}));

import { gitlabWebhook, gitlabClient, createGitlabWebhooks } from "../../webhooks/gitlab.js";
import type { PlatformWebhookEvent } from "../../webhooks/base.js";

function createMockQueue() {
  return {
    add: vi.fn().mockResolvedValue({ id: "job-1" }),
    close: vi.fn().mockResolvedValue(undefined),
    on: vi.fn().mockReturnThis(),
    getJob: vi.fn().mockResolvedValue(null),
    getJobs: vi.fn().mockResolvedValue([]),
    obliterate: vi.fn().mockResolvedValue(undefined),
  };
}

function sampleGitLabIssueOpenedPayload() {
  return {
    object_kind: "issue",
    event_type: "issue",
    user: { username: "testuser", id: 123 },
    project: {
      id: 1,
      name: "test-repo",
      namespace: "owner",
      path_with_namespace: "owner/test-repo",
      visibility_level: 20,
      web_url: "https://gitlab.com/owner/test-repo",
    },
    object_attributes: {
      id: 100,
      iid: 42,
      title: "Fix broken login",
      description: "Users cannot log in",
      state: "opened",
      url: "https://gitlab.com/owner/test-repo/-/issues/42",
      action: "open",
      labels: [],
    },
    labels: [],
  };
}

function sampleGitLabIssueLabeledPayload() {
  return {
    object_kind: "issue",
    event_type: "issue",
    user: { username: "testuser", id: 123 },
    project: {
      id: 1,
      name: "test-repo",
      namespace: "owner",
      path_with_namespace: "owner/test-repo",
      visibility_level: 20,
      web_url: "https://gitlab.com/owner/test-repo",
    },
    object_attributes: {
      id: 100,
      iid: 42,
      title: "Fix broken login",
      description: "Users cannot log in",
      state: "opened",
      url: "https://gitlab.com/owner/test-repo/-/issues/42",
      action: "update",
      labels: [{ title: "stas:fix" }],
    },
    labels: [{ title: "stas:fix" }],
  };
}

function sampleGitLabMergeRequestPayload() {
  return {
    object_kind: "merge_request",
    event_type: "merge_request",
    project: {
      id: 1,
      name: "test-repo",
      namespace: "owner",
      path_with_namespace: "owner/test-repo",
      visibility_level: 20,
    },
    object_attributes: {
      id: 200,
      iid: 10,
      title: "Add new feature",
      description: "Description of the MR",
      state: "opened",
      action: "open",
      source_branch: "feature-branch",
      target_branch: "main",
      url: "https://gitlab.com/owner/test-repo/-/merge_requests/10",
    },
  };
}

describe("gitlabWebhook", () => {
  describe("verify", () => {
    it("returns true when token matches secret", () => {
      expect(gitlabWebhook.verify("{}", "my-secret", "my-secret")).toBe(true);
    });

    it("returns false when token does not match secret", () => {
      expect(gitlabWebhook.verify("{}", "wrong-token", "my-secret")).toBe(false);
    });
  });

  describe("parse", () => {
    it("parses issue open event", () => {
      const result = gitlabWebhook.parse("Issue Hook", sampleGitLabIssueOpenedPayload());
      expect(result).not.toBeNull();
      expect(result!.platform).toBe("gitlab");
      expect(result!.eventType).toBe("issue.opened");
      expect(result!.issue.number).toBe(42);
      expect(result!.issue.title).toBe("Fix broken login");
      expect(result!.issue.repoOwner).toBe("owner");
      expect(result!.issue.repoName).toBe("test-repo");
    });

    it("parses issue labeled event (update with stas:fix label)", () => {
      const result = gitlabWebhook.parse("Issue Hook", sampleGitLabIssueLabeledPayload());
      expect(result).not.toBeNull();
      expect(result!.eventType).toBe("issue.edited");
      expect(result!.issue.labels).toContain("stas:fix");
    });

    it("returns null for non-matching event type", () => {
      const result = gitlabWebhook.parse("Push Hook", {});
      expect(result).toBeNull();
    });

    it("parses merge request hook", () => {
      const result = gitlabWebhook.parse("Merge Request Hook", sampleGitLabMergeRequestPayload());
      expect(result).not.toBeNull();
      expect(result!.eventType).toBe("pull_request.created");
    });

    it("returns null for close action", () => {
      const payload = sampleGitLabIssueOpenedPayload();
      payload.object_attributes.action = "close";
      const result = gitlabWebhook.parse("Issue Hook", payload);
      expect(result).toBeNull();
    });
  });
});

describe("gitlabClient", () => {
  describe("toIssueJobData", () => {
    it("converts a PlatformWebhookEvent to IssueJobData", () => {
      const event: PlatformWebhookEvent = {
        platform: "gitlab",
        eventType: "issue.opened",
        issue: {
          id: 100,
          number: 42,
          title: "Fix bug",
          body: "Bug description",
          labels: ["stas:fix"],
          repoOwner: "owner",
          repoName: "test-repo",
          repoPrivate: false,
        },
        raw: {},
      };

      const jobData = gitlabClient.toIssueJobData(event);
      expect(jobData.repoOwner).toBe("owner");
      expect(jobData.repoName).toBe("test-repo");
      expect(jobData.issueNumber).toBe(42);
      expect(jobData.issueTitle).toBe("Fix bug");
      expect(jobData.source).toBe("gitlab");
    });
  });
});

describe("createGitlabWebhooks", () => {
  let mockQueue: ReturnType<typeof createMockQueue>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockEnqueueIssue.mockResolvedValue("job-mock-id");
    mockQueue = createMockQueue();
  });

  it("enqueues a job for issue updated with target label", async () => {
    const handler = createGitlabWebhooks();
    await handler.handle("Issue Hook", sampleGitLabIssueLabeledPayload());

    expect(mockEnqueueIssue).toHaveBeenCalledTimes(1);
    expect(mockEnqueueIssue).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({
        repoOwner: "owner",
        repoName: "test-repo",
        issueNumber: 42,
        issueTitle: "Fix broken login",
        source: "gitlab",
      }),
    );
  });

  it("does NOT enqueue for issue open without label", async () => {
    const handler = createGitlabWebhooks();
    await handler.handle("Issue Hook", sampleGitLabIssueOpenedPayload());

    expect(mockEnqueueIssue).not.toHaveBeenCalled();
  });

  it("does NOT enqueue for non-matching event types", async () => {
    const handler = createGitlabWebhooks();
    await handler.handle("Push Hook", {});

    expect(mockEnqueueIssue).not.toHaveBeenCalled();
  });

  it("does NOT enqueue for update without target label", async () => {
    const payload = sampleGitLabIssueLabeledPayload();
    payload.object_attributes.labels = [{ title: "other-label" }];
    payload.labels = [{ title: "other-label" }];

    const handler = createGitlabWebhooks();
    await handler.handle("Issue Hook", payload);

    expect(mockEnqueueIssue).not.toHaveBeenCalled();
  });
});
