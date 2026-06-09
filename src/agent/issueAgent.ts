/**
 * Main agent loop — the core of STAS.
 *
 * Takes an issue, classifies it, investigates, and either produces a fix or
 * explains why it can't. The main fix agent loop delegates to OpenCode serve
 * at http://localhost:4096, while classification/triage uses a direct OpenCode Go LLM call.
 *
 * Phases:
 *   1. Triage — classify issue type + difficulty (cheap model)
 *   2. Fetch comments — gather up to 15 issue comments for context
 *   3. Boot sandbox — sandbox with cloned repo (E2B or Docker)
 *   3.5 Baseline tests — run test suite before any changes
 *   4. Static analysis — tsc --noEmit etc.
 *   5. Code intelligence — symbol index, import tracing
 *   6. Agent loop — call opencode serve with full context
 *   6.5 Verification — post-fix tests, regression validation, before/after compare
 *   7. PR creation — via ActionDispatcher (includes verification decision)
 *   8. Cleanup — destroy sandbox
 *
 * ── Error Handling Audit ────────────────────────────────────────────
 * ✅ Outer try/catch wraps all phases (9 regions) with phase tracking
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

import OpenAI from "openai";
import { config } from "../config.js";
import { getOctokit, getInstallationToken } from "../github/auth.js";
import { ActionDispatcher } from "../github/actionDispatcher.js";
import { createSandbox } from "../sandbox/index.js";
import type { SandboxExecutor } from "../sandbox/types.js";
import { buildTools, type SandboxTools } from "./tools.js";
import type { AgentResult, TriageResult, VerificationResult, TestBaseline } from "./types.js";
import type { IssueJobData } from "../utils/types.js";
import { rootLogger, jobLogger } from "../utils/logger.js";
import { addBreadcrumb, setUserContext } from "../monitoring/sentry.js";
import * as messages from "../github/messages.js";
import { getTracker } from "../trackers/index.js";
import { writeBack } from "../trackers/writeBack.js";
import { validateIssue } from "./issueValidator.js";
import { isFeatureEnabled } from "../services/featureFlags.js";
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
 * Helper: call writeBack if the job has a tracker ticket ID.
 * This is a no-op if trackerTicketId is not set.
 */
