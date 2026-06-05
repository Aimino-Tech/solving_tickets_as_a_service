/**
 * Main agent loop — the core of STAS.
 *
 * Takes an issue, classifies it, investigates, and either produces a fix or
 * explains why it can't. The main fix agent loop delegates to OpenCode serve
 * at http://localhost:4096, while classification/triage uses a cheap OpenAI model.
 *
 * Phases:
 *   1. Triage — classify issue type + difficulty (cheap model)
 *   2. Fetch comments — gather up to 15 issue comments for context
 *   3. Boot sandbox — E2B sandbox with cloned repo
 *   4. Static analysis — tsc --noEmit etc.
 *   5. Code intelligence — symbol index, import tracing
 *   6. Agent loop — call opencode serve with full context
 *   7. PR creation — via ActionDispatcher
 *   8. Cleanup — destroy sandbox
 *
 * ── Error Handling Audit ────────────────────────────────────────────
 * ✅ Outer try/catch wraps all 8 phases with phase tracking
 * ✅ Phase-specific error context in catch log
 * ✅ Sandbox cleanup in finally block with non-fatal error logging
 * ✅ classifyIssue() catches API failures, returns safe defaults
 * ✅ fetchIssueComments() catches API failures, returns empty array
 * ✅ buildCodeIntelligence() catches partial failures, continues
 * ✅ dispatchToOpenCode() has timeout (10 min) and catch with distinction
 * ✅ attemptBasicFix() has full try/catch returning structured error
 * ✅ postComment() catches failures, logs warning (non-fatal)
 * ────────────────────────────────────────────────────────────────────
 */

import OpenAI from 'openai';
import { config } from '../config.js';
import { ActionDispatcher } from '../github/actionDispatcher.js';
import { getInstallationToken, getOctokit } from '../github/auth.js';
import * as messages from '../github/messages.js';
import { SandboxExecutor } from '../sandbox/executor.js';
import { getTracker } from '../trackers/index.js';
import { jobLogger, rootLogger } from '../utils/logger.js';
import type { IssueJobData } from '../utils/types.js';
import { buildTools } from './tools.js';
import type { AgentResult, TriageResult } from './types.js';

const log = rootLogger.child({ module: 'issue-agent' });

// ---------------------------------------------------------------------------
// Timeout helper
// ---------------------------------------------------------------------------

class PhaseTimeoutError extends Error {
  phase: string;
  timeoutMs: number;

  constructor(phase: string, timeoutMs: number) {
    super(`Phase "${phase}" timed out after ${timeoutMs}ms`);
    this.name = "PhaseTimeoutError";
    this.phase = phase;
    this.timeoutMs = timeoutMs;
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  phase: string,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const result = await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener("abort", () => {
          reject(new PhaseTimeoutError(phase, timeoutMs));
        });
      }),
    ]);
    return result;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run the full agent pipeline for an issue.
 */
