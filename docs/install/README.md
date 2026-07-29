# STAS Installation Guide

> Choose your deployment path. Every option gets you from zero to your first automated fix in minutes.

| Option | Setup Time | Cost | Best For |
|--------|-----------|------|----------|
| **Cloud** (recommended) | ~2 minutes | Free tier included | Most users, public repos |
| **Docker Compose** | ~15 minutes | Your infrastructure | Teams needing data sovereignty |
| **Kubernetes** | ~30 minutes | Your infrastructure | Enterprise self-hosters |
| **Railway / Fly.io** | ~10 minutes | ~$5–$25/mo | Quick cloud self-host |

---

## Option 1: Cloud (Recommended for Most Users)

**Install STAS Cloud in 3 clicks — no configuration needed.**

1. **Install from GitHub Marketplace**
   Visit [STAS on GitHub Marketplace](https://github.com/marketplace/actions/stas-eval) and click **Install**.

2. **Select repositories**
   Choose `All repositories` or pick specific repos.

3. **Label an issue**
   Add the label `stas:fix` to any open issue — your first fix arrives in ~60 seconds.

**That's it.** No servers, no environment variables, no configuration. Free tier includes 50 fixes/month for public repos.

---

## Option 2: Self-Host with Docker Compose

Run STAS on your own infrastructure for full control and data sovereignty.

### Prerequisites

| Requirement | Version | Why |
|-------------|---------|-----|
| Docker | 24+ | Container runtime |
| Docker Compose | 2.20+ | Multi-service orchestration |
| RAM | 4 GB+ | Bot + Redis + workers |
| GitHub App | — | Webhook receiver + API access |
| LLM API Key | — | OpenAI, Anthropic, or compatible |

### Step 1: Create a GitHub App

1. Go to **GitHub Settings → Developer settings → GitHub Apps → New GitHub App**
2. Fill in:
   - **GitHub App name**: `stas-<your-org>` (must be unique)
   - **Homepage URL**: `https://github.com/Aimino-Tech/solving_tickets_as_a_service`
   - **Webhook URL**: `https://your-domain.com/api/webhook/github` (update after deploy)
   - **Webhook secret**: Generate a random secret, save it for `.env`
3. **Permissions**:
   | Permission | Access | Why |
   |------------|--------|-----|
   | Issues | Read & Write | Label detection, comments, close |
   | Pull Requests | Read & Write | Create and update PRs |
   | Contents | Read | Clone and read repo code |
   | Checks | Read & Write | Run and report check results |
   | Metadata | Read | (always included) |
4. **Subscribe to events**: `Issues`, `Issue comment`, `Pull request`, `Check run`
5. **Create app**, then:
   - **Generate a private key** → download the `.pem` file
   - **Note your App ID** from the app settings page
   - **Install the app** on your repos (Settings → Install App)

### Step 2: Clone and Configure

```bash
git clone https://github.com/Aimino-Tech/solving_tickets_as_a_service
cd solving_tickets_as_a_service

cp .env.example .env
```

Edit `.env` with your GitHub App credentials:

```bash
# GitHub App (required)
GITHUB_APP_ID=123456                         # From app settings page
GITHUB_APP_PRIVATE_KEY_PATH=./stas.private-key.pem  # Path to your .pem file
GITHUB_WEBHOOK_SECRET=your-webhook-secret    # The secret from step 1

# LLM Provider (choose at least one)
OPENAI_API_KEY=sk-...                        # OpenAI API key
# or
ANTHROPIC_API_KEY=sk-ant-...                 # Anthropic API key

# Redis (use defaults for local Docker)
REDIS_URL=redis://localhost:6379
```

### Step 3: Start the Stack

```bash
docker compose up -d
```

This starts:
- `stas-redis` — Redis 7 (persistent, health-checked)
- `stas-bot` — STAS bot with hot-reload

Verify all services are healthy:

```bash
docker compose ps
docker compose logs --tail=20
```

### Step 4: Start OpenCode

In a separate terminal:

```bash
opencode serve --port 4096
```

Verify OpenCode is running:

```bash
curl http://localhost:4096/health
```

### Step 5: Test the Installation

1. **Update your GitHub App's webhook URL** to point to your server (use a tunnel like `smee.io` for local dev, or deploy with a public URL)
2. Go to any repo where the app is installed
3. Label an issue with `stas:fix`
4. Watch the logs: `docker compose logs -f`
5. Within ~60 seconds, STAS should post a plan comment and open a PR

### Configuration Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GITHUB_APP_ID` | Yes | — | GitHub App ID |
| `GITHUB_APP_PRIVATE_KEY` | Yes* | — | Private key content (PEM) |
| `GITHUB_APP_PRIVATE_KEY_PATH` | Yes* | — | Path to private key file |
| `GITHUB_WEBHOOK_SECRET` | Yes | — | Webhook verification secret |
| `OPENAI_API_KEY` | No | — | OpenAI API key |
| `ANTHROPIC_API_KEY` | No | — | Anthropic API key |
| `REDIS_URL` | No | `redis://localhost:6379` | Redis connection URL |
| `PORT` | No | `3000` | HTTP server port |
| `LOG_LEVEL` | No | `info` | Log verbosity (`debug`, `info`, `warn`, `error`) |
| `STAS_LABEL` | No | `stas:fix` | Trigger issue label |
| `BOT_NAME` | No | `STAS` | Bot display name |
| `E2B_API_KEY` | No | — | E2B sandbox API key (cloud sandbox) |

\* Either `GITHUB_APP_PRIVATE_KEY` or `GITHUB_APP_PRIVATE_KEY_PATH` is required.

### Updating

```bash
git pull
docker compose pull
docker compose up -d
```

### Logging

```bash
# Follow all logs
docker compose logs -f

# Follow a specific service
docker compose logs -f stas-bot

# Search for errors
docker compose logs stas-bot | grep -i error

# Last 100 lines
docker compose logs --tail=100
```

---

## Option 3: Kubernetes (Enterprise)

Deploy STAS on Kubernetes for production-grade orchestration, autoscaling, and multi-team isolation.

### Prerequisites

| Requirement | Version |
|-------------|---------|
| Kubernetes cluster | 1.28+ |
| kubectl | 1.28+ |
| Helm (optional) | 3.12+ |
| RAM per node | 8 GB+ |

### Step 1: Configure Secrets

```bash
# Create namespace
kubectl create namespace stas

# GitHub App credentials
kubectl create secret generic stas-github \
  --namespace stas \
  --from-literal=app-id=123456 \
  --from-literal=webhook-secret=your-webhook-secret \
  --from-file=private-key=./stas.private-key.pem

# LLM API keys
kubectl create secret generic stas-llm \
  --namespace stas \
  --from-literal=openai-api-key=sk-... \
  --from-literal=anthropic-api-key=sk-ant-...
```

### Step 2: Deploy

```bash
# Using kubectl
kubectl apply -f k8s/ --namespace stas

# Verify deployment
kubectl get pods --namespace stas
kubectl get svc --namespace stas
```

### Step 3: Set Up Ingress

Create an ingress for webhook delivery:

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: stas-ingress
  namespace: stas
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
    nginx.ingress.kubernetes.io/proxy-body-size: 32m
spec:
  ingressClassName: nginx
  tls:
  - hosts:
    - stas.your-domain.com
    secretName: stas-tls
  rules:
  - host: stas.your-domain.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: stas-webhook
            port:
              number: 3000
```

### Step 4: Configure GitHub App Webhook

Update your GitHub App's webhook URL to: `https://stas.your-domain.com/api/webhook/github`

### Step 5: Verify

```bash
# Check pod health
kubectl get pods --namespace stas -w

# Check logs
kubectl logs --namespace stas -l app=stas-webhook

# Test health endpoint
kubectl port-forward --namespace stas svc/stas-webhook 3000:3000 &
curl http://localhost:3000/health
```

### Autoscaling

The Kubernetes deployment includes a KEDA `ScaledObject` for event-driven autoscaling:

```bash
# Scale based on queue depth
kubectl apply -f k8s/keda-scaled-object.yaml --namespace stas
```

---

## Option 4: Railway / Fly.io (Quick Cloud Self-Host)

### Railway (One-Click Deploy)

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template?template=...)

