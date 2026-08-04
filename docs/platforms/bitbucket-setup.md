# Bitbucket Setup Guide

SYNTARO supports Bitbucket Cloud end-to-end: a labeled Bitbucket issue
(`syntaro:fix`) triggers a fix run, status comments are posted on the issue,
and a draft pull request is opened on Bitbucket for human review.

The Bitbucket integration is a **real Bitbucket Marketplace app** (AIM-4633):
outbound API calls authenticate with the OAuth2 **client-credentials grant**
using the app's client id/secret — **not** raw app passwords.

## Prerequisites

- A Bitbucket workspace and repository (Cloud)
- Admin access to the repository
- SYNTARO instance running (see [DEVELOPMENT.md](../../DEVELOPMENT.md))
- A Bitbucket Marketplace app listing (installed from the Atlassian
  Marketplace; the listing itself is an external vendor-portal action)

## Step 1: Install the Marketplace app

1. Open the dashboard **Repos → Bitbucket Workspace** section and click
   **Install from Marketplace** (or visit the app's Atlassian Marketplace
   listing directly).
2. Choose the workspace you want to grant the app access to.
3. Review the requested scopes:
   - `repository:read`, `repository:write`
   - `issue:read`, `issue:write`
   - `pullrequest:read`, `pullrequest:write`
   - `webhook:read`, `webhook:write`
4. Install.

## Step 2: Configure SYNTARO (server side)

Set these variables on the SYNTARO instance (see [`.env.example`](../../.env.example)):

| Variable | Purpose |
|----------|---------|
| `BITBUCKET_CLIENT_ID` | Marketplace app client id (vendor portal) |
| `BITBUCKET_CLIENT_SECRET` | Marketplace app client secret (vendor portal) |
| `BITBUCKET_WORKSPACE` | Default workspace slug |
| `BITBUCKET_WEBHOOK_SECRET` | Secret used to verify webhook payloads (HMAC-SHA256) |
| `BITBUCKET_BASE_URL` | Defaults to `https://api.bitbucket.org` (Cloud) |
| `BITBUCKET_TOKEN_URL` | Defaults to `https://bitbucket.org/site/oauth2/access_token` |

The workspace can also be connected from the dashboard (**Repos → Bitbucket
Workspace**), which verifies the app credentials by fetching an access token
and listing the workspace repositories.

## Step 3: Configure the Webhook

1. Go to **Repository Settings → Webhooks** (or enable it from the dashboard:
   **Repos → Bitbucket Workspace → Enable SYNTARO** per repo — the dashboard
   registers the webhook with the SYNTARO webhook secret automatically)
2. Click **Add webhook**
3. Title: `SYNTARO Webhook`
4. URL: `https://your-syntaro-instance.com/webhook/bitbucket`
5. Select triggers:
   - Issue: Created, Updated
   - Pull request: Created, Updated
6. Set the **secret** to the same value as `BITBUCKET_WEBHOOK_SECRET`
7. Save the webhook

### Trigger

Label a Bitbucket issue with `syntaro:fix`. SYNTARO verifies the webhook
signature (HMAC-SHA256, `X-Hub-Signature` header), posts a **"working on
it"** comment, and dispatches a fix run. When the fix is ready a **draft
pull request** is opened on the repository and a result comment is posted.

## Step 4: Repository Variables (CI)

If you use Bitbucket Pipelines, add these to **Repository Settings →
Repository variables**:

| Variable | Value |
|----------|-------|
| `SYNTARO_API_KEY` | Your SYNTARO API key |

## Known Limitations

- `$BITBUCKET_WORKSPACE` not `$GITHUB_REPOSITORY` — CI variables differ
- Diff API returns inline format, not unified
- Code review API is different from GitHub's
- Bitbucket Server (on-premise) is not currently supported
- Pipeline schedules use different syntax than GitHub Actions cron
- One workspace per SYNTARO instance (self-host v1; credentials are
  instance-scoped, not per-user)
