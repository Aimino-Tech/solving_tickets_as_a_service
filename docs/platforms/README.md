# Multi-Platform Support

STAS supports multiple Git hosting platforms. Below is the current status.

| Platform   | Status      | Webhook | Agent Pipeline | CI Integration | Eval |
|------------|-------------|---------|---------------|----------------|------|
| GitHub     | ✅ Live     | ✅      | ✅             | ✅             | ✅   |
| GitLab     | 🚧 Beta     | ✅      | ✅ W8-T2      | ✅ W8-T3       | ✅   |
| Bitbucket  | 🚧 Beta     | ✅      | ✅ W9-T1      | ✅ W9-T2       | ✅   |

## Common Sense Gate (AIM-3182 / AIM-4496)

The **Common Sense Gate** is a set of guardrail validators that reject
hallucinated or malformed inputs before they reach the agent pipeline. It is
wired into the webhook → dispatch path (fail-closed): any GitHub issue labeled
`stas:fix` that fails the gate is saved as `blocked` and rejected pre-pipeline,
with a block comment posted back to the issue.

| Check | What it validates |
|-------|-------------------|
| **Platform URL** | Hostname matches expected platform. Extracts owner/repo. |
| **Issue Reference** | Number is positive integer <= 1,000,000. |
| **Repo Name** | Alphanumeric + `._-`, no path traversal, no placeholders. |
| **Issue Content** | Rejects requests to delete manifest/lockfiles (`package.json`, lockfiles) or modify workflow definitions (`workflows/`, `.github/workflows/`). |
| **Cost-Benefit** | Rejects empty, near-empty, or unbounded-scope requests before agent cost is spent. |
| **Branch Name** | Git ref rules: no `..`, `@{`, space, control chars. |
| **Webhook URL** | Path matches expected per platform. |

Source: `src/guardrails/` (tests in `src/__tests__/guardrails/`). The gate is
invoked from `src/webhooks/github.ts` (`issues.labeled`) via
`runCommonSenseGate` in `src/guardrails/commonSenseGate.ts`, which also powers
the shared `WebhookRouter` (`src/webhooks/webhookRouter.ts`).

## Platform Guides

- [GitLab Setup](gitlab-setup.md) — Self-hosted and GitLab.com
- [Bitbucket Setup](bitbucket-setup.md) — Bitbucket Cloud
- [Eval on Any Platform](eval.md) — Running evaluations across platforms
- [Adding a New Platform](development/adding-a-platform.md) — Developer guide