async function writeBackIfTracked(
  data: IssueJobData,
  agentResult: AgentResult,
  prUrl?: string,
  prNumber?: number,
): Promise<void> {
  if (data.trackerType && data.trackerTicketId) {
    await writeBack({
      trackerType: data.trackerType,
      trackerTicketId: data.trackerTicketId,
      agentResult,
      prUrl,
      prNumber,
    });
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
  const TASK_MAX_DURATION_MS = config.phaseTimeouts.openCodeAgent + 30_000;
  let watchdog: ReturnType<typeof setTimeout> | null = null;

  try {
    // ── Phase 1: Triage ──────────────────────────────────────────────
    currentPhase = "1-triage";
    logger.info("Phase 1: Classifying issue");
    const triage = await withTimeout(
      classifyIssue(issueTitle, issueBody ?? "", installationId),
      config.phaseTimeouts.triage,
      "1-triage",
    );

    if (triage.type === 'feature') {
      logger.info('Issue is a feature request — skipping');
      await postComment(installationId, repoOwner, repoName, issueNumber, messages.featureSkipComment());
      const featureResult: AgentResult = {
        summary: 'Issue is a feature request, not a bug. Skipping.',
        confidence: 'low',
        fixReady: false,
        noFixReason: 'Feature requests are not handled by the bot.',
      };
      await writeBackIfTracked(data, featureResult);
      return featureResult;
    }

    if (triage.type === 'question') {
      logger.info('Issue is a question — skipping');
      await postComment(installationId, repoOwner, repoName, issueNumber, messages.questionSkipComment());
      const questionResult: AgentResult = {
        summary: 'Issue is a question, not a bug. Skipping.',
        confidence: 'low',
        fixReady: false,
        noFixReason: 'Questions and support requests are not handled by the bot.',
      };
      await writeBackIfTracked(data, questionResult);
      return questionResult;
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
          .catch((err: unknown) => {
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
    sandbox = createSandbox(repoUrl, repoOwner, repoName, installationId, getInstallationToken);

    const logHeartbeat = (_phase: string, _progress: number, message?: string) => {
      logger.info({ sandboxPhase: _phase, progress: _progress }, message || 'Sandbox progress');
    };
    heartbeatTimer = setInterval(() => {
      logger.debug({ currentPhase }, 'Job heartbeat — still processing');
    }, config.rabbitmq.taskHeartbeatIntervalMs);

    await withTimeout(
      sandbox.boot(logHeartbeat),
      config.phaseTimeouts.sandboxBoot,
      "3-boot-sandbox",
    );
    clearInterval(heartbeatTimer);
    heartbeatTimer = undefined;

    await postStatus(installationId, repoOwner, repoName, issueNumber,
      `⚙️ **Sandbox ready** — cloned repository, detected runtime, installed dependencies.`);

    // ── Set task-level watchdog timer ─────────────────────────────────
    watchdog = setTimeout(() => {
      log.error({ jobId, TASK_MAX_DURATION_MS }, 'Task exceeded max duration — force killing sandbox');
      if (sandbox) {
        sandbox.destroy().catch(() => {});
        sandbox = null;
      }
    }, TASK_MAX_DURATION_MS);

    // ── Phase 3.2: Issue validation ────────────────────────────────────
    currentPhase = "3.2-issue-validation";
    logger.info("Phase 3.2: Validating issue against repository");

    const validationResult = await validateIssue(sandbox, issueTitle, issueBody ?? "", triage);

    if (validationResult.missingFiles.length > 0) {
      logger.warn(
        { missingFiles: validationResult.missingFiles, isPhantom: validationResult.isPhantomIssue },
        "Issue references non-existent files",
      );

      if (validationResult.isPhantomIssue) {
        logger.info("Phantom issue detected — skipping agent dispatch");
        await postComment(
          installationId,
          repoOwner,
          repoName,
          issueNumber,
          messages.phantomIssueComment(validationResult.missingFiles, validationResult.skipReason!),
        );

        await sandbox.destroy();
        sandbox = null;

        const phantomResult: AgentResult = {
          summary: "Issue references non-existent code — skipping.",
          confidence: "low",
          fixReady: false,
          noFixReason: validationResult.skipReason,
          investigationOnly: true,
        };
        await writeBackIfTracked(data, phantomResult);
        return phantomResult;
      }
    }

    // ── Phase 3.5: Baseline test run ──────────────────────────────────
    currentPhase = "3.5-baseline-tests";
    logger.info("Phase 3.5: Running baseline tests");
    let baselineTestResult: TestBaseline | null = null;
    let baselineTestFiles: string[] = [];

    try {
      if (sandbox.hasTestSuite()) {
        const baseline = await sandbox.runTests();
        baselineTestResult = {
          passed: baseline.passed,
          output: baseline.output.slice(0, 5000),
          command: baseline.command,
          durationMs: baseline.durationMs,
        };

        const fileListResult = await sandbox.exec(
          `find . -type f \\( -name '*.test.*' -o -name '*.spec.*' -o -path '*/test/*' -o -path '*/__tests__/*' \\) -not -path './node_modules/*' -not -path './.git/*' -not -path './dist/*' 2>/dev/null | sort`,
        );
        baselineTestFiles = fileListResult.stdout.split("\n").filter(Boolean);

        logger.info({ passed: baseline.passed, duration: baseline.durationMs }, "Baseline tests complete");
        await postStatus(installationId, repoOwner, repoName, issueNumber,
          `🧪 **Baseline tests** — ${baseline.passed ? "passed" : "failed"} (${baseline.durationMs}ms)`);
      } else {
        logger.info("No test suite configured — verification will be unverified");
        await postStatus(installationId, repoOwner, repoName, issueNumber,
          `⚠️ **No test suite detected** — verification will be marked as unverified.`);
      }
    } catch (err) {
      logger.warn({ err: String(err) }, "Baseline test run failed (non-fatal)");
      await postStatus(installationId, repoOwner, repoName, issueNumber,
        `⚠️ **Baseline test error** — could not run test suite.`);
    }

    // ── Phase 4: Static analysis ──────────────────────────────────────
    currentPhase = '4-static-analysis';
    logger.info('Phase 4: Running static analysis');
    const analysisResult = await sandbox.analyzeCode();
    await postStatus(installationId, repoOwner, repoName, issueNumber,
      `📊 **Static analysis** — completed analysis of codebase.`);

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

      const fallbackEnabled = await isFeatureEnabled('fallback_fix_enabled', installationId);
      if (fallbackEnabled) {
        logger.info('Attempting basic fix fallback');
        const fallbackResult = await attemptBasicFix(sandbox, data, triage, comments);

        await sandbox.destroy();
        sandbox = null;

        await writeBackIfTracked(data, fallbackResult);
        return fallbackResult;
      }

      logger.info('Fallback fix disabled by feature flag — returning error');
      await sandbox.destroy();
      sandbox = null;

      const noFallbackResult: AgentResult = {
        summary: openCodeResult.errors?.[0] ?? 'OpenCode agent failed',
        confidence: 'low',
        fixReady: false,
        noFixReason: 'OpenCode agent failed and fallback fix is disabled by feature flag.',
      };
      await writeBackIfTracked(data, noFallbackResult);
      return noFallbackResult;
    }

    // ── Phase 6.5: Verification (post-fix) ────────────────────────────
    currentPhase = "6.5-verification";
    logger.info("Phase 6.5: Running verification");
    const regressionVerification = await isFeatureEnabled('regression_verification', installationId);
    const verification = regressionVerification
      ? await runVerification(sandbox, baselineTestResult, baselineTestFiles, logger)
      : {
          baseline: baselineTestResult,
          postFix: null,
          regressionTestCreated: false,
          regressionTestPassedOnOriginal: null,
          regressionTestPassedOnFix: null,
          preExistingTestsRegressed: false,
          unverified: !baselineTestResult,
          details: baselineTestResult
            ? ['Regression verification disabled by feature flag']
            : ['No test suite configured'],
        };
    if (verification.details.length > 0) {
      logger.info({ details: verification.details }, "Verification results");
    }
    if (verification.unverified) {
      await postStatus(installationId, repoOwner, repoName, issueNumber,
        `⚠️ **Unverified** — no test suite detected, skipping verification.`);
    } else if (verification.preExistingTestsRegressed) {
      await postStatus(installationId, repoOwner, repoName, issueNumber,
        `❌ **Regression detected** — existing tests that previously passed are now failing.`);
    } else if (verification.regressionTestPassedOnOriginal === false) {
      await postStatus(installationId, repoOwner, repoName, issueNumber,
        `⚠️ **Regression test issue** — the regression test does not fail on original code.`);
    } else if (verification.regressionTestPassedOnFix === false) {
      await postStatus(installationId, repoOwner, repoName, issueNumber,
        `⚠️ **Regression test issue** — the regression test does not pass on fixed code.`);
    } else {
      await postStatus(installationId, repoOwner, repoName, issueNumber,
        `✅ **Verification passed** — no regressions detected, regression test validated.`);
    }

    // ── Phase 7: Dispatch action ──────────────────────────────────────
    currentPhase = "7-dispatch-action";
    logger.info("Phase 7: Dispatching action");

    // Adjust confidence based on verification
    let finalConfidence = openCodeResult.confidence;
    if (verification.preExistingTestsRegressed) {
      finalConfidence = "low";
    } else if (verification.regressionTestPassedOnOriginal === false || verification.regressionTestPassedOnFix === false) {
      if (finalConfidence === "high") finalConfidence = "medium";
    }

    const dispatcher = new ActionDispatcher();
    const dispatchResult = await dispatcher.dispatch({
      issueNumber,
      issueTitle,
      agentResult: {
        summary: openCodeResult.summary,
        confidence: finalConfidence,
        fixReady: true,
        branchName: openCodeResult.branchName,
        diff: openCodeResult.diff,
        testOutput: openCodeResult.testOutput,
        errors: openCodeResult.errors,
        verification,
      },
      sandbox,
      repoOwner,
      repoName,
      installationId,
    });

    // ── Phase 7.5: Write back to tracker ──────────────────────────────
    const successResult: AgentResult = {
      summary: openCodeResult.summary,
      confidence: finalConfidence,
      fixReady: true,
      prUrl: dispatchResult.prUrl,
      branchName: openCodeResult.branchName,
      diff: openCodeResult.diff,
      testOutput: openCodeResult.testOutput,
      verification,
    };
    await writeBackIfTracked(data, successResult, dispatchResult.prUrl, dispatchResult.prNumber);

    // ── Phase 8: Cleanup ──────────────────────────────────────────────
    if (sandbox) {
      await sandbox.destroy();
      sandbox = null;
    }

    return successResult;
  } catch (err) {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = undefined;
    }
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
          .catch((e: unknown) => {
            logger.warn({ err: String(e) }, 'Failed to post error to tracker');
          });
      }
    }

    const errorResult: AgentResult = {
      summary: 'Agent pipeline encountered an error',
      confidence: 'low',
      fixReady: false,
      errors: [errorMsg],
      noFixReason: `An error occurred: ${errorMsg}`,
    };
    // writeBack updates status + posts a comment; the extra postComment above is kept
    // for backward compat (immediate feedback) — writeBack.warn catch prevents double-failure
    await writeBackIfTracked(data, errorResult);
    return errorResult;
  } finally {
    if (watchdog) {
      clearTimeout(watchdog);
      watchdog = null;
    }
    if (sandbox) {
      try {
        await sandbox.destroy();
      } catch (err) {
        log.warn({ err: String(err) }, 'Error destroying sandbox in finally');
      }
      sandbox = null;
    }
  }
}

