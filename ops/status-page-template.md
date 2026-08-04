---
title: Status Page Template
status: active
last-updated: 2026-07-28
---

# SYNTARO Status Page Templates

> Templates for communicating incidents to users via the public [status page](https://syntaro.betteruptime.com).
> SYNTARO — Customer Communication Guide

---

## 1. Status Lifecycle

Every incident follows this lifecycle on the status page:

```
Investigating ──→ Identified ──→ Monitoring ──→ Resolved
     │                │               │              │
     v                v               v              v
  We know     We found the      Fix is live,   Everything is
  something   root cause        watching for    back to normal
  is wrong                       side effects
```

### State Transitions

| From | To | When |
|---|---|---|
| — | Investigating | Alert received, confirmed real |
| Investigating | Identified | Root cause determined |
| Identified | Monitoring | Fix deployed, verifying |
| Monitoring | Resolved | No recurrence within monitoring window |
| Any | Resolved | Incident resolved without monitoring period |

**All incidents must pass through at least Investigating and Resolved.** Identified and Monitoring may be skipped for trivial incidents.

---

## 2. Status Update Templates

### Investigating

> **Investigating** — We are currently investigating an issue affecting [service/feature].
>
> Users may experience [symptoms, e.g., "delays in issue processing" / "errors when creating tickets" / "the dashboard not loading"].
>
> We will provide another update within [timeframe, e.g., "30 minutes"] or when we have more information.
>
> Started at: [timestamp UTC]

### Identified

> **Identified** — We have identified the root cause of the issue affecting [service/feature].
>
> Root cause: [one-sentence explanation, e.g., "A database connection pool was exhausted due to a spike in concurrent requests."]
>
> We are working on a fix and expect to have it deployed within [ETA].
>
> Affected users may continue to experience [symptoms] until the fix is deployed.

### Monitoring

> **Monitoring** — A fix has been deployed for the issue affecting [service/feature].
>
> We are monitoring the results closely to confirm that the fix is working as expected.
>
> We expect to resolve this incident within [timeframe] if no further issues are detected.

### Resolved

> **Resolved** — The issue affecting [service/feature] has been resolved and all systems are operating normally.
>
> Incident duration: [Xh Ym]
> Root cause: [one-sentence description]
>
> A post-mortem will be published within 5 business days detailing the root cause and steps we are taking to prevent recurrence.
>
> We apologize for any inconvenience this may have caused.

---

## 3. Communication Principles

### Language Guidelines

| ✅ Do | ❌ Don't |
|---|---|
| Use clear, plain language | Use jargon, acronyms, or internal terminology |
| Say what's happening in simple terms | Say "we are investigating the issue" without any details |
| Provide ETA when available | Give false precision ("we'll fix it in 10 minutes") |
| Acknowledge impact honestly | Downplay or hide the severity |
| Use "we" consistently | Blame users, vendors, or individual team members |
| Update proactively — even if no new info | Go silent for hours |
| Thank users for patience | Be defensive or dismissive |
| Specify scope ("affecting Pro-tier users") | Be vague ("some users") |

### Tone Guidelines

| Severity | Tone | Example |
|---|---|---|
| SEV-1 (Down) | Direct, urgent, empathetic | "SYNTARO is currently unable to process new issues. We understand this is disruptive and are working urgently to restore service." |
| SEV-2 (Broken) | Clear, informative | "Issue processing is delayed for some repositories. Our workers are experiencing higher than normal latency." |
| SEV-3 (Degraded) | Informative, reassuring | "Some users may see slower-than-normal response times. No data has been lost." |
| SEV-4 (Cosmetic) | Brief, light | "The dashboard is showing stale data for some users. We are refreshing the cache." |

### When to Post

| Condition | Action |
|---|---|
| Incident acknowledged, SEV-1 or SEV-2 | Post "Investigating" within 5 minutes |
| Incident acknowledged, SEV-3 | Post "Investigating" within 15 minutes |
| Root cause found | Post "Identified" immediately |
| Fix deployed | Post "Monitoring" immediately |
| Service restored | Post "Resolved" immediately |
| No update for 2 hours | Post "No change — still investigating" |
| Incident escalated | Update status page with new ETA |
| Post-mortem published | Link from resolved status page |

---

## 4. Component Status Labels

Use these on the status page for individual components:

| Label | Definition | Icon |
|---|---|---|
| Operational | Service is functioning normally | ✅ |
| Degraded Performance | Service is running slower than normal | ⚠️ |
| Partial Outage | Service is partially unavailable | 🔶 |
| Major Outage | Service is completely unavailable | 🔴 |
| Maintenance | Scheduled maintenance in progress | 🔧 |

---

## 5. Scheduled Maintenance Template

> **Maintenance** — We will be performing scheduled maintenance on [service] on [date] from [start] to [end UTC].
>
> During this window, affected services may be briefly unavailable or experience degraded performance.
>
> We will update this notice when maintenance is complete.

---

## 6. Multi-Incident Coordination

If multiple incidents are active simultaneously, each incident gets its own status update:

```
Current Status:
├── 🔴 Major Outage — Webhook Processing (Investigating)
├── ⚠️ Degraded Performance — Worker Queue (Monitoring)
└── ✅ All other systems operational
```

---

## 7. Example: Complete Incident Flow

### T+0min (Investigating)

> **Investigating** — We are investigating reports of delayed issue processing. Workers are experiencing higher latency than normal. We will update within 30 minutes.

### T+12min (Identified)

> **Identified** — We have identified that a database connection pool was exhausted, causing workers to queue jobs slower than normal. We are scaling the connection pool and expect resolution within 15 minutes.

### T+25min (Monitoring)

> **Monitoring** — The connection pool has been scaled and workers are processing jobs at normal speed. We are monitoring the queue drain.

### T+40min (Resolved)

> **Resolved** — The connection pool issue has been resolved and all queued jobs have been processed. No data was lost. A post-mortem will be published within 5 business days. We apologize for any inconvenience.

---

## 8. Post-Incident Communication

### Post the following to the status page after resolution:

- Link to resolved incident
- Duration summary
- Root cause (one line)
- Link to post-mortem (when published)

### Post to `#syntaro-incidents` (internal):

```
Incident: INC-NNNN resolved.
Service: [service]
Duration: Xh Ym
Severity: SEV-N
Root cause: [one line]
Action items: [link to post-mortem]
```