```bash
npm install -g @railway/cli
railway login
railway init
railway up
railway secrets set GITHUB_APP_ID=... GITHUB_WEBHOOK_SECRET=...
```

Railway auto-provisions Redis — `REDIS_URL` is injected automatically.

### Fly.io

```bash
fly launch --copy-config
fly secrets set GITHUB_APP_ID=... GITHUB_WEBHOOK_SECRET=...
fly redis create
fly redis attach <redis-name>
fly deploy
```

---

## Post-Installation Verification Checklist

- [ ] Webhook ping received (GitHub App settings → Advanced → Recent deliveries)
- [ ] `GET /health` returns `200 OK`
- [ ] Label an issue with `stas:fix` → STAS posts a comment within 15 seconds
- [ ] Plan appears within 15 seconds of the comment
- [ ] PR appears within 60 seconds of the plan
- [ ] Tests pass on the generated PR

---

## Troubleshooting FAQ

### "Webhook says verification failed"

**Cause:** Webhook secret in `.env` doesn't match what's configured in the GitHub App settings.

**Fix:**
```bash
# Check your .env has the same secret as GitHub App settings
grep GITHUB_WEBHOOK_SECRET .env

# Update GitHub App settings if needed, or update .env
```

### "STAS didn't respond to my comment"

**Cause:** Webhook not reaching STAS, or label not matching.

