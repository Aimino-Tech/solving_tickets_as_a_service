---
title: "SYNTARO Launch Day — Support Plan"
status: "draft"
last-updated: "2026-07-28"
---

# SYNTARO Launch Day — Support Plan

## Overview

This plan covers the first 90+ days of the SYNTARO community Slack workspace (`syntaro-community`). It defines support SLAs, escalation paths, moderator recruitment, shift schedules, and key metrics. The goal is to provide an exceptional support experience that converts early users into long-term community advocates.

---

## Phase 1: First 30 Days (Founder-Led Support)

### Support Commitment

- **SLA**: Every question in #support answered within **4 hours**, 7 days a week.
- **Coverage**: 8:00 AM — 10:00 PM ET (14-hour window)
- **Responders**: Founders and core SYNTARO team members only.
- **Channel**: Primary response in #support. Complex issues escalated to DMs or GitHub issues.

### Shift Schedule (Founder Rotation)

| Slot | Time (ET) | Primary | Secondary |
|------|-----------|---------|-----------|
| Morning | 8:00 AM — 12:00 PM | Founder A | Founder B |
| Afternoon | 12:00 PM — 4:00 PM | Founder B | Founder C |
| Evening | 4:00 PM — 8:00 PM | Founder C | Founder A |
| Late | 8:00 PM — 10:00 PM | Founder A (on-call) | — |
| Weekend (Sat-Sun) | 10:00 AM — 6:00 PM | Rotating founder | — |

**On-call handoff**: Each shift lead posts a brief summary in #mod-log before handing off:
> "Shift handoff: 3 new threads, 2 resolved, 1 escalated to GitHub (#123). @next-up — all threads in #support have been triaged."

### Daily Triage Workflow

