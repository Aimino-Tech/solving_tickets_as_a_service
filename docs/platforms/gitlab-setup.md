# GitLab Setup Guide

## Prerequisites

- A GitLab project (self-hosted or GitLab.com)
- Maintainer or Owner access to the project
- STAS instance running (see [DEVELOPMENT.md](../../DEVELOPMENT.md))

## Step 1: Create a Project Access Token

1. Go to **Settings → Access Tokens** in your GitLab project
2. Create a token with scopes: `api`, `read_api`, `read_repository`, `write_repository`
3. Name it `stas-bot` and set an expiration date
4. Copy the token value immediately

## Step 2: Configure Webhooks

1. Go to **Settings → Webhooks** in your GitLab project
2. Add a webhook with URL: `https://your-stas-instance.com/webhook/gitlab`
3. Select triggers:
   - Merge request events
   - Issue events
   - Note events (for comments)
4. Add a **Secret Token** for webhook verification
5. Save the webhook

### Webhook Verification

GitLab uses HMAC-SHA256 verification with the secret token sent in the `X-Gitlab-Token` header. STAS verifies this token on every incoming webhook.

## Step 3: Configure CI Variables

Add these variables to **Settings → CI/CD → Variables**:

| Variable | Value |
|----------|-------|
| `STAS_API_KEY` | Your STAS API key |
| `GITLAB_TOKEN` | The project access token from Step 1 |

## Step 4: Runner Requirements

- Docker executor
- Network access to E2B sandbox service
- Sufficient memory (4GB+ recommended)

## Differences from GitHub

| Aspect | GitHub | GitLab |
|--------|--------|--------|
| Pull Requests | Pull Requests | Merge Requests |
| Check Runs API | ✅ Full support | ❌ No equivalent (use MR comments + labels) |
| Labels | Repo-level scoping | Project-level scoping |
| Webhook auth | HMAC-SHA256 (X-Hub-Signature-256) | Secret token (X-Gitlab-Token) |
| API auth | GitHub App (installation token) | Personal Access Token (Private-Token header) |
| Self-hosted | GitHub Enterprise Server | GitLab self-hosted with `baseUrl` config |

## Known Limitations

- Group-level webhooks are not supported
- No deployment environments integration
- External status checks are limited compared to GitHub Check Runs
- GitLab CI schedules follow different syntax than GitHub Actions cron
