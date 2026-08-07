# SYNTARO Bitbucket App (Forge)

Workspace-installable Bitbucket app for SYNTARO — the Bitbucket equivalent of
the SYNTARO GitHub App. Users install the app into their Bitbucket workspace
with a single install link (no API tokens, no app passwords, no email paste).

The app is a **thin Forge Remote proxy**: it subscribes to Bitbucket events and
forwards them to the SYNTARO backend (`Forge Remote`), which does the actual
work (agent fix runs, git operations, draft PRs) using the per-invocation
`x-forge-oauth-system` token delivered by Atlassian.

## Why Forge (not Connect / not OAuth consumer)

- Atlassian **Connect for Bitbucket Cloud is end-of-life**: new app registration
  stopped Feb 2, 2026, updates Mar 31, 2026, end of support Dec 31, 2026.
- **App passwords are deprecated** (stopped working June 9, 2026) — the old
  per-user API-token flow is dead.
- Bitbucket **built-in Issues are removed Aug 20, 2026** — triggers move from
  "label an issue" to **PR commands** (`/syntaro fix` comment on a PR).
- Forge is the only Atlassian-supported path for a workspace-installable app,
  and **draft PRs are supported** (GA Aug 5, 2026) — full GitHub-App parity.

## Architecture

```
Bitbucket workspace (user)
        │ 1. admin clicks install link
        ▼
Forge app (this dir, thin remote proxy)
        │ 2. trigger events forwarded to SYNTARO backend
        │    + x-forge-oauth-system token + FIT token
        ▼
SYNTARO backend — /forge/remote/*   (src/forge/)
        │ 3. verifies FIT, caches token, resolves workspace
        │ 4. enqueues fix job (PR-completion)
        ▼
Agent pipeline (OpenCode) — git clone/push via x-token-auth,
draft PR via Bitbucket REST, status comments on the PR
```

Events subscribed (modules.trigger):

| Event | Purpose |
|-------|---------|
| `avi:bitbucket:created:pullrequest-comment` | User comments `/syntaro fix` on a PR → bot completes it |
| `avi:bitbucket:created:pullrequest` | PR description contains `syntaro:fix` marker → bot takes over |
| `avi:forge:installed:app` / `avi:forge:upgraded:app` | Register the installation in SYNTARO |
| `scheduledTrigger` (hourly) | Keep a fresh `x-forge-oauth-system` token available |
| `preUninstall` | Remove the installation record |

## Requirements

- Node.js 20+ and the [Forge CLI](https://developer.atlassian.com/platform/forge/set-up-forge/)
  (`npm install -g @forge/cli`), authenticated with an Atlassian account that
  owns a **team workspace** (Forge apps do not install on personal workspaces).
- A running SYNTARO backend reachable from the internet
  (`SYNTARO_PUBLIC_URL` / `SYNTARO_FORGE_REMOTE_URL`).

## Install & deploy (one-time, done by SYNTARO ops)

```bash
cd bitbucket-forge

# 1. Authenticate Forge CLI
forge login

# 2. Register the app (use an environment: development/staging/production)
forge register

# 3. Set the remote backend URL (the manifest uses ${SYNTARO_FORGE_REMOTE_URL})
#    e.g. https://api.syntaro.io/forge/remote  — MUST end with /forge/remote
forge variables set SYNTARO_FORGE_REMOTE_URL "https://api.syntaro.io/forge/remote"

# 4. Deploy
forge deploy

# 5. Enable sharing so any workspace admin can install via link
#    Developer console → your app → Distribution → enable sharing
#    → copy the install link, e.g.
#    https://developer.atlassian.com/console/install/<app-id>?signature=...&product=bitbucket
```

> The install link works **without a Marketplace listing**. It stops working if
> the app is submitted to the Marketplace or the manifest adds a license.

## User install (one click, done by each workspace admin)

1. Workspace admin clicks the install link.
2. Bitbucket asks to grant the requested scopes — approve.
3. App appears under **Workspace settings → Apps → Installed apps**.
4. The user opens a draft PR and comments `/syntaro fix` — SYNTARO completes it.

## Trigger syntax (PR command)

On any PR (draft or open) in an installed workspace:

```
/syntaro fix
```

SYNTARO: fetches the PR description, runs the agent on the PR's source branch,
pushes the fix to the same branch, updates the PR, and posts status comments.

Alternatively, put `syntaro:fix` in the PR description when creating the PR.

## Backend env vars (SYNTARO server)

| Variable | Purpose |
|----------|---------|
| `FORGE_APP_ID` | The Forge app id (`ari:cloud:ecosystem::app/...`) — validates FIT `aud` |
| `FORGE_JWKS_URL` | Forge FIT JWKS endpoint (default `https://forge.cdn.prod.atlassian-dev.net/.well-known/jwks.json`) |
| `FORGE_SKIP_FIT_VERIFY` | `true` only for local dev without a JWKS reachable |
| `SYNTARO_PUBLIC_URL` | Public API URL (already used by OAuth callback) |
| `SYNTARO_FORGE_REMOTE_URL` | `<SYNTARO_PUBLIC_URL>/forge/remote` — the manifest `remotes.baseUrl` |

Backend implementation lives in `src/forge/` (FIT verification, remote
endpoints, token caching) and `src/db/repositories/BitbucketForgeInstallationRepository.ts`
(installation registry). See `docs/platforms/bitbucket-forge-app.md` for the
full design and operational notes.
