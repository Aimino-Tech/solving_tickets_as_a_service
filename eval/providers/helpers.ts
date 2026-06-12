/**
 * E2B sandbox lifecycle helpers and result parsing for the STAS eval provider.
 *
 * Provides:
 *  - launchSandbox()    — Create an E2B sandbox with the "stas-eval" template
 *  - killSandbox()      — Hard-kill a sandbox (with grace-period timeout enforcement)
 *  - runAgentInSandbox() — Execute the STAS agent CLI inside the sandbox
 *  - collectArtifacts() — Read back PR diff, agent logs, and tool calls
 *  - evaluateResult()   — Compare agent output against expected test case outcome
 */

import { Sandbox } from "e2b";
import type { ExecResult } from "../../src/sandbox/types.js";
import type { TestCase, ToolCall } from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SANDBOX_TEMPLATE = process.env.STAS_EVAL_SANDBOX_TEMPLATE || "stas-eval";
const AGENT_CLI_COMMAND = process.env.STAS_AGENT_CLI || "stas-agent";
const AGENT_WORKDIR = "/home/user";
const GRACE_PERIOD_MS = 30_000;

// ---------------------------------------------------------------------------
// Sandbox lifecycle
// ---------------------------------------------------------------------------

/**
 * Launch an E2B sandbox using the "stas-eval" template.
 *
 * The sandbox timeout is set to `timeoutMs + grace period` so the agent
 * gets its full allotted time plus buffer for cleanup operations.
 *
 * @param timeoutMs - Max execution time for the agent (ms)
 * @returns A booted E2B Sandbox instance
 * @throws If sandbox creation fails
 */
export async function launchSandbox(timeoutMs: number): Promise<Sandbox> {
  const apiKey = process.env.E2B_API_KEY;
  if (!apiKey) {
    throw new Error(
      "E2B_API_KEY is not set. Configure it in your environment or .env file.",
    );
  }

  try {
    const sandbox = await Sandbox.create({
      apiKey,
      template: SANDBOX_TEMPLATE,
      timeoutMs: timeoutMs + GRACE_PERIOD_MS,
    });
    return sandbox;
  } catch (err) {
    throw new Error(
      `Failed to launch E2B sandbox (template: ${SANDBOX_TEMPLATE}): ${String(err)}`,
    );
  }
}

/**
 * Hard-kill a sandbox, ignoring any errors (best-effort cleanup).
 *
 * @param sandbox - The E2B Sandbox to destroy
 */
export async function killSandbox(sandbox: Sandbox | null): Promise<void> {
  if (!sandbox) return;
  try {
    await sandbox.kill();
  } catch {
    // Non-fatal — sandbox may already be terminated
  }
}

// ---------------------------------------------------------------------------
// Agent execution
// ---------------------------------------------------------------------------

/**
 * Build the shell command to invoke the STAS agent CLI with test case params.
 *
 * Escapes shell-sensitive characters in the issue title and description
 * to prevent injection.
 *
 * @param testCase - Parsed test case specification
 * @returns A shell command string
 */
export function buildAgentCommand(testCase: TestCase): string {
  const escapedTitle = shellEscape(testCase.issueTitle);
  const escapedDesc = shellEscape(testCase.issueDescription);
  const escapedOutcome = shellEscape(testCase.expectedOutcome);

  return [
    AGENT_CLI_COMMAND,
    "--repo",
    testCase.repo,
    "--issue-title",
    escapedTitle,
    "--issue-description",
    escapedDesc,
    "--expected-outcome",
    escapedOutcome,
    "--expected-files",
    testCase.expectedFiles.join(","),
    "--timeout-ms",
    String(testCase.timeoutMs),
    "--workdir",
    AGENT_WORKDIR,
    "2>&1",
  ].join(" ");
}

/**
 * Run the STAS agent CLI inside the sandbox and return the execution result.
 *
 * @param sandbox - Booted E2B Sandbox
 * @param testCase - Parsed test case (used for timeout and command building)
 * @returns The execution result (stdout, stderr, exitCode)
 */
export async function runAgentInSandbox(
  sandbox: Sandbox,
  testCase: TestCase,
): Promise<ExecResult> {
  const command = buildAgentCommand(testCase);

  try {
    const result = await sandbox.commands.run(command, {
      cwd: AGENT_WORKDIR,
      timeoutMs: testCase.timeoutMs + 5_000, // 5s buffer for the command itself
    });

    return {
      stdout: result.stdout || "",
      stderr: result.stderr || "",
      exitCode: result.exitCode ?? -1,
    };
  } catch (err) {
    return {
      stdout: "",
      stderr: `Agent execution failed or timed out: ${String(err)}`,
      exitCode: -1,
    };
  }
}

// ---------------------------------------------------------------------------
// Artifact collection
// ---------------------------------------------------------------------------

