/**
 * Webhook payload validation with Zod.
 *
 * Provides Zod schemas for all supported GitHub webhook events and a
 * validation function that returns structured error information.
 * Runs after @octokit/webhooks signature verification but before any
 * business logic — defense-in-depth against malformed payloads.
 *
 * ── Governance Proxy Migration ──────────────────────────────────────
 * Per-route schema validation is being centralized in the governance proxy.
 * Webhook-specific Zod schemas remain here for now (domain-specific business
 * logic validation). Remove general-purpose validation helpers once proxy
 * handles all request schemas centrally.
 *
 * See: src/governance/validation.ts for proxy delegation helpers.
 * ────────────────────────────────────────────────────────────────────
 *
 * ── Error Handling Audit ────────────────────────────────────────────
 * ✅ Uses Zod safeParse — never throws, always returns ValidationResult
 * ✅ Unknown event types are handled gracefully (return success: true)
 * ✅ Errors are structured as human-readable strings (no raw stack traces)
 * ✅ No silent failures — every validation path returns a clear result
 * ────────────────────────────────────────────────────────────────────
 */

import { z } from 'zod';

// ── Shared embedded schemas ─────────────────────────────────────────

const installationSchema = z.object({
  id: z.number(),
});

const repositorySchema = z.object({
  name: z.string(),
  owner: z.object({ login: z.string() }),
  private: z.boolean().optional(),
  clone_url: z.string().optional(),
});

const issueSchema = z.object({
  number: z.number(),
  title: z.string(),
  body: z.string().nullable(),
  html_url: z.string().optional(),
  labels: z.array(z.object({ name: z.string() })).optional(),
});

const senderSchema = z
  .object({
    login: z.string(),
    id: z.number(),
  })
  .optional();

// ── issues.labeled ──────────────────────────────────────────────────

export const issueLabeledSchema = z.object({
  installation: installationSchema,
  repository: repositorySchema,
  issue: issueSchema,
  label: z
    .object({
      name: z.string(),
    })
    .nullable()
    .optional(),
  action: z.string().optional(),
  sender: senderSchema,
});

// ── issues.opened (same as labeled, without label) ──────────────────

export const issueOpenedSchema = issueLabeledSchema.omit({ label: true });

// ── marketplace_purchase ────────────────────────────────────────────

export const marketplacePurchaseSchema = z.object({
  action: z.string(),
  effective_date: z.string().optional(),
  marketplace_purchase: z.object({
    account: z.object({
      id: z.number(),
      type: z.string().optional(),
    }),
    plan: z.object({
      name: z.string(),
    }),
  }),
  sender: senderSchema,
});

// ── Schema registry ─────────────────────────────────────────────────

/**
 * Map of webhook event names (x-github-event header value) to their
 * corresponding Zod validation schemas.
 */
export const webhookSchemas = Object.freeze({
  'issues.labeled': issueLabeledSchema,
  'issues.opened': issueOpenedSchema,
  marketplace_purchase: marketplacePurchaseSchema,
} as const);

export type WebhookEventName = keyof typeof webhookSchemas;

// ── Validation result types ─────────────────────────────────────────

export interface ValidationSuccess {
  success: true;
  data: unknown;
}

export interface ValidationFailure {
  success: false;
  errors: string[];
}

export type ValidationResult = ValidationSuccess | ValidationFailure;

// ── validateWebhookPayload ──────────────────────────────────────────

/**
 * Validate a webhook payload against the schema for the given event.
 *
 * @param event  The x-github-event header value (e.g. "issues.labeled")
 * @param payload  The parsed JSON payload to validate
 * @returns  `{ success: true, data }` or `{ success: false, errors: string[] }`
 *
 * Errors are human-readable strings like "Missing required field: issue.number"
 * or "Invalid field: issue.title — Expected string, received number".
 */
export function validateWebhookPayload(event: string, payload: unknown): ValidationResult {
  const schema = webhookSchemas[event as WebhookEventName] ?? null;

  if (!schema) {
    // Unknown event — no schema to validate against. We consider this
    // valid since we may not have schemas for every event type, and we
    // don't want to reject webhooks for events we don't know about yet.
    return { success: true, data: payload };
  }

  const result = schema.safeParse(payload);

  if (result.success) {
    return { success: true, data: result.data };
  }

  const errors = result.error.issues.map((issue) => {
    const path = issue.path.join('.');
    if (issue.code === 'invalid_type' && issue.received === 'undefined') {
      return `Missing required field: ${path}`;
    }
    return `Invalid field: ${path} — ${issue.message}`;
  });

  return { success: false, errors };
}
