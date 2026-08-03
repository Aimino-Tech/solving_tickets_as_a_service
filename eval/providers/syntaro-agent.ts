/**
 * Promptfoo TypeScript provider — SYNTARO agent evaluation with E2B sandbox
 * and LangFuse OTel trace export.
 *
 * This provider is loaded by Promptfoo as a custom provider. It:
 *  1. Parses a YAML test case from the prompt (issueTitle, issueDescription,
 *     repo, expectedOutcome, expectedFiles, timeoutMs)
 *  2. Starts a LangFuse trace via OpenTelemetry OTLP export
 *  3. Launches an E2B sandbox (template: "syntaro-eval")
 *  4. Runs the SYNTARO agent CLI inside the sandbox
 *  5. Collects artifacts (PR diff, agent logs, tool calls)
 *  6. Evaluates the result against the expected outcome
 *  7. Ends the LangFuse trace
 *  8. Returns { output: { passed, result, artifacts, traceUrl } }
 *
 * Retry: Flaky tests auto-retry up to 2 times, reporting each attempt.
 * Timeout: Hard kill at timeoutMs + 30s grace period.
 *
 * Usage in promptfoo config:
 *   providers:
 *     - file://eval/providers/syntaro-agent.ts
 */

import type {
  ProviderResponse,
  CallApiContextParams,
  CallApiOptionsParams,
} from "promptfoo";
import yaml from "js-yaml";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import {
  SpanStatusCode,
  SpanKind,
  type Span,
  type Tracer,
} from "@opentelemetry/api";
import { Sandbox } from "e2b";

import type { TestCase, EvalResult, AgentTrace, AttemptRecord } from "./types.js";
import {
  launchSandbox,
  killSandbox,
  runAgentInSandbox,
  collectArtifacts,
  evaluateResult,
} from "./helpers.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of retry attempts for flaky eval runs. */
const MAX_RETRIES = 2;

/** Grace period after timeout before hard-killing the sandbox (milliseconds). */
const GRACE_PERIOD_MS = 30_000;

// ---------------------------------------------------------------------------
// LangFuse OTel tracer initialisation
// ---------------------------------------------------------------------------

/**
 * Configure and return an OpenTelemetry Tracer that exports spans to LangFuse
 * via OTLP HTTP.
 *
 * Required environment variables:
 *   LANGFUSE_PUBLIC_KEY   — LangFuse project public key
 *   LANGFUSE_SECRET_KEY   — LangFuse project secret key
 *   LANGFUSE_OTEL_ENDPOINT  — (optional) OTel endpoint, defaults to
 *     https://cloud.langfuse.com/api/public/otel/v1/traces
 *
 * Returns an API-level Tracer that creates spans exported to LangFuse.
 */
function initLangFuseTracer(): Tracer {
  const langfusePublicKey = process.env.LANGFUSE_PUBLIC_KEY || "";
  const langfuseSecretKey = process.env.LANGFUSE_SECRET_KEY || "";
  const endpoint =
    process.env.LANGFUSE_OTEL_ENDPOINT ||
    "https://cloud.langfuse.com/api/public/otel/v1/traces";

  // Build Basic Auth header: base64("publicKey:secretKey")
  const credentials = Buffer.from(
    `${langfusePublicKey}:${langfuseSecretKey}`,
  ).toString("base64");

  const exporter = new OTLPTraceExporter({
    url: endpoint,
    headers: {
      Authorization: `Basic ${credentials}`,
    },
    timeoutMillis: 10_000,
  });

  // Use NodeTracerProvider for register() support
  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: "syntaro-eval",
    }),
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });

  // Register as the global tracer provider
  provider.register();

  return provider.getTracer("syntaro-eval", "0.1.0");
}

// ---------------------------------------------------------------------------
// Test case parsing
// ---------------------------------------------------------------------------

/**
 * Parse a YAML string into a TestCase object.
 *
 * The prompt string passed by Promptfoo is expected to be YAML with the
 * following fields:
 *   issueTitle:       string (required)
 *   issueDescription: string (required)
 *   repo:             string (required)
 *   expectedOutcome:  string (required)
 *   expectedFiles:    string[] (optional)
 *   timeoutMs:        number (optional, default 300000)
 *
 * @param prompt - YAML string from the Promptfoo prompt template
 * @returns A validated TestCase
 * @throws If required fields are missing
 */
function parseTestCase(prompt: string): TestCase {
  const raw = yaml.load(prompt) as Record<string, unknown> | null;

  if (!raw || typeof raw !== "object") {
    throw new Error(
      "Invalid test case YAML: expected an object with issueTitle, issueDescription, repo, and expectedOutcome",
    );
  }

  const issueTitle = String(raw.issueTitle || "").trim();
  const issueDescription = String(raw.issueDescription || "").trim();
  const repo = String(raw.repo || "").trim();
  const expectedOutcome = String(raw.expectedOutcome || "").trim();

  if (!issueTitle) {
    throw new Error("Missing required field: issueTitle");
  }
  if (!issueDescription) {
    throw new Error("Missing required field: issueDescription");
  }
  if (!repo) {
    throw new Error("Missing required field: repo");
  }
  if (!expectedOutcome) {
    throw new Error("Missing required field: expectedOutcome");
  }

  const rawFiles = raw.expectedFiles;
  let expectedFiles: string[] = [];
  if (Array.isArray(rawFiles)) {
    expectedFiles = rawFiles.map(String);
  }

  const timeoutMs =
    typeof raw.timeoutMs === "number" && raw.timeoutMs > 0
      ? raw.timeoutMs
      : 300_000;

  return {
    issueTitle,
    issueDescription,
    repo,
    expectedOutcome,
    expectedFiles,
    timeoutMs,
  };
}

