# SYNTARO Scaling & Capacity for 500 Users

> Load profile, resource requirements, rate limits, and cost projections for 500 concurrent users.

## 1. 500-User Load Profile

### Defined Load Parameters

| Parameter | Value | Basis |
|-----------|-------|-------|
| Concurrent webhook deliveries | 150/min peak | 1 webhook per user per ~3min |
| Concurrent fix operations | 50 | ~10% of users submitting fixes simultaneously |
| API calls/min | 5000 | 10 req/min average per user |
| Health check polls | 60/min | Monitoring infra polling every 5s |
| Queue throughput | 100-150 msg/min | Webhook + Celery events |
| DB concurrent reads | 200 | Dashboard, config, feature flags |
| DB concurrent writes | 50 | Audit logs, run history updates |
| Redis concurrent reads | 300 | Cache lookups, session data |
| Redis concurrent writes | 100 | Cache updates, TTL expirations |

### Peak vs Sustained

| Metric | Sustained (normal) | Peak (burst) |
|--------|-------------------|--------------|
| Webhooks | 60/min | 150/min |
| Active fix jobs | 20 | 50 |
| API throughput | 2000 req/min | 5000 req/min |
| Queue depth | 50 | 200 |

## 2. Scaling Verification

### Horizontal Scaling

```bash
# Scale webhook to 3 replicas
docker compose -f docker-compose.prod.yml up -d --scale syntaro-webhook=3 syntaro-webhook

# Scale workers to 8 replicas
docker compose -f docker-compose.prod.yml up -d --scale syntaro-worker=8 syntaro-worker

# Full production stack
docker compose -f docker-compose.prod.yml up -d \
  --scale syntaro-webhook=3 \
  --scale syntaro-worker=8
```

### PostgreSQL Connection Pool

```yaml
# docker-compose.prod.yml
environment:
  - PGPoolSize=50  # 500 users: min 20, recommended 50
  - PGMAXClientConnections=75  # headroom for monitoring
```

### Redis Configuration

```yaml
# docker-compose.prod.yml
command: >
  redis-server --appendonly yes
  --maxmemory 4gb
  --maxmemory-policy allkeys-lru
  --maxmemory-samples 10
  --hz 100
```

Redis TTL recommendations for 500 users:

| Data Type | TTL | Rationale |
|-----------|-----|-----------|
| Session data | 30 min | Active sessions expire quickly |
| API cache | 60s | Freshness for benchmarks/pricing |
| Feature flags | 30s | Near-real-time flag evaluation |
| Rate limit counters | 60s | Rolling window limits |
| Job state | 24h | Allow resumption of interrupted jobs |

### Nginx Load Balancing

Current `least_conn` strategy scales with replica count. For 500 users:
- Minimum 3 webhook replicas
- worker_connections: 1024 per replica
- Rate limiting at nginx level (30r/s webhooks, 100r/s API)

### CDN for Static Assets

Static assets (`/assets/`) are served with:
```
Cache-Control: public, max-age=31536000, immutable
```

For 500 users, consider:
- CloudFront or CloudFlare CDN for global distribution
- Pre-warm CDN cache after deployment
- Separate asset domain for cookie-free delivery

## 3. Rate Limiting Calibration

### Per-Repo Webhook Limit

| Tier | Webhooks/min | Burst | Response |
|------|-------------|-------|----------|
| Free | 10 | 5 | 429 after limit |
| Pro | 60 | 10 | 429 after limit |
| Enterprise | 300 | 30 | 429 after limit |

### Per-IP Request Limit (Nginx)

| Endpoint | Rate | Burst |
|----------|------|-------|
| `/webhook` | 30/s | 10 |
| `/api/` | 100/s | 20 |
| `/health` | 60/m | 5 |

### Per-User (API Key) Request Limit

| Plan | Requests/min | Concurrent Jobs |
|------|-------------|-----------------|
| Free | 10 | 1 |
| Pro | 60 | 5 |
| Enterprise | 300 | 20 |

### Queue Depth Limits

| Limit | Value | Action |
|-------|-------|--------|
| Max pending per repo | 3 | New webhooks for repo are rejected |
| Max global queue depth | 200 | Alert triggers at 100, critical at 200 |
| DLQ max before notify | 10 | Auto-notify operator when exceeded |
| Job TTL | 30 min | Auto-fail jobs exceeding this duration |

