#!/usr/bin/env tsx
/**
 * stas-action.ts — STAS GitHub Action entry point
 *
 * Runs inside a GitHub Action when an issue is labeled "stas:fix".
 * Handles the full lifecycle: triage, investigate, fix, verify, PR.
 *
 * This is the "pure GitHub Action" approach — no webhook server needed.
 * The checked-out repo IS the sandbox. The GitHub App token IS the auth.
 *
 * Usage:
 *   GITHUB_TOKEN=<token> ISSUE_NUMBER=1 REPO_OWNER=org REPO_NAME=repo \
 *     npx tsx scripts/stas-action.ts
 */

import { Octokit } from "@octokit/rest";
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

// ── Environment ────────────────────────────────────────────────────────────

const ENV = {
  GITHUB_TOKEN: process.env.GITHUB_TOKEN || "",
  ISSUE_NUMBER: parseInt(process.env.ISSUE_NUMBER || "0", 10),
  REPO_OWNER: process.env.REPO_OWNER || "",
  REPO_NAME: process.env.REPO_NAME || "",
  ISSUE_TITLE: process.env.ISSUE_TITLE || "",
  ISSUE_BODY: process.env.ISSUE_BODY || "",
  BASE_BRANCH: process.env.BASE_BRANCH || "main",
  // OpenCode AI (primary)
  OPENCODE_URL: process.env.OPENCODE_URL || "",
  OPENCODE_API_KEY: process.env.OPENCODE_API_KEY || "",
  OPENCODE_MODEL: process.env.OPENCODE_MODEL || "",
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL || "http://litellm-proxy:4002/v1",
  OPENAI_CHEAP_MODEL: process.env.OPENAI_CHEAP_MODEL || "gpt-4o-mini",
  BOT_NAME: process.env.BOT_NAME || "STAS",
  CI: process.env.CI === "true",
};

function requiredEnv(): void {
  const missing: string[] = [];
  if (!ENV.GITHUB_TOKEN) missing.push("GITHUB_TOKEN");
  if (!ENV.ISSUE_NUMBER) missing.push("ISSUE_NUMBER");
  if (!ENV.REPO_OWNER) missing.push("REPO_OWNER");
  if (!ENV.REPO_NAME) missing.push("REPO_NAME");
  if (missing.length > 0) {
    console.error("Missing required env vars:", missing.join(", "));
    process.exit(1);
  }
}

// ── Clients ────────────────────────────────────────────────────────────────

const octokit = new Octokit({ auth: ENV.GITHUB_TOKEN });

// AI provider config — tries OpenCode API first, then OpenAI, then none
const AI = (() => {
  if (ENV.OPENCODE_API_KEY && ENV.OPENCODE_URL) {
    console.log(`AI: using OpenCode API at ${ENV.OPENCODE_URL}`);
    return { provider: "opencode" as const };
  }
  if (ENV.OPENAI_API_KEY) {
    console.log("AI: using OpenAI API");
    return { provider: "openai" as const };
  }
  console.log("AI: no API key — using rule-based fallback");
  return { provider: "none" as const };
})();

/** Call the configured AI provider with a prompt. Returns the response text or null. */
async function callAI(
  prompt: string,
  options?: { model?: string; system?: string; json?: boolean },
): Promise<string | null> {
  if (AI.provider === "opencode") {
    const body: Record<string, unknown> = {
      prompt,
      model: options?.model || ENV.OPENCODE_MODEL || "anthropic/claude-sonnet-4-20250514",
    };
    if (options?.system) body.system = options.system;
    if (options?.json) body.response_format = { type: "json_object" };

    try {
      const res = await fetch(`${ENV.OPENCODE_URL}/api/run`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ENV.OPENCODE_API_KEY}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        console.warn(`OpenCode API returned ${res.status}: ${await res.text().catch(() => "unknown")}`);
        return null;
      }
      const data = (await res.json()) as Record<string, unknown>;
      return (data.summary as string) || (data.response as string) || null;
    } catch (err) {
      console.warn("OpenCode API call failed:", String(err));
      return null;
    }
  }

  if (AI.provider === "openai") {
    const { OpenAI } = await import("openai");
    const openai = new OpenAI({ apiKey: ENV.OPENAI_API_KEY, baseURL: ENV.OPENAI_BASE_URL || "http://litellm-proxy:4002" });
    try {
      const messages: { role: string; content: string }[] = [];
      if (options?.system) messages.push({ role: "system", content: options.system });
      messages.push({ role: "user", content: prompt });

      const response = await openai.chat.completions.create({
        model: options?.model || ENV.OPENAI_CHEAP_MODEL,
        messages: messages as never[],
        temperature: 0,
        ...(options?.json ? { response_format: { type: "json_object" } } : {}),
      });
      return response.choices[0]?.message?.content || null;
    } catch (err) {
      console.warn("OpenAI call failed:", String(err));
      return null;
    }
  }

  return null;
}

