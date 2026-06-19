# Bitbucket Setup Guide

## Prerequisites

- A Bitbucket workspace and repository (Cloud)
- Admin access to the repository
- STAS instance running (see [DEVELOPMENT.md](../../DEVELOPMENT.md))

## Step 1: Create an OAuth Consumer

1. Go to **Workspace Settings → OAuth consumers**
2. Click **Add consumer**
3. Set name: `STAS Bot`
4. Set callback URL: `https://your-stas-instance.com`
5. Select permissions:
   - Pull requests: Read, Write
   - Issues: Read, Write
   - Webhooks: Read, Write
6. Save and note the **Consumer Key** and **Consumer Secret**

## Step 2: Configure Webhooks

1. Go to **Repository Settings → Webhooks**
2. Click **Add webhook**
3. Title: `STAS Webhook`
4. URL: `https://your-stas-instance.com/webhook/bitbucket`
5. Select triggers:
   - Pull request: Created, Updated, Approved
   - Issue: Created, Updated
6. Save the webhook

### Webhook Verification

Bitbucket uses HMAC-SHA256 verification. The secret is sent in the `X-Hub-Signature` header. STAS verifies this on every incoming webhook.

## Step 3: Configure Repository Variables

Add these to **Repository Settings → Repository variables**:

| Variable | Value |
|----------|-------|
| `STAS_API_KEY` | Your STAS API key |
| `BITBUCKET_USERNAME` | Your Bitbucket username |
| `BITBUCKET_APP_PASSWORD` | Your Bitbucket app password |

## Known Limitations

- `$BITBUCKET_WORKSPACE` not `$GITHUB_REPOSITORY` — CI variables differ
- Diff API returns inline format, not unified
- Code review API is different from GitHub's
- Bitbucket Server (on-premise) is not currently supported
- Pipeline schedules use different syntax than GitHub Actions cron
