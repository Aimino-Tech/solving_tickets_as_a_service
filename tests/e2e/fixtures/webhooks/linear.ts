/**
 * Linear webhook test payloads for E2E tests.
 */

export function sampleLinearWebhookPayload() {
  return {
    action: "create",
    data: {
      id: "linear-issue-123",
      title: "Fix login bug in API",
      description: "Users cannot log in with special characters in their password.",
      priority: 1,
      priorityLabel: "Urgent",
      state: { name: "Todo", type: "unstarted" },
      labels: [{ name: "bug" }],
      team: { id: "team-1", name: "Engineering", key: "ENG" },
      createdAt: "2025-05-01T10:00:00Z",
      updatedAt: "2025-05-01T10:00:00Z",
      url: "https://linear.app/aimino/issue/ENG-123/fix-login-bug",
    },
    url: "https://linear.app/aimino/issue/ENG-123/fix-login-bug",
    createdAt: "2025-05-01T10:00:00Z",
    updatedAt: "2025-05-01T10:00:00Z",
  };
}
