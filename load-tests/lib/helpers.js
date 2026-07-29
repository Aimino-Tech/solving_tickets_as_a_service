export function randomRepo(index) {
  const repos = [
    "test-org/repo-a", "test-org/repo-b", "test-org/repo-c",
    "test-org/frontend", "test-org/backend",
  ];
  return repos[index % repos.length];
}

export function generateWebhookPayload(owner, name, issueNumber) {
  return JSON.stringify({
    action: "labeled",
    issue: { number: issueNumber, title: "Test fix issue", body: "Load test", labels: [{ name: "stas:fix" }] },
    repository: { owner: { login: owner }, name, private: false },
    installation: { id: 12345678 },
  });
}