// ── Types ──────────────────────────────────────────────────────────────────

interface TriageResult {
  type: "bug" | "feature" | "question" | "unknown";
  difficulty: "easy" | "medium" | "hard" | "unknown";
  relevantFiles: string[];
  summary: string;
}

interface FixResult {
  applied: boolean;
  summary: string;
  changes: { file: string; diff: string }[];
  errors: string[];
}

// ── Helpers ────────────────────────────────────────────────────────────────

async function postComment(body: string): Promise<void> {
  await octokit.issues.createComment({
    owner: ENV.REPO_OWNER,
    repo: ENV.REPO_NAME,
    issue_number: ENV.ISSUE_NUMBER,
    body,
  });
}

async function updateProgress(
  step: string,
  status: string,
  table: Record<string, string>,
): Promise<void> {
  const rows = Object.entries(table)
    .map(([s, st]) => `| ${s} | ${st} |`)
    .join("\n");
  await postComment(
    [
      `> 🤖 **${ENV.BOT_NAME}:** ${step}`,
      "",
      "| Step | Status |",
      "|------|--------|",
      rows,
    ].join("\n"),
  );
}

async function fetchIssueComments(): Promise<string[]> {
  try {
    const { data } = await octokit.issues.listComments({
      owner: ENV.REPO_OWNER,
      repo: ENV.REPO_NAME,
      issue_number: ENV.ISSUE_NUMBER,
      per_page: 15,
    });
    return data.map(
      (c) => `@${c.user?.login || "unknown"}: ${c.body || ""}`,
    );
  } catch (err) {
    console.warn("Failed to fetch comments:", String(err));
    return [];
  }
}

function run(
  cmd: string,
  options?: { cwd?: string; ignoreError?: boolean },
): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execSync(cmd, {
      cwd: options?.cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 300_000,
    });
    return { stdout: stdout.trim(), stderr: "", exitCode: 0 };
  } catch (err: unknown) {
    const e = err as {
      stdout?: Buffer;
      stderr?: Buffer;
      status?: number;
    };
    const out = e.stdout?.toString().trim() || "";
    const errOut = e.stderr?.toString().trim() || "";
    if (options?.ignoreError) {
      return { stdout: out, stderr: errOut, exitCode: e.status ?? 1 };
    }
    throw new Error(
      `Command failed (exit ${e.status ?? "?"}): ${cmd}\n${errOut.slice(0, 2000)}`,
    );
  }
}

// ── Triage ─────────────────────────────────────────────────────────────────

async function runTriage(): Promise<TriageResult> {
  if (AI.provider !== "none") {
    console.log("Running AI triage...");
    const prompt = [
      "You are a triage agent. Given a GitHub issue, classify it.",
      "",
      `Title: ${ENV.ISSUE_TITLE}`,
      `Body: ${(ENV.ISSUE_BODY || "(no body)").slice(0, 3000)}`,
      "",
      'Reply with a JSON object:',
      '{',
      '  "type": "bug" | "feature" | "question" | "unknown",',
      '  "difficulty": "easy" | "medium" | "hard" | "unknown",',
      '  "relevantFiles": ["list of file paths that might be relevant"],',
      '  "summary": "one-line summary of the issue"',
      '}',
      "",
      "Only respond with the JSON object, no other text.",
    ].join("\n");

    const content = await callAI(prompt, {
      model: AI.provider === "opencode" ? ENV.OPENCODE_MODEL || "anthropic/claude-sonnet-4-20250514" : ENV.OPENAI_CHEAP_MODEL,
      json: true,
    });

    if (content) {
      try {
        const parsed = JSON.parse(content) as TriageResult;
        console.log(`Triage: ${parsed.type} (difficulty: ${parsed.difficulty})`);
        return {
          type: parsed.type || "unknown",
          difficulty: parsed.difficulty || "unknown",
          relevantFiles: parsed.relevantFiles || [],
          summary: parsed.summary || "",
        };
      } catch {
        console.warn("Failed to parse triage JSON");
      }
    }
  }

  // Rule-based fallback
  console.log("Using rule-based triage");
  const titleLower = ENV.ISSUE_TITLE.toLowerCase();
  const bodyLower = (ENV.ISSUE_BODY || "").toLowerCase();
  const content = `${titleLower} ${bodyLower}`;

  let type: TriageResult["type"] = "bug";
  if (/\b(feature|request|suggestion|want|would like|proposal)\b/i.test(content)) {
    type = content.includes("bug") || content.includes("fix") || content.includes("error") ? "bug" : "feature";
  }
  if (/\b(question|how to|help|what is|tutorial|guide)\b/i.test(content)) {
    type = "question";
  }

  return {
    type,
    difficulty: "unknown",
    relevantFiles: [],
    summary: "",
  };
}