**Check:**
1. Verify webhook delivery in GitHub App settings (Advanced → Recent deliveries)
2. Check STAS logs: `docker compose logs stas-bot | grep "webhook"`
3. Verify trigger label: `grep STAS_LABEL .env` (default: `stas:fix`)
4. Verify the label exists on the repo (create it if not)

### "Fix keeps failing"

**Cause:** Usually an LLM API issue or rate limiting.

**Fix:**
```bash
# Check LLM API key
curl -H "Authorization: Bearer $OPENAI_API_KEY" https://api.openai.com/v1/models

# Check rate limits
# GitHub API: check X-RateLimit-Remaining headers in logs

# Check repo size — very large repos may timeout
# Increase FIX_TIMEOUT_MS in .env if needed
```

### "Redis connection refused"

```bash
# Test connection
redis-cli -u redis://localhost:6379 ping

# Check if Redis is running
docker compose ps stas-redis
docker compose logs stas-redis
```

### "OpenCode connection refused"

```bash
# Test connection
curl http://localhost:4096/health

# Restart OpenCode
opencode serve --port 4096
```

### "Docker sandbox creation failed"

```bash
# E2B: Check API key
curl -H "Authorization: Bearer $E2B_API_KEY" https://api.e2b.dev/v1/health

# Docker: check runtime
docker info
docker run hello-world
```

### "Port 3000 already in use"

Change the port in `.env` and restart:

```bash
# .env
PORT=3001

# Restart
docker compose down
docker compose up -d
```

### "Database errors in logs"

For the production Docker Compose stack:

```bash
# Check Postgres
docker compose -f docker-compose.prod.yml logs postgres

# Run database migrations
docker compose -f docker-compose.prod.yml exec stas-webhook npm run db:migrate
```

---

## Getting Help

| Channel | Where |
|---------|-------|
| **GitHub Issues** | [github.com/Aimino-Tech/solving_tickets_as_a_service/issues](https://github.com/Aimino-Tech/solving_tickets_as_a_service/issues) |
| **Discord** | [discord.gg/aimino](https://discord.gg/aimino) |
| **Documentation** | [docs.stas.aimino.io](https://docs.stas.aimino.io) |
| **Email** | support@aimino.io |

---

## Next Steps

- [Explore the Dashboard](https://stas.aimino.io) (cloud users)
- [Review the Architecture](../ARCHITECTURE.md)
- [Learn about Customization](../CUSTOMIZATION.md)
- [Self-Hosting Deep Dive](../SELF_HOSTING.md)
- [Production Deployment Guide](../DEPLOYMENT.md)
- [Production Runbook](../../ops/runbook.md)
