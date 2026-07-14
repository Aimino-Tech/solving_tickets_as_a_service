# STAS — Launch-Ready Environment Variables

> **Compiled from `src/config.ts` schema + `.env.example`**
> Last updated: 2026-07-14
> Purpose: Every env var needed for a production launch, with defaults and sourcing instructions.

---

## Legend

| Mark | Meaning |
|------|---------|
| 🔴 **REQUIRED** | Must be set before the app will start |
| 🟡 Conditional | Required only if the feature is enabled |
| 🟢 Optional | Has a safe default — override for production tuning |

---

## 1. Core — Required at All Costs 🔴

| Variable | Type | Default | Description | Where to Get It |
|----------|------|---------|-------------|-----------------|
| `GITHUB_APP_ID` | `string` | — | GitHub App ID (numeric) | GitHub Settings → Developer settings → GitHub Apps → Your app → App ID |
| `GITHUB_APP_PRIVATE_KEY` | `string` | — | PEM-format private key (inline, newlines as `\n`) | GitHub App settings → Generate a private key → Download PEM |
| `GITHUB_APP_PRIVATE_KEY_PATH` | `string` | — | Alternative: path to PEM file on disk | Use instead of `GITHUB_APP_PRIVATE_KEY` if reading from file |
| `GITHUB_WEBHOOK_SECRET` | `string` | — | Webhook secret for verifying payloads | GitHub App settings → Webhook secret |
| `DATABASE_URL` | `string` | `postgres://localhost:5432/stas` | PostgreSQL connection | Supabase Dashboard → Project Settings → Database → Connection string (or your own Postgres provider) |

### Sourcing Details

**GitHub App:** https://github.com/settings/apps/new
1. Create a GitHub App with permissions: Issues (read+write), Pull Requests (write), Contents (write)
2. Subscribe to: Issues, Issue comments, Pull requests
3. Generate a private key → download PEM
4. Copy the App ID and Webhook Secret

**PostgreSQL:**
- **Supabase:** Dashboard → Project Settings → Database → URI → copy `postgresql://...` string. Enable SSL.
- **Railway/Fly.io:** Automatically provisioned, available in dashboard
- **Self-hosted:** Run `createdb stas`, use connection string

---

## 2. Core — Strongly Recommended for Launch 🟡

| Variable | Type | Default | Description | Where to Get It |
|----------|------|---------|-------------|-----------------|
| `STAS_AI_MODE` | `enum` | `ai` | `ai` = real AI, `static` = placeholder mock responses | Set to `ai` for production, `static` for testing |
| `STAS_MODE` | `enum` | `oss` | `oss` or `hosted` — controls feature gates | Set to `hosted` for cloud-hosted deployment |
| `STAS_LABEL` | `string` | `stas:fix` | Issue label that triggers the bot | Choose a unique label for your repo |
| `BOT_NAME` | `string` | `STAS` | Bot display name in issue comments | Customize to match your brand |
| `NODE_ENV` | `enum` | `development` | `development`, `production`, or `test` | Set to `production` for launch |
| `LOG_LEVEL` | `enum` | `info` | `debug`, `info`, `warn`, `error`, `fatal` | Set to `warn` in high-traffic production |
| `PORT` | `number` | `3000` | Webhook server HTTP port | Must match your deployment's port mapping |
| `RUN_MODE` | `enum` | `both` | `api`, `worker`, or `both` | Use `both` for single-server, separate for scaled |
| `ADMIN_API_KEY` | `string` | — | API key for `/admin/*` endpoints | Generate: `openssl rand -hex 32` |
| `CORS_ORIGIN` | `string` | `*` | CORS allowed origin | Set to your dashboard URL in production |
| `REDIS_URL` | `string` | `redis://localhost:6379` | Redis for caching + session store | **Upstash** (serverless Redis), **Railway** Redis plugin, or self-hosted |
| `DATABASE_SSL` | `bool` | `false` | Enable SSL for database | **Must be `true`** for Supabase, Railway, Fly.io, RDS |

