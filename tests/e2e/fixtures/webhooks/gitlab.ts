/**
 * GitLab webhook test payloads for E2E tests.
 */

/**
 * GitLab Issue Hook payload (issue opened with stas:fix label).
 */
export function sampleGitlabIssuePayload() {
  return {
    object_kind: "issue",
    event_type: "issue",
    user: { username: "testuser", id: 12345 },
    project: {
      id: 100,
      name: "test-repo",
      namespace: "owner",
      path_with_namespace: "owner/test-repo",
      visibility_level: 20,
      web_url: "https://gitlab.com/owner/test-repo",
    },
    object_attributes: {
      id: 500,
      iid: 42,
      title: "Fix broken user login on GitLab",
      description: "Users are unable to log in when the password contains special characters.",
      state: "opened",
      url: "https://gitlab.com/owner/test-repo/-/issues/42",
      action: "open",
      labels: [{ title: "stas:fix" }],
    },
    labels: [{ title: "stas:fix" }],
  };
}

/**
 * GitLab Issue Hook payload (issue updated with target label).
 */
export function sampleGitlabIssueUpdatedPayload() {
  return {
    object_kind: "issue",
    event_type: "issue",
    user: { username: "testuser", id: 12345 },
    project: {
      id: 100,
      name: "test-repo",
      namespace: "owner",
      path_with_namespace: "owner/test-repo",
      visibility_level: 20,
      web_url: "https://gitlab.com/owner/test-repo",
    },
    object_attributes: {
      id: 500,
      iid: 42,
      title: "Fix broken user login on GitLab (updated)",
      description: "Updated description with more details.",
      state: "opened",
      url: "https://gitlab.com/owner/test-repo/-/issues/42",
      action: "update",
      labels: [{ title: "stas:fix" }],
    },
    labels: [{ title: "stas:fix" }],
  };
}