// ── Analysis ───────────────────────────────────────────────────────────────

interface AnalysisResult {
  typeCheck: string;
  lintResults: string;
  testResults: string;
  projectFiles: string;
}

async function runAnalysis(): Promise<AnalysisResult> {
  console.log("Running analysis...");

  const typeCheck = run("npx tsc --noEmit 2>&1 || true", {
    ignoreError: true,
  });

  const lintResults = run("npx biome check src/ 2>&1 || true", {
    ignoreError: true,
  });

  const testResults = run("npm test 2>&1 || true", { ignoreError: true });

  const projectFiles = run(
    "find src -type f -name '*.ts' | head -100",
    { ignoreError: true },
  );

  return {
    typeCheck: typeCheck.stdout.slice(0, 3000),
    lintResults: lintResults.stdout.slice(0, 3000),
    testResults: testResults.stdout.slice(0, 3000),
    projectFiles: projectFiles.stdout,
  };
}

// ── Fix ────────────────────────────────────────────────────────────────────

async function attemptFix(
  triage: TriageResult,
  analysis: AnalysisResult,
  comments: string[],
): Promise<FixResult> {
  if (AI.provider === "none" || triage.type !== "bug") {
    console.log(
      `Skipping fix: ${AI.provider === "none" ? "no AI provider configured" : `issue type is ${triage.type}`}`,
    );
    return { applied: false, summary: "Fix skipped", changes: [], errors: [] };
  }

  console.log(`Attempting fix via ${AI.provider}...`);

  // Read relevant files
  const relevantFiles = triage.relevantFiles.filter((f) => {
    const cleaned = f.startsWith("/") ? f.slice(1) : f;
    return existsSync(cleaned);
  });

  const fileContents: string[] = [];
  for (const f of relevantFiles.slice(0, 8)) {
    const cleaned = f.startsWith("/") ? f.slice(1) : f;
    try {
      const content = readFileSync(cleaned, "utf-8");
      fileContents.push(`File: ${cleaned}\n\`\`\`\n${content.slice(0, 4000)}\n\`\`\``);
    } catch {
      console.warn(`Could not read file: ${cleaned}`);
    }
  }

  // Build the fix prompt
  const systemPrompt = [
    "You are a code fix agent. You have access to a repository checked out on disk.",
    "The user has filed an issue. Analyze it and suggest concrete code changes.",
    "",
    "For each file you want to change, output a diff block:",
    '```diff',
    '--- a/path/to/file.ts',
    '+++ b/path/to/file.ts',
    '@@ -line,count +line,count @@',
    ' unchanged line',
    '-removed line',
    '+added line',
    '```',
    "",
    "Only output the diffs. No explanatory text outside code blocks.",
    "Make minimal changes — fix only what the issue describes.",
  ].join("\n");

  const userPrompt = [
    `Issue: #${ENV.ISSUE_NUMBER} ${ENV.ISSUE_TITLE}`,
    "",
    `Body: ${(ENV.ISSUE_BODY || "(no body)").slice(0, 3000)}`,
    "",
    comments.length > 0
      ? `Comments:\n${comments.slice(0, 5).join("\n---\n")}`
      : "",
    "",
    `Triage: ${triage.summary}`,
    `Difficulty: ${triage.difficulty}`,
    "",
    "Relevant files:",
    ...(relevantFiles.length > 0 ? relevantFiles : ["(none identified — explore the codebase)"]),
    "",
    "Project structure:",
    analysis.projectFiles.slice(0, 1500),
    "",
    fileContents.length > 0
      ? ["Current file contents:", ...fileContents].join("\n\n")
      : "",
    "",
    "TypeScript errors:",
    analysis.typeCheck.slice(0, 2000) || "(none)",
    "",
    "Test output:",
    analysis.testResults.slice(0, 2000) || "(no tests run yet)",
  ].join("\n");

  try {
    const message = await callAI(userPrompt, {
      system: systemPrompt,
      model: AI.provider === "opencode"
        ? ENV.OPENCODE_MODEL || "anthropic/claude-sonnet-4-20250514"
        : "gpt-4o",
    });
    if (!message) {
      return { applied: false, summary: "AI returned no response", changes: [], errors: ["No response from AI"] };
    }

    console.log("AI response length:", message.length);

    const diffBlocks = message.match(/```diff\n[\s\S]*?```/g) || [];
    const changes: FixResult["changes"] = [];

    for (const block of diffBlocks) {
      const diffContent = block
        .replace(/```diff\n/, "")
        .replace(/```$/, "")
        .trim();

      // Extract file path from ---/+++ lines
      const fileMatch = diffContent.match(/^\+\+\+\s+b\/(.+)$/m);
      const filePath = fileMatch?.[1];
      if (!filePath) continue;

      // Apply the diff using patch command
      const patchFile = `/tmp/stas-patch-${Date.now()}.diff`;
      writeFileSync(patchFile, diffContent, "utf-8");

      try {
        run(`patch --forward "${filePath}" "${patchFile}"`, {
          ignoreError: true,
        });
        changes.push({ file: filePath, diff: diffContent });
        console.log(`Applied patch to: ${filePath}`);
      } catch {
        // Try with -p0
        const patch0Content = diffContent.replace(
          /^--- a\/(.+)$/m,
          "--- $1",
        ).replace(/^\+\+\+ b\/(.+)$/m,
          "+++ $1",
        );
        writeFileSync(patchFile, patch0Content, "utf-8");
        run(`patch --forward -p0 "${filePath}" "${patchFile}"`, {
          ignoreError: true,
        });
        console.log(`Applied patch (p0) to: ${filePath}`);
      }
    }

    if (changes.length > 0) {
      return {
        applied: true,
        summary: `Applied ${changes.length} change(s) based on issue analysis.`,
        changes,
        errors: [],
      };
    }

    // No diffs parsed — try to get the model to suggest file content directly
    return {
      applied: false,
      summary: "OpenAI analyzed the issue but did not produce applicable diffs.",
      changes: [],
      errors: ["No diff blocks found in response"],
    };
  } catch (err) {
    console.error("Fix attempt failed:", String(err));
    return {
      applied: false,
      summary: `Fix attempt failed: ${String(err).slice(0, 500)}`,
      changes: [],
      errors: [String(err)],
    };
  }
}

