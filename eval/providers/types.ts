/**
 * Shared types for the SYNTARO eval provider.
 *
 * These types define the shape of test cases, evaluation results, and
 * agent trace artifacts used throughout the Promptfoo provider pipeline.
 */

// ---------------------------------------------------------------------------
// Test case — parsed from the YAML prompt that Promptfoo passes to the provider
// ---------------------------------------------------------------------------

export interface TestCase {
  /** Short title for the issue/PR (e.g. "Fix broken login redirect") */
  issueTitle: string;

  /** Full markdown description of the issue the agent should fix */
  issueDescription: string;

  /** GitHub repo in "owner/name" format (e.g. "my-org/my-repo") */
  repo: string;

  /** What the correct fix should achieve — used for pass/fail evaluation */
  expectedOutcome: string;

  /** File paths expected to be modified by the fix (relative to repo root) */
  expectedFiles: string[];

  /** Maximum wall-clock time for the agent to complete, in milliseconds */
  timeoutMs: number;

  /** Difficulty tier 1-4 for per-tier eval bucketing (AIM-4622). */
  tier?: number;

  /** Routing variant low/medium/high/max for per-tier eval bucketing. */
  variant?: string;
}

// ---------------------------------------------------------------------------
// Tool call — a single agent tool invocation captured from the run log
// ---------------------------------------------------------------------------

export interface ToolCall {
  /** Name of the tool invoked (e.g. "read_file", "edit_file", "bash") */
  tool: string;

  /** Input arguments passed to the tool */
  input: string;

  /** Output returned by the tool */
  output: string;

  /** Duration of the tool call in milliseconds */
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Attempt record — tracks one execution attempt (for retry tracking)
// ---------------------------------------------------------------------------

export interface AttemptRecord {
  /** 1-based attempt number */
  attempt: number;

  /** Whether this attempt passed evaluation */
  passed: boolean;

  /** Duration of the attempt in milliseconds */
  durationMs: number;

  /** Error message if the attempt failed with an exception */
  error?: string;
}

// ---------------------------------------------------------------------------
// Agent trace — full artifact bundle collected from the sandbox
// ---------------------------------------------------------------------------

export interface AgentTrace {
  /** E2B sandbox ID where the agent ran */
  sandboxId: string;

  /** Raw PR diff output (git diff) */
  prDiff: string;

  /** Full agent run log */
  logs: string;

  /** Parsed tool calls extracted from the agent log */
  toolCalls: ToolCall[];

  /** Total wall-clock duration of the run in milliseconds */
  durationMs: number;

  /** Records of each attempt (shows retry history) */
  attempts: AttemptRecord[];

  /** Error message if the overall run failed */
  error?: string;
}

// ---------------------------------------------------------------------------
// Eval result — the shape returned inside ProviderResponse.output
// ---------------------------------------------------------------------------

export interface EvalResult {
  /** Whether the fix passed all evaluation criteria */
  passed: boolean;

  /** Human-readable result summary ("PASSED", "FAILED", or "ERROR: ...") */
  result: string;

  /** Full artifact bundle for post-hoc analysis */
  artifacts: AgentTrace;

  /** Link to the LangFuse trace for observability */
  traceUrl: string;

  /** Difficulty tier 1-4 the case ran under (AIM-4622). */
  tier?: number;

  /** Routing variant low/medium/high/max the case ran under. */
  variant?: string;

  /** Total cost of the run in cents (used for per-tier cost reports). */
  costCents?: number;
}
