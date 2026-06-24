/**
 * OpenCode Contract — TypeScript types and Zod validation schemas
 * for the STAS ↔ OpenCode serve boundary.
 *
 * This module defines the formal contract for communication between
 * STAS (the orchestrator) and OpenCode serve (the fix agent).
 *
 * @module bridge/contract
 * @see docs/opencode-contract.md for full documentation
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Current version of the OpenCode contract. */
export const CONTRACT_VERSION = '1.0.0';

/** Maximum allowed length for the prompt string. */
export const MAX_PROMPT_LENGTH = 100_000;

/** Maximum allowed length for the summary string. */
export const MAX_SUMMARY_LENGTH = 10_000;

// ---------------------------------------------------------------------------
// TypeScript Interfaces
// ---------------------------------------------------------------------------

/**
 * Request payload sent from STAS to OpenCode serve.
 * This is what gets POSTed to `{OPENCODE_URL}/api/run`.
 */
export interface OpenCodeRequest {
  /** The full system prompt instructing the OpenCode agent.
   *  Built by buildOpenCodePrompt() in src/agent/issueAgent.ts. */
  prompt: string;

  /** Model identifier in "<provider>/<model-name>" format.
   *  Example: "anthropic/claude-sonnet-4-20250514" */
  model: string;
}

/**
 * Response payload returned from OpenCode serve to STAS.
 * Parsed from the JSON body of the HTTP response.
 */
export interface OpenCodeResponse {
  /** Human-readable summary of what the agent accomplished. */
  summary: string;

  /** Agent's confidence in the correctness of the fix. */
  confidence: 'high' | 'medium' | 'low';

  /** Optional unified diff of all file changes. */
  diff?: string;

  /** Branch name if changes were pushed to the remote repository.
   *  Expected format: stas/fix-<issueNumber>-<shortHash> */
  branch?: string;

  /** Output from running the test suite after the fix was applied. */
  testOutput?: string;

  /** List of error messages if the agent encountered problems. */
  errors?: string[];

  /** Arbitrary metadata attached by the agent run. */
  metadata?: Record<string, unknown>;
}

/**
 * Result of contract validation — either success with parsed data
 * or failure with a list of error messages.
 */
export interface ContractValidationResult<T> {
  /** Whether validation succeeded. */
  success: boolean;

  /** Validated and parsed data (present on success). */
  data?: T;

  /** Human-readable error messages (present on failure). */
  errors?: string[];
}

// ---------------------------------------------------------------------------
// Zod Schemas
// ---------------------------------------------------------------------------

/**
 * Regex pattern for model identifiers.
 * Expected format: "<provider>/<model-name>"
 * Examples: "anthropic/claude-sonnet-4-20250514", "gpt-4o", "deepseek-v4-flash"
 */
const MODEL_PATTERN = /^[a-zA-Z0-9_.-]+(\/[a-zA-Z0-9_.-]+)*$/;

/**
 * Regex pattern for branch names created by OpenCode.
 * Expected format: "stas/fix-<number>-<hash>"
 */
const BRANCH_PATTERN = /^stas\/fix-\d+-[a-f0-9]+$/;

/**
 * Zod schema for validating OpenCodeRequest payloads.
 * Used at the STAS→OpenCode boundary before sending.
 */
export const OpenCodeRequestSchema = z.object({
  prompt: z
    .string()
    .min(1, 'Prompt is required and must be a non-empty string')
    .max(
      MAX_PROMPT_LENGTH,
      `Prompt must not exceed ${MAX_PROMPT_LENGTH} characters`,
    ),
  model: z
    .string()
    .min(1, 'Model is required and must be a non-empty string')
    .regex(
      MODEL_PATTERN,
      'Model must be in "<provider>/<name>" format (e.g., "anthropic/claude-sonnet-4-20250514")',
    ),
});

/**
 * Zod schema for validating OpenCodeResponse payloads.
 * Used at the STAS←OpenCode boundary after receiving.
 */
