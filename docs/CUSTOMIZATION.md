# Customizing STAS

## Changing the Trigger Label

Set `STAS_LABEL` in your environment:

```bash
# .env
STAS_LABEL=fix-it
```

The bot will now trigger on issues labeled `fix-it` instead of the default `stas:fix`.

## Changing the Model

Set `OPENCODE_MODEL` to any OpenCode-compatible model:

```bash
# .env
OPENCODE_MODEL=gpt-4o
```

For a fallback chain, set `FALLBACK_MODELS`:

```bash
# .env
FALLBACK_MODELS=gpt-4o,claude-haiku
```

The triage model (for issue classification) is configured separately:

```bash
# .env
OPENAI_CHEAP_MODEL=gpt-4o-mini
```

## Adding Custom Tools

STAS uses OpenCode's tool system. To add custom tools:

1. Create a tool file in `src/tools/`
2. Register it with OpenCode in `src/agent/issueAgent.ts`
3. The tool will be available to the agent during fix attempts

See [OpenCode documentation](https://opencode.ai/docs/tools) for tool API details.

## Customizing PR Templates

PR templates are defined in `src/github/messages.ts`. The `createPrComment` function generates the PR body.

To customize:
1. Edit the template function in `src/github/messages.ts`
2. The PR title and body can reference issue context (title, description, labels)

## Configuring Sandbox Timeout

```bash
# E2B sandbox timeout (default: 5 minutes)
E2B_SANDBOX_TIMEOUT_MS=600000

# Docker sandbox timeout (default: 5 minutes)
DOCKER_SANDBOX_TIMEOUT_MS=600000

# Overall fix timeout (default: 10 minutes)
FIX_TIMEOUT_MS=1200000
```

## Configuring Queue Behavior

```bash
# Queue backend (bullmq, rabbitmq, or both)
QUEUE_BACKEND=bullmq

# Worker concurrency
WORKER_CONCURRENCY=4

# Max retries before dead-letter
QUEUE_MAX_RETRIES=4

# Retry delays (comma-separated, milliseconds)
QUEUE_RETRY_DELAYS=30000,120000,300000,900000
```

## Configuring Sandbox Security

```bash
# Restrict Docker network to allowlist only
DOCKER_NETWORK_RESTRICT=true

# Allowed hosts for sandbox network access
DOCKER_ALLOWED_HOSTS=api.github.com,github.com,registry.npmjs.org

# Container resource limits
DOCKER_CONTAINER_MEMORY=4g
DOCKER_CONTAINER_CPU=2
```

## Customizing Notifications

STAS supports Slack notifications for job status:

```bash
# .env
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
SLACK_CHANNEL=#stas-alerts
```

## Feature Flags

Feature flags allow gradual rollout and A/B testing:

```bash
# .env
FEATURE_FLAGS_DEFAULT_TTL_SECONDS=30
FEATURE_FLAGS_AUTO_DISABLE_THRESHOLD=0.05
```

Flags are managed via the admin API at `/api/v1/admin/feature-flags`.