---

## 3. AI / OpenCode Configuration 🟡

| Variable | Default | Description | Where to Get It |
|----------|---------|-------------|-----------------|
| `OPENCODE_URL` | `http://localhost:4096` | OpenCode serve endpoint URL | Your OpenCode serve instance (internal Docker network or cloud) |
| `OPENCODE_MODEL` | `anthropic/claude-sonnet-4-20250514` | Primary model for fix agent | Anthropic/OpenAI/OpenCode account — the model you want for fixes |
| `FALLBACK_MODELS` | `gpt-4o,claude-haiku` | Comma-separated fallback models | Choose models that are cheaper/faster than primary |
| `OPENAI_API_KEY` | — | API key for triage/classification | **OpenAI** https://platform.openai.com/api-keys or Anyscale/DeepSeek provider |
| `OPENAI_CHEAP_MODEL` | `gpt-4o-mini` | Cheap model for triage | Any cheap model: `gpt-4o-mini`, `deepseek-chat`, `claude-3-haiku` |
| `OPENAI_BASE_URL` | `http://litellm-proxy:4002/v1` | Custom OpenAI-compatible endpoint | For using non-OpenAI providers via LiteLLM proxy |
| `MAX_AGENT_ITERATIONS` | `40` | Max tool-call iterations per fix | Higher = more thorough but more expensive |
| `MAX_ISSUE_COMMENTS` | `15` | Max comments agent can post | Prevents spam on active issues |
| `FIX_TIMEOUT_MS` | `600000` | Total fix timeout (10 min) | Increase for complex repos |
| `PHASE_TIMEOUT_TRIAGE_MS` | `30000` | Triage phase timeout (30s) | — |
| `PHASE_TIMEOUT_SANDBOX_MS` | `600000` | Sandbox boot timeout (10 min) | — |
| `PHASE_TIMEOUT_PRCREATION_MS` | `30000` | PR creation timeout (30s) | — |

---

## 4. Stripe / Billing 🟡

**Required only if you accept payments.**

| Variable | Default | Description | Where to Get It |
|----------|---------|-------------|-----------------|
| `STRIPE_SECRET_KEY` | — | Stripe secret key (`sk_live_` or `sk_test_`) | https://dashboard.stripe.com/apikeys |
| `STRIPE_WEBHOOK_SECRET` | — | Webhook signing secret | Stripe Dashboard → Developers → Webhooks → Add endpoint → Signing secret |
| `STRIPE_PRICE_100_CREDITS` | `price_100credits` | Price ID for 100 Credits pack | Stripe Dashboard → Products → Create product → Copy price ID |
| `STRIPE_PRICE_500_CREDITS` | `price_500credits` | Price ID for 500+50 Credits pack | Same as above |
| `STRIPE_PRICE_2000_CREDITS` | `price_2000credits` | Price ID for 2000+200 Credits pack | Same as above |
| `STRIPE_SOLO_PRICE_ID` | `price_solo` | Price ID for Solo plan ($49/mo) | Stripe Dashboard → Products → Create subscription product |
| `STRIPE_TEAM_PRICE_ID` | `price_team` | Price ID for Team plan ($149/mo) | Same as above |
| `DPA_VERSION` | `2026-06-01` | DPA version identifier | Bump this to require re-acceptance |
| `DPA_REQUIRE_ACCEPTANCE` | `true` | Require DPA before checkout | Keep `true` for compliance |
| `DATA_RETENTION_DAYS` | `30` | Days before data purge after cancel | Adjust for your data policy |

### Stripe Setup Steps:
1. Create Stripe account at https://stripe.com
2. Create Products & Prices in Stripe Dashboard:
   - Credit packs: 100 ($10), 500+50 ($45), 2000+200 ($150)
   - Subscriptions: Solo ($49/mo, 100 fixes), Team ($149/mo, 500 fixes)
