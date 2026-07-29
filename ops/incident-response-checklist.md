---
title: Incident Response Checklist
status: active
last-updated: 2026-07-28
---

# STAS Incident Response Checklist

> One-page quick reference for on-call engineers.
> Solving Tickets As A Service — On-Call Runbook

---

## 1. Immediate Actions (T+0–5 min)

- [ ] **Check health dashboard**: `curl -f http://localhost:3000/health`
- [ ] **Check alert source**: Determine which alert fired (PagerDuty / Slack / Better Uptime / Prometheus)
- [ ] **Acknowledge the incident**: In PagerDuty (ack) AND in Slack (`#stas-on-call`)
- [ ] **Check Grafana overview**: [Grafana Dashboard](http://localhost:3000/d/stas-overview)
- [ ] **Check logs (Loki)**: Search for error patterns across all services
- [ ] **Alert the team**: Post in `#stas-incidents` with format (see §4)
- [ ] **Determine severity**: Use severity definitions (see runbook §10.1)
- [ ] **Start incident timer**: Note the exact time of first alert

### Health Check Commands

```bash
# Service health
curl -f http://localhost:3000/health
curl -f http://localhost:3000/health/queue

# Container status
docker ps --filter "name=stas" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

# Worker status
docker compose -f docker-compose.prod.yml ps

# Quick error scan
docker compose -f docker-compose.prod.yml logs --tail=50 | grep -iE "error|exception|crash|oom|kill|exit"
```

---

## 2. Triage Checklist (T+5–15 min)

### Is It a Known Issue?

- [ ] Check `ops/playbook.md` for matching alert playbook
- [ ] Search recent incidents in `ops/security-incidents/`
- [ ] Check GitHub issues for open bugs
- [ ] Ask in `#stas-on-call` — has anyone seen this before?

### What's the Blast Radius?

- [ ] Single user / repo / event type, or all traffic?
- [ ] Is data at risk (corruption / loss)?
- [ ] Are paying customers affected? (check Stripe dashboard)
- [ ] Is GitHub API rate-limited? (`curl -H "Authorization: Bearer $GITHUB_TOKEN" https://api.github.com/rate_limit | jq '.resources.core'`)
- [ ] Are workers processing or idle?
- [ ] What's the queue depth? (`curl -s -u guest:guest http://localhost:15672/api/queues | jq '.[].messages_ready'`)

### Can We Mitigate Immediately?

| Mitigation | When to Use | Command |
|---|---|---|
| Scale workers | Queue depth > 100 | `docker compose up -d --scale stas-worker=8 stas-worker` |
| Restart service | Process crash / memory leak | `docker compose restart stas-webhook` |
| Kill idle DB connections | Connection pool exhausted | See playbook §7 |
| Rate limit override | Tier exhausted | See playbook §5 |
| Disable webhook processing | Upstream API flooding | `docker compose stop stas-webhook` |

### Instrumentation Reference

```bash
# Grafana: all dashboards
open http://localhost:3000/d/stas-overview

# Sentry: recent errors
# https://sentry.io/organizations/aimino/issues/

# PagerDuty active incidents
# https://aimino.pagerduty.com/incidents

# Better Uptime status
# https://stas.betteruptime.com

# Prometheus metrics
curl -s http://localhost:9464/metrics | grep -iE "stas_" | head -30

# Loki log query (last 15 min)
curl -s 'http://localhost:3100/loki/api/v1/query_range' \
  --data-urlencode 'query={compose_project="stas"} |= "error"' \
  --data-urlencode 'start='$(date -d '15 min ago' +%s)'000' \
  --data-urlencode 'end='$(date +%s)'000' \
  --data-urlencode 'limit=50' | jq '.data.result[]'
```

---

## 3. Communication Templates

Use these in `#stas-incidents` and on the [status page](https://stas.betteruptime.com).

### Investigating

> **Status: Investigating** — We are aware of an issue affecting [service/feature]. Our team is investigating the root cause. We will provide an update within [ETA].
>
> Affected: [what's broken]
> Started: [timestamp UTC]
> Tracking: [#incident-NNNN]

### Identified

> **Status: Identified** — We have identified the root cause: [brief description]. We are working on a fix.
>
> Root cause: [one-line summary]
> ETA for fix: [estimated time]
> Mitigation in progress: [yes/no]

### Deploying Fix

> **Status: Fix Deploying** — A fix has been implemented and is being deployed. Expected completion in [ETA].

### Resolved

> **Status: Resolved** — The issue has been resolved and all systems are operating normally.
>
> Duration: [Xh Ym]
> Root cause: [one-line summary]
> Post-mortem: [link to post-mortem doc]

### Customer-Facing (Public Status Page)

> We are currently investigating reports of [issue description]. Users may experience [symptoms]. We will provide updates as they become available. No action is needed on your end.

---

## 4. Escalation Triggers

### Automatic Escalation Criteria

| Condition | Escalate To | Method |
|---|---|---|
| SEV-1 incident acknowledged but no update in 10 min | DevOps Lead | Phone + Slack @devops-lead |
| SEV-1 unresolved after 30 min | Engineering Manager | Phone |
| SEV-1 unresolved after 60 min | CTO / VP Engineering | Phone |
| SEV-2 unresolved after 2 hours | DevOps Lead | Slack @devops-lead |
| Security incident confirmed | Security Team | Slack + security@aimino.com |
| Data loss suspected | CTO + Security Team | Phone + Slack |
| Customer-reported SEV-1 via support | On-call + DevOps Lead | Phone |
| Multiple SEV-2 incidents simultaneously | DevOps Lead | Slack + Phone |

### Escalation Contacts

| Role | Contact | Response SLA | Available |
|---|---|---|---|
| On-call Engineer | `#stas-on-call` Slack | 5 min SEV-1 / 15 min SEV-2 | 24/7 |
| DevOps Lead | @devops-lead Slack, +1-555-0102 | 15 min | 24/7 |
| Engineering Manager | @eng-mgr Slack, +1-555-0103 | 30 min | Business hours |
| Security Team | security@aimino.com, `#security` Slack | 1 hour | 24/7 |
| CTO | @cto Slack, +1-555-0104 | Upon escalation | 24/7 (escalation only) |
| Emergency | +1-555-0199 (NOC hotline) | 5 min | 24/7, infrastructure-only |

---

## 5. Post-Incident Tasks

- [ ] **Verify full resolution**: All health checks pass, no residual errors in logs
- [ ] **Monitor for recurrence**: Stay on alert for 30 min post-resolution
- [ ] **Update incident in PagerDuty**: Add resolution notes, close incident
- [ ] **Draft post-mortem**: Use `ops/post-mortem-template.md`
- [ ] **File follow-up tickets**: For any remediation items identified
- [ ] **Update playbook**: If this incident type wasn't covered, add it to `ops/playbook.md`
- [ ] **Post to `#stas-incidents`**: Final summary with duration and root cause
- [ ] **Schedule post-mortem review**: Within 5 business days
- [ ] **Restore normal operations**: Scale down workers, remove temporary mitigations

---

## 6. Quick Reference

```text
┌─────────────────────────────────────────────────────────────────┐
│                    STAS INCIDENT RESPONSE                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  T+0   Alert received → Acknowledge → Post in #stas-incidents   │
│  T+5   Triage: known issue? blast radius? mitigate?              │
│  T+15  Escalate if SEV-1 and no progress                        │
│  T+30  Mitigation in place → Monitor                            │
│  T+60  Resolved → Post-mortem → Update docs                     │
│                                                                  │
│  Dashboards:                                                     │
│  - Grafana:   http://localhost:3000/d/stas-overview              │
│  - Sentry:    https://sentry.io/orgs/aimino                     │
│  - PagerDuty: https://aimino.pagerduty.com                      │
│  - Uptime:    https://stas.betteruptime.com                     │
│  - Prometheus: http://localhost:9464/metrics                    │
│                                                                  │
│  Logs:                                                           │
│  - Docker:   docker compose logs -f                              │
│  - Loki:     http://localhost:3100 (via Grafana)                │
│  - Sentry:   Recent errors, crash-free rate                     │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```