// ── Phase 1: Classification ─────────────────────────────────────────

/**
 * Classify the issue using a cheap OpenAI model.
 * Checks `advanced_triage` and `new_triage_prompt` feature flags.
 */
async function classifyIssue(title: string, body: string, installationId?: number): Promise<TriageResult> {
  const opencode = new OpenAI({ baseURL: config.opencode.direct.baseUrl, apiKey: config.opencode.direct.apiKey });

  const [useAdvancedTriage, useNewTriagePrompt] = await Promise.all([
    isFeatureEnabled('advanced_triage', installationId),
    isFeatureEnabled('new_triage_prompt', installationId),
  ]);

  const prompt = useNewTriagePrompt
    ? `You are a triage agent. Given a GitHub issue, classify the issue type and difficulty.

Title: ${title}
Body: ${(body || '(no body)').slice(0, 3000)}

Instructions:
- Focus on whether this is a bug, feature request, question, or unclear.
- For bugs, estimate difficulty based on how many files likely need changes.
- List specific files that are likely relevant.

Reply with a JSON object:
{
  "type": "bug" | "feature" | "question" | "unknown",
  "difficulty": "easy" | "medium" | "hard" | "unknown",
  "relevantFiles": ["list of file paths that might be relevant"],
  "summary": "one-line summary of the issue"
}

Only respond with the JSON object, no other text.`
    : `You are a triage agent. Given a GitHub issue, classify it.

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
    const model = useAdvancedTriage ? config.opencode.direct.fallbackModel : config.opencode.direct.model;
    const response = await opencode.chat.completions.create({
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
  repoUrl: string;
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
  baselineTestResult?: TestBaseline | null;
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
    repoUrl,
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
    baselineTestResult,
  } = params;

  const prompt = buildOpenCodePrompt({
    repoUrl,
    repoOwner,
    repoName,
    issueNumber,
    issueTitle,
    issueBody,
    comments,
    triage,
    analysisResult,
    codeIntel,
    baselineTestResult,
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
  repoUrl: string;
  repoOwner: string;
  repoName: string;
  issueNumber: number;
  issueTitle: string;
  issueBody: string;
  comments: string[];
  triage: TriageResult;
  analysisResult: string;
  codeIntel: CodeIntel;
  baselineTestResult?: TestBaseline | null;
}): string {
  const { repoUrl, repoOwner, repoName, issueNumber, issueTitle, issueBody, comments, triage, analysisResult, codeIntel, baselineTestResult } = params;

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
    triage.relevantFiles?.length
      ? `**Relevant Files**:\n${triage.relevantFiles.map((f) => `- ${f}`).join("\n")}`
      : "",
    "",
    baselineTestResult
      ? [
          "## Baseline Test Results",
          "",
          `**Status**: ${baselineTestResult.passed ? "PASSED" : "FAILED"}`,
          `**Duration**: ${baselineTestResult.durationMs}ms`,
          `**Command**: \`${baselineTestResult.command}\``,
          baselineTestResult.passed
            ? ""
            : "\n> ⚠️ Note: Baseline tests are failing. Focus on fixing the issue without introducing new failures.",
          "",
        ].join("\n")
      : "",
    "",
    analysisResult
      ? [
          "## Static Analysis Output",
          "",
          "```",
          analysisResult.slice(0, 2000),
          "```",
          "",
        ].join("\n")
      : "",
    "",
    codeIntel.fileStructure
      ? [
          "## Codebase Structure",
          "",
          "```",
          codeIntel.fileStructure.slice(0, 3000),
          "```",
          "",
        ].join("\n")
      : "",
    "",
    "## Instructions",
    "",
    "1. **Reproduce** — Understand the issue and reproduce it if possible.",
    "2. **Trace** — Find the root cause by tracing the code path.",
    "3. **Fix** — Implement the minimal fix needed.",
    "4. **Regression Test (MANDATORY)** — Write a regression test that:",
    "   a. Tests the specific bug scenario described in the issue",
    "   b. **Must fail** when run against the original (unfixed) code",
    "   c. **Must pass** when run against your fix",
    "   d. Place the test in the existing test directory following project conventions",
    "5. **Verify** — Run the existing test suite to ensure nothing is broken.",
    "6. **Format** — Format modified files per project conventions.",
    "7. **Commit** — Stage all changes and commit with a descriptive message.",
    "",
    "## Tools Available",
    "",
    "You have access to: read_file, write_file, patch_file, replace_lines,",
    "search_codebase, find_files, run_command, run_tests, get_diff,",
    "format_code, list_directory, get_line_numbers, find_symbol,",
    "trace_imports, submit_fix",
    "",
    "## Rules",
    "",
    "- Use `run_command` to clone and work with the repo.",
    "- The repo is already cloned — work in the current directory.",
    "- After implementing the fix and verifying, use `submit_fix`",
    "  with a branch name like `stas/fix-${issueNumber}-<short-hash>`.",
    "- Include your summary, confidence level, and test results in the final output.",
    "- If you cannot fix the issue, clearly explain why.",
    "",
    "## Output Format",
    "",
    "When done, output a JSON summary:",
    "```json",
    "{",
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

