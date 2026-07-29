# STAS Launch Day Run Sheet — T-60min to T+48h

> **Launch Commander**: Marketing Lead
> **Purpose**: Condensed checklist for launch-day execution. Print this sheet.
> **Slack Channels**: `#launch-war-room` (coordination), `#launch-alerts` (infra), `#launch-metrics` (automated)

---

## Pre-Launch — T-60min to T-5min

| Time (ET) | Action | Owner | Verification |
|-----------|--------|-------|--------------|
| T-60min | Deploy final version to staging | Engineer A | Staging smoke tests pass |
| T-50min | Push GitHub release tag (v1.0.0) | Engineer A | Tag visible on repo |
| T-45min | Run `scripts/pre-launch-smoke-test.sh` | Engineer B | All 37 tests pass |
| T-30min | Verify monitoring dashboards live | Engineer B | Grafana / Plausible / GH Insights |
| T-15min | Confirm all social accounts logged in | Marketing Lead | HN, Reddit, Twitter/X, PH |
| T-10min | Team roll call in `#launch-war-room` | Launch Commander | All present, all roles confirmed |
| T-5min | Final go/no-go with Launch Commander | Launch Commander | Issue final approval |

**Monitor**: `#launch-alerts` for infra warnings, staging health endpoint

---

## H-1 — HN Launch Window (T+0min to T+60min)

| Time (ET) | Action | Owner | Verification |
|-----------|--------|-------|--------------|
| T+0min | **SUBMIT SHOW HN** | Launch Commander | Link posted in `#launch-war-room` |
| T+2min | Supporters upvote + first comments (5 people) | Community Lead | Confirmed in DM thread |
| T+5min | Monitor HN `/newest` — flag if buried | All | Check every 2min |
| T+15min | **Traction check**: HN points ≥ 5? | Launch Commander | Yes → Reddit drop; No → Plan B |
| T+30min | Post HN traction update in `#launch-metrics` | Community Lead | Screenshot of HN ranking |
| T+45min | Respond to all HN comments (target: <10min) | All | Zero unanswered |

**Monitor**: HN ranking, HN comments, `#launch-alerts`
**On Shift**: Launch Commander, Community Lead, Engineer A, Engineer B

---

## HN Drop — T+15min (Conditional on HN Traction)

| Time (ET) | Action | Owner | Verification |
|-----------|--------|-------|--------------|
| T+15min | Submit `r/programming` post | Content Lead | Link shared in `#launch-war-room` |
| T+16min | Submit `r/devtools` post | Content Lead | Different angle from `r/programming` |
| T+17min | Submit `r/MachineLearning` post | Content Lead | ML/AI angle |
| T+20min | Supporters comment on Reddit posts | Community Lead | 2-3 organic-feeling comments each |
| T+25min | Verify no HN→Reddit cross-linking | Launch Commander | All Reddit posts link to STAS site |
| T+30min | Reddit traction report in `#launch-metrics` | Content Lead | Upvotes + comments across all 3 posts |

**Monitor**: Reddit upvote velocity, comment quality
**Rule**: Link to STAS website, NOT to the HN post

---

## Reddit Drop — T+30min to T+60min

| Time (ET) | Action | Owner | Verification |
|-----------|--------|-------|--------------|
| T+30min | Publish Twitter/X launch thread (10 tweets) | Marketing Lead | Pinned to profile |
| T+32min | All team members retweet + quote tweet | All | Confirm in `#launch-war-room` |
| T+35min | DM 5-10 dev influencers with demo link | Marketing Lead | Personalized messages |
| T+45min | Cross-post to dev Discord/Slack communities | Community Lead | Coolify, Supabase, Plausible, etc. |
| T+50min | Trigger newsletter send (pre-notified list) | Marketing Lead | Confirm send in `#launch-war-room` |
| T+55min | Engagement check — respond to ALL comments | All | Zero unanswered on HN + Reddit |

**Monitor**: Twitter/X engagement, Discord invite clicks
**On Shift**: Full team

---

## PH Drop — T+60min to T+90min

| Time (ET) | Action | Owner | Verification |
|-----------|--------|-------|--------------|
| T+60min | **SUBMIT PRODUCT HUNT LISTING** | Launch Commander | Maker comment ready |
| T+62min | Publish maker comment | Launch Commander | Product background + story |
| T+63min | Supporters upvote + comment (5 people) | Community Lead | Comments feel authentic |
| T+65min | Share PH link in `#launch-war-room` | Launch Commander | Everyone upvotes |
| T+75min | PH upvote trajectory report | Content Lead | Every 15min in `#launch-metrics` |
| T+90min | Cross-platform engagement sweep | All | HN + Reddit + PH + Twitter — all responded |

