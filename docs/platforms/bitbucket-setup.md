# Bitbucket Setup Guide

SYNTARO supports Bitbucket Cloud end-to-end: a labeled Bitbucket issue
(`syntaro:fix`) triggers a fix run, status comments are posted on the issue,
and a draft pull request is opened on Bitbucket for human review.

## Prerequisites

- A Bitbucket workspace and repository (Cloud)
- Admin access to the repository
- A SYNTARO account (dashboard login) **or** a self-hosted instance with env vars

## Step 1: Connect from the dashboard (recommended — OAuth)

Any logged-in user can connect their Bitbucket workspace with one click:

1. Open **Settings → Source Control → Bitbucket** (or **Repos → Bitbucket Workspace**)
2. Click **Connect with Bitbucket**
3. Approve the SYNTARO OAuth client in Bitbucket
4. You return to Settings showing **Manage** + workspace name
5. On **Repos**, enable **SYNTARO** per repository to install the webhook

No API token and no email paste — Bitbucket issues a Bearer access token.

### Operator setup (one-time): OAuth client

Bitbucket UI may say **OAuth clients** (newer) or **OAuth consumers** (older docs) — same thing.

1. Open workspace settings → Apps and features → **OAuth clients**  
   Example: `https://bitbucket.org/<workspace>/workspace/settings/oauth-clients`
2. **Add** / create a client
3. Callback URL: `https://<your-syntaro-host>/api/v1/auth/bitbucket/callback`  
   (local API: `http://localhost:3002/api/v1/auth/bitbucket/callback`)
4. Permissions: Account, Repositories (R/W), Pull requests (R/W), Issues (R/W), Webhooks
5. Save — copy **Key** + **Secret** into the SYNTARO **server** env (not end-user machines):

| Variable | Purpose |
|----------|---------|
| `BITBUCKET_OAUTH_CLIENT_ID` | OAuth client key |
| `BITBUCKET_OAUTH_CLIENT_SECRET` | OAuth client secret |
| `SYNTARO_PUBLIC_URL` | API public URL (OAuth **callback** host), e.g. `http://localhost:3002` |
| `SYNTARO_FRONTEND_URL` | Dashboard SPA URL (OAuth **return**), e.g. `http://localhost:5173` |

> Local tip: callback stays on the API (`:3002`); after approve, users must return to the Vite app (`:5173`) where the JWT lives. Do not point the post-login redirect at the API port.

### Fallback: API token

If OAuth is not configured, use **Use API token instead** in Settings.
See Step 2. API tokens still need Basic auth with your Atlassian email
(= SYNTARO login email).

One Bitbucket workspace can be linked to one SYNTARO user. Reconnecting as the
same user updates credentials; another user connecting the same workspace gets
a conflict.

### Self-host env fallback

If no per-user connection exists for a workspace, the webhook runtime falls
back to instance env:

| Variable | Purpose |
|----------|---------|
| `BITBUCKET_OAUTH_CLIENT_ID` | Dashboard OAuth connect (recommended) |
| `BITBUCKET_OAUTH_CLIENT_SECRET` | Dashboard OAuth connect |
| `BITBUCKET_USERNAME` | Atlassian account email (API token / env fallback) |
| `BITBUCKET_API_TOKEN` | Atlassian API token with Bitbucket scopes |
| `BITBUCKET_APP_PASSWORD` | Legacy alias for the same token value |
| `BITBUCKET_WORKSPACE` | Default workspace slug (optional) |
| `BITBUCKET_WEBHOOK_SECRET` | Secret used to verify webhook payloads (HMAC-SHA256) |
| `BITBUCKET_BASE_URL` | Defaults to `https://api.bitbucket.org` (Cloud) |

`BITBUCKET_WEBHOOK_SECRET` is always instance-scoped (all user-created webhooks
share this secret for signature verification).

## Step 2: Create an API Token

