# SYNTARO Cost Projection — 500 Users

## Assumptions
- 500 users, 5 issues/week each = 2,500 issues/week
- 80% triaged = 500 fix runs/week
- Avg fix: 2m agent + 30s sandbox

## Inference (Monthly)
| Model | Cost/fix | Weekly | Monthly |
|-------|----------|--------|---------|
| Claude Sonnet 4 | $0.15 | $75 | $325 |
| Self-hosted AGI | $0.02 | $10 | $43 |

## Infrastructure (Monthly)
| Component | Spec | Cost |
|-----------|------|------|
| 4x API servers | 2 vCPU, 4GB | $96 |
| 8x Workers | 4 vCPU, 8GB | $384 |
| 2x Redis (HA) | 4GB | $30 |
| 1x PostgreSQL | 4 vCPU, 16GB | $80 |
| 2x Nginx | 1 vCPU, 2GB | $20 |
| Bandwidth | 160 GB | $17 |
| Sandbox (E2B) | 17 hrs | $5 |
| **Total** | | **$632** |

## Total
| Category | Claude | Our AGI |
|----------|--------|---------|
| Total | **$957** | **$675** |
| Cost/fix | **$0.48** | **$0.34** |

Breakeven at **~20 users** ($49/user, 97% margin)

## Scale
| Users | Fixes/mo | Cost/mo | Revenue | Margin |
|-------|----------|---------|---------|--------|
| 500 | 2,000 | $957 | $24,500 | 96% |
| 1,000 | 4,000 | $1,800 | $49,000 | 96% |
| 5,000 | 20,000 | $7,500 | $245,000 | 97% |
