# Bitbucket Setup Guide

SYNTARO supports Bitbucket Cloud end-to-end: a labeled Bitbucket issue
(`syntaro:fix`) triggers a fix run, status comments are posted on the issue,
and a draft pull request is opened on Bitbucket for human review.

## Prerequisites

- A Bitbucket workspace and repository (Cloud)
- Admin access to the repository
- SYNTARO instance running (see [DEVELOPMENT.md](../../DEVELOPMENT.md))

## Step 1: Configure SYNTARO (server side)

Set these variables on the SYNTARO instance (see [`.env.example`](../../.env.example)):

| Variable | Purpose |
|----------|---------|
| `BITBUCKET_USERNAME` | Bitbucket username (or workspace account) |
| `BITBUCKET_APP_PASSWORD` | Bitbucket app password (see Step 2) |
| `BITBUCKET_WORKSPACE` | Default workspace slug |
| `BITBUCKET_WEBHOOK_SECRET` | Secret used to verify webhook payloads (HMAC-SHA256) |
| `BITBUCKET_BASE_URL` | Defaults to `https://api.bitbucket.org` (Cloud) |

The workspace can also be connected from the dashboard (**Repos → Bitbucket
Workspace** or **Settings → Integrations**), which verifies the credentials
and lists the workspace repositories.

## Step 2: Create an App Password

1. Go to **Bitbucket account settings → App passwords** (https://bitbucket.org/account/settings/app-passwords/)
2. Click **Create app password**
3. Grant these permissions:
   - Pull requests: **Read, Write**
   - Issues: **Read, Write**
   - Webhooks: **Read, Write**
   - Repositories: **Read**
4. Copy the generated password into `BITBUCKET_APP_PASSWORD`

## Step 3: Configure the Webhook

1. Go to **Repository Settings → Webhooks** (or enable it from the dashboard:
   **Repos → Bitbucket Workspace → Enable SYNTARO** per repo)
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
| `BITBUCKET_USERNAME` | Your Bitbucket username |
| `BITBUCKET_APP_PASSWORD` | Your Bitbucket app password |

## Known Limitations

- `$BITBUCKET_WORKSPACE` not `$GITHUB_REPOSITORY` — CI variables differ
- Diff API returns inline format, not unified
- Code review API is different from GitHub's
- Bitbucket Server (on-premise) is not currently supported
- Pipeline schedules use different syntax than GitHub Actions cron
- One workspace per SYNTARO instance (self-host v1; credentials are
  instance-scoped, not per-user)