export async function runIssueAgent(data: IssueJobData, jobId?: string): Promise<AgentResult> {
  const logger = jobLogger({
    jobId,
    installationId: data.installationId,
    repo: `${data.repoOwner}/${data.repoName}`,
    issueNumber: data.issueNumber,
  });

  const { installationId, repoOwner, repoName, repoPrivate, issueNumber, issueTitle, issueBody } = data;

  const repoUrl = repoPrivate
    ? `https://github.com/${repoOwner}/${repoName}`
    : `https://github.com/${repoOwner}/${repoName}`;

  let sandbox: SandboxExecutor | null = null;
  let currentPhase = '';

  try {
    // ── Phase 1: Triage ──────────────────────────────────────────────
    currentPhase = "1-triage";
    logger.info("Phase 1: Classifying issue");
    const triage = await withTimeout(
      classifyIssue(issueTitle, issueBody ?? ""),
      config.phaseTimeouts.triage,
      "1-triage",
    );

    if (triage.type === 'feature') {
      logger.info('Issue is a feature request — skipping');
      await postComment(installationId, repoOwner, repoName, issueNumber, messages.featureSkipComment());
      return {
        summary: 'Issue is a feature request, not a bug. Skipping.',
        confidence: 'low',
        fixReady: false,
        noFixReason: 'Feature requests are not handled by the bot.',
      };
    }

    if (triage.type === 'question') {
      logger.info('Issue is a question — skipping');
      await postComment(installationId, repoOwner, repoName, issueNumber, messages.questionSkipComment());
      return {
        summary: 'Issue is a question, not a bug. Skipping.',
        confidence: 'low',
        fixReady: false,
        noFixReason: 'Questions and support requests are not handled by the bot.',
      };
    }

    // Post "working on it" comment
    await postComment(
      installationId,
      repoOwner,
      repoName,
      issueNumber,
      `### 🔍 STAS Investigating\n\nIssue classified as **${triage.type}** (difficulty: ${triage.difficulty}).\n\nI'll investigate and work on a fix.\n\n`,
    );

    // Post "working on it" to tracker if applicable
    if (data.trackerType && data.trackerTicketId) {
      const tracker = getTracker(data.trackerType);
      if (tracker) {
        tracker
          .postComment(
            data.trackerTicketId,
            `### 🔍 STAS Investigating\n\n**Issue**: ${data.issueTitle}\n\nIssue classified as **${triage.type}** (difficulty: ${triage.difficulty}).\n\nI'll investigate and work on a fix.\n\n`,
          )
          .catch((err) => {
            log.warn(
              { err: String(err), trackerType: data.trackerType, ticketId: data.trackerTicketId },
              'Failed to post initial tracker comment',
            );
          });
      }
    }

    // ── Phase 2: Fetch comments ──────────────────────────────────────
    currentPhase = '2-fetch-comments';
    logger.info('Phase 2: Fetching issue comments');
    const comments = await fetchIssueComments(installationId, repoOwner, repoName, issueNumber);
    await postStatus(
      installationId,
      repoOwner,
      repoName,
      issueNumber,
      `📖 **Analyzing issue** — reviewed ${comments.length} comments for context.`,
    );

    // ── Phase 3: Boot sandbox ─────────────────────────────────────────
    currentPhase = '3-boot-sandbox';
    logger.info('Phase 3: Booting sandbox');
    sandbox = new SandboxExecutor(repoUrl, repoOwner, repoName, installationId, getInstallationToken);
    await sandbox.boot();
    await postStatus(
      installationId,
      repoOwner,
      repoName,
      issueNumber,
      `⚙️ **Sandbox ready** — cloned repository, detected runtime, installed dependencies.`,
    );
    await withTimeout(
      sandbox.boot(),
      config.phaseTimeouts.sandboxBoot,
      "3-boot-sandbox",
    );
    await postStatus(installationId, repoOwner, repoName, issueNumber,
      `⚙️ **Sandbox ready** — cloned repository, detected runtime, installed dependencies.`);

    // ── Phase 4: Static analysis ──────────────────────────────────────
    currentPhase = '4-static-analysis';
    logger.info('Phase 4: Running static analysis');
    const analysisResult = await sandbox.analyzeCode();
    await postStatus(
      installationId,
      repoOwner,
      repoName,
      issueNumber,
      `🔬 **Analysis complete** — codebase scanned, issues identified.`,
    );

    // ── Phase 5: Build code intelligence ──────────────────────────────
    currentPhase = '5-code-intelligence';
    logger.info('Phase 5: Building code intelligence');
    const codeIntel = await buildCodeIntelligence(sandbox);

    // ── Phase 6: Agent loop via OpenCode ──────────────────────────────
    currentPhase = '6-opencode-agent';
    logger.info('Phase 6: Dispatching to OpenCode');
    await postStatus(
      installationId,
      repoOwner,
      repoName,
      issueNumber,
      `🤖 **Running fix agent** — investigating root cause and writing fix (may take a few minutes).`,
    );

    const openCodeResult = await withTimeout(
      dispatchToOpenCode({
        repoUrl,
        repoOwner,
        repoName,
        issueNumber,
        issueTitle,
        issueBody: issueBody ?? "",
        comments,
        triage,
        analysisResult,
        codeIntel,
        installationToken: await getInstallationToken(installationId),
        installationId,
      }),
      config.phaseTimeouts.openCodeAgent,
      "6-opencode-agent",
    );

    if (!openCodeResult.success) {
      logger.error({ error: openCodeResult.errors?.[0] }, "OpenCode agent failed");

      // Try basic fix approach as fallback
      logger.info('Attempting basic fix fallback');
      const fallbackResult = await attemptBasicFix(sandbox, data, triage, comments);

      await sandbox.destroy();
      sandbox = null;

      return fallbackResult;
    }

    // ── Phase 7: Dispatch action ──────────────────────────────────────
    currentPhase = '7-dispatch-action';
    logger.info('Phase 7: Dispatching action');
    const dispatcher = new ActionDispatcher();
    const dispatchResult = await withTimeout(
      dispatcher.dispatch({
        issueNumber,
        issueTitle,
        agentResult: {
          summary: openCodeResult.summary,
          confidence: openCodeResult.confidence,
          fixReady: true,
          branchName: openCodeResult.branchName,
          diff: openCodeResult.diff,
          testOutput: openCodeResult.testOutput,
          errors: openCodeResult.errors,
        },
        sandbox,
        repoOwner,
        repoName,
        installationId,
      }),
      config.phaseTimeouts.prCreation,
      "7-dispatch-action",
    );

    // ── Post result back to tracker (Linear/Jira) ───────────────────
    if (data.trackerType && data.trackerTicketId && dispatchResult.prUrl) {
      const tracker = getTracker(data.trackerType);
      if (tracker) {
        try {
          await tracker.postComment(
            data.trackerTicketId,
            `### ✅ Fix Completed by STAS\n\nA fix has been implemented and a pull request has been opened.\n\n**PR**: ${dispatchResult.prUrl}\n**Summary**: ${openCodeResult.summary}\n**Confidence**: ${openCodeResult.confidence}`,
          );

          await tracker.createLink(data.trackerTicketId, dispatchResult.prUrl, `STAS Fix: ${data.issueTitle}`);

          log.info(
            { trackerType: data.trackerType, ticketId: data.trackerTicketId, prUrl: dispatchResult.prUrl },
            'Posted fix result back to tracker',
          );
        } catch (err) {
          log.warn(
            { err: String(err), trackerType: data.trackerType, ticketId: data.trackerTicketId },
            'Failed to post result back to tracker',
          );
        }
      }
    }

    // ── Phase 8: Cleanup ──────────────────────────────────────────────
    if (sandbox) {
      await sandbox.destroy();
      sandbox = null;
    }

    return {
      summary: openCodeResult.summary,
      confidence: openCodeResult.confidence,
      fixReady: true,
      prUrl: dispatchResult.prUrl,
      branchName: openCodeResult.branchName,
      diff: openCodeResult.diff,
      testOutput: openCodeResult.testOutput,
    };
  } catch (err) {
    const errorMsg = String(err);
    logger.error({ err: errorMsg, phase: currentPhase }, 'Agent pipeline failed during phase');

    // Post appropriate comment based on error type
    try {
      if (err instanceof PhaseTimeoutError) {
        await postComment(
          installationId,
          repoOwner,
          repoName,
          issueNumber,
          messages.timeoutComment(err.phase, err.timeoutMs),
        );
      } else {
        await postComment(
          installationId,
          repoOwner,
          repoName,
          issueNumber,
          messages.errorComment(`[Phase: ${currentPhase}] ${errorMsg}`),
        );
      }
    } catch (commentErr) {
      logger.error({ err: String(commentErr), phase: currentPhase }, 'Failed to post error comment');
    }

    // Post error to tracker if applicable
    if (data.trackerType && data.trackerTicketId) {
      const tracker = getTracker(data.trackerType);
      if (tracker) {
        tracker
          .postComment(
            data.trackerTicketId,
            `### ❌ STAS Error\n\nAn error occurred during fix analysis:\n\n\`\`\`\n${errorMsg.slice(0, 2000)}\n\`\`\`\n\n**Phase**: ${currentPhase}`,
          )
          .catch((e) => {
            logger.warn({ err: String(e) }, 'Failed to post error to tracker');
          });
      }
    }

    return {
      summary: 'Agent pipeline encountered an error',
      confidence: 'low',
      fixReady: false,
      errors: [errorMsg],
      noFixReason: `An error occurred: ${errorMsg}`,
    };
  } finally {
    if (sandbox) {
      try {
        await sandbox.destroy();
      } catch (err) {
        log.warn({ err: String(err) }, 'Error destroying sandbox in finally');
      }
    }
  }
}

