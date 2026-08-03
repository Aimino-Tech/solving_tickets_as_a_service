# SYNTARO Usage Analytics Dashboard

**Purpose:** Track growth metrics (WAR, fix count, conversion) internally, and provide usage insights to customers on Pro/Team tiers.

**Recommended stack:** PostHog (open-source, self-hostable, EU data residency)
**Alternative:** Metabase (self-hosted, SQL-based)

---

## Section 1: Growth Overview (Executive Summary)

| Metric | Definition | Target (D90) | Refresh |
|--------|-----------|-------------|---------|
| **Weekly Active Repos (WAR)** | Repos that triggered ≥1 fix in last 7 days | 150 | Daily |
| **Total Fixes Processed** | Cumulative fixes, 7-day trend sparkline | 10,000 | Real-time |
| **Active Users** | Unique installation IDs with ≥1 fix in last 30 days | 500 | Daily |
| **MRR** | Monthly recurring revenue, 30-day trailing avg | $5,000 | Daily |

Each KPI displayed as:
- Current value (large number)
- 7-day change (percentage + arrow)
- 30-day trend (sparkline)
- Target vs actual (progress bar)

---

## Section 2: Fix Performance (Ops + Quality)

### Metrics

- **Fix pass rate** — % of generated PRs that pass existing tests + quality gates
- **Average fix time** — from issue label to PR creation. Segmented by queue tier (free vs priority)
- **Cost per fix** — LLM API cost per fix, averaged daily. Alert if >$5/fix
- **Fix distribution by language** — JS/TS vs Python vs Rust vs Other
- **Top failing repos** — repos with lowest pass rate (target improvement efforts)
- **Fix size distribution** — files changed per fix (1, 2-3, 4-5, 5+)

### Charts

- Pass rate trend (7-day rolling, with deployment annotations)
- Fix time histogram (bucketed by minute)
- Cost per fix scatter (daily average with outlier highlighting)
- Language donut chart

---

## Section 3: Conversion Funnel (Revenue Tracking)

### Funnel Stages

```
Visitors → Installs → First Fix → Weekly Active → Paid
  100%        15%        10%          5%           1.5%
```

### Metrics

- Conversion rates at each stage (current + trailing 30-day)
- Paid user cohort tracking (conversion rate by signup month)
- Monthly churn rate (target: <5%)
- Expansion MRR (upgrades from Pro to Team)
- Average revenue per paid user (ARPU)
- Lifetime value (LTV) estimate by cohort

### Cohort View

| Signup Month | Users | Converted | Month 1 | Month 2 | Month 3 |
|-------------|-------|-----------|---------|---------|---------|
| July 2026 | 200 | 15 (7.5%) | 100% | 85% | 72% |

---

## Section 4: User Activity (Engagement Metrics)

### Metrics

- **Fixes per active repo per week** — distribution histogram
- **Trigger methods** — comment trigger vs MCP vs API (stacked bar)
- **Feature adoption** — % of users using planning feature, MCP access, team dashboard
- **Retention cohorts** — % of users still active at week 1, 2, 4, 8, 12

### Charts

- Weekly active repos line chart (52-week lookback)
- Trigger method breakdown (time-series stacked area)
- Retention curves (cohort-based line chart)
- Feature adoption radar

---

## Event Tracking Schema

### Events

| Event | Properties | Trigger | PII? |
|-------|-----------|---------|------|
| `app_installed` | `installation_id`, `repo_count`, `account_type` | GitHub app installed | No |
| `issue_labeled` | `installation_id`, `repo`, `issue_number`, `language` | Issue labeled `syntaro:fix` | No |
| `plan_generated` | `installation_id`, `fix_id`, `plan_length`, `language` | Plan posted to issue | No |
| `plan_approved` | `installation_id`, `fix_id`, `approval_time_seconds` | User approved plan | No |
| `plan_rejected` | `installation_id`, `fix_id`, `rejection_reason` | User rejected plan | No |
| `pr_created` | `installation_id`, `fix_id`, `files_changed`, `pass_rate` | PR opened | No |
| `fix_completed` | `installation_id`, `fix_id`, `duration_seconds`, `cost`, `pass_rate` | PR merged/closed | No |
| `user_signup` | `installation_id`, `plan`, `referral_source` | User creates account | Email (hashed) |
| `user_converted` | `installation_id`, `plan`, `amount`, `coupon` | Free→Paid upgrade | No |
| `user_canceled` | `installation_id`, `plan`, `reason` | Subscription canceled | No |

### Entity Properties

| Entity | Properties |
|--------|-----------|
| **Installation** | `installation_id`, `github_account`, `repo_count`, `created_at`, `plan`, `mcp_enabled` |
| **Repository** | `repo`, `owner`, `language`, `fix_count`, `pass_rate`, `last_active` |
| **User** | `distinct_id` (anonymous), `email_hash` (if signed up), `plan`, `created_at` |

---

## Data Pipeline