1. **Review overnight threads** — Morning shift reviews all unanswered threads from the previous 12 hours.
2. **Tag and categorize** — Each thread gets a label:
   - `:bug:` — Confirmed bug (create GitHub issue)
   - `:question:` — Usage question (answer or link to docs)
   - `:feature_request:` — Feature request (move to #feedback)
   - `:urgent:` — Production down / blocking (escalate immediately)
3. **Close resolved threads** — Mark as resolved with a summary comment. Archiving after 24h of no activity.
4. **Log escalations** — Every escalation to GitHub gets a link in #mod-log.

### Week 1-4 Tactical Goals

| Week | Goal | Success Metric |
|------|------|----------------|
| 1 | All support questions answered within 4h | 100% SLA adherence |
| 2 | First 10 user showcases in #showcase | 10 posts |
| 3 | Knowledge base FAQ created from top 20 support questions | FAQ published in docs |
| 4 | Identify 5 power users for moderator program | 5 nominations |

---

## Phase 2: Day 30–90 (Power User Transition)

### Moderator Program Recruitment

**Criteria for power-user identification**:
- Answered 5+ questions in #support correctly
- Submitted 2+ quality bug reports or feature requests
- Active in the community for 14+ days
- Positive reception from other members

**Invitation process**:
1. Founders nominate candidates in private (#mod-log).
2. Reach out via DM with a personalized invite.
3. 30-minute onboarding call covering moderation tools, guidelines, escalation path.
4. Grant `@moderator` role with limited permissions (can delete messages, mute users for up to 24h).
5. Two-week trial period with mentorship from a founder.

### Shift Schedule (Hybrid — Founders + Moderators)

| Slot | Time (ET) | Primary | Secondary |
|------|-----------|---------|-----------|
| Morning | 8:00 AM — 12:00 PM | Founder A | Moderator 1 |
| Afternoon | 12:00 PM — 4:00 PM | Moderator 1 | Moderator 2 |
| Evening | 4:00 PM — 8:00 PM | Founder B | Moderator 2 |
| Late | 8:00 PM — 10:00 PM | Moderator 1 (on-call) | — |
| Weekend | 10:00 AM — 6:00 PM | Rotating founder + moderator | — |

### Day 30-90 Tactical Goals

| Milestone | Goal | Success Metric |
|-----------|------|----------------|
| Day 45 | 5 moderators onboarded and active | 5 active @moderator roles |
| Day 60 | Moderators handling 50% of support questions | 50% of #support threads resolved by moderators |
| Day 75 | First community-contributed FAQ expansion | FAQ PR merged |
| Day 90 | Moderators handling 80% of support questions | 80% of #support threads resolved by moderators |

---

## Phase 3: Day 90+ (Community-Led)

### Community-Elected Moderators

- **Election cycle**: Every 90 days.
- **Eligibility**: Active `@moderator` for at least one term, or has been a `@power-user` for 60+ days.
- **Voting**: Simple majority vote by the active moderator team. Founders hold veto power.
- **Term limits**: Maximum 2 consecutive terms (180 days). Must sit out one cycle before re-election.

### Community Events

| Event | Frequency | Description |
|-------|-----------|-------------|
| AMA with SYNTARO founders | Monthly | Live Q&A in #general. Founders answer questions for 1 hour. |
| SYNTARO Show & Tell | Bi-weekly | Members showcase their SYNTARO workflows in #showcase. Best showcase wins a prize. |
| Contributor Office Hours | Weekly | 30-min video call for open-source contributors to get guidance. |
| Bug Bash | Quarterly | 48-hour focused bug-finding event. Prizes for most valuable bug reports. |
| Community Survey | Monthly | Measure satisfaction, identify pain points, gather feature requests. |

### Day 90+ Tactical Goals

| Goal | Success Metric |
|------|----------------|
| Community handles 90%+ of support without founder intervention | <10% of threads require founder response |
| Average first-response time <2 hours | Median <120 min |
| Member growth rate >20% month-over-month | MoM growth |
| NPS score >40 | Monthly survey |

---

## Support Escalation Path

```
User posts in #support
        │
        ▼
    ┌─────────────────────┐
    │ Tier 1: Community   │ ← Moderator or power-user responds
    │      Goal: Resolve  │    within 2 hours (Phase 3) / 4 hours (Phase 1-2)
    │      in-thread      │
    └────────┬────────────┘
             │ Escalated if: unresolved after 2 responses,
             │               confirmed bug, security issue
             ▼
    ┌─────────────────────┐
    │ Tier 2: SYNTARO Team   │ ← Core contributor / founder
    │      Goal: Fix or   │    Responds within 8 hours
    │      workaround     │
    └────────┬────────────┘
             │ Escalated if: production outage,
             │               security vulnerability,
             │               feature request requiring architecture change
             ▼
    ┌─────────────────────┐
    │ Tier 3: Engineering │ ← Engineering team
    │      Goal: Patch    │    Hotfix: 24 hours
    │      or redesign    │    Feature: next sprint
    └─────────────────────┘
```

### Escalation Triggers

- **Tier 1 → Tier 2**:
  - Thread has 2+ moderator responses without resolution
  - User reports a confirmed bug with reproduction steps
  - User reports a security concern
  - Feature request with broad community support (3+ upvotes)

- **Tier 2 → Tier 3**:
  - Production system is down or degraded
  - Confirmed security vulnerability (CVSS 7+)
  - Issue affects 5+ users
  - Requires changes to core SYNTARO architecture

---

## Response Shift Schedule Template

### Weekly Template

| Day | Slot | Time (ET) | Primary | Secondary |
|-----|------|-----------|---------|-----------|
| Mon | Morning | 8-12 | [Name] | [Name] |
| Mon | Afternoon | 12-4 | [Name] | [Name] |
| Mon | Evening | 4-8 | [Name] | [Name] |
| Mon | Late | 8-10 | [Name] | — |
| Tue | Morning | 8-12 | [Name] | [Name] |
| Tue | Afternoon | 12-4 | [Name] | [Name] |
| Tue | Evening | 4-8 | [Name] | [Name] |
| Tue | Late | 8-10 | [Name] | — |
| Wed | Morning | 8-12 | [Name] | [Name] |
| Wed | Afternoon | 12-4 | [Name] | [Name] |
| Wed | Evening | 4-8 | [Name] | [Name] |
| Wed | Late | 8-10 | [Name] | — |
| Thu | Morning | 8-12 | [Name] | [Name] |
| Thu | Afternoon | 12-4 | [Name] | [Name] |
| Thu | Evening | 4-8 | [Name] | [Name] |
| Thu | Late | 8-10 | [Name] | — |
| Fri | Morning | 8-12 | [Name] | [Name] |
| Fri | Afternoon | 12-4 | [Name] | [Name] |
| Fri | Evening | 4-8 | [Name] | [Name] |
| Fri | Late | 8-10 | [Name] | — |
| Sat | Weekend | 10-6 | [Name] | [Name] |
| Sun | Weekend | 10-6 | [Name] | [Name] |

### On-Call Handoff Template

```
## Shift Handoff — [Date] [Time ET]

**From**: [Previous responder]
**To**: [Next responder]

**Threads created**: [N]
**Threads resolved**: [N]
**Threads escalated**: [N] — links: [GitHub issue URLs]

**Active escalations**:
- [Thread link] — waiting on user response
- [Thread link] — engineering working on fix

**Notes**: [Anything the next shift should know]

**Next handoff**: [Time]
```

---

## Metrics to Track

### Support Metrics

| Metric | Definition | Target (Phase 1) | Target (Phase 2) | Target (Phase 3) |
|--------|------------|------------------|------------------|------------------|
| First Response Time (FRT) | Time from first message to first reply (median) | <2h | <1h | <30min |
| Resolution Time | Time from first message to thread closure (median) | <8h | <4h | <2h |
| SLA Adherence | % of threads receiving first response within SLA | 100% | 95% | 95% |
| Escalation Rate | % of threads escalated to Tier 2+ | <20% | <15% | <10% |
| Resolution Rate | % of threads marked as resolved | >80% | >85% | >90% |
| CSAT | % of users rating support as "Good" or "Excellent" | — | >4.0/5.0 | >4.5/5.0 |

### Community Health Metrics

| Metric | Definition | Target (Phase 1) | Target (Phase 2) | Target (Phase 3) |
|--------|------------|------------------|------------------|------------------|
| Member Count | Total workspace members | 100 | 500 | 2000 |
| Active Members | Members who posted in last 7 days | >30 | >100 | >400 |
| Retention (D7) | % of members still active after 7 days | >40% | >50% | >60% |
| DAU/MAU | Daily active / monthly active users | >20% | >25% | >30% |
| Conversion Rate | % of members who try SYNTARO | >30% | >40% | >50% |
| NPS | Net Promoter Score (monthly survey) | — | >30 | >40 |
| Moderators Active | Moderators who took action in last 7 days | 0 (all founders) | >3 | >8 |

### Reporting Cadence

| Report | Frequency | Audience | Contents |
|--------|-----------|----------|----------|
| Daily support summary | Daily | Support team | Threads created/resolved, escalations, issues found |
| Weekly community report | Weekly | All founders | Member growth, top threads, moderation actions, NPS |
| Monthly retrospective | Monthly | Full team | Trends, improvement areas, wins, community survey results |
| Quarterly review | Quarterly | Company | Phase transition readiness, moderator elections, roadmap alignment |