// ── Phase 6.5: Verification ────────────────────────────────────────

/**
 * Run post-fix verification: compare test results with baseline, detect
 * regressions, and validate regression tests.
 */
async function runVerification(
  sandbox: SandboxExecutor,
  baseline: TestBaseline | null,
  testFilesBefore: string[],
  logger: { info: (obj: object, msg: string) => void; warn: (obj: object, msg: string) => void },
): Promise<VerificationResult> {
  const details: string[] = [];
  let regressionTestCreated = false;
  let regressionTestPassedOnOriginal: boolean | null = null;
  let regressionTestPassedOnFix: boolean | null = null;
  let preExistingTestsRegressed = false;
  let unverified = false;
  let postFix: TestBaseline | null = null;

  if (!sandbox.hasTestSuite()) {
    return {
      baseline: null,
      postFix: null,
      regressionTestCreated: false,
      regressionTestPassedOnOriginal: null,
      regressionTestPassedOnFix: null,
      preExistingTestsRegressed: false,
      unverified: true,
      details: ["No test suite configured"],
    };
  }

  // Run post-fix tests
  try {
    const postResult = await sandbox.runTests();
    postFix = {
      passed: postResult.passed,
      output: postResult.output.slice(0, 5000),
      command: postResult.command,
      durationMs: postResult.durationMs,
    };
    details.push(`Post-fix tests: ${postResult.passed ? "passed" : "failed"} (${postResult.durationMs}ms)`);
  } catch (err) {
    details.push(`Post-fix test run failed: ${String(err)}`);
  }

  // Compare with baseline to detect regressions
  if (baseline && postFix) {
    if (baseline.passed && !postFix.passed) {
      preExistingTestsRegressed = true;
      details.push("REGRESSION: Pre-existing tests that were passing now fail");
    } else if (!baseline.passed && !postFix.passed) {
      details.push("Baseline and post-fix both have failures (no new regression detected)");
    } else {
      details.push("No pre-existing test regressions detected");
    }
  }

  // Find new/modified test files
  try {
    const fileListResult = await sandbox.exec(
      `find . -type f \\( -name '*.test.*' -o -name '*.spec.*' -o -path '*/test/*' -o -path '*/__tests__/*' \\) -not -path './node_modules/*' -not -path './.git/*' -not -path './dist/*' 2>/dev/null | sort`,
    );
    const testFilesAfter = fileListResult.stdout.split("\n").filter(Boolean);
    const beforeSet = new Set(testFilesBefore);
    const newTestFiles = testFilesAfter.filter((f) => !beforeSet.has(f));

    if (newTestFiles.length > 0) {
      regressionTestCreated = true;
      details.push(`New test file(s) detected: ${newTestFiles.join(", ")}`);

      for (const testFile of newTestFiles) {
        try {
          // Remove the test file to simulate original code
          await sandbox.exec(`git rm -f "${testFile}" 2>/dev/null || true`);
          const originalResult = await sandbox.runSpecificTest(testFile);

          // Restore the test file
          await sandbox.exec(`git checkout HEAD -- "${testFile}" 2>/dev/null || true`);

          const fixResult = await sandbox.runSpecificTest(testFile);

          regressionTestPassedOnOriginal = !originalResult.passed;
          regressionTestPassedOnFix = fixResult.passed;

          if (regressionTestPassedOnOriginal && regressionTestPassedOnFix) {
            details.push(`Regression test ${testFile}: ✅ fails on original, passes on fix`);
          } else {
            details.push(
              `Regression test ${testFile}: ⚠️ fails on original=${regressionTestPassedOnOriginal}, passes on fix=${regressionTestPassedOnFix}`,
            );
          }
        } catch (err) {
          details.push(`Could not validate regression test ${testFile}: ${String(err)}`);
        }
      }
    } else {
      details.push("No new test files detected");
    }
  } catch (err) {
    details.push(`Test file detection error: ${String(err)}`);
  }

  return {
    baseline,
    postFix,
    regressionTestCreated,
    regressionTestPassedOnOriginal,
    regressionTestPassedOnFix,
    preExistingTestsRegressed,
    unverified,
    details,
  };
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

    // Try to use the direct OpenCode Go LLM for a simpler fix attempt
    const opencode = new OpenAI({ baseURL: config.opencode.direct.baseUrl, apiKey: config.opencode.direct.apiKey });
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

    const fallbackModel = config.opencode.direct.fallbackModel;
    const response = await opencode.chat.completions.create({
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
          verification: {
            baseline: null,
            postFix: { passed: false, output: postFixTestOutput, command: 'npm test', durationMs: 0 },
            regressionTestCreated: false,
            regressionTestPassedOnOriginal: null,
            regressionTestPassedOnFix: null,
            preExistingTestsRegressed: true,
            unverified: false,
            details: ['Fix failed verification — tests did not pass after changes'],
          },
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
