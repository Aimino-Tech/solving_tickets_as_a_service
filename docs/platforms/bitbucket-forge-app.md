# SYNTARO Bitbucket App (Forge) — Design & Operations

The SYNTARO Bitbucket App is the **Bitbucket equivalent of the SYNTARO GitHub
App**: a workspace-installable app users connect with **one click** — no API
tokens, no app passwords, no email paste.

The app is built on **Atlassian Forge** (the only Atlassian-supported path for
workspace-installable Bitbucket Cloud apps — Connect is end-of-life) using the
**Forge Remote** pattern: the app is a thin event-forwarder; all real work
(agent fix runs, git operations, PRs) happens in the SYNTARO backend.

## Why this design (Aug 2026)

| Platform fact | Consequence for SYNTARO |
|---|---|
| Bitbucket **built-in Issues removed Aug 20, 2026** | The old "label issue `syntaro:fix`" trigger is dead. New trigger: **PR command** (`/syntaro fix` comment) or `syntaro:fix` marker in the PR description. |
| **Connect apps EOL** (new registrations stopped Feb 2, 2026; EoS Dec 31, 2026; OAuth 1.0 retired Feb 27, 2026) | Cannot build a "Bitbucket Connect app". Forge is the only supported app path. |
| **App passwords deprecated** (stopped working June 9, 2026) | The `BITBUCKET_API_TOKEN` fallback is dead for new users. Forge's bot identity replaces it. |
| **Draft PRs GA Aug 5, 2026** | `{"draft": true}` supported — full GitHub-App PR parity. |
| Forge apps installable **by link without Marketplace** | One-click install for workspace admins; no listing/review required (until submitted to Marketplace). |

## Architecture

```
Bitbucket workspace (user)
        │ 1. admin clicks install link (from SYNTARO distribution page)
        ▼
Forge app (bitbucket-forge/ — thin remote proxy)
        │ 2. trigger events + x-forge-oauth-system token + FIT token
        ▼
SYNTARO backend — POST /forge/remote/*   (src/forge/remote.ts)
        │ 3. verify FIT (JWKS), rotate token into DB, resolve workspace slug
        │ 4. parse /syntaro fix → enqueue PR-completion job
        ▼
Agent pipeline (OpenCode/OpenSymphony)
        │ 5. git clone/push via https://x-token-auth:{systemToken}@bitbucket.org/...
        │ 6. status comments + draft PR via Bitbucket REST (bot identity)
        ▼
PR updated — user reviews
```

### Components

| Component | Location | Responsibility |
|---|---|---|
| Forge app manifest | `bitbucket-forge/manifest.yml` | Triggers (PR comment, PR created, lifecycle, scheduled), endpoints, remotes, scopes |
| FIT verification | `src/forge/fit.ts` | Verify Forge Invocation Token against JWKS; extract `app.apiBaseUrl`, `app.installationId`, system token |
| Remote router | `src/forge/remote.ts` | `/events`, `/lifecycle`, `/uninstall`, `/token-refresh` |
| Installation registry | `src/db/repositories/BitbucketForgeInstallationRepository.ts` (+ migration 028) | installation_id → workspace UUID/slug + cached bot token (encrypted) |
| Client resolution | `src/webhooks/bitbucket.ts` `resolveBitbucketClient` | Prefers Forge bot identity → per-user OAuth → env fallback |

## Event flow — `/syntaro fix` PR command

1. User opens a (draft) PR on the workspace and comments `/syntaro fix`.
2. Forge fires `avi:bitbucket:created:pullrequest-comment` to
   `POST /forge/remote/events` with `x-forge-oauth-system` + FIT.
3. Backend verifies the FIT, persists/rotates the bot token, resolves the
   workspace slug, fetches the comment text (`GET …/pullrequests/{id}/comments/{commentId}`
   — the Forge payload carries only the comment id).
