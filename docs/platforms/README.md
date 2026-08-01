# Multi-Platform Support

STAS supports multiple Git hosting platforms. Below is the current status.

| Platform   | Status      | Webhook | Agent Pipeline | CI Integration | Eval |
|------------|-------------|---------|---------------|----------------|------|
| GitHub     | ✅ Live     | ✅      | ✅             | ✅             | ✅   |
| GitLab     | 🚧 Beta     | ✅      | ✅ W8-T2      | ✅ W8-T3       | ✅   |
| Bitbucket  | 🚧 Beta     | ✅      | ✅ W9-T1      | ✅ W9-T2       | ✅   |

## Common Sense Gate (AIM-3182 / AIM-4496)

The **Common Sense Gate** rejects hallucinated, malformed, or dangerous inputs
before they reach the agent pipeline.

**Wiring (AIM-4496):** `runCommonSenseGateOnJob` runs inside the webhook
dispatch choke point (`enqueueIssue` in `src/server.ts`), so every webhook
(GitHub, GitLab, Bitbucket, Linear, Jira) is gated before dispatch. The hard
file guardrails also block PR creation in `src/github/actionDispatcher.ts` when
the proposed diff deletes a protected manifest or touches a protected path.

| Check | What it validates |
|-------|-------------------|
| **Platform URL** | Hostname matches expected platform. Extracts owner/repo. |
| **Issue Reference** | Number is positive integer <= 1,000,000. |
| **Repo Name** | Alphanumeric + `._-`, no path traversal, no placeholders. |
| **Manifest Deletion** | Never delete `package.json`, lockfiles, etc. |
| **Protected Paths** | Never modify `workflows/`, CI definitions, `.env`, secrets. |
| **Cost-Benefit** | Heuristic ROI estimate to surface wasteful runs. |

Source: `src/guardrails/` (tests in `src/__tests__/guardrails/`)

## Platform Guides

- [GitLab Setup](gitlab-setup.md) — Self-hosted and GitLab.com
- [Bitbucket Setup](bitbucket-setup.md) — Bitbucket Cloud
- [Eval on Any Platform](eval.md) — Running evaluations across platforms
- [Adding a New Platform](development/adding-a-platform.md) — Developer guide
