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
It is wired into every path that dispatches an issue to the agent, so a
rejected issue never costs agent tokens or API calls.

### Where it is wired in

| Path | Location | Behaviour on rejection |
|------|----------|------------------------|
| GitHub webhooks (`issues.labeled`, `issues.edited`) | `src/webhooks/github.ts` | Posts a rejection comment on the issue, logs an audit `failed` event, returns |
| GitLab / Bitbucket / Linear / Jira / Telegram / WhatsApp webhooks | `enqueueIssue` in `src/server.ts` | Logs a warning, returns `undefined` (not dispatched) |
| RabbitMQ fix-queue consumer | `src/server.ts` | Logs a warning, skips dispatch |
| `WebhookRouter.enqueue` | `src/webhooks/webhookRouter.ts` | Throws `CommonSenseGateError` |

### Checks

| Check | What it validates |
|-------|-------------------|
| **Platform** | Source is one of the supported platforms. |
| **Platform URL** | Hostname matches expected platform. Extracts owner/repo. |
| **Issue Reference** | Number is positive integer <= 1,000,000. |
| **Repo Name** | Alphanumeric + `._-`, no path traversal, no placeholders. |
| **Branch Name** | Git ref rules: no `..`, `@{`, space, control chars. |
| **Webhook URL** | Path matches expected per platform. |
| **Invariants** | Issue body does not request destructive actions: deleting `package.json`, modifying/deleting CI workflow files, force-pushing the default branch, or deleting the repository. |

Source: `src/guardrails/` (tests in `src/__tests__/guardrails/`)

### Cost / benefit

The gate costs a few microseconds per webhook: a handful of regex matches
and, only when a URL is present, a single `URL` parse. No I/O, no network,
no model calls. In return it rejects hallucinated or hostile issue content
before the agent pipeline is invoked — no model tokens, sandbox time, or
platform API calls are spent on requests that could never produce a valid
PR, and repositories are protected from destructive instructions such as
deleting `package.json` or tampering with CI workflow files. The gate is
fail-closed: anything it rejects is never dispatched.

## Platform Guides

- [GitLab Setup](gitlab-setup.md) — Self-hosted and GitLab.com
- [Bitbucket Setup](bitbucket-setup.md) — Bitbucket Cloud
- [Eval on Any Platform](eval.md) — Running evaluations across platforms
- [Adding a New Platform](development/adding-a-platform.md) — Developer guide