4. Command parsed → PR description fetched → job enqueued:
   `source: 'bitbucket'`, `jobKind: 'pr-completion'`, `forgeInstallationId`, `forgeWorkspaceUuid`.
5. Backend posts a "working on it" comment as the bot.
6. Worker resolves the bot client via `resolveBitbucketClient(workspaceSlug)`,
   clones the PR's **source branch** (`x-token-auth`), runs the agent, pushes
   to the same branch, updates the PR.

### PR-description marker

`avi:bitbucket:created:pullrequest` with `syntaro:fix` in the description
enqueues the same job — handy when users prefer not to comment.

### Self-generated events

Every payload carries `selfGenerated` — the backend skips events the bot
caused (its own PR comments, its own pushes) to avoid loops.

## Token lifecycle

- Tokens in `x-forge-oauth-system` are JWTs, max TTL 4h (cached by Atlassian,
  valid ~2–4h). The backend uses the `exp` claim.
- The token is rotated into `bitbucket_forge_installations` on **every**
  invocation (events, lifecycle, scheduled).
- An **hourly scheduled trigger** (`/forge/remote/token-refresh`) keeps a fresh
  token available so the worker never waits for the next event.
- There is no proactive refresh endpoint (documented Forge limitation).
- **No uninstall event exists** (FRGE-1246) — the `preUninstall` module fires
  the `/uninstall` endpoint (55s window). 4xx from Atlassian APIs also signal
  an uninstallation; scheduled-trigger silence is the fallback detection.

## Security

- FIT signature verified against the Forge JWKS (`FORGE_JWKS_URL`, default
  `https://forge.cdn.prod.atlassian-dev.net/.well-known/jwks.json`), cached 1h,
  plus `aud`/`app.id` check against `FORGE_APP_ID` when set.
- `FORGE_SKIP_FIT_VERIFY=true` is dev-only (decodes claims without signature).
- Bot tokens are stored **encrypted** (AES-256-GCM, same as OAuth tokens).
- Scope set is minimal: repos read/write (clone/push), PRs read/write
  (comments/draft PRs), workspace/user read (slug/identity), `read:app-system-token`.

## Setup (one-time, SYNTARO ops)

```bash
cd bitbucket-forge
forge login
forge register                        # app id → set FORGE_APP_ID in backend env
forge variables set SYNTARO_FORGE_REMOTE_URL "https://api.syntaro.io/forge/remote"
forge deploy
# Developer console → Distribution → enable sharing → copy install link
```

Backend env: `FORGE_APP_ID`, `FORGE_JWKS_URL` (optional), `SYNTARO_PUBLIC_URL`,
`SYNTARO_FORGE_REMOTE_URL`. Migration `028` must be applied.

## User experience

- Workspace admin clicks the install link → approves scopes → app installed
  (Workspace settings → Apps → Installed apps).
- Open a draft PR → comment `/syntaro fix` → SYNTARO completes it.
- No API keys, no app passwords, no email paste.

## Known limitations / follow-ups

- **Worker PR-completion behavior**: `jobKind: 'pr-completion'` is emitted and
  carried through the queue; the agent must be told to work on the PR's source
  branch (vs. opening a fresh branch) — pipeline integration in `dispatch/osDispatch.ts`
  / OpenCode prompt. Until wired, jobs fall back to the issue-fix flow.
- Forge apps install on **team workspaces only** (not personal workspaces).
- Forge cannot manage webhooks via REST (scopes rejected at `forge deploy`) —
  events come through the `trigger` module instead.
- Bitbucket has **no Checks API** — PR quality status is delivered via comments.
- Rate limits: Forge asApp gets scaled limits (up to 10,000 RPH on
  `/2.0/repositories/*`); the hourly token-refresh adds negligible load.
- Cross-workspace APIs (`GET /2.0/repositories`) EOL Apr 14, 2026 — all calls
  are workspace-scoped (`/2.0/repositories/{workspace}/{repo}/…`).
