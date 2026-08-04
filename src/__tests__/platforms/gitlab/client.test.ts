/**
 * Unit tests for GitLabPlatformClient.
 *
 * Tests each method against mocked fetch responses to verify:
 * - Correct API endpoint construction
 * - Proper header propagation (PRIVATE-TOKEN, Content-Type)
 * - Response mapping from GitLab JSON shapes to normalized interfaces
 * - Error handling for non-2xx responses
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GitLabPlatformClient } from "../../../platforms/gitlab/index.js";
import type { CreatePRParams, StatusParams } from "../../../platforms/interface.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal GitLab issue response shape. */
function sampleGitLabIssue(iid = 42, state = "opened"): Record<string, unknown> {
  return {
    id: 100,
    iid,
    title: "Fix broken login",
    description: "Users cannot log in",
    state,
    labels: ["bug", "syntaro:fix"],
    web_url: `https://gitlab.com/owner/test-repo/-/issues/${iid}`,
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-02T00:00:00Z",
  };
}

/** Minimal GitLab MR response shape. */
function sampleGitLabMR(iid = 10, state = "opened"): Record<string, unknown> {
  return {
    id: 200,
    iid,
    title: "Fix broken login",
    description: "Fixes the login issue",
    state,
    web_url: `https://gitlab.com/owner/test-repo/-/merge_requests/${iid}`,
    source_branch: "syntaro/fix-42",
    target_branch: "main",
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-02T00:00:00Z",
  };
}