1. Open [Atlassian API tokens](https://id.atlassian.com/manage-profile/security/api-tokens)
   (or Bitbucket profile → **Account settings** → **Security** → **Create and manage API tokens**)
2. Click **Create API token with scopes** (not a plain API token without scopes)
3. Name the token, set an expiration, choose app **Bitbucket**, then grant these scopes:

### Required Bitbucket scopes for SYNTARO

| Category (UI) | Level | Scope |
|---------------|-------|-------|
| User | Read | `read:user:bitbucket` |
| Workspaces | Read | `read:workspace:bitbucket` |
| Repositories | Read + Write | `read:repository:bitbucket`, `write:repository:bitbucket` |
| Pull requests | Read + Write | `read:pullrequest:bitbucket`, `write:pullrequest:bitbucket` |
| Issues | Read + Write | `read:issue:bitbucket`, `write:issue:bitbucket` |
| Webhooks | Read + Write (+ Delete to remove hooks) | `read:webhook:bitbucket`, `write:webhook:bitbucket` |

Do **not** need: Pipelines, Runners, Snippets, SSH/GPG, Projects Admin, Workspace Admin.

4. Click **Create**, copy the token immediately (shown once)
5. Paste it into the dashboard connect form
   (or set `BITBUCKET_USERNAME` + `BITBUCKET_API_TOKEN` for self-host)

Authentication uses **Basic auth**: **Atlassian account email** (= SYNTARO login email) + API token.

A token without Bitbucket scopes fails with `API Token provided has no Bitbucket scopes` or
`Token is invalid, expired, or not supported for this endpoint`.

### Security note

If an API token was ever pasted into chat, logs, or a ticket, **revoke it immediately**
at [Atlassian API tokens](https://id.atlassian.com/manage-profile/security/api-tokens)
and create a new token with the scopes above before connecting again.

## Step 3: Configure the Webhook

1. Prefer the dashboard: **Repos → Bitbucket Workspace → Enable SYNTARO** per repo
2. Or manually: **Repository Settings → Webhooks → Add webhook**
   - Title: `SYNTARO Webhook`
   - URL: `https://your-syntaro-instance.com/webhook/bitbucket`
   - Triggers: Issue Created/Updated, Pull request Created/Updated
   - Secret: same value as `BITBUCKET_WEBHOOK_SECRET`

### Trigger

Label a Bitbucket issue with `syntaro:fix`. SYNTARO verifies the webhook
signature (HMAC-SHA256, `X-Hub-Signature` header), resolves the workspace’s
stored API token (or env fallback), posts a **"working on it"** comment,
and dispatches a fix run. When the fix is ready a **draft pull request** is
opened on the repository and a result comment is posted.

## Step 4: Repository Variables (CI)

If you use Bitbucket Pipelines, add these to **Repository Settings →
Repository variables**:

| Variable | Value |
|----------|-------|
| `SYNTARO_API_KEY` | Your SYNTARO API key |
| `BITBUCKET_USERNAME` | Your Atlassian account email |
| `BITBUCKET_API_TOKEN` | Your Atlassian API token (with Bitbucket scopes) |

## Verification (local)

```bash
# Expect non-null — migration 024 applied
# SELECT to_regclass('public.bitbucket_connections');

# Token sanity (use a NEW token with Bitbucket scopes; never commit secrets)
curl -s -u "$ATLASSIAN_EMAIL:$API_TOKEN" https://api.bitbucket.org/2.0/user

# Connect with JWT from dashboard localStorage
curl -s -X POST http://127.0.0.1:3002/api/v1/bitbucket/connect \
  -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' \
  -d "{\"apiToken\":\"$API_TOKEN\",\"email\":\"$ATLASSIAN_EMAIL\"}"

# Status must not return the token
curl -s http://127.0.0.1:3002/api/v1/bitbucket/status \
  -H "Authorization: Bearer $JWT"
```

Unauthenticated `POST /connect` must return `401 Authentication required`.

## Known Limitations

- `$BITBUCKET_WORKSPACE` not `$GITHUB_REPOSITORY` — CI variables differ
- Diff API returns inline format, not unified
- Code review API is different from GitHub's
- Bitbucket Server / Data Center is not currently supported
- Pipeline schedules use different syntax than GitHub Actions cron
- One Bitbucket workspace ↔ one SYNTARO user (unique workspace constraint)
- Webhook HMAC secret is instance-scoped (`BITBUCKET_WEBHOOK_SECRET`)
- OAuth “Connect with Bitbucket” is supported via `BITBUCKET_OAUTH_CLIENT_*`
- API token connect remains as a fallback when OAuth is not configured
