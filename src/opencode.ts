/**
 * OpenCode client — talks to `opencode serve` on :4096.
 *
 * The agent does the real work. We just:
 *   1. Format the issue into a prompt
 *   2. POST it to opencode serve
 *   3. Wait for the result
 *   4. Return the diff/PR
 */

import { config } from "./config.js";

export interface OpenCodeResult {
  success: boolean;
  summary: string;
  diff?: string;
  branch?: string;
  error?: string;
}

export async function runAgent(issueContext: string, repoUrl: string): Promise<OpenCodeResult> {
  const prompt = buildPrompt(issueContext, repoUrl);

  try {
    const res = await fetch(`${config.opencode.url}/api/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        model: config.opencode.model,
      }),
    });

    if (!res.ok) {
      return {
        success: false,
        summary: `OpenCode returned error: ${res.status}`,
        error: await res.text(),
      };
    }

    // opencode serve returns a session result;
    // exact shape depends on the version — adapt as needed
    const data = (await res.json()) as Record<string, unknown>;

    return {
      success: true,
      summary: (data.summary as string) || "Agent completed without summary.",
      diff: data.diff as string | undefined,
      branch: data.branch as string | undefined,
    };
  } catch (err) {
    return {
      success: false,
      summary: "Failed to reach OpenCode serve",
      error: String(err),
    };
  }
}

function buildPrompt(issueContext: string, repoUrl: string): string {
  return [
    `You are an autonomous fix agent for the repository ${repoUrl}.`,
    "",
    "Your task is to investigate the following issue, implement a fix, write a regression test, and open a pull request.",
    "",
    "--- Issue ---",
    issueContext,
    "",
    "--- Instructions ---",
    "1. Clone the repo and investigate the root cause.",
    "2. Write the fix.",
    "3. Write a regression test that fails before the fix and passes after.",
    "4. Run the existing test suite.",
    "5. Commit and push to a new branch.",
    "6. Open a draft PR.",
    "",
    "Output the PR URL and a summary of what you did.",
  ].join("\n");
}