/** Minimal GitLab user response. */
function sampleGitLabUser(): Record<string, unknown> {
  return {
    id: 1,
    username: "syntaro-bot",
    name: "SYNTARO Bot",
    state: "active",
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GitLabPlatformClient", () => {
  let client: GitLabPlatformClient;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);

    client = new GitLabPlatformClient("glpat-test-token", "https://gitlab.example.com");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ── Constructor ───────────────────────────────────────────────────

  describe("constructor", () => {
    it("appends /api/v4 to the provided base URL without trailing slash", () => {
      const c = new GitLabPlatformClient("token", "https://self-hosted.gitlab.com/");
      expect((c as unknown as { baseUrl: string }).baseUrl).toBe("https://self-hosted.gitlab.com/api/v4");
    });

    it("defaults to https://gitlab.com/api/v4 when no baseUrl given", () => {
      const c = new GitLabPlatformClient("token");
      expect((c as unknown as { baseUrl: string }).baseUrl).toBe("https://gitlab.com/api/v4");
    });
  });

  // ── getIssue ──────────────────────────────────────────────────────

  describe("getIssue", () => {
    it("fetches an issue and returns normalised shape", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(sampleGitLabIssue(42)),
      });

      const issue = await client.getIssue("owner/test-repo", 42);

      expect(issue.number).toBe(42);
      expect(issue.title).toBe("Fix broken login");
      expect(issue.body).toBe("Users cannot log in");
      expect(issue.labels).toEqual(["bug", "syntaro:fix"]);
      expect(issue.repoOwner).toBe("owner");
      expect(issue.repoName).toBe("test-repo");
      expect(issue.state).toBe("opened");

      // Verify correct API URL
      const requestUrl = mockFetch.mock.calls[0][0];
      expect(requestUrl).toContain("/api/v4/projects/owner%2Ftest-repo/issues/42");
    });

    it("throws on non-ok response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: () => Promise.resolve("Not Found"),
      });

      await expect(client.getIssue("owner/test-repo", 999)).rejects.toThrow(
        "GitLab API GET /projects/owner%2Ftest-repo/issues/999 failed: 404 Not Found",
      );
    });
  });

  // ── createComment ─────────────────────────────────────────────────

  describe("createComment", () => {
    it("posts a note to the issue", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: () => Promise.resolve({ id: 1, body: "Test comment" }),
      });

      await client.createComment("owner/test-repo", 42, "Test comment");

      const requestUrl = mockFetch.mock.calls[0][0];
      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);

      expect(requestUrl).toContain("/api/v4/projects/owner%2Ftest-repo/issues/42/notes");
      expect(requestBody).toEqual({ body: "Test comment" });
    });
  });

  // ── updateIssue ───────────────────────────────────────────────────

  describe("updateIssue", () => {
    it("updates issue labels and state", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(sampleGitLabIssue(42)),
      });

      await client.updateIssue("owner/test-repo", 42, {
        labels: ["bug", "syntaro:fix", "wontfix"],
        state: "closed",
      });

      const requestUrl = mockFetch.mock.calls[0][0];
      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);

      expect(requestUrl).toContain("/api/v4/projects/owner%2Ftest-repo/issues/42");
      expect(requestBody.labels).toBe("bug,syntaro:fix,wontfix");
      expect(requestBody.state).toBe("closed");
    });
  });

  // ── createPullRequest ─────────────────────────────────────────────

  describe("createPullRequest", () => {
    it("creates a merge request and returns normalised shape", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: () => Promise.resolve(sampleGitLabMR(10)),
      });

      const params: CreatePRParams = {
        repoOwner: "owner",
        repoName: "test-repo",
        title: "Fix broken login",
        head: "syntaro/fix-42",
        base: "main",
        body: "Fixes the login issue",
        draft: false,
      };

      const mr = await client.createPullRequest(params);

      expect(mr.number).toBe(10);
      expect(mr.url).toBe("https://gitlab.com/owner/test-repo/-/merge_requests/10");
      expect(mr.state).toBe("open");

      const requestUrl = mockFetch.mock.calls[0][0];
      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);

      expect(requestUrl).toContain("/api/v4/projects/owner%2Ftest-repo/merge_requests");
      expect(requestBody.source_branch).toBe("syntaro/fix-42");
      expect(requestBody.target_branch).toBe("main");
      expect(requestBody.title).toBe("Fix broken login");
    });

    it("prepends Draft: prefix when draft is true", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: () => Promise.resolve(sampleGitLabMR(11)),
      });

      const params: CreatePRParams = {
        repoOwner: "owner",
        repoName: "test-repo",
        title: "Fix broken login",
        head: "syntaro/fix-42",
        base: "main",
        body: "Fixes the login issue",
        draft: true,
      };

      await client.createPullRequest(params);

      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(requestBody.title).toBe("Fix broken login");
    });
  });

  // ── getPullRequest ────────────────────────────────────────────────

  describe("getPullRequest", () => {
    it("fetches an MR and returns normalised shape", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(sampleGitLabMR(10)),
      });

      const mr = await client.getPullRequest("owner/test-repo", 10);

      expect(mr.number).toBe(10);
      expect(mr.url).toBe("https://gitlab.com/owner/test-repo/-/merge_requests/10");
      expect(mr.state).toBe("open");

      const requestUrl = mockFetch.mock.calls[0][0];
      expect(requestUrl).toContain("/api/v4/projects/owner%2Ftest-repo/merge_requests/10");
    });

    it("maps merged state correctly", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(sampleGitLabMR(10, "merged")),
      });

      const mr = await client.getPullRequest("owner/test-repo", 10);
      expect(mr.state).toBe("merged");
    });
  });

  // ── setStatus ─────────────────────────────────────────────────────

  describe("setStatus", () => {
    it("posts a commit status", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: () => Promise.resolve({}),
      });

      const params: StatusParams = {
        repoOwner: "owner",
        repoName: "test-repo",
        sha: "abc123def456",
        state: "success",
        description: "Tests passed",
        targetUrl: "https://ci.example.com/build/1",
      };

      await client.setStatus(params);

      const requestUrl = mockFetch.mock.calls[0][0];
      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);

      expect(requestUrl).toContain("/api/v4/projects/owner%2Ftest-repo/statuses/abc123def456");
      expect(requestBody.state).toBe("success");
      expect(requestBody.description).toBe("Tests passed");
      expect(requestBody.target_url).toBe("https://ci.example.com/build/1");
    });
  });

  // ── getAuthenticatedUser ──────────────────────────────────────────

  describe("getAuthenticatedUser", () => {
    it("returns the username from /user endpoint", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(sampleGitLabUser()),
      });

      const username = await client.getAuthenticatedUser();
      expect(username).toBe("syntaro-bot");

      const requestUrl = mockFetch.mock.calls[0][0];
      expect(requestUrl).toContain("/api/v4/user");
    });
  });

  // ── Error handling ────────────────────────────────────────────────

  describe("error handling", () => {
    it("throws descriptive error with status and body", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: () => Promise.resolve('{"error":"insufficient_access"}'),
      });

      await expect(client.getIssue("owner/test-repo", 42)).rejects.toThrow(
        'GitLab API GET /projects/owner%2Ftest-repo/issues/42 failed: 403 {"error":"insufficient_access"}',
      );
    });
  });

  // ── Auth headers ──────────────────────────────────────────────────

  describe("authentication headers", () => {
    it("includes PRIVATE-TOKEN and Content-Type headers", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(sampleGitLabIssue()),
      });

      await client.getIssue("owner/test-repo", 42);

      const requestHeaders = mockFetch.mock.calls[0][1].headers;
      expect(requestHeaders["PRIVATE-TOKEN"]).toBe("glpat-test-token");
      expect(requestHeaders["Content-Type"]).toBe("application/json");
    });
  });
});