**Monitor**: PH ranking (goal: top 5 daily), `#launch-alerts`
**On Shift**: Launch Commander, Content Lead, Community Lead, Engineer A

---

## Sustained — T+2h to T+24h

| Time | Action | Owner | Notes |
|------|--------|-------|-------|
| T+2h | Shift handoff — Day team → Evening team | Launch Commander | Brief in `#launch-war-room` |
| T+3h | Second wave of social sharing (quote HN comments) | Marketing Lead | New tweets, no reposts |
| T+4h | Interim metrics report in `#launch-metrics` | Content Lead | Stars, visits, signups, fixes run |
| T+6h | Evening engagement check — respond to backlog | Evening Team | Target: <30min response |
| T+8h | Night watch handoff | Evening Team | 1 engineer on-call |
| T+12h | Night watch check — any incidents? | On-Call Eng | Log in `#launch-alerts` |
| T+18h | Morning prep — review overnight metrics | Launch Commander | Prepare for T+24h wave |
| T+24h | **T+24h wave**: Thank-you post on HN (if front page) | Launch Commander | Also tweet + LinkedIn |

**Monitor**: GitHub star velocity, signup rate, error rates, `#launch-alerts`
**On Shift (Days)**: Launch Commander, Marketing Lead, Content Lead, Engineer A
**On Shift (Evenings T+2h→T+10h)**: Community Lead, Engineer B, Ops Lead
**Night Watch (T+10h→T+22h)**: Engineer C (on-call)

---

## T+24h — Amplification Wave 2

| Time (ET) | Action | Owner | Verification |
|-----------|--------|-------|--------------|
| T+24h | Check HN front page status | Launch Commander | Screenshot to `#launch-metrics` |
| T+24h+15m | Post thank-you/update comment on HN if trending | Launch Commander | Grateful + "what we learned" tone |
| T+24h+30m | Second round of social sharing (engagement quotes) | Marketing Lead | Pull quotes from HN/Reddit comments |
| T+25h | Follow up on newsletter non-responders | Marketing Lead | Re-send with updated stats |
| T+26h | Cross-post to LinkedIn (professional angle) | Content Lead | "How our OSS project hit HN front page" |
| T+28h | Open awesome-list PRs | Engineer A | awesome-selfhosted, awesome-github, etc. |
| T+30h | Metrics snapshot in `#launch-metrics` | Content Lead | 24h vs 48h targets |

**Monitor**: GH star count, website traffic trend, signup conversion rate
**On Shift**: Full team (reduced — respond to comments as they come)

---

## T+48h — Post-Launch Recovery & Metrics

| Time (ET) | Action | Owner | Verification |
|-----------|--------|-------|--------------|
| T+48h | Compile final launch metrics | Content Lead | Stars, visits, signups, stars, fixes, conversions |
| T+48h+30m | Respond to all remaining unanswered comments | All | Zero orphaned threads |
| T+49h | "Launch week in numbers" transparency post | Marketing Lead | Stars, visitors, fixes run, feedback highlights |
| T+50h | Conduct launch retrospective meeting | Launch Commander | All team members attend |
| T+51h | Publish launch retrospective doc | Launch Commander | What went well, what didn't, surprises |
| T+52h | Plan next 30-day content sprint | Content Lead | Blog posts, features, community building |

**Monitor**: All metrics — compile into retrospective report
**On Shift**: All (post-launch debrief)

---

## Escalation Contacts

| Severity | Condition | Contact | Response SLA |
|----------|-----------|---------|--------------|
| **Sev1** | Site down, auth broken, data loss | **Phone tree**: Launch Commander → Engineer A → Ops Lead | 5min response |
| **Sev2** | Slow performance, non-critical bug | `#launch-alerts` only — fix after launch window | 1h response |
| **Sev3** | Cosmetic, typo, minor UI glitch | Log in `#launch-metrics`, fix within 48h | 48h response |

**Launch Commander**: Marketing Lead (DM: @marketing-lead)
**Engineering Lead**: Engineer A (DM: @engineer-a)
**Infra Escalation**: Engineer C (DM: @engineer-c)

---

## Success Metrics — Track in `#launch-metrics`

| Metric | 24h Target | 48h Target | Actual |
|--------|-----------|-----------|--------|
| GitHub Stars | 100+ | 200+ | |
| Website Visitors | 1,000+ | 2,000+ | |
| HN Points | 50+ | — | |
| PH Upvotes | — | 100+ | |
| Free Signups | 25+ | 50+ | |
| Discord Members | 25+ | 50+ | |
| Fixes Run | 10+ | 20+ | |
| Paid Conversions | — | 5+ | |
