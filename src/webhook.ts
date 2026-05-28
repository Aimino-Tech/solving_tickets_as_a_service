/**
 * GitHub webhook handler — receives `issues.labeled` events.
 *
 * When a user labels an issue with `stas:fix`, we:
 *   1. Acknowledge with a comment
 *   2. Extract the issue context
 *   3. Dispatch to OpenCode
 *   4. Post status updates
 *   5. Open a PR on success
 */

import { config } from "./config.js";
import { postComment, openPr } from "./github.js";
import { runAgent } from "./opencode.js";

export interface IssueLabeledPayload {
  installation: { id: number };
  repository: { owner: { login: string }; name: string; clone_url: string };
  issue: { number: number; title: string; body: string | null; html_url: string; labels: Array<{ name: string }> };
  label?: { name: string };
}

export async function handleIssueLabeled(payload: IssueLabeledPayload): Promise<void> {
  const { installation, repository: repo, issue } = payload;

  // Only act on our label
  if (payload.label?.name !== config.label) return;

  const owner = repo.owner.login;
  const repoName = repo.name;
  const issueNumber = issue.number;

  console.log(
    `[${owner}/${repoName}#${issueNumber}] Labeled "${payload.label.name}" — starting fix...`,
  );

  // 1. Acknowledge
  await postComment(
    installation.id,
    owner,
    repoName,
    issueNumber,
    [
      `🤖 **STAS** is on it.`,
      "",
      `Investigating issue and preparing a fix. I'll post updates here.`,
    ].join("\n"),
  );

  // 2. Build context from the issue
  const issueContext = [
    `# ${issue.title}`,
    ``,
    issue.body || "(no description)",
    ``,
    `Issue URL: ${issue.html_url}`,
  ].join("\n");

  // 3. Run the agent
  const result = await runAgent(issueContext, repo.clone_url);

  // 4. Post result
  if (result.success && result.branch) {
    const prUrl = await openPr(
      installation.id,
      owner,
      repoName,
      `Fix: ${issue.title}`,
      result.branch,
      "main",
      `## 🤖 Automated Fix\n\n${result.summary}\n\n_Fixed by STAS (Solving Tickets As A Service)_`,
      issueNumber,
    );

    await postComment(
      installation.id,
      owner,
      repoName,
      issueNumber,
      [
        `✅ **Fix ready!**`,
        ``,
        prUrl
          ? `Pull request: ${prUrl}`
          : `Branch: \`${result.branch}\` (PR creation failed — push was done)`,
        ``,
        result.diff ? `<details><summary>Diff preview</summary>\n\n\`\`\`diff\n${result.diff.slice(0, 3000)}\n\`\`\`\n</details>` : "",
        ``,
        `_Review and merge at your convenience._`,
      ].join("\n"),
    );
  } else {
    await postComment(
      installation.id,
      owner,
      repoName,
      issueNumber,
      [
        `❌ **Fix failed.**`,
        ``,
        result.error ? `Error: \`${result.error}\`` : result.summary,
        ``,
        `_You can re-label the issue to retry, or fix it manually._`,
      ].join("\n"),
    );
  }
}
