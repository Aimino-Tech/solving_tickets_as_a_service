# Troubleshooting

Common STAS errors, their causes, and fixes.

## 1. "Installation Not Found"

**Error**: `Installation not found for repo owner/repo`
**Cause**: The GitHub App hasn't been installed on the repository.
**Fix**: Install the GitHub App on your repo or organization.

## 2. "Webhook verification failed"

**Error**: `Signature verification failed` in logs
**Cause**: Mismatched `GITHUB_WEBHOOK_SECRET` between your STAS config and GitHub App settings.
**Fix**: 
1. Copy the webhook secret from your GitHub App settings
2. Update `GITHUB_WEBHOOK_SECRET` in your `.env` file
3. Restart STAS

## 3. "Agent timed out"

**Error**: `OpenCode agent timed out on all models`
**Cause**: The agent took longer than the timeout (default 10 minutes) to generate a fix.
**Fix**:
- Check if your repo is large — consider increasing `STAS_PHASE_TIMEOUT_OPENCODE_AGENT`
- Check if OpenCode is running and healthy at `OPENCODE_URL`
- Try labeling a simpler issue to verify the pipeline works

## 4. "No fixable issues found"

**Error**: `Agent reported no fix for issue #N`
**Cause**: The agent determined the issue isn't a fix (question, feature request, vague description).
**Fix**:
- Make the issue description more specific (include error messages, reproduction steps)
- Ensure the issue is labeled `bug` or has a clear fix scope
- Check [Failure Modes](failure-modes.md) for what STAS can and cannot fix

## 5. "OpenCode connection refused"

**Error**: `FetchError: connect ECONNREFUSED 127.0.0.1:4096`
**Cause**: OpenCode serve is not running.
**Fix**:
```bash
# Start OpenCode in another terminal
opencode serve --port 4096

# Verify it's running
curl http://localhost:4096/api/health
```

## 6. "Sandbox creation failed"

**Error**: `Failed to create container` or `Failed to pull Docker image`
**Cause**: Docker isn't running or the sandbox image can't be pulled.
**Fix**:
```bash
# Check Docker is running
docker info

# Pull the sandbox image
docker pull node:20-bookworm-slim

# If using Docker sandbox, ensure Docker is accessible
```

## 7. "Git push failed"

**Error**: `Failed to push branch` in logs
**Cause**: The installation token may be expired or the agent tried a destructive git operation.
**Fix**:
- Ensure the GitHub App has `contents: write` permission
- If you see "GitGuard blocked" in logs, the agent attempted a destructive operation — label the issue to retry
- Check branch name doesn't conflict with existing branches

## 8. "PR already exists"

**Warning**: `PR already exists for issue #N, skipping creation`
**Cause**: A PR was already created for this issue in a previous run.
**Fix**: Close the existing PR and re-label the issue, or remove the old branch.

## 9. "Rate limit exceeded"

**Error**: `429 Too Many Requests` from GitHub API
**Cause**: STAS exceeded GitHub's API rate limit.
**Fix**:
- Reduce `STAS_MAX_CONCURRENT` in your config
- Wait for the rate limit window to reset
- If self-hosted, ensure your GitHub App has sufficient rate limit

## 10. "Label not triggering"

**Error**: Labeling an issue with `stas:fix` does nothing
**Cause**: Webhook not reaching STAS or label mismatch.
**Fix**:
- Verify the webhook URL in your GitHub App points to `https://your-server/webhook`
- Check the label name matches `STAS_LABEL` config (default: `stas:fix`)
- Check webhook delivery logs in GitHub App settings

## Common Configuration Issues

### STAS_LABEL not matching
```bash
# Check your configured label
echo $STAS_LABEL  # Should be 'stas:fix' unless customized
```

### OpenCode not configured
```bash
# Check OpenCode is reachable
curl $OPENCODE_URL/api/health  # Should return 200
```

### Missing environment variables
```bash
# Verify required vars are set
grep -v '^#' .env | grep -v '^$' | head -10
# Required: GITHUB_APP_ID, GITHUB_PRIVATE_KEY, GITHUB_WEBHOOK_SECRET
```

## Still Stuck?

- Join our [Discord](https://discord.gg/aimino) for community support
- Check [FAQ](faq.md) for common questions
- File a [GitHub issue](https://github.com/Aimino-Tech/solving_tickets_as_a_service/issues/new?template=support_request.yml)
