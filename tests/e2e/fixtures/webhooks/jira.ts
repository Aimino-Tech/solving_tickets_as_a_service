/**
 * Jira webhook test payloads for E2E tests.
 */

export function sampleJiraWebhookPayload() {
  return {
    webhookEvent: "jira:issue_updated",
    issue: {
      id: "10001",
      key: "PROJ-123",
      self: "https://jira.example.com/rest/api/3/issue/10001",
      fields: {
        summary: "Fix login bug in API",
        description: "Users cannot log in with special characters in their password.",
        status: { name: "In Progress" },
        priority: { id: "2", name: "High" },
        labels: ["bug", "security"],
        created: "2025-05-01T10:00:00.000+0000",
        updated: "2025-05-01T12:00:00.000+0000",
      },
    },
    changelog: {
      items: [
        {
          field: "status",
          fromString: "To Do",
          toString: "In Progress",
        },
      ],
    },
  };
}
