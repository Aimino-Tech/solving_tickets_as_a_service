# STAS Launch Day Run Sheet — 48-Hour Execution

## Overview

Coordination document for the STAS public launch. Run sheet covers pre-launch checks, drop timing, team shifts, war room operations, and post-launch retro.

---

## Pre-Launch Check (T-24h to T-1h)

| # | Check | Owner | Status |
|---|-------|-------|--------|
| 1 | Run `scripts/pre-launch-smoke-test.sh` — all checks pass | | |
| 2 | Verify `docker compose up -d` on clean checkout | | |
| 3 | Verify all 4 systems respond: app server, worker, dashboard, MCP | | |
| 4 | Confirm `stas:fix` label exists on demo repo | | |
| 5 | Confirm GitHub App is installed and permissions correct | | |
| 6 | Verify HN account has ≥80 karma | | |
| 7 | Verify Reddit accounts have ≥80 karma each | | |
| 8 | Product Hunt listing submitted and scheduled | | |
| 9 | Social media posts pre-written and queued | | |
| 10 | Discord server ready with #launch-war-room channel | | |
| 11 | Plausible analytics verified on landing page | | |
| 12 | Support roster confirmed (Shift A + Shift B) | | |
| 13 | Test issue created on demo repo (ready to label at T+0) | | |
| 14 | All dependent PRs merged and deployed | | |

---

## Drop Sequence (T+0 to T+48h)

```
T+0    ── Hacker News ──  "Show HN: STAS — Label a GitHub issue, get a fix PR"
                         Post title + first comment. First 30 min critical.

T+1h   ── Reddit r/programming ──  "I built an AI that fixes GitHub issues"
                         Cross-post with feature focus.

T+2h   ── Reddit r/devtools ──  Cross-post with tooling focus.

T+4h   ── Product Hunt ──  Scheduled launch. Maker comment ready.

T+8h   ── Reddit r/machinelearning ──  Technical deep-dive.

T+24h  ── Hacker News follow-up ──  "STAS 24h later — what we learned"

T+36h  ── Indie Hackers ──  "From idea to $0 (and back): building STAS"

T+48h  ── Retro meeting ──  Metrics compilation + retrospective
```

---

## Team Shifts

| Shift | Time (ET) | Role | Responsibilities |
|-------|-----------|------|-----------------|
| Shift A | 9:00 – 14:00 | Launch Commander | Monitor HN/Reddit/PH, respond to comments within 10min, handle escalations |
| Shift B | 14:00 – 19:00 | Launch Commander | Continue monitoring, post updates, handle escalations |
| Night Watch | 19:00 – 9:00 | On-Call | Critical failures only — PagerDuty escalation path |

### Shift Handoff Checklist

- [ ] Review all open threads and unanswered comments
- [ ] Note any escalations or unresolved issues
- [ ] Confirm metric dashboards are healthy
- [ ] Pass Slack war room leadership to incoming shift

---

## War Room Operations

**Slack Channel**: `#launch-war-room`

### Communication Protocol

1. Every team member joins war room at shift start
2. All external posts logged in thread with URL + timestamp
3. Comments with questions tagged and assigned to responder
4. Any outage >2min announced in war room immediately
5. Decision to pause promotion requires 2-person approval

### Escalation Path

```
Comment needs technical answer → Tag #launch-war-room with @responder
Outage suspected              → Ping @on-call immediately
Abuse/spam                    → Mute + report, do not engage
Press inquiry                 → Route to launch commander
PR/investor interest          → Capture contact info, route post-launch
```

---

## Monitoring Dashboard

During launch, keep these open:

- **Grafana**: http://localhost:3000/d/stas (queue depth, error rates, dispatch telemetry)
- **RabbitMQ**: http://localhost:15672 (queue health)
- **Plausible**: https://plausible.io/stas (real-time visitors)
- **GitHub**: https://github.com/Aimino-Tech/solving_tickets_as_a_service (star count, issues)
- **Slack**: `#launch-war-room` (all coordination)

---

## Plan B Triggers

| Condition | Action |
|-----------|--------|
| <5 HN points at T+30min | Accelerate PH launch, double Reddit posting, DM influencers |
| <10 PH upvotes at T+2h | Boost with paid promotion, re-engage community |
| Any outage >15min | Pause all external promotion, focus on fix, post apology |
| Negative HN/Reddit reception | Engage constructively, address concerns, do not argue |
| Server scaling issue | Shift to self-hosted marketing, pause cloud marketing |

---

## Post-Launch (T+48h)

### Retro Meeting Agenda

1. Metrics review: stars, visitors, fixes run, pass rate, PRs, revenue
2. Top feedback themes from HN/Reddit/PH comments
3. What went well / what to improve
4. Action items for W+1 to W+8
5. Assign owners for follow-up work

### Metrics to Compile

| Metric | Value | Target | Notes |
|--------|-------|--------|-------|
| GitHub Stars | | 200+ | |
| Website Visitors | | 2,000+ | |
| Discord Members | | 50+ | |
| Fixes Run | | 20+ | |
| PRs Created | | 10+ | |
| HN Points | | 50+ | |
| PH Upvotes | | 30+ | |
| Support Tickets | | — | Count + categorize |

---

## Quick Reference

- **STAS Repo**: https://github.com/Aimino-Tech/solving_tickets_as_a_service
- **Dashboard**: https://stas.aimino.ai
- **Docs**: https://docs.stas.aimino.ai
- **Discord**: https://discord.gg/stas
- **Status Page**: https://status.stas.aimino.ai