3. Copy each Price ID (starts with `price_`) to the env vars
4. Set up webhook endpoint → URL: `https://your-domain.com/webhook/stripe` → Events: `checkout.session.completed`, `customer.subscription.*`, `invoice.*`
5. Copy Signing Secret to `STRIPE_WEBHOOK_SECRET`

---

## 5. Queue / Messaging 🟡

| Variable | Default | Description | Where to Get It |
|----------|---------|-------------|-----------------|
| `RABBITMQ_URL` | `amqp://guest:guest@localhost:5672/stas` | RabbitMQ connection | **CloudAMQP** (managed), **Railway** RabbitMQ plugin, or self-hosted |
| `QUEUE_BACKEND` | `amqp` | Only `amqp` is supported | Keep default |
| `WORKER_CONCURRENCY` | `2` | Jobs processed concurrently per worker | Increase for higher throughput (4–8 for production) |
| `QUEUE_DEDUP_TTL_SECONDS` | `120` | Deduplication TTL (prevents double-queueing) | Keep default |
| `QUEUE_MAX_RETRIES` | `4` | Max retries before dead-letter | Keep default (max 10) |
| `QUEUE_RETRY_DELAYS` | `30000,120000,300000,900000` | Retry delays in ms (comma-separated) | Adjust based on your API rate limits |
| `CELERY_BROKER_URL` | `amqp://guest:guest@localhost:5672//` | Celery RabbitMQ URL (Django workers) | Same as RABBITMQ_URL |
| `CELERY_RESULT_BACKEND` | `redis://localhost:6379/0` | Celery Redis URL | Same as REDIS_URL but with DB index |

### Queue Setup (Production):
- **Managed RabbitMQ:** https://www.cloudamqp.com (free tier: 1M messages/mo)
- **Self-hosted:** `docker run -d --name rabbitmq -p 5672:5672 rabbitmq:4`

---

## 6. Platform Integrations 🟡

### GitLab
| Variable | Default | Description | Where to Get It |
|----------|---------|-------------|-----------------|
| `GITLAB_URL` | `https://gitlab.com` | GitLab instance URL | Self-hosted: your instance URL |
| `GITLAB_TOKEN` | — | GitLab personal access token | GitLab → Settings → Access Tokens → `api` scope |
| `GITLAB_WEBHOOK_SECRET` | — | Webhook secret | Your choice — configure in GitLab webhook settings |

### Bitbucket
| Variable | Default | Description | Where to Get It |
|----------|---------|-------------|-----------------|
| `BITBUCKET_USERNAME` | — | Bitbucket account username | Your Bitbucket account username |
| `BITBUCKET_APP_PASSWORD` | — | Bitbucket app password | Bitbucket → Personal settings → App passwords → `Repositories: read/write`, `Pull requests: write` |
| `BITBUCKET_WEBHOOK_SECRET` | — | Webhook secret | Your choice |
| `BITBUCKET_BASE_URL` | `https://api.bitbucket.org` | API base URL | Keep default |

### Slack
| Variable | Default | Description | Where to Get It |
|----------|---------|-------------|-----------------|
| `SLACK_WEBHOOK_URL` | — | Incoming webhook URL | https://api.slack.com/messaging/webhooks → Create webhook |
| `SLACK_CHANNEL` | — | Channel override (e.g., `#stas-alerts`) | Your Slack channel name |
| `SLACK_BOT_TOKEN` | — | Bot token (`xoxb-...`) | https://api.slack.com/apps → Create app → OAuth & Permissions |
| `SLACK_SIGNING_SECRET` | — | Signing secret for interactive requests | Slack App → Basic Information → Signing Secret |

---

## 7. Tracker Integrations 🟡

### Linear
| Variable | Default | Description | Where to Get It |
|----------|---------|-------------|-----------------|
| `LINEAR_API_KEY` | — | Linear API key | https://linear.app/settings/api → Create key |
| `LINEAR_WEBHOOK_SECRET` | — | Webhook signing secret | Linear → Settings → Webhooks → Create webhook → Signing key |

