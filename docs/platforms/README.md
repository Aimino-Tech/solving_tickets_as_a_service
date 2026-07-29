# Multi-Platform Support

STAS supports multiple Git hosting platforms. Below is the current status.

| Platform   | Status      | Webhook | Agent Pipeline | CI Integration | Eval |
|------------|-------------|---------|---------------|----------------|------|
| GitHub     | ✅ Live     | ✅      | ✅             | ✅             | ✅   |
| GitLab     | 🚧 Beta     | ✅      | ✅ W8-T2      | ✅ W8-T3       | ✅   |
| Bitbucket  | 🚧 Beta     | ✅      | ✅ W9-T1      | ✅ W9-T2       | ✅   |

## Common Sense Gate (AIM-3182)

The **Common Sense Gate** is a set of guardrail validators that reject
hallucinated or malformed inputs before they reach the agent pipeline.

| Check | What it validates |
|-------|-------------------|
| **Platform URL** | Hostname matches expected platform. Extracts owner/repo. |
| **Issue Reference** | Number is positive integer <= 1,000,000. |
| **Repo Name** | Alphanumeric + `._-`, no path traversal, no placeholders. |
| **Branch Name** | Git ref rules: no `..`, `@{`, space, control chars. |
| **Webhook URL** | Path matches expected per platform. |

Source: `src/guardrails/` (52 tests in `src/__tests__/guardrails/`)

## Platform Guides

- [GitLab Setup](gitlab-setup.md) — Self-hosted and GitLab.com
- [Bitbucket Setup](bitbucket-setup.md) — Bitbucket Cloud
- [Eval on Any Platform](eval.md) — Running evaluations across platforms
- [Adding a New Platform](development/adding-a-platform.md) — Developer guide