// ---------------------------------------------------------------------------
// Single attempt runner
// ---------------------------------------------------------------------------

/**
 * Run one evaluation attempt for a test case.
 *
 * Creates a child span under the root trace, launches the E2B sandbox,
 * executes the SYNTARO agent, collects artifacts, evaluates the result,
 * and returns both the EvalResult and the associated span.
 *
 * @param testCase - The parsed test case
 * @param attemptNum - 1-based attempt number (for retry tracking)
 * @param tracer - OTel tracer instance
 * @returns Object containing the EvalResult and the attempt span
 */
async function runAttempt(
  testCase: TestCase,
  attemptNum: number,
  tracer: Tracer,
): Promise<{ result: EvalResult; span: Span }> {
  const startTime = Date.now();

  // Create a child span for this attempt
  const attemptSpan = tracer.startSpan(`attempt-${attemptNum}`, {
    kind: SpanKind.CLIENT,
    attributes: {
      "attempt.number": attemptNum,
      "attempt.timeoutMs": testCase.timeoutMs,
    },
  });

  try {
    // --- Phase 1: Launch sandbox ---
    attemptSpan.addEvent("sandbox.launch.start");
    const sandbox = await launchSandbox(testCase.timeoutMs + GRACE_PERIOD_MS);
    const sbxId = sandbox.sandboxId;
    attemptSpan.setAttribute("sandbox.id", sbxId);
    attemptSpan.addEvent("sandbox.launch.end");

    try {
      // --- Phase 2: Run agent CLI ---
      attemptSpan.addEvent("agent.run.start");
      const execResult = await runAgentInSandbox(sandbox, testCase);
      attemptSpan.addEvent("agent.run.end", {
        "agent.exitCode": execResult.exitCode,
        "agent.stdoutLength": execResult.stdout.length,
        "agent.stderrLength": execResult.stderr.length,
      });

      // --- Phase 3: Collect artifacts ---
      attemptSpan.addEvent("artifacts.collect.start");
      const { prDiff, logs, toolCalls } = await collectArtifacts(sandbox);
      attemptSpan.addEvent("artifacts.collect.end", {
        "artifacts.prDiffLength": prDiff.length,
        "artifacts.logsLength": logs.length,
        "artifacts.toolCallsCount": toolCalls.length,
      });

      const durationMs = Date.now() - startTime;

      // --- Phase 4: Evaluate ---
      attemptSpan.addEvent("evaluation.run");
      const passed = evaluateResult(execResult, prDiff, testCase);

      const artifacts: AgentTrace = {
        sandboxId: sbxId,
        prDiff,
        logs,
        toolCalls,
        durationMs,
        attempts: [],
        error: undefined,
      };

      const evalResult: EvalResult = {
        passed,
        result: passed ? "PASSED" : "FAILED",
        artifacts,
        traceUrl: "", // Set by the caller after the root span ends
      };

      attemptSpan.setStatus({
        code: passed ? SpanStatusCode.OK : SpanStatusCode.ERROR,
        message: passed ? undefined : "Evaluation failed — see artifacts for details",
      });
      attemptSpan.setAttribute("eval.passed", String(passed));
      attemptSpan.setAttribute("eval.durationMs", durationMs);

      return { result: evalResult, span: attemptSpan };
    } finally {
      // Always kill the sandbox (best-effort)
      attemptSpan.addEvent("sandbox.kill");
      await killSandbox(sandbox);
    }
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const errorMsg = String(err);

    attemptSpan.setStatus({
      code: SpanStatusCode.ERROR,
      message: errorMsg,
    });
    attemptSpan.setAttribute("eval.passed", "false");
    attemptSpan.setAttribute("eval.error", errorMsg);
    attemptSpan.recordException(err instanceof Error ? err : new Error(errorMsg));

    const artifacts: AgentTrace = {
      sandboxId: "",
      prDiff: "",
      logs: "",
      toolCalls: [],
      durationMs,
      attempts: [],
      error: errorMsg,
    };

    return {
      result: {
        passed: false,
        result: `ERROR: ${errorMsg}`,
        artifacts,
        traceUrl: "",
      },
      span: attemptSpan,
    };
  }
}

// ---------------------------------------------------------------------------
// Promptfoo provider — default export
// ---------------------------------------------------------------------------