### Jira
| Variable | Default | Description | Where to Get It |
|----------|---------|-------------|-----------------|
| `JIRA_URL` | — | Jira instance URL | `https://your-domain.atlassian.net` |
| `JIRA_EMAIL` | — | Jira account email | The email for your Jira account |
| `JIRA_API_TOKEN` | — | Jira API token | https://id.atlassian.com/manage/api-tokens → Create token |
| `JIRA_WEBHOOK_SECRET` | — | Webhook secret | Your choice |
| `JIRA_PROJECT_KEY` | — | Default Jira project key (e.g., `PROJ`) | Your Jira project key |

### Tracker → GitHub Mapping
| Variable | Default | Description |
|----------|---------|-------------|
| `TRACKER_DEFAULT_REPO_OWNER` | — | Default GitHub repo owner for tracker tickets |
| `TRACKER_DEFAULT_REPO_NAME` | — | Default GitHub repo name |
| `TRACKER_INSTALLATION_ID` | — | GitHub App installation ID |

---

## 8. Sandbox / Security 🟡

### E2B Sandbox (Cloud)
| Variable | Default | Description | Where to Get It |
|----------|---------|-------------|-----------------|
| `E2B_API_KEY` | — | E2B cloud sandbox API key | https://e2b.dev → Dashboard → API Keys |
| `E2B_TEMPLATE_ID` | `default` | Sandbox template ID | Keep default or create custom template |
| `E2B_SANDBOX_TIMEOUT_MS` | `300000` | Max sandbox execution time (5 min) | Increase for repos with long tests |

### Docker Sandbox (Self-hosted)
| Variable | Default | Description |
|----------|---------|-------------|
| `DOCKER_IMAGE` | `node:20-slim` | Base Docker image for sandbox |
| `DOCKER_NETWORK_RESTRICT` | `true` | Restrict sandbox network access |
| `DOCKER_ALLOWED_HOSTS` | `api.github.com,...` | Allowed hosts for sandbox (comma-separated) |
| `DOCKER_CONTAINER_MEMORY` | `4g` | Memory limit per sandbox |
| `DOCKER_CONTAINER_CPU` | `2` | CPU cores per sandbox |
| `DOCKER_SECCOMP_PROFILE` | `./docker/seccomp/sandbox.json` | Seccomp profile path |
| `DOCKER_GVISOR_ENABLED` | `false` | Use gVisor runtime for kernel-level isolation |

### IP Allowlist
| Variable | Default | Description |
|----------|---------|-------------|
| `IP_ALLOWLIST_ENABLED` | `false` | Enable IP allowlist for webhooks |
| `IP_ALLOWLIST` | — | Comma-separated CIDR ranges (GitHub: `192.30.252.0/22`) |

### Rate Limiting
| Variable | Default | Description |
|----------|---------|-------------|
| `STAS_RATE_LIMIT_WINDOW_MS` | `60000` | Rate limit window (1 min) |
| `STAS_RATE_LIMIT_MAX` | `30` | Max requests per window |
| `STAS_RATE_LIMIT_DEFAULT_TIER` | `free` | Default tier for rate limiting |
| `ADMIN_RATE_LIMIT_MAX` | `10` | Admin endpoint rate limit |
| `REQUEST_BODY_LIMIT` | `1mb` | Max body size for API requests |
| `WEBHOOK_BODY_LIMIT` | `5mb` | Max body size for webhooks |

---

## 9. Monitoring / Alerting 🟡

### Sentry
| Variable | Default | Description | Where to Get It |
|----------|---------|-------------|-----------------|
| `SENTRY_DSN` | — | Sentry DSN for error tracking | https://sentry.io → Create project → Copy DSN |
| `SENTRY_ENVIRONMENT` | `development` | Environment name | Set to `production` for launch |
| `SENTRY_TRACES_SAMPLE_RATE` | `0.1` | Trace sampling rate (0.0–1.0) | 0.1 = sample 10% of traces |