export const OpenCodeResponseSchema = z.object({
  summary: z
    .string()
    .min(1, 'Summary is required and must be a non-empty string')
    .max(
      MAX_SUMMARY_LENGTH,
      `Summary must not exceed ${MAX_SUMMARY_LENGTH} characters`,
    ),
  confidence: z.enum(['high', 'medium', 'low'], {
    errorMap: () => ({ message: 'Confidence must be "high", "medium", or "low"' }),
  }),
  diff: z.string().optional(),
  branch: z
    .string()
    .regex(
      BRANCH_PATTERN,
      'Branch must be in "stas/fix-<number>-<hash>" format (e.g., "stas/fix-42-a1b2c3d")',
    )
    .optional(),
  testOutput: z.string().optional(),
  errors: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

// ---------------------------------------------------------------------------
// Inferred Types from Zod
// ---------------------------------------------------------------------------

/** Inferred type from OpenCodeRequestSchema — matches OpenCodeRequest. */
export type ParsedOpenCodeRequest = z.infer<typeof OpenCodeRequestSchema>;

/** Inferred type from OpenCodeResponseSchema — matches OpenCodeResponse. */
export type ParsedOpenCodeResponse = z.infer<typeof OpenCodeResponseSchema>;

// ---------------------------------------------------------------------------
// Contract Validation Methods
// ---------------------------------------------------------------------------

/**
 * Validate a potential OpenCode request payload.
 *
 * @param data - Raw unknown data to validate (e.g., from JSON.parse)
 * @returns ContractValidationResult with validated data or error messages
 *
 * @example
 * const result = OpenCodeContract.validateRequest({ prompt: "...", model: "..." });
 * if (!result.success) {
 *   console.error(result.errors);
 * }
 */
export function validateOpenCodeRequest(
  data: unknown,
): ContractValidationResult<OpenCodeRequest> {
  const parsed = OpenCodeRequestSchema.safeParse(data);

  if (parsed.success) {
    return {
      success: true,
      data: parsed.data,
    };
  }

  const errors = parsed.error.issues.map(
    (issue) => `[${issue.path.join('.')}] ${issue.message}`,
  );

  return {
    success: false,
    errors,
  };
}

/**
 * Validate a potential OpenCode response payload.
 *
 * @param data - Raw unknown data to validate (e.g., from response.json())
 * @returns ContractValidationResult with validated data or error messages
 *
 * @example
 * const result = OpenCodeContract.validateResponse(json);
 * if (!result.success) {
 *   // Handle malformed response — try fallback model
 * }
 */
export function validateOpenCodeResponse(
  data: unknown,
): ContractValidationResult<OpenCodeResponse> {
  const parsed = OpenCodeResponseSchema.safeParse(data);

  if (parsed.success) {
    return {
      success: true,
      data: parsed.data,
    };
  }

  const errors = parsed.error.issues.map(
    (issue) => `[${issue.path.join('.')}] ${issue.message}`,
  );

  return {
    success: false,
    errors,
  };
}

// ---------------------------------------------------------------------------
// Contract Class (convenience wrapper)
// ---------------------------------------------------------------------------

/**
 * Convenience class wrapping the OpenCode contract.
 * Provides static methods for versioning and validation.
 */
export class OpenCodeContract {
  /** Semantic version of this contract. */
  static readonly VERSION = CONTRACT_VERSION;

  /**
   * Validate a request payload before sending to OpenCode.
   * @see validateOpenCodeRequest
   */
  static validateRequest(
    data: unknown,
  ): ContractValidationResult<OpenCodeRequest> {
    return validateOpenCodeRequest(data);
  }

  /**
   * Validate a response payload received from OpenCode.
   * @see validateOpenCodeResponse
   */
  static validateResponse(
    data: unknown,
  ): ContractValidationResult<OpenCodeResponse> {
    return validateOpenCodeResponse(data);
  }
}