```
Events (GitHub App / API) 
       ↓
  [PostHog Capture API]
       ↓
  [PostHog Pipeline]
       ↓
  PostgreSQL → [Materialized Views] → Dashboards
       ↓
  ClickHouse (PostHog) → [Analytics Queries]
       ↓
  Redis (real-time counters)
```

### Components

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Event capture | PostHog SDK / REST API | Client-side event ingestion |
| Stream processing | PostHog plugin server | Real-time aggregation |
| Data warehouse | ClickHouse (managed by PostHog) | Analytics queries |
| Cache | Redis | Real-time counter increments |
| Dashboards | PostHog dashboards + Metabase | Visualization |
| Export | CSV download | Enterprise requirement |

### Refresh Rates

| Data | Refresh |
|------|---------|
| Real-time counters (fixes today, active now) | Sub-minute |
| Operations metrics (pass rate, fix time) | Minute |
| Growth metrics (WAR, MRR, conversion) | Hourly |
| Cohort analysis | Daily |
| Historical reports | Daily |

---

## Privacy & Compliance

- **No PII in analytics events** — all tracking uses anonymous `installation_id` or `distinct_id`
- **Email stored only as SHA-256 hash** — cannot recover original email from analytics
- **IP anonymization** — PostHog configured to drop IP addresses
- **Opt-out mechanism** — users can disable analytics via `/syntaro analytics disable` or dashboard setting
- **Data retention** — raw events: 90 days, aggregated: 24 months
- **GDPR compliant** — no personal data leaves the EU region (self-hosted or EU-cloud PostHog)
- **Data Processing Agreement** — available for enterprise customers

---

## Customer-Facing Dashboard (Pro/Team Tiers)

Subset of internal dashboard visible to customers:

| Section | Pro | Team |
|---------|-----|------|
| Fixes this month | ✅ | ✅ |
| Pass rate | ✅ | ✅ |
| Avg fix time | ✅ | ✅ |
| Language breakdown | ✅ | ✅ |
| Active repos | ✅ | ✅ |
| Team member usage | ❌ | ✅ |
| Cost savings estimate | ❌ | ✅ |
| Trend comparison | 7-day | 30-day |
| CSV export | ❌ | ✅ |

---

## Implementation Plan

### Phase 1: Foundation (Week 1)
1. Deploy PostHog (self-hosted or EU cloud)
2. Integrate PostHog SDK into GitHub app
3. Fire core events: `app_installed`, `issue_labeled`, `plan_generated`, `pr_created`
4. Build Growth Overview dashboard

### Phase 2: Quality & Funnel (Week 2)
1. Add fix performance tracking: `fix_completed`, `plan_approved`, `plan_rejected`
2. Build Fix Performance dashboard
3. Build Conversion Funnel dashboard
4. Set up Stripe event integration for MRR tracking

### Phase 3: Engagement & Customer (Week 3)
1. Build User Activity dashboard
2. Set up cohort tracking
3. Build customer-facing dashboard (Pro/Team)
4. Add CSV export

### Phase 4: Automation (Week 4)
1. Set up alerting (cost >$5/fix, pass rate <80%, churn spike)
2. Configure weekly email report
3. Build anomaly detection for metric drops
4. Document runbook for dashboard maintenance

### Effort Estimate

| Phase | Engineering | Design | Total |
|-------|------------|--------|-------|
| Phase 1 | 2 days | 0.5 day | 2.5 days |
| Phase 2 | 2 days | 0.5 day | 2.5 days |
| Phase 3 | 1.5 days | 1 day | 2.5 days |
| Phase 4 | 1 day | 0 day | 1 day |
| **Total** | **6.5 days** | **2 days** | **8.5 days** |

---

## Appendix: SQL Schema (PostgreSQL Materialized Views)

```sql
-- Weekly Active Repos
CREATE MATERIALIZED VIEW weekly_active_repos AS
SELECT
  date_trunc('week', timestamp) AS week,
  installation_id,
  COUNT(DISTINCT repo) AS active_repos
FROM events
WHERE event_name = 'fix_completed'
  AND timestamp > NOW() - INTERVAL '90 days'
GROUP BY week, installation_id;

-- Conversion Funnel
CREATE MATERIALIZED VIEW conversion_funnel AS
SELECT
  date_trunc('day', timestamp) AS day,
  COUNT(DISTINCT CASE WHEN event_name = 'app_installed' THEN installation_id END) AS installs,
  COUNT(DISTINCT CASE WHEN event_name = 'fix_completed' THEN installation_id END) AS first_fix,
  COUNT(DISTINCT CASE WHEN event_name = 'user_converted' THEN installation_id END) AS paid
FROM events
GROUP BY day;

-- Cost Per Fix (Daily Average)
CREATE MATERIALIZED VIEW daily_cost_per_fix AS
SELECT
  date_trunc('day', timestamp) AS day,
  AVG(cost) AS avg_cost,
  COUNT(*) AS fix_count
FROM events
WHERE event_name = 'fix_completed'
GROUP BY day;
```