### Health / Alerting
| Variable | Default | Description |
|----------|---------|-------------|
| `HEALTH_QUEUE_DEPTH_WARN_THRESHOLD` | `50` | Queue depth warning threshold |
| `HEALTH_QUEUE_DEPTH_CRIT_THRESHOLD` | `200` | Queue depth critical threshold |
| `DLQ_RETENTION_DAYS` | `7` | Dead-letter queue retention in days |
| `ALERT_SLACK_CHANNEL` | `#stas-alerts` | Slack channel for alerts |
| `ALERT_WARN_QUEUE_DEPTH` | `50` | Slack alert warning threshold |
| `ALERT_CRIT_QUEUE_DEPTH` | `200` | Slack alert critical threshold |
| `ALERT_WARN_ERROR_RATE_PERCENT` | `10` | Warning error rate threshold |
| `ALERT_CRIT_ERROR_RATE_PERCENT` | `30` | Critical error rate threshold |

### OpenCode Health
| Variable | Default | Description |
|----------|---------|-------------|
| `OPENCODE_HEALTH_CIRCUIT_BREAKER_THRESHOLD` | `3` | Consecutive failures before circuit opens |
| `OPENCODE_HEALTH_POLL_INTERVAL_MS` | `30000` | Health poll interval (30s) |
| `OPENCODE_HEALTH_CACHE_TTL_MS` | `30000` | Health cache TTL (30s) |
| `OPENCODE_HEALTH_REQUEST_TIMEOUT_MS` | `10000` | Health request timeout (10s) |
| `OPENCODE_HEALTH_STARTUP_TIMEOUT_MS` | `120000` | Max wait for healthy on startup (2 min) |

---

## 10. Storage / Database 🟢

| Variable | Default | Description |
|----------|---------|-------------|
| `STORAGE_TYPE` | `sqlite` | `sqlite` or `postgres` — set to `postgres` for production |
| `STORAGE_SQLITE_PATH` | `./data/stas.db` | SQLite file path (dev only) |
| `DATABASE_POOL_MIN` | `2` | Min connections in pool |
| `DATABASE_POOL_MAX` | `10` | Max connections in pool |
| `DATABASE_ENABLE_AUDIT_PERSISTENCE` | `false` | Persist audit logs to database |

---

## 11. Feature Flags 🟢

| Variable | Default | Description |
|----------|---------|-------------|
| `FEATURE_FLAGS_DEFAULT_TTL_SECONDS` | `30` | TTL for feature flag evaluations |
| `FEATURE_FLAGS_AUTO_DISABLE_THRESHOLD` | `0.05` | Auto-disable if error rate exceeds 5% |

---

## 12. Usage / Metering 🟢

| Variable | Default | Description |
|----------|---------|-------------|
| `USAGE_CREDITS_FIX_RUN` | `50` | Credits consumed per fix run |
| `USAGE_CREDITS_TRIAGE` | `10` | Credits consumed per triage |
| `USAGE_CREDITS_SANDBOX` | `5` | Credits consumed per sandbox boot |
| `METERING_COST_TRIAGE` | `1` | Metering cost unit for triage |
| `METERING_COST_OPENCODE_PRIMARY` | `10` | Metering cost for primary model |
| `METERING_COST_OPENCODE_FALLBACK` | `5` | Metering cost for fallback model |
| `METERING_COST_PR_CREATION` | `2` | Metering cost for PR creation |
| `METERING_FREE_MONTHLY_CREDITS` | `100` | Free tier monthly credit allowance |
| `STAS_DEFAULT_TIER` | `free` | Default account tier |
| `STAS_MONTHLY_QUOTA_ENABLED` | `true` | Enforce monthly quotas |

---

## 13. Optional / Experimental 🟢

