---
title: Post-Mortem Template
status: active
last-updated: 2026-07-28
---

# Post-Mortem: [Incident Title]

> **Blameless, action-oriented incident analysis.**
> Solving Tickets As A Service

---

## Incident Summary

| Field | Value |
|---|---|
| **Incident ID** | `INC-NNNN` |
| **Title** | Short, descriptive title |
| **Date** | YYYY-MM-DD |
| **Duration** | Start — End (Xh Ym) |
| **Severity** | SEV-1 / SEV-2 / SEV-3 / SEV-4 |
| **Service Affected** | e.g., Webhook, Worker, PostgreSQL, GitHub API |
| **Detected By** | PagerDuty / Better Uptime / Customer report / Internal monitor |
| **Reported By** | Name / Team |
| **Participants** | @on-call, @devops-lead, @eng-mgr |

---

## Timeline of Events

_All times in UTC._

| Time (UTC) | Event |
|---|---|
| HH:MM | [First alert fired / customer report received] |
| HH:MM | [On-call acknowledged] |
| HH:MM | [Initial triage assessment] |
| HH:MM | [Escalation if applicable] |
| HH:MM | [Mitigation action taken] |
| HH:MM | [Service partially restored] |
| HH:MM | [Service fully restored] |
| HH:MM | [Monitoring period started] |
| HH:MM | [Incident closed] |

### Key Decisions

| Time | Decision | Rationale | Decided By |
|---|---|---|---|
| HH:MM | [e.g., scaled workers to 8] | Queue depth > 500 | @on-call |
| HH:MM | [e.g., rolled back deploy] | Migration caused regression | @devops-lead |

### Communication Log

| Time | Channel | Message |
|---|---|---|
| HH:MM | `#syntaro-incidents` | "Investigating: ..." |
| HH:MM | Status page | "Identified: ..." |
| HH:MM | `#syntaro-incidents` | "Resolved: ..." |

---

## Root Cause Analysis

### Summary

[One-paragraph description of what happened and why.]

### 5 Whys Analysis

| Why? | Answer |
|---|---|
| 1. What failed? | [e.g., Worker crashed processing GitHub webhook] |
| 2. Why did it fail? | [e.g., Unhandled exception in issue parser] |
| 3. Why was the exception unhandled? | [e.g., Missing try/catch for malformed payload] |
| 4. Why was the malformed payload not caught earlier? | [e.g., No webhook payload schema validation] |
| 5. Why was schema validation missing? | [e.g., Not included in original spec / priority gap] |

### Contributing Factors

- [Factor 1, e.g., No monitoring on worker memory usage]
- [Factor 2, e.g., Manual deployment without CI gate]

### What Went Well

- [e.g., Alert fired within 2 minutes of failure]
- [e.g., Playbook steps were accurate]

### What Went Wrong

- [e.g., Post-mortem not started until 24h after incident]
- [e.g., Communication delayed to customers]

---

## Impact Assessment

| Metric | Value |
|---|---|
| **Users affected** | N users / N repos |
| **Incidents not processed** | N |
| **Data loss** | Yes / No (details: [if yes]) |
| **Financial impact** | $N (lost transactions / credits) |
| **Downtime** | Xh Ym (total service impairment) |
| **PagerDuty alerts triggered** | N |
| **Customer support tickets** | N |

### Blast Radius Detail

[List repos, users, or features affected. Include any secondary impacts.]

---

## Action Items

| # | Action | Type | Owner | Deadline | Status |
|---|---|---|---|---|---|
| 1 | [e.g., Add try/catch in issue parser] | Fix | @engineer | YYYY-MM-DD | Open |
| 2 | [e.g., Add webhook payload validation middleware] | Test | @engineer | YYYY-MM-DD | Open |
| 3 | [e.g., Add worker OOM alert to Prometheus] | Monitor | @devops | YYYY-MM-DD | Open |
| 4 | [e.g., Update playbook for this failure mode] | Doc | @on-call | YYYY-MM-DD | Open |
| 5 | [e.g., Add schema validation to CI pipeline] | Test | @devops | YYYY-MM-DD | Open |
| 6 | [e.g., Run restore drill for affected data] | Fix | @devops | YYYY-MM-DD | Open |

### Action Item Types

| Type | Description |
|---|---|
| **Fix** | Code/config change that prevents recurrence |
| **Test** | Test that would have caught this issue |
| **Monitor** | Alert or dashboard that would have detected earlier |
| **Doc** | Playbook or runbook update |
| **Process** | Team workflow or communication change |

---

## Lessons Learned

### What Would We Do Differently?

1. [e.g., "Add webhook payload validation before enqueuing"]
2. [e.g., "Implement canary deployments for worker changes"]
3. [e.g., "Set up cross-team on-call for weekend coverage"]

### What Should We Keep Doing?

1. [e.g., "PagerDuty integration worked well — alerts were immediate"]
2. [e.g., "Playbooks for queue depth were accurate"]

### Surprises

- [e.g., "The failure was in code that hadn't been touched in 6 months"]
- [e.g., "GitHub API rate limits were the actual bottleneck, not our workers"]

---

## Follow-Up Review

| Item | Details |
|---|---|
| **Post-mortem review date** | YYYY-MM-DD (within 5 business days) |
| **Review participants** | @on-call, @devops-lead, affected team lead |
| **Action item review date** | YYYY-MM-DD (30 days post-incident) |
| **Incident closed in PagerDuty** | Yes / No |

---

## Attachments

- [Link to Grafana dashboard snapshot]
- [Link to Sentry error trace]
- [Link to PagerDuty incident]
- [Link to Slack thread]
- [Link to relevant deploy or code change]

---

## Approval

| Role | Name | Date | Signature |
|---|---|---|---|
| Incident Commander | | YYYY-MM-DD | |
| DevOps Lead | | YYYY-MM-DD | |
| Engineering Manager | | YYYY-MM-DD | |
| CTO (if SEV-1) | | YYYY-MM-DD | |

---

*This post-mortem is blameless. We are looking for systemic improvements, not individual mistakes.*