// ── Phase 1: Classification ─────────────────────────────────────────

/**
 * Classify the issue using a cheap OpenAI model.
 */
async function classifyIssue(title: string, body: string): Promise<TriageResult> {
  const openai = new OpenAI({ apiKey: config.openai.apiKey });

  const prompt = `You are a triage agent. Given a GitHub issue, classify it.

Title: ${title}
Body: ${(body || '(no body)').slice(0, 3000)}

Reply with a JSON object:
{
  "type": "bug" | "feature" | "question" | "unknown",
  "difficulty": "easy" | "medium" | "hard" | "unknown",
  "relevantFiles": ["list of file paths that might be relevant"],
  "summary": "one-line summary of the issue"
}

Only respond with the JSON object, no other text.`;

  try {
    const model = config.openai.cheapModel || 'gpt-4o-mini';
    const response = await openai.chat.completions.create({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content;
    if (content) {
      const parsed = JSON.parse(content) as TriageResult;
      return {
        type: parsed.type || 'unknown',
        difficulty: parsed.difficulty || 'unknown',
        relevantFiles: parsed.relevantFiles,
        summary: parsed.summary || '',
      };
    }
  } catch (err) {
    log.warn({ err: String(err) }, 'Classification failed, using defaults');
  }

  return { type: 'unknown', difficulty: 'unknown', summary: '' };
}

// ── Phase 2: Fetch comments ─────────────────────────────────────────

/**
 * Fetch issue comments (up to MAX_ISSUE_COMMENTS).
 */
async function fetchIssueComments(
  installationId: number,
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<string[]> {
  try {
    const octokit = await getOctokit(installationId);
    const response = await octokit.issues.listComments({
      owner,
      repo,
      issue_number: issueNumber,
      per_page: config.stas.maxIssueComments,
    });

    return response.data.map((c) => `@${c.user?.login || 'unknown'}: ${c.body || ''}`);
  } catch (err) {
    log.warn({ err: String(err) }, 'Failed to fetch issue comments');
    return [];
  }
}

// ── Phase 5: Code intelligence ──────────────────────────────────────

interface CodeIntel {
  symbols: string[];
  imports: Record<string, string[]>;
  fileStructure: string;
}

async function buildCodeIntelligence(sandbox: SandboxExecutor): Promise<CodeIntel> {
  const intel: CodeIntel = {
    symbols: [],
    imports: {},
    fileStructure: '',
  };

  try {
    // Get file structure
    const structure = await sandbox.exec(
      "find . -type f -not -path './node_modules/*' -not -path './.git/*' -not -path './dist/*' 2>/dev/null | head -200",
    );
    intel.fileStructure = structure.stdout;

    // For TypeScript projects, use tsc to get symbol info
    const tscResult = await sandbox.exec('npx tsc --noEmit --listFiles 2>/dev/null | head -100 || true');
    if (tscResult.stdout) {
      intel.symbols = tscResult.stdout.split('\n').filter(Boolean).slice(0, 50);
    }
  } catch (err) {
    log.warn({ err: String(err) }, 'Code intelligence partial failure');
  }

  return intel;
}

// ── Phase 6: OpenCode dispatch ──────────────────────────────────────

interface OpenCodeDispatchParams {
  repoOwner: string;
  repoName: string;
  issueNumber: number;
  issueTitle: string;
  issueBody: string;
  comments: string[];
  triage: TriageResult;
  analysisResult: string;
  codeIntel: CodeIntel;
  installationToken: string;
  installationId: number;
}

interface OpenCodeDispatchResult {
  success: boolean;
  summary: string;
  confidence: 'high' | 'medium' | 'low';
  branchName?: string;
  diff?: string;
  testOutput?: string;
  errors?: string[];
  metadata?: Record<string, unknown>;
}

/**
 * Dispatch the issue context to OpenCode serve at :4096.
 * This is the key differentiator from KintsugiBot — instead of calling
 * the OpenAI SDK for the main agent loop, we call opencode serve.
 */
async function dispatchToOpenCode(params: OpenCodeDispatchParams): Promise<OpenCodeDispatchResult> {
  const {
    repoOwner,
    repoName,
    issueNumber,
    issueTitle,
    issueBody,
    comments,
    triage,
    analysisResult,
    codeIntel,
    installationToken,
    installationId,
  } = params;

  const prompt = buildOpenCodePrompt({
    repoOwner,
    repoName,
    issueNumber,
    issueTitle,
    issueBody,
    comments,
    triage,
    analysisResult,
    codeIntel,
  });

  const sanitizedPrompt = sanitizeUserContent(prompt);

  // Build model chain: primary + fallbacks
  const models = [
    config.opencode.model,
    ...config.opencode.fallbackModels,
  ];

  let lastError: string | undefined;

  for (let i = 0; i < models.length; i++) {
    const model = models[i];

    // Post status for fallback attempts
    if (i > 0 && lastError) {
      try {
        await postComment(
          installationId,
          repoOwner,
          repoName,
          issueNumber,
          messages.retryComment(i + 1, model, lastError),
        );
      } catch {
        // non-fatal
      }
    }

    try {
      const response = await fetch(`${config.opencode.url}/api/run`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${installationToken}`,
        },
        body: JSON.stringify({
          prompt: sanitizedPrompt,
          model,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "unknown error");
        lastError = errorText;

        // Post status about the failure
        try {
          await postComment(
            installationId,
            repoOwner,
            repoName,
            issueNumber,
            messages.modelFallbackComment(models[i + 1] ?? "none", errorText),
          );
        } catch {
          // non-fatal
        }

        continue;
      }

      const result = (await response.json()) as Record<string, unknown>;

      // Parse the result
      const summary = String(result.summary || "Agent completed.");
      const diff = result.diff ? String(result.diff) : undefined;
      const branchName = result.branch ? String(result.branch) : undefined;
      const testOutput = result.testOutput
        ? String(result.testOutput)
        : undefined;
      const confidence = parseConfidence(result);
      const errorList = result.errors
        ? (result.errors as string[])
        : undefined;

      return {
        success: true,
        summary,
        confidence,
        branchName,
        diff,
        testOutput,
        errors: errorList,
        metadata: result.metadata as Record<string, unknown> | undefined,
      };
    } catch (err) {
      const errorMsg = String(err);
      lastError = errorMsg;

      // Check if this was a timeout error
      const isTimeout = errorMsg.includes("abort") || errorMsg.includes("timeout");

      if (isTimeout && i < models.length - 1) {
        try {
          await postComment(
            installationId,
            repoOwner,
            repoName,
            issueNumber,
            messages.timeoutComment(`6-opencode-agent (model: ${model})`, config.phaseTimeouts.openCodeAgent),
          );
        } catch {
          // non-fatal
        }
      }

      // Continue to next fallback model
      continue;
    }
  }

  // All models failed
  return {
    success: false,
    summary: lastError?.includes("abort") || lastError?.includes("timeout")
      ? "OpenCode agent timed out on all models"
      : "OpenCode agent failed on all models",
    confidence: "low",
    errors: lastError ? [lastError] : ["All models failed"],
  };
}

/**
 * Build the system prompt for the OpenCode agent.
 */
function buildOpenCodePrompt(params: {
  repoOwner: string;
  repoName: string;
  issueNumber: number;
  issueTitle: string;
  issueBody: string;
  comments: string[];
  triage: TriageResult;
  analysisResult: string;
  codeIntel: CodeIntel;
}): string {
  const { repoOwner, repoName, issueNumber, issueTitle, issueBody, comments, triage, analysisResult, codeIntel } =
    params;

  return [
    '# STAS Fix Agent',
    '',
    `You are an autonomous fix agent for **${repoOwner}/${repoName}**.`,
    'Your task is to investigate the following issue, implement a fix,',
    'write a regression test, and commit the changes to a branch.',
    '',
    '## Issue',
    '',
    `**#${issueNumber}: ${issueTitle}**`,
    '',
    issueBody || '(no description)',
    '',
    comments.length > 0 ? ['## Issue Comments', '', ...comments.map((c) => `> ${c}`), ''].join('\n') : '',
    '',
    '## Triage Analysis',
    '',
    `**Type**: ${triage.type}`,
    `**Difficulty**: ${triage.difficulty}`,
    `**Summary**: ${triage.summary}`,
    triage.relevantFiles?.length ? `**Relevant Files**:\n${triage.relevantFiles.map((f) => `- ${f}`).join('\n')}` : '',
    '',
    analysisResult ? ['## Static Analysis Output', '', '```', analysisResult.slice(0, 2000), '```', ''].join('\n') : '',
    '',
    codeIntel.fileStructure
      ? ['## Codebase Structure', '', '```', codeIntel.fileStructure.slice(0, 3000), '```', ''].join('\n')
      : '',
    '',
    '## Instructions',
    '',
    '1. **Reproduce** — Understand the issue and reproduce it if possible.',
    '2. **Trace** — Find the root cause by tracing the code path.',
    '3. **Fix** — Implement the minimal fix needed.',
    '4. **Test** — Write a regression test that fails before the fix and passes after.',
    '5. **Verify** — Run the existing test suite to ensure nothing is broken.',
    '6. **Format** — Format modified files per project conventions.',
    '7. **Commit** — Stage all changes and commit with a descriptive message.',
    '',
    '## Tools Available',
    '',
    'You have access to: read_file, write_file, patch_file, replace_lines,',
    'search_codebase, find_files, run_command, run_tests, get_diff,',
    'format_code, list_directory, get_line_numbers, find_symbol,',
    'trace_imports, submit_fix',
    '',
    '## Rules',
    '',
    '- Use `run_command` to clone and work with the repo.',
    '- The repo is already cloned — work in the current directory.',
    '- After implementing the fix and verifying, use `submit_fix`',
    `  with a branch name like \`stas/fix-${issueNumber}-<short-hash>\`.`,
    '- Include your summary, confidence level, and test results in the final output.',
    '- If you cannot fix the issue, clearly explain why.',
    '',
    '## Output Format',
    '',
    'When done, output a JSON summary:',
    '```json',
    '{',
    '  "summary": "What was done",',
    '  "confidence": "high|medium|low",',
    '  "diff": "optional unified diff of changes",',
    '  "branch": "optional branch name if pushed",',
    '  "testOutput": "optional test run output",',
    '  "errors": ["optional list of errors"]',
    '}',
    '```',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Sanitize user-provided content to prevent prompt injection.
 */
function sanitizeUserContent(prompt: string): string {
  // Remove any content that looks like it's trying to override instructions
  return prompt
    .replace(/ignore all previous instructions/gi, '[REDACTED]')
    .replace(/ignore all prior instructions/gi, '[REDACTED]')
    .replace(/you are not/gi, '[REDACTED]')
    .replace(/forget everything/gi, '[REDACTED]')
    .replace(/your new role/gi, '[REDACTED]')
    .replace(/disregard/gi, '[REDACTED]')
    .replace(/system override/gi, '[REDACTED]')
    .replace(/you must now/gi, '[REDACTED]')
    .replace(/you are now/gi, '[REDACTED]');
}

/**
 * Parse confidence from OpenCode response.
 */
function parseConfidence(result: Record<string, unknown>): 'high' | 'medium' | 'low' {
  const confidence = String(result.confidence || 'medium').toLowerCase();
  if (confidence === 'high' || confidence === 'medium' || confidence === 'low') {
    return confidence;
  }
  return 'medium';
}

// ── Fallback: Basic fix attempt ─────────────────────────────────────

/**
 * When OpenCode is unavailable, attempt a basic fix using the sandbox
 * and a simpler approach.
 */
async function attemptBasicFix(
  sandbox: SandboxExecutor,
  data: IssueJobData,
  _triage: TriageResult,
  comments: string[],
): Promise<AgentResult> {
  try {
    // Run tests first to see baseline
    const testResult = await sandbox.runTests();

    // Build the tools
    const tools = buildTools({
      readFile: (path) => sandbox.readFile(path),
      writeFile: (path, content) => sandbox.writeFile(path, content),
      exec: (cmd) => sandbox.execForTools(cmd),
      runTests: () => sandbox.runTests(),
      formatCode: () => sandbox.formatCode(),
      pushBranch: (branch) => sandbox.pushBranch(branch),
    });

    // Try to use the cheap OpenAI model for a simpler fix attempt
    const openai = new OpenAI({ apiKey: config.openai.apiKey });
    const issueContext = [`Issue #${data.issueNumber}: ${data.issueTitle}`, data.issueBody || '', ...comments].join(
      '\n\n',
    );

    const toolDescriptions = tools
      .map((t) => `- ${t.name}: ${t.description} (args: ${JSON.stringify(t.inputSchema)})`)
      .join('\n');

    const systemPrompt = [
      'You are a code fix agent. You have access to a sandbox with the repo cloned.',
      'Use the available tools to investigate and fix the issue.',
      '',
      'Available tools:',
      toolDescriptions,
      '',
      'Always verify tests pass after making changes.',
      'Output the result as JSON: { summary, confidence, branchName }',
    ].join('\n');

    const fallbackModel = config.openai.cheapModel || 'gpt-4o-mini';
    const response = await openai.chat.completions.create({
      model: fallbackModel,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `Issue: ${issueContext}\n\nTest output: ${testResult.output.slice(0, 2000)}`,
        },
      ],
      temperature: 0.2,
      tools: tools.map((t) => ({
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.inputSchema as Record<string, unknown>,
        },
      })),
      tool_choice: 'auto',
    });

    const message = response.choices[0]?.message;
    const results: string[] = [];

    if (message?.tool_calls) {
      for (const tc of message.tool_calls) {
        try {
          const args = JSON.parse(tc.function.arguments);
          const result = await dispatchNamedTool(tools, tc.function.name, args);
          results.push(`${tc.function.name}: ${result}`);
        } catch {
          // individual tool failure is non-fatal
        }
      }
    }

    const summary = message?.content || 'Agent completed basic fix attempt.';
    const hadChanges = results.length > 0;

    // Re-run tests after fix attempt to verify
    let postFixTestOutput = testResult.output;
    if (hadChanges) {
      const postFixTest = await sandbox.runTests();
      postFixTestOutput = postFixTest.output;

      if (!postFixTest.passed) {
        return {
          summary: `[Fallback] ${summary}`,
          confidence: 'low',
          fixReady: false,
          verificationFailed: true,
          branchName: undefined,
          testOutput: postFixTestOutput,
          errors: ['Fix failed verification — tests did not pass after changes'],
          noFixReason: 'Fix failed verification: tests did not pass after changes',
        };
      }
    }

    return {
      summary: `[Fallback] ${summary}`,
      confidence: hadChanges ? 'medium' : 'low',
      fixReady: hadChanges,
      branchName: undefined,
      testOutput: postFixTestOutput,
      errors: hadChanges ? undefined : ['No tool calls were made'],
      noFixReason: hadChanges ? undefined : 'No changes were made by the fallback agent',
    };
  } catch (err) {
    return {
      summary: `Basic fix attempt failed: ${String(err)}`,
      confidence: 'low',
      fixReady: false,
      errors: [String(err)],
      noFixReason: `Agent unavailable and fallback failed: ${String(err)}`,
    };
  }
}

// Helpers ────────────────────────────────────────────────────────────

/**
 * Post a status update to the issue (updates the existing "working on it" thread).
 */
async function postStatus(
  installationId: number,
  owner: string,
  repo: string,
  issueNumber: number,
  message: string,
): Promise<void> {
  await postComment(installationId, owner, repo, issueNumber, `> 🤖 **STAS:** ${message}`);
}

/**
 * Post a comment to an issue via raw fetch (used early in the pipeline
 * before we have an Octokit instance handy).
 */
async function postComment(
  installationId: number,
  owner: string,
  repo: string,
  issueNumber: number,
  body: string,
): Promise<void> {
  try {
    const octokit = await getOctokit(installationId);
    await octokit.issues.createComment({
      owner,
      repo,
      issue_number: issueNumber,
      body,
    });
  } catch (err) {
    log.warn({ err: String(err) }, 'Failed to post comment');
  }
}

/**
 * Lightweight tool dispatch for the fallback path.
 */
function dispatchNamedTool(
  tools: ReturnType<typeof buildTools>,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) return Promise.resolve(`Unknown tool: ${name}`);
  return tool.handler(args);
}