| Variable | Default | Description |
|----------|---------|-------------|
| `TELEGRAM_BOT_TOKEN` | — | Telegram bot token for notifications |
| `WHATSAPP_PHONE_NUMBER_ID` | — | WhatsApp Business phone number ID |
| `WHATSAPP_ACCESS_TOKEN` | — | WhatsApp access token |
| `WHATSAPP_VERIFY_TOKEN` | — | WhatsApp webhook verify token |
| `MCP_API_KEY` | — | MCP server API key |
| `MCP_AUTH_ENABLED` | `true` | Enable MCP authentication |
| `RAPIDAPI_PROXY_SECRET` | — | RapidAPI proxy secret |
| `GITHUB_OAUTH_CLIENT_ID` | — | GitHub OAuth App client ID |
| `GITHUB_OAUTH_CLIENT_SECRET` | — | GitHub OAuth App secret |
| `CI_MONITOR_ENABLED` | `false` | Enable CI build monitoring |
| `CI_REPOS` | — | Comma-separated repos to monitor |
| `CI_POLL_INTERVAL_MS` | `60000` | CI poll interval |
| `SMEE_URL` | — | smee.io URL for local webhook forwarding |
| `DEV_SKIP_WEBHOOK_SIGNATURE_VERIFY` | `false` | Skip webhook verification (dev only!) |

---

## 14. Django (Migration-Phase Only) 🟢

| Variable | Default | Description |
|----------|---------|-------------|
| `DJANGO_DEBUG` | `true` | Django debug mode (set `false` in production) |
| `DJANGO_ALLOWED_HOSTS` | `localhost,127.0.0.1,0.0.0.0` | Allowed hostnames |
| `DJANGO_SECRET_KEY` | — | Django signing key (generate via `python -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())"`) |
| `CELERY_TASK_SOFT_TIME_LIMIT` | `580` | Celery soft time limit (seconds) |
| `CELERY_TASK_HARD_TIME_LIMIT` | `600` | Celery hard time limit (seconds) |

---

## Production Quick-Start Checklist

### Absolute Minimum (App Will Not Start Without):
```
GITHUB_APP_ID=<numeric>
GITHUB_APP_PRIVATE_KEY=<pem-content>
GITHUB_WEBHOOK_SECRET=<secret>
DATABASE_URL=postgres://user:pass@host:5432/stas
DATABASE_SSL=true
```

### Strongly Recommended:
```
NODE_ENV=production
LOG_LEVEL=info
ADMIN_API_KEY=<32-char-hex>
CORS_ORIGIN=https://your-dashboard.com
REDIS_URL=rediss://user:pass@upstash-redis:6379
RABBITMQ_URL=amqps://user:pass@cloudamqp:5671/stas
SENTRY_DSN=https://key@sentry.io/project
OPENCODE_URL=http://opencode:4096
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

### For Payments:
```
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_100_CREDITS=price_abc123
STRIPE_PRICE_500_CREDITS=price_def456
STRIPE_PRICE_2000_CREDITS=price_ghi789
STRIPE_SOLO_PRICE_ID=price_jkl012
STRIPE_TEAM_PRICE_ID=price_mno345
```

### For Integrations:
```
LINEAR_API_KEY=lin-api-...
GITLAB_TOKEN=glpat-...
SLACK_WEBHOOK_URL=https://hooks.slack.com/...
```

---

## Health Check & Verification

After setting all env vars, verify with:
```bash
# Config validation
npx tsx scripts/init.ts

# Or just check parsing
node -e "
const { config } = require('./dist/config.js');
console.log('Config loaded:', Object.keys(config));
"
```

The app provides:
- `GET /health` — Basic health check (always available)
- `GET /health/ready` — Readiness check (DB, Redis, OpenCode)
- `GET /health/opencode` — OpenCode health with circuit breaker
- `GET /admin/health` — Full system health (requires ADMIN_API_KEY)
