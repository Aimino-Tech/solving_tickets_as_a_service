# GitHub App Permissions

> **Documentation of SYNTARO GitHub App permissions, scope justification, and minimum required access analysis.**
>
> Applies to: SYNTARO GitHub App (`syntaro-bot`)
> Last updated: 2026-07-13

---

## Overview

SYNTARO operates as a GitHub App to interact with repositories on behalf of users. GitHub Apps use **installation-scoped tokens** that are more secure than personal access tokens or OAuth apps because:

- Tokens are scoped to a single installation (one or more repositories)
- Tokens expire after 1 hour
- Permissions are declared upfront and cannot be changed at runtime
- The app acts as its own principal (not impersonating a user)

---

## Current Permissions

| Permission | Access Level | Required | Justification |
|---|---|---|---|
| **Issues** | Read & Write | Yes | Read issue content, title, labels, and comments to build agent prompts. Post status comments ("working on it", investigation results). Create and manage issue labels. |
| **Pull requests** | Read & Write | Yes | Create fix PRs with agent-generated changes. Post PR descriptions with fix summary, verification results, and quality gate evidence. Update PRs with new content. |
| **Contents** | Read & Write | Yes | Clone repository contents for agent investigation. Read source code, tests, and configuration files. Push fix branches with agent changes. |
| **Metadata** | Read (automatic) | Yes | Repository metadata (name, description, default branch). Automatically granted by GitHub; cannot be revoked. |

### Repository-Specific Scope

All permissions apply only to repositories where the app is installed. The app **cannot** access repositories where it is not installed, even if they belong to the same organization.

---

## Events Subscribed To

| Event | Purpose |
|---|---|
| **Issues** | Receive `issues.labeled` events (the primary trigger) and `issues.edited` events (handle issue updates) |
| **Issue comment** | Detect new comments on issues that may contain additional context or fix confirmation |
| **Pull request** | Track PR status updates (opened, closed, merged) for audit and result tracking |

---

## Minimum Required Scope Analysis

### Core Workflow Requirements

To complete its core workflow (label issue, investigate, create PR), SYNTARO needs:

1. **Read issue** (Issues: read) -- Get issue title, body, labels, comments
2. **Post comment** (Issues: write) -- Post progress updates and results
3. **Clone repository** (Contents: read) -- Read source code and tests
4. **Push branch** (Contents: write) -- Push fix branch with changes
5. **Create PR** (Pull requests: write) -- Open draft or ready PR

### Permission Reduction Analysis

| Permission | What if removed? | Risk of removal |
|---|---|---|
| Issues (write) | Cannot post status comments, blocking all user feedback | High -- users would have no visibility into progress |
| Contents (read) | Cannot read source code, making investigation impossible | Critical -- core functionality broken |
| Contents (write) | Cannot push fix branches or create PRs | Critical -- core functionality broken |
| Pull requests (write) | Cannot create PRs | Critical -- core functionality broken |

**Verdict**: All four permissions are required for core functionality. No permission can be removed without breaking the core workflow.

---

## Token Lifecycle

```
GitHub App (private key + app ID)
       |
       v
  JWT (JSON Web Token)
       |
       v
  Installation Token (1 hour TTL)
       |
       +-- scoped to 1 installation
       +-- carries declared permissions
       +-- used for all API operations
```

| Stage | Security Property |
|---|---|
| Private key stored as env var | Never logged, never committed, `chmod 600` |
| JWT generated per-session | Short-lived (10 minutes), signed with private key |
| Installation token | Generated per-installation, expires in 1 hour |
| Token in sandbox | Passed to ephemeral sandbox, destroyed with container |

---

## Token Scope During Sandbox Execution

When SYNTARO dispatches an agent to fix an issue, the installation token is passed to the sandbox for git operations. The token scope is limited to:

- **Repository**: The specific repository containing the issue
- **Actions**: `git clone`, `git push`, `git commit`, `git status`
- **Duration**: Token expires in 1 hour (sandbox run is typically 5-30 minutes)

The sandbox is ephemeral and destroyed after the run, so the token cannot persist or be reused.

---

## Comparison: GitHub App vs PAT

| Capability | GitHub App | Personal Access Token (PAT) |
|---|---|---|
| **Token scope** | Per-installation, per-repo | Per-user, all accessible repos |
| **Token expiry** | 1 hour | Configurable (up to no expiry) |
| **Audit trail** | App actor in audit log | User actor |
| **Permission granularity** | Repository-level | User-level |
| **Rate limit** | Higher (with app) | Lower (user-scoped) |
| **Secret rotation** | Automatic (tokens refresh) | Manual regeneration |

**SYNTARO uses GitHub App tokens exclusively for production.** PAT fallback is available only for local development and testing.

---

## Best Practices for Self-Hosting

When self-hosting SYNTARO, follow these permission best practices:

1. **Create a dedicated GitHub App** -- Do not share the app across unrelated projects
2. **Use a strong webhook secret** -- `openssl rand -hex 32`
3. **Restrict installation to needed repos** -- Install only on repositories that need auto-fix
4. **Rotate private key annually** -- Generate a new key in GitHub App settings
5. **Protect the private key** -- File permissions `600`, never commit to git
6. **Review audit log** -- Periodically check GitHub App audit log for unusual activity
7. **Use environment-specific apps** -- Consider separate apps for development, staging, and production

---

## FAQ

### Can SYNTARO access repositories where it is not installed?

No. GitHub App tokens are scoped to a specific installation. The app can only access repositories explicitly selected during installation.

### Can SYNTARO access other parts of the GitHub API (admin, billing)?

No. The app only has the permissions declared above. GitHub does not allow apps to access APIs beyond their declared scope.

### What happens when the token expires?

The agent run typically completes within 30 minutes. If a token expires mid-run, the agent will fail on the next API call. SYNTARO generates a fresh token for each new run. The system retries failed operations with a new token.

### Can I use a PAT instead of a GitHub App?

Yes, for local development. Set `GITHUB_TOKEN` in your `.env` file. This is not recommended for production due to the wider scope and lack of expiry of PATs.

---

## References

- [GitHub App Permissions Documentation](https://docs.github.com/en/apps/creating-a-github-app/setting-permissions-for-github-apps)
- [GitHub App Authentication](https://docs.github.com/en/apps/creating-a-github-app/authenticating-with-a-github-app)
- [SYNTARO Security Model](../docs/SECURITY.md)
- [SYNTARO Security Threat Model](../docs/security/threat-model.md)
- [Self-Hosting Guide](../docs/SELF_HOSTING.md)