## 4. Cost Projection for 500 Users

### Inference Cost (Monthly)

| Model | Cost per fix | Fixes/month (500 users) | Total |
|-------|-------------|------------------------|-------|
| Our AGI (internal) | $0.05 | 5,000 | $250 |
| Claude Sonnet 4 | $0.15 | 5,000 | $750 |
| GPT-4o | $0.20 | 5,000 | $1,000 |

**Assumptions**: 10 fixes/user/month average. Each fix = ~20K input tokens + ~2K output tokens.

### Infrastructure Cost (Monthly)

| Service | Spec | Unit Cost | Units | Total |
|---------|------|-----------|-------|-------|
| Webhook server | 2 vCPU, 1GB RAM | $30/mo | 3 | $90 |
| Worker pool | 2 vCPU, 2GB RAM | $50/mo | 8 | $400 |
| PostgreSQL | 4 vCPU, 8GB RAM, 100GB SSD | $120/mo | 1 | $120 |
| Redis | 4GB RAM | $40/mo | 1 | $40 |
| RabbitMQ | 2 vCPU, 2GB RAM | $60/mo | 1 | $60 |
| Nginx/LB | 1 vCPU, 512MB RAM | $15/mo | 1 | $15 |
| Dashboard | Static hosting | $5/mo | 1 | $5 |
| Monitoring | Prometheus + Grafana | $20/mo | 1 | $20 |
| **Total** | | | | **$750** |

### Sandbox Cost (Monthly)

| Provider | Cost per run | Runs/month | Total |
|----------|-------------|------------|-------|
| E2B | $0.003 | 5,000 | $15 |
| Docker (self-hosted) | $0.001 | 5,000 | $5 |
| Firecracker (self-hosted) | $0.0005 | 5,000 | $2.50 |

Using self-hosted Docker sandboxes: **$5/mo** for 500 users.

### Monthly Cost Summary

| Category | Cost |
|----------|------|
| Inference (AGI) | $250 |
| Infrastructure | $750 |
| Sandbox | $5 |
| Bandwidth | $50 |
| **Total** | **$1,055** |

### Per-Fix Cost at Various Scales

| Users | Fixes/mo | Total Cost | Cost/Fix |
|-------|----------|------------|----------|
| 100 | 1,000 | $500 | $0.50 |
| 500 | 5,000 | $1,055 | $0.21 |
| 1,000 | 10,000 | $1,800 | $0.18 |
| 5,000 | 50,000 | $6,000 | $0.12 |
| 10,000 | 100,000 | $10,000 | $0.10 |

### Breakeven Analysis

| Plan | Price/mo | Cost to Serve | Margin | Breakeven Users |
|------|----------|---------------|--------|-----------------|
| Free | $0 | $2/user | -$2/user | — |
| Pro ($49/mo) | $49 | $10/user (5 users) | $39 | 1 user |
| Team ($149/mo) | $149 | $8/user (20 users) | $141 | 1 user |
| Enterprise ($499/mo) | $499 | $5/user (100 users) | $494 | 2 users |

At 500 users with a mix of 5% Pro, 3% Team, 1% Enterprise, 91% Free:
- Monthly revenue: (25 × $49) + (15 × $149) + (5 × $499) = **$6,095**
- Monthly cost: **$1,055**
- **Gross margin: 83%**

## 5. Verification Checklist

- [ ] `docker compose --scale syntaro-worker=4` works without errors
- [ ] `docker compose --scale syntaro-webhook=3` works without errors
- [ ] PostgreSQL connection pool handles 50 concurrent connections
- [ ] Redis `maxmemory` set to 4GB for 500 users
- [ ] Nginx worker_connections: 1024 (sufficient for 500 concurrent users)
- [ ] Rate limits documented and applied in nginx config
- [ ] DLQ alert rules active
- [ ] Queue depth alert thresholds configured
- [ ] Grafana dashboard deployed with cost panel
- [ ] Load test completes with <1% error rate at 500 users
- [ ] P95 webhook response time <500ms under peak load
- [ ] Queue drains within 5 minutes after load ends
