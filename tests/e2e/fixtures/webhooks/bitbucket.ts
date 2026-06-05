/**
 * Bitbucket webhook test payloads for E2E tests.
 */

export function sampleBitbucketIssueCreatedPayload() {
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
      title: "Fix broken user login on Bitbucket",
      content: { raw: "Users are unable to log in when the password contains special characters." },
      state: "new",
      kind: "bug",
      priority: "major",
      labels: [{ name: "stas:fix" }],
    },
  };
}