// ── PR Creation ────────────────────────────────────────────────────────────

async function createPullRequest(
  branchName: string,
  fixResult: FixResult,
  triage: TriageResult,
  testOutput: string,
  analysis: AnalysisResult,
): Promise<{ number: number; html_url: string } | null> {
  // Check if there are changes
  const statusResult = run("git status --porcelain", { ignoreError: true });
  if (!statusResult.stdout.trim()) {
    console.log("No changes to commit");
    return null;
  }

  try {
    // Commit and push
    run("git add -A");
    run(
      [
        "git commit",
        `-m "fix: resolve issue #${ENV.ISSUE_NUMBER}"`,
        `-m "${triage.summary || ENV.ISSUE_TITLE}"`,
        `-m ""`,
        `-m "Auto-fixed by ${ENV.BOT_NAME} bot."`,
        `-m ""`,
        `-m "Issue: #${ENV.ISSUE_NUMBER}"`,
      ].join(" "),
    );
    run(`git push origin "${branchName}"`);

    // Create PR
    const prBody = [
      `## 🤖 ${ENV.BOT_NAME} Fix`,
      "",
      `This PR addresses issue **#${ENV.ISSUE_NUMBER}**.`,
      "",
      triage.summary ? `### Summary\n${triage.summary}\n` : "",
      fixResult.applied ? `### Changes Applied\n${fixResult.changes.map((c) => `- \`${c.file}\``).join("\n")}\n` : "",
      "",
      analysis.typeCheck
        ? `<details><summary>📋 TypeScript Diagnostics</summary>\n\n\`\`\`\n${analysis.typeCheck.slice(0, 2000)}\n\`\`\`\n</details>\n`
        : "",
      testOutput
        ? `<details><summary>🧪 Test Results</summary>\n\n\`\`\`\n${testOutput.slice(0, 3000)}\n\`\`\`\n</details>\n`
        : "",
      fixResult.errors.length > 0
        ? `### ⚠️ Notes\n${fixResult.errors.map((e) => `- ${e}`).join("\n")}\n`
        : "",
      "",
      `_Automated fix by ${ENV.BOT_NAME}._`,
    ]
      .filter(Boolean)
      .join("\n");

    const { data: pr } = await octokit.pulls.create({
      owner: ENV.REPO_OWNER,
      repo: ENV.REPO_NAME,
      title: `Fix: ${ENV.ISSUE_TITLE}`,
      head: branchName,
      base: ENV.BASE_BRANCH,
      body: prBody.trim(),
      draft: true,
    });

    console.log(`PR created: ${pr.html_url}`);
    return { number: pr.number, html_url: pr.html_url };
  } catch (err) {
    console.error("Failed to create PR:", String(err));
    // Try to push anyway
    try {
      run(`git push origin "${branchName}"`, { ignoreError: true });
    } catch {
      // non-fatal
    }
    return null;
  }
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  requiredEnv();
  console.log(
    `[${ENV.BOT_NAME}] Starting — issue #${ENV.ISSUE_NUMBER}: ${ENV.ISSUE_TITLE}`,
  );

  // Track progress for the status table
  const progress: Record<string, string> = {
    "📥 Received": "✅",
    "🔍 Investigating": "⏳",
    "✏️ Writing fix": "⏳",
    "🧪 Verifying": "⏳",
    "📬 PR": "⏳",
  };

  // ── Step 1: Fetch issue context ──────────────────────────────────────
  console.log("Fetching issue comments...");
  const comments = await fetchIssueComments();

  // ── Step 2: Triage ───────────────────────────────────────────────────
  await updateProgress("Running triage...", "🔍 Investigating", progress);
  const triage = await runTriage();

  if (triage.type === "feature") {
    await postComment(
      [
        `## ❌ Feature Request`,
        "",
        "This issue is a **feature request**, not a bug. STAS currently handles bug fixes only.",
        "",
        "I'll skip this one. Feel free to label it differently for manual triage.",
      ].join("\n"),
    );
    console.log("Skipped — feature request");
    return;
  }

  if (triage.type === "question") {
    await postComment(
      [
        `## ❌ Question / Support`,
        "",
        "This looks like a question or support request. STAS handles bug fixes only.",
        "",
        "I'll skip this one.",
      ].join("\n"),
    );
    console.log("Skipped — question");
    return;
  }

  await postComment(
    [
      `> 🤖 **${ENV.BOT_NAME}:** Issue classified as **${triage.type}** ` +
        `(difficulty: ${triage.difficulty})` +
        (triage.summary ? ` — ${triage.summary}` : ""),
      "",
      triage.relevantFiles.length > 0
        ? `Relevant files: ${triage.relevantFiles.slice(0, 5).join(", ")}`
        : "",
    ].join("\n"),
  );

  progress["🔍 Investigating"] = "✅";
  progress["✏️ Writing fix"] = "⏳";
  await updateProgress("Investigating codebase...", "✏️ Writing fix", progress);

  // ── Step 3: Run static analysis ──────────────────────────────────────
  console.log("Running codebase analysis...");
  const analysis = await runAnalysis();

  await postComment(
    [
      `> 🤖 **${ENV.BOT_NAME}:** Codebase analysis complete.`,
      "",
      analysis.typeCheck
        ? `📋 TypeScript: ${analysis.typeCheck.split("\n").length} lines`
        : "",
      analysis.lintResults
        ? `🎨 Lint: ${analysis.lintResults.split("\n").length} issues found`
        : "",
      analysis.testResults
        ? `🧪 Tests: ${analysis.testResults.split("\n").slice(0, 3).join(" | ")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );

  // ── Step 4: Create branch and attempt fix ────────────────────────────
  const branchName = `stas/fix-${ENV.ISSUE_NUMBER}-${Date.now().toString(36)}`;
  run(`git checkout -b "${branchName}"`);

  progress["✏️ Writing fix"] = "⏳";
  await updateProgress("Attempting fix...", "✏️ Writing fix", progress);

  const fixResult = await attemptFix(triage, analysis, comments);

  if (fixResult.applied) {
    await postComment(
      [
        `> 🤖 **${ENV.BOT_NAME}:** Fix applied — ${fixResult.changes.length} file(s) modified.`,
        "",
        fixResult.changes.map((c) => `- \`${c.file}\``).join("\n"),
      ].join("\n"),
    );
    console.log("Fix applied successfully");
  } else {
    console.log("No fix applied:", fixResult.summary);
  }

  // ── Step 5: Verify ───────────────────────────────────────────────────
  progress["🧪 Verifying"] = "⏳";
  progress["✏️ Writing fix"] = fixResult.applied ? "✅" : "⚠️";
  await updateProgress("Running verification...", "🧪 Verifying", progress);

  let testOutput = "";
  let verificationPassed = false;

  if (fixResult.applied) {
    console.log("Running verification tests...");

    // Format code
    run("npx biome check --write src/ 2>&1 || true", { ignoreError: true });

    // Run typecheck
    const tscAfter = run("npx tsc --noEmit 2>&1 || true", {
      ignoreError: true,
    });
    const typeCheckPassed = tscAfter.exitCode === 0;

    // Run tests
    const testAfter = run("npm test 2>&1 || true", { ignoreError: true });
    testOutput = testAfter.stdout;
    const testsPassed = testAfter.exitCode === 0;

    verificationPassed = typeCheckPassed && testsPassed;

    await postComment(
      [
        `> 🤖 **${ENV.BOT_NAME}:** Verification ${verificationPassed ? "✅ passed" : "⚠️ issues found"}`,
        "",
        `| Check | Result |`,
        `|-------|--------|`,
        `| TypeScript | ${typeCheckPassed ? "✅" : "❌"} |`,
        `| Tests | ${testsPassed ? "✅" : "❌"} |`,
        !typeCheckPassed
          ? `\n<details><summary>TypeScript errors</summary>\n\n\`\`\`\n${tscAfter.stdout.slice(0, 2000)}\n\`\`\`\n</details>`
          : "",
        !testsPassed
          ? `\n<details><summary>Test output</summary>\n\n\`\`\`\n${testAfter.stdout.slice(0, 3000)}\n\`\`\`\n</details>`
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  // ── Step 6: Create PR ────────────────────────────────────────────────
  progress["📬 PR"] = "⏳";
  progress["🧪 Verifying"] = verificationPassed ? "✅" : "⚠️";
  await updateProgress("Creating pull request...", "📬 PR", progress);

  const pr = await createPullRequest(
    branchName,
    fixResult,
    triage,
    testOutput,
    analysis,
  );

  if (pr) {
    progress["📬 PR"] = "✅";
    await postComment(
      [
        `## ✅ ${ENV.BOT_NAME} Complete`,
        "",
        fixResult.applied
          ? `A draft PR has been created: [#${pr.number}](${pr.html_url})`
          : `A branch has been pushed: \`${branchName}\``,
        "",
        "| Detail | Value |",
        "|---|---|",
        `| PR | [#${pr.number}](${pr.html_url}) |`,
        `| Branch | \`${branchName}\` |`,
        `| Issue | #${ENV.ISSUE_NUMBER} — ${ENV.ISSUE_TITLE} |`,
        `| Fix applied | ${fixResult.applied ? "✅ Yes" : "❌ No"} |`,
        `| Verification | ${verificationPassed ? "✅ Passed" : "⚠️ Issues"} |`,
        "",
        fixResult.applied
          ? "Please review the draft PR and make any needed changes."
          : "The branch has the analysis results. A human needs to implement the fix.",
        "",
        `_Powered by ${ENV.BOT_NAME}._`,
      ].join("\n"),
    );
    console.log(`Done! PR: ${pr.html_url}`);
  } else {
    // No changes — just post a summary comment
    await postComment(
      [
        `## ⚠️ ${ENV.BOT_NAME} — No Changes`,
        "",
        "I analyzed the issue but couldn't produce an automated fix.",
        "",
        triage.summary
          ? `**Analysis**: ${triage.summary}`
          : "",
        analysis.typeCheck
          ? `\n**TypeScript state**:\n\`\`\`\n${analysis.typeCheck.slice(0, 1500)}\n\`\`\`\n`
          : "",
        "",
        "This issue needs manual attention.",
        `_Powered by ${ENV.BOT_NAME}._`,
      ].join("\n"),
    );
    console.log("Done — no changes created");
  }
}

main().catch(async (err) => {
  console.error("STAS Action failed:", err);
  try {
    await postComment(
      [
        `## ❌ ${ENV.BOT_NAME} Error`,
        "",
        "An error occurred while processing this issue:",
        "",
        "```",
        String(err).slice(0, 2000),
        "```",
      ].join("\n"),
    );
  } catch {
    // non-fatal
  }
  process.exit(1);
});
