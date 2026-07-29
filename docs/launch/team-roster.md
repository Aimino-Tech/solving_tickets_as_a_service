# STAS Launch Team Roster

> **Launch Window**: T-60min to T+48h
> **Base Slack**: `stas-inc.slack.com`

---

## Command Team

| Role | Person | Slack Handle | Responsibilities | Shift |
|------|--------|-------------|-----------------|-------|
| **Launch Commander** | Founder A | @founder-a | Go/no-go, HN submission, PH submission, overall coordination | Day (T-1h → T+10h) |
| **Engineering Lead** | Engineer A | @engineer-a | Deploy, monitoring, Sev1/Sev2 triage, performance watch | Day (T-1h → T+10h) |
| **Content Lead** | Founder A | @founder-a | Reddit posts, Twitter/X thread, LinkedIn post, all copy | Day (T-1h → T+10h) |
| **Community Lead** | Community A | @community-a | Coordinate supporters, respond to comments, cross-post to communities | Day (T-1h → T+10h) |
| **Ops Lead** | Engineer B | @engineer-b | Monitoring dashboards, metrics tracking, incident response | Evening (T+6h → T+16h) |
| **Support Lead** | Engineer C | @engineer-c | HN/Reddit/PH comment response, user Q&A | Evening (T+6h → T+16h) |

---

## Engineering Team

| Role | Person | Slack Handle | Responsibilities | Shift |
|------|--------|-------------|-----------------|-------|
| **Lead Developer** | Engineer A | @engineer-a | Release deployment, hotfix authority, sandbox stability | Day |
| **Backend Engineer** | Engineer B | @engineer-b | API monitoring, database performance, Redis/RabbitMQ health | Evening |
| **Infrastructure Engineer** | Engineer C | @engineer-c | Docker/K8s health, auto-scaling, CI/CD pipeline | Evening / Night Watch |
| **QA Engineer** | Engineer D | @engineer-d | Smoke tests, E2E checks, regression testing | Day |
| **Security Engineer** | Engineer E | @engineer-e | Auth monitoring, rate limit checks, vulnerability scan | On-call |

---

## Marketing & Community

| Role | Person | Slack Handle | Responsibilities | Shift |
|------|--------|-------------|-----------------|-------|
| **Marketing Lead** | Founder A | @founder-a | Strategy, influencer outreach, newsletter, metrics reporting | Day |
| **Content Writer** | Founder A | @founder-a | Copy for all platforms, blog post, retrospective | Day |
| **Community Manager** | Community A | @community-a | Beta supporter coordination, Discord moderation, comment templates | Day |
| **Social Media** | Community B | @community-b | Twitter/X thread, retweet coordination, LinkedIn cross-post | Evening |
| **Designer** | Designer A | @designer-a | Hero GIF, social images, PH assets (standby for hot-fixes) | On-call |

---

## Advisory / On-Call

| Role | Person | Slack Handle | Responsibilities |
|------|--------|-------------|-----------------|
| **Advisor** | Advisor A | @advisor-a | Strategic guidance, escalation for tough decisions |
| **Legal** | Advisor A | @advisor-a | Compliance check, licensing questions |
| **DB Admin** | Engineer E | @engineer-e | Database performance, migration standby |

---

## Shift Schedule

| Shift | Time (ET) | Team Members | Coverage |
|-------|-----------|-------------|----------|
| **Day Shift A** | 8:00 AM – 2:00 PM ET | Founder A, Engineer A, Engineer D, Community A | HN drop, Reddit drop, PH drop |
| **Day Shift B** | 10:00 AM – 4:00 PM ET | Engineer A, Community B, Designer A | Peak traffic amplification |
| **Evening Shift** | 2:00 PM – 10:00 PM ET | Engineer B, Engineer C, Community B | Sustained engagement, second wave |
| **Night Watch** | 10:00 PM – 6:00 AM ET | Engineer C (on-call pager) | Infrastructure monitoring only |

---

## Communication Channels

| Channel | Purpose | Participants | Message Frequency |
|---------|---------|-------------|-------------------|
| **`#launch-war-room`** | Primary coordination — all launch comms | Full team | Continuous during launch window |
| **`#launch-alerts`** | Infrastructure alerts only | Engineering + Ops | Automated — human silence unless Sev1 |
| **`#launch-metrics`** | Automated metric updates + manual reports | All (read-only for non-command) | Every 30min automated + on-demand |
| **`#launch-supporters`** | Beta supporter coordination | Community Lead + Supporters | As needed (private channel) |
| **Phone Tree** | Emergency escalation | Launch Commander + Engineering Lead | Sev1 only |

---

## Communication Rules

1. **`#launch-war-room` is for launch coordination only** — no off-topic discussion during T-2h to T+4h
2. **All decisions go through Launch Commander** — no unilateral changes to launch sequence
3. **Incident protocol**: Engineering Lead decides severity:
   - Sev1 (site down, auth broken, data loss) → phone tree + `#launch-alerts`
   - Sev2 (slow, non-critical bug) → `#launch-alerts` only, fix after launch window
   - Sev3 (cosmetic, typo) → log in `#launch-metrics`, fix within 48h
4. **Metrics sharing**: Automated every 30min in `#launch-metrics`. Manual check when someone calls "metrics check"
5. **No external communication** about issues or incidents during launch window — respond with "We're looking into it"
6. **Comment response SLA**: <10min during peak (T-1h to T+4h), <30min during sustained (T+4h to T+24h)

---

## Launch Day Contact Quick Reference

```
Launch Commander (Founder A):  +1-555-0100 (SMS ok)
Engineering Lead (Engineer A): +1-555-0101 (SMS ok)
Ops Lead (Engineer B):         +1-555-0102 (SMS ok)
Infra On-Call (Engineer C):    +1-555-0103 (call only for Sev1)
Community Lead (Community A):  +1-555-0104 (SMS ok)
```

> **Emergency phone tree**: Launch Commander → Engineering Lead → Ops Lead → Infra On-Call