/**
 * SYNTARO Agent evaluation provider for Promptfoo.
 *
 * Usage in promptfoo config (YAML):
 *   providers:
 *     - file://eval/providers/syntaro-agent.ts
 *
 * The `prompt` passed to this provider should be a YAML document with the
 * test case fields (see `parseTestCase`).
 *
 * The provider returns a ProviderResponse whose `.output` is an EvalResult:
 *   {
 *     passed: boolean,
 *     result: "PASSED" | "FAILED" | "ERROR: ...",
 *     artifacts: { sandboxId, prDiff, logs, toolCalls, durationMs, attempts },
 *     traceUrl: string
 *   }
 */
export default async function syntaroAgentProvider(
  prompt: string,
  _context?: CallApiContextParams,
  _options?: CallApiOptionsParams,
): Promise<ProviderResponse> {
  // Initialise LangFuse OTel tracer
  const tracer = initLangFuseTracer();

  // Create the root span for this evaluation run
  const rootSpan = tracer.startSpan("syntaro-eval-run", {
    kind: SpanKind.CLIENT,
    attributes: {
      "eval.provider": "syntaro-agent",
      "eval.promptLength": prompt.length,
    },
  });

  try {
    // Parse the test case from YAML
    let testCase: TestCase;
    try {
      testCase = parseTestCase(prompt);
    } catch (parseErr) {
      rootSpan.setStatus({
        code: SpanStatusCode.ERROR,
        message: `Failed to parse test case: ${String(parseErr)}`,
      });
      rootSpan.setAttribute("eval.error", String(parseErr));
      return {
        output: {
          passed: false,
          result: `PARSE_ERROR: ${String(parseErr)}`,
          artifacts: {
            sandboxId: "",
            prDiff: "",
            logs: "",
            toolCalls: [],
            durationMs: 0,
            attempts: [],
            error: String(parseErr),
          },
          traceUrl: "",
        },
      };
    }

    // Set attributes on the root span
    rootSpan.setAttribute("test.issueTitle", testCase.issueTitle);
    rootSpan.setAttribute("test.repo", testCase.repo);
    rootSpan.setAttribute("test.expectedFiles", testCase.expectedFiles.join(","));
    rootSpan.setAttribute("test.timeoutMs", testCase.timeoutMs);

    // Run attempts with retry logic
    let bestResult: EvalResult | null = null;
    const allAttempts: AttemptRecord[] = [];

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      rootSpan.addEvent("attempt.start", { "attempt.number": attempt });

      const { result, span } = await runAttempt(testCase, attempt, tracer);

      // End the attempt span
      span.end();

      const attemptRecord: AttemptRecord = {
        attempt,
        passed: result.passed,
        durationMs: result.artifacts.durationMs,
        error: result.artifacts.error,
      };
      allAttempts.push(attemptRecord);

      // Attach attempt records to the result
      result.artifacts.attempts = [...allAttempts];

      rootSpan.addEvent("attempt.end", {
        "attempt.number": attempt,
        "attempt.passed": String(result.passed),
        "attempt.durationMs": result.artifacts.durationMs,
      });

      if (result.passed) {
        bestResult = result;
        break;
      }

      bestResult = result;
    }

    // Build the LangFuse trace URL from the root span context
    const spanContext = rootSpan.spanContext();
    const traceId = spanContext.traceId;
    const langfuseProjectId = process.env.LANGFUSE_PROJECT_ID || "";
    const traceUrl =
      langfuseProjectId && traceId
        ? `https://cloud.langfuse.com/trace/${langfuseProjectId}/${traceId}`
        : traceId
          ? `https://cloud.langfuse.com/trace/${traceId}`
          : "";

    if (bestResult) {
      bestResult.traceUrl = traceUrl;
    }

    rootSpan.setStatus({
      code: bestResult?.passed ? SpanStatusCode.OK : SpanStatusCode.ERROR,
    });
    rootSpan.setAttribute("eval.passed", String(bestResult?.passed ?? false));
    rootSpan.setAttribute("eval.attempts", String(allAttempts.length));
    rootSpan.setAttribute("eval.traceUrl", traceUrl);

    return {
      output:
        bestResult || {
          passed: false,
          result: "No result produced after all attempts",
          artifacts: {
            sandboxId: "",
            prDiff: "",
            logs: "",
            toolCalls: [],
            durationMs: 0,
            attempts: allAttempts,
          },
          traceUrl,
        },
    };
  } catch (err) {
    const errorMsg = String(err);

    rootSpan.setStatus({
      code: SpanStatusCode.ERROR,
      message: errorMsg,
    });
    rootSpan.setAttribute("eval.error", errorMsg);
    rootSpan.setAttribute("eval.passed", "false");
    rootSpan.recordException(err instanceof Error ? err : new Error(errorMsg));

    return {
      output: {
        passed: false,
        result: `FATAL: ${errorMsg}`,
        artifacts: {
          sandboxId: "",
          prDiff: "",
          logs: "",
          toolCalls: [],
          durationMs: 0,
          attempts: [],
          error: errorMsg,
        },
        traceUrl: "",
      },
    };
  } finally {
    rootSpan.end();
  }
}
