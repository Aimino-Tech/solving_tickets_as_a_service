# Marketing Pipeline & Monitoring System — Plan

## Current State Analysis

### What We Have
| Component | Status | Notes |
|-----------|--------|-------|
| **Reddit** | Active (332 posts) | 5 accounts, 20+ subreddits, daily cron |
| **LinkedIn** | Active (separate sheet) | Personal account, daily engagement |
| **Twitter/X** | Active (separate sheet) | Guerrilla replies, 3x/day |
| **Hacker News** | Active (49 posts) | 2 accounts, daily |
| **Discord** | Active | Aimino Tech server, 3x/day |
| **Google Sheet** | 9 worksheets | Tracking but no analytics |

### What's Missing
1. **No unified pipeline** — each platform runs independently
2. **No metrics tracking** — we track actions but not outcomes
3. **No ROI analysis** — can't tell what drives new users/revenue
4. **No A/B testing** — can't compare strategies
5. **No automated reporting** — manual checking only

---

## Marketing Pipeline Design

### The Funnel
```
[AWARENESS] → [INTEREST] → [CONSIDERATION] → [SIGNUP] → [REVENUE]
     ↓              ↓              ↓              ↓           ↓
  Reddit/HN    Value-first    Product mention   Waitlist    Paying
  LinkedIn     comments       in context        signup      customer
  Twitter
  Discord
```

### Pipeline Stages

#### Stage 1: AWARENESS (Top of Funnel)
**Goal:** Get seen by target audience
**Actions:**
- Reddit posts in relevant subreddits
- Twitter replies to relevant conversations
- LinkedIn engagement on industry posts
- Hacker News comments on technical discussions
- Discord community participation

**Metrics:**
- Posts/comments published
- Reach (upvotes, likes, impressions)
- Subreddit/topic coverage

#### Stage 2: INTEREST (Middle of Funnel)
**Goal:** Build credibility and trust
**Actions:**
- Value-first comments (90/10 rule)
- Answer questions genuinely
- Share knowledge without selling
- Build account karma/reputation

**Metrics:**
- Comment karma gained
- Reply rate (% of comments getting replies)
- Upvote ratio
- Account age/karma growth

#### Stage 3: CONSIDERATION (Bottom of Funnel)
**Goal:** Introduce product as solution
**Actions:**
- Contextual product mentions
- "I use a tool that..." framing
- Comparison with alternatives
- Direct recommendations (when appropriate)

**Metrics:**
- Product mention frequency
- Click-through rate (if trackable)
- Reply sentiment (positive/neutral/negative)

#### Stage 4: CONVERSION (Action)
**Goal:** Drive signups
**Actions:**
- Direct links to waitlist/website
- Clear CTAs in comments
- Profile bio links
- GitHub repo links

**Metrics:**
- Waitlist signups (daily)
- Website visits (if analytics available)
- GitHub stars/forks

#### Stage 5: REVENUE (Outcome)
**Goal:** Monetize
**Actions:**
- Convert free users to paid
- Upsell premium features
- Referral programs

**Metrics:**
- Paying customers
- MRR/ARR
- Churn rate

---

## Monitoring Dashboard Design

### Daily Metrics (Auto-collected)
```yaml
daily_metrics:
  # Activity
  posts_published: count
  comments_posted: count
  replies_received: count
  replies_responded: count
  
  # Engagement
  total_upvotes: count
  total_likes: count
  average_engagement_rate: percentage
  
  # Growth
  new_followers: count
  account_karma_change: count
  
  # Conversion
  website_visits: count (if trackable)
  waitlist_signups: count
  github_stars: count
```

### Weekly Metrics (Aggregated)
```yaml
weekly_metrics:
  # Performance
  best_performing_post: {platform, url, upvotes}
  worst_performing_post: {platform, url, upvotes}
  average_engagement_by_platform: {reddit: %, twitter: %, linkedin: %}
  
  # Growth
  total_reach: count
  follower_growth_rate: percentage
  karma_growth_rate: percentage
  
  # Conversion
  signups_by_source: {reddit: count, twitter: count, ...}
  conversion_rate: percentage
  cost_per_acquisition: amount (if paid)
```

### Monthly Metrics (Strategic)
```yaml
monthly_metrics:
  # ROI
  revenue_generated: amount
  marketing_spend: amount
  roi: percentage
  
  # Strategy
  best_performing_platform: platform
  best_performing_subreddit: subreddit
  best_performing_content_type: type
  
  # Insights
  what_worked: list
  what_failed: list
  recommendations: list
```

---

## Implementation Plan

### Phase 1: Data Collection (Week 1)
1. **Extend Google Sheet** — Add metrics columns
2. **Create tracking script** — Auto-collect daily metrics
3. **Set up cron job** — Daily metrics collection

### Phase 2: Dashboard (Week 2)
1. **Create monitoring worksheet** — Daily/weekly/monthly views
2. **Build automated reports** — Morning kickoff with metrics
3. **Set up alerts** — Anomaly detection (sudden drops/spikes)

### Phase 3: Analysis (Week 3)
1. **A/B testing framework** — Test different strategies
2. **Attribution tracking** — Which actions drive signups
3. **Optimization recommendations** — AI-powered suggestions

### Phase 4: Automation (Week 4)
1. **Auto-optimize** — Adjust strategy based on metrics
2. **Auto-report** — Weekly summary to Slack
3. **Auto-alert** — Notify on significant changes

---

## Sheet Extensions

### New Columns for reddit-campaign
| Column | Purpose |
|--------|---------|
| `Engagement_Score` | Calculated: upvotes + replies + clicks |
| `Conversion_Tracked` | Did this lead to a signup? |
| `Source_Attribution` | Which platform/content drove the signup |
| `Performance_Tier` | A/B/C/D based on engagement |

### New Worksheet: marketing-metrics
| Column | Purpose |
|--------|---------|
| `Date` | Metric date |
| `Platform` | Reddit/Twitter/LinkedIn/HN/Discord |
| `Posts_Published` | Count |
| `Comments_Posted` | Count |
| `Replies_Received` | Count |
| `Total_Upvotes` | Count |
| `New_Followers` | Count |
| `Waitlist_Signups` | Count |
| `Notes` | Qualitative observations |

### New Worksheet: conversion-funnel
| Column | Purpose |
|--------|---------|
| `Date` | Funnel date |
| `Awareness_Count` | Total posts/comments |
| `Interest_Count` | Comments with replies |
| `Consideration_Count` | Product mentions |
| `Conversion_Count` | Signups |
| `Revenue_Count` | Paying customers |
| `Conversion_Rate` | Calculated % |

---

## Success Criteria

### Daily Goals
- [ ] 5+ posts/comments across platforms
- [ ] 2+ replies to our comments
- [ ] 1+ new follower/subscriber
- [ ] 1+ waitlist signup (stretch goal)

### Weekly Goals
- [ ] 30+ posts/comments
- [ ] 10+ replies received
- [ ] 5+ new followers
- [ ] 5+ waitlist signups
- [ ] 1+ paying customer (stretch goal)

### Monthly Goals
- [ ] 100+ posts/comments
- [ ] 50+ replies received
- [ ] 20+ new followers
- [ ] 20+ waitlist signups
- [ ] 5+ paying customers

---

## Next Steps

1. **Review this plan** — Does it match your vision?
2. **Prioritize** — What to implement first?
3. **Start Phase 1** — Extend the Sheet and create tracking script
4. **Set up first cron job** — Daily metrics collection
5. **Iterate** — Adjust based on what we learn

---

*Plan created: 2026-06-15*
*Status: Awaiting review*
