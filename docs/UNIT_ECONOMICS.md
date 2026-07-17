# Unit Economics & Breakeven Analysis

> **Last Updated**: 2026-07-17
> **Canonical Pricing**: Solo $49/mo | Team $149/mo | Enterprise Custom

## Current Cost Structure

### Per-Fix Cost Breakdown
| Component | Cost | Share |
|---|---|---|
| Inference (OpenCode + claude-sonnet-4) | ~$3.00 | 86% |
| Sandbox compute (E2B/Docker) | ~$0.50 | 14% |
| **Total per fix** | **~$3.50** | **100%** |

### Baseline Infrastructure
| Item | Monthly Cost |
|---|---|
| API server (2 x $20) | $40 |
| Redis (cache + queue) | $15 |
| Database (Postgres) | $15 |
| Monitoring (Sentry + Grafana) | $30 |
| CI/CD + artifact storage | $20 |
| DNS + CDN | $10 |
| **Total baseline** | **~$130/mo** |

## Per-Tier Breakeven Analysis

### Free Tier
```
Revenue:       $0/mo
Fixes:         10 fixes/mo
Inference:     $3.00 × 10 = $30.00
Sandbox:       $0.50 × 10 = $5.00
Infra share:   $0.65 (0.5% of baseline)
Total cost:    $35.65/mo
Margin:        -100%
```

**Purpose**: Customer acquisition cost. Acceptable loss-leader.

### Solo ($49/mo)

#### At full utilization (100 fixes)
```
Revenue:       $49.00/mo
Fixes:         100 fixes/mo
Inference:     $3.00 × 100 = $300.00
Sandbox:       $0.50 × 100 = $50.00
Infra share:   $2.60
Total cost:    $352.60/mo
Margin:        -619%
```

#### At average utilization (25 fixes)
```
Revenue:       $49.00/mo
Fixes:         25 fixes/mo
Inference:     $3.00 × 25 = $75.00
Sandbox:       $0.50 × 25 = $12.50
Infra share:   $2.60
Total cost:    $90.10/mo
Margin:        -84%
```

#### Breakeven utilization
```
Revenue:       $49.00/mo
Target cost:   $49.00 (breakeven)
Max fixes:     49 / $3.50 = 14 fixes/mo
Utilization:   14% of allocation
```

### Team ($149/mo)

#### At full utilization (500 fixes)
```
Revenue:       $149.00/mo
Fixes:         500 fixes/mo
Inference:     $3.00 × 500 = $1,500.00
Sandbox:       $0.50 × 500 = $250.00
Infra share:   $5.20
Total cost:    $1,755.20/mo
Margin:        -1,078%
```

#### At average utilization (100 fixes)
```
Revenue:       $149.00/mo
Fixes:         100 fixes/mo
Inference:     $3.00 × 100 = $300.00
Sandbox:       $0.50 × 100 = $50.00
Infra share:   $5.20
Total cost:    $355.20/mo
Margin:        -138%
```

#### Breakeven utilization
```
Revenue:       $149.00/mo
Target cost:   $149.00 (breakeven)
Max fixes:     149 / $3.50 = 42 fixes/mo
Utilization:   8.4% of allocation
```

## Cost Reduction Path to Profitability

### Phase 1 (0-3 months) — Optimization
- Implement caching → -20% inference cost ($3.00 → $2.40)
- Better prompt engineering → -10% tokens ($2.40 → $2.16)
- Optimize sandbox boot times → -20% sandbox cost ($0.50 → $0.40)
- **Result**: $2.56/fix total

### Phase 2 (3-6 months) — Infrastructure
- Pre-warmed sandbox containers → -50% sandbox cost ($0.40 → $0.20)
- Model cascade routing → -15% inference ($2.16 → $1.84)
- Batch pricing with providers → -10% inference ($1.84 → $1.66)
- **Result**: $1.86/fix total

### Phase 3 (6-12 months) — Scale
- Dedicated inference infra → -30% inference ($1.66 → $1.16)
- Shared sandbox pools → -25% sandbox ($0.20 → $0.15)
- Proprietary fine-tuned models → -40% inference ($1.16 → $0.70)
- **Result**: $0.85/fix total

### Breakeven at Phase 3 Costs

| Tier | Revenue | Breakeven Fixes | % of Allocation |
|---|---|---|---|
| Solo ($49) | $49 | 57 fixes | 57% |
| Team ($149) | $149 | 175 fixes | 35% |
| Enterprise ($10K) | $10,000 | 11,764 fixes | N/A (unlimited) |

## Key Metrics Dashboard

| Metric | Value | Target |
|---|---|---|
| Per-fix cost (current) | $3.50 | $1.70 |
| Solo contribution margin | -619% | +20% |
| Team contribution margin | -1,078% | +30% |
| Enterprise margin | 25%+ | 60%+ |
| Blended gross margin | -200% | 40%+ |
| Months to profitability | 12-18 | 12 |
| Avg fixes/user/month | 25-50 | 30 |

## Risk Factors

| Risk | Impact | Mitigation |
|---|---|---|
| Model provider price increase | +20-50% cost | Multi-provider strategy, caching |
| Lower than expected usage | Fewer economies of scale | Focus on high-value enterprise deals |
| Competitor price war | Pressure on $49/$149 | Differentiate on quality, not price |
| Sandbox cost overruns | +50-100% cost | Pre-warming, shared infra, timeouts |