/**
 * Collect artifacts from the sandbox after the agent has finished.
 *
 * Reads:
 *  - PR diff (`pr.diff` in the workdir)
 *  - Agent log (`agent.log`)
 *  - Tool calls (`tool_calls.json`)
 *
 * All reads are best-effort — missing files return empty strings/arrays.
 *
 * @param sandbox - Booted E2B Sandbox (may still be alive or recently killed)
 * @returns Artifact bundle
 */
export async function collectArtifacts(
  sandbox: Sandbox,
): Promise<{
  prDiff: string;
  logs: string;
  toolCalls: ToolCall[];
}> {
  const [prDiff, logs, toolCallsRaw] = await Promise.all([
    readFileSafe(sandbox, `${AGENT_WORKDIR}/pr.diff`),
    readFileSafe(sandbox, `${AGENT_WORKDIR}/agent.log`),
    readFileSafe(sandbox, `${AGENT_WORKDIR}/tool_calls.json`),
  ]);

  let toolCalls: ToolCall[] = [];
  if (toolCallsRaw) {
    try {
      const parsed = JSON.parse(toolCallsRaw);
      toolCalls = Array.isArray(parsed) ? parsed : [];
    } catch {
      // Not valid JSON — ignore
    }
  }

  return { prDiff, logs, toolCalls };
}

/**
 * Safely read a file from the sandbox, returning an empty string on failure.
 */
async function readFileSafe(sandbox: Sandbox, path: string): Promise<string> {
  try {
    return await sandbox.files.read(path);
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Result evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate whether the agent's execution result matches the expected outcome.
 *
 * Evaluation criteria (in order of increasing strictness):
 *  1. Exit code must be 0 (agent completed without crashing)
 *  2. PR diff must not be empty (the agent made changes)
 *  3. If expectedFiles are specified, each file path must appear in the diff
 *  4. If expectedOutcome is specified, key terms should appear in the diff
 *
 * @param execResult - Raw execution result from the sandbox
 * @param prDiff - Collected PR diff content
 * @param testCase - Original test case with expected outcome/files
 * @returns `true` if all criteria pass
 */
export function evaluateResult(
  execResult: ExecResult,
  prDiff: string,
  testCase: TestCase,
): boolean {
  // Criterion 1: Agent must exit successfully
  if (execResult.exitCode !== 0) {
    return false;
  }

  // Criterion 2: There must be actual changes
  if (!prDiff || prDiff.trim().length === 0) {
    return false;
  }

  // Criterion 3: Expected files must appear in the diff
  if (testCase.expectedFiles && testCase.expectedFiles.length > 0) {
    for (const filePath of testCase.expectedFiles) {
      if (!prDiff.includes(filePath)) {
        return false;
      }
    }
  }

  // Criterion 4: Expected outcome keywords should appear in the diff
  if (
    testCase.expectedOutcome &&
    testCase.expectedOutcome.trim().length > 0
  ) {
    const keywords = extractKeywords(testCase.expectedOutcome);
    if (keywords.length > 0) {
      const diffLower = prDiff.toLowerCase();
      const matchingKeywords = keywords.filter((kw) =>
        diffLower.includes(kw.toLowerCase()),
      );
      // At least half of the keywords should be present
      if (matchingKeywords.length < Math.ceil(keywords.length / 2)) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Extract meaningful keywords from the expected outcome text.
 * Filters out very short words, common stop words, and markdown artifacts.
 *
 * @param text - Expected outcome description
 * @returns Array of keyword strings
 */
function extractKeywords(text: string): string[] {
  const stopWords = new Set([
    "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "by", "from", "is", "are", "was", "were", "be", "been",
    "being", "have", "has", "had", "do", "does", "did", "will", "would",
    "could", "should", "may", "might", "shall", "can", "need", "must",
    "this", "that", "these", "those", "it", "its", "they", "them", "their",
    "we", "us", "our", "you", "your", "he", "she", "him", "her", "his",
    "not", "no", "nor", "so", "if", "then", "else", "when", "where", "why",
    "how", "what", "which", "who", "whom", "fix", "fixed", "fixes", "fixing",
    "should", "ensure", "make", "made", "making", "change", "changed",
    "changes", "changing", "add", "added", "adding", "remove", "removed",
    "removing", "update", "updated", "updating",
  ]);

  return text
    .replace(/[^a-zA-Z0-9\s_-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !stopWords.has(w.toLowerCase()))
    .map((w) => w.toLowerCase());
}

// ---------------------------------------------------------------------------
// Shell escaping
// ---------------------------------------------------------------------------

/**
 * Escape a string for use as a single-quoted shell argument.
 *
 * Handles embedded single quotes by ending the quote, escaping the
 * character, and resuming the quote (`'foo'\''bar'`).
 */
function shellEscape(value: string): string {
  const sanitized = value.replace(/'/g, "'\\''");
  return `'${sanitized}'`;
}
